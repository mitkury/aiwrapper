use crate::{CancellationToken, Error, Result};
use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    future::Future,
    sync::{Arc, Mutex},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Clone)]
pub struct ToolContext {
    pub call_id: String,
    pub name: String,
    pub cancellation: CancellationToken,
}

type Handler = dyn Fn(Value, ToolContext) -> BoxFuture<'static, Result<Value>> + Send + Sync;
/// The compiled parameter schema with the schema it was compiled from.
type CompiledSchema = Arc<Mutex<Option<(Value, Arc<jsonschema::Validator>)>>>;

#[derive(Clone)]
pub struct Tool {
    pub definition: ToolDefinition,
    handler: Arc<Handler>,
    validator: CompiledSchema,
}

impl Tool {
    pub fn new<F, Fut>(
        name: impl Into<String>,
        description: impl Into<String>,
        parameters: Value,
        handler: F,
    ) -> Self
    where
        F: Fn(Value, ToolContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Value>> + Send + 'static,
    {
        Self {
            definition: ToolDefinition {
                name: name.into(),
                description: description.into(),
                parameters,
            },
            handler: Arc::new(move |args, context| Box::pin(handler(args, context))),
            validator: CompiledSchema::default(),
        }
    }
    /// Compile the parameter schema once; recompile only if `definition` changed.
    pub(crate) fn validator(&self) -> Result<Arc<jsonschema::Validator>> {
        let mut cache = self.validator.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((schema, validator)) = cache.as_ref()
            && schema == &self.definition.parameters
        {
            return Ok(validator.clone());
        }
        let validator = Arc::new(
            jsonschema::validator_for(&self.definition.parameters)
                .map_err(|e| Error::Schema(e.to_string()))?,
        );
        *cache = Some((self.definition.parameters.clone(), validator.clone()));
        Ok(validator)
    }
    pub async fn execute(&self, arguments: Value, context: ToolContext) -> Result<Value> {
        crate::error::check_cancel(&context.cancellation)?;
        self.validator()?
            .validate(&arguments)
            .map_err(|e| Error::Schema(e.to_string()))?;
        // Do not drop a handler after it has started: it may have side effects.
        // The handler receives cancellation and must return a truthful outcome.
        (self.handler)(arguments, context).await
    }
}

pub(crate) fn validate_schema(schema: &Value, value: &Value) -> Result<()> {
    let validator = jsonschema::validator_for(schema).map_err(|e| Error::Schema(e.to_string()))?;
    validator
        .validate(value)
        .map_err(|e| Error::Schema(e.to_string()))
}

/// Explicit multimodal tool output, matching the TypeScript wire representation.
pub fn tool_content(parts: Vec<Value>) -> Result<Value> {
    if parts.is_empty() {
        return Err(Error::Invalid("tool content cannot be empty".into()));
    }
    Ok(json!({"type":"tool-content", "content":parts}))
}
