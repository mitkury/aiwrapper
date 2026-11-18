use aiwrapper::{Error, Provider, ProviderConfig, Result};

pub fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

// Host configuration only; the embeddable crate never reads the environment.
pub fn language_config(provider: Provider, model: String) -> Result<ProviderConfig> {
    let prefix = provider.as_str().replace('-', "_").to_uppercase();
    let mut config = ProviderConfig::new(provider, model);
    config.api_key = env(&format!("{prefix}_API_KEY"));
    if config.api_key.is_none()
        && !matches!(provider, Provider::Ollama | Provider::OpenaiCompatible)
    {
        return Err(Error::Invalid(format!(
            "{prefix}_API_KEY is not configured"
        )));
    }
    let base_url = env(&format!("{prefix}_BASE_URL")).or_else(|| match provider {
        Provider::Ollama => env("OLLAMA_URL"),
        _ => None,
    });
    if let Some(url) = base_url {
        config.base_url = url;
    }
    Ok(config)
}
