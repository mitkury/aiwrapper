# AIWrapper for Rust

A universal AI wrapper for Rust. One message and tool-calling API across language
providers, with separate interfaces for live models, speech, and agents.

```toml
[dependencies]
aiwrapper = "0.1"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

```rust,no_run
use aiwrapper::{ChatOptions, Lang, Provider, ProviderConfig};

#[tokio::main]
async fn main() -> aiwrapper::Result<()> {
    let lang = Lang::new(
        ProviderConfig::new(Provider::Openai, "gpt-4.1-mini")
            .with_api_key(std::env::var("OPENAI_API_KEY").expect("API key")),
    )?;
    println!("{}", lang.ask("Explain Rust ownership briefly.", &ChatOptions::default()).await?.answer());
    Ok(())
}
```

Model names stay explicit. The default `catalog` feature embeds the
[AIModels](https://github.com/mitkury/aimodels) catalog, re-exported as
`aiwrapper::models()`, and uses it to size output and gate reasoning parameters
for known models.

See the [native guide](https://github.com/mitkury/aiwrapper/blob/main/docs/native.md)
for agents, compression, injected transports, frontend integration, live sessions
and the compatibility matrix. The crate is versioned separately from the
[npm package](https://www.npmjs.com/package/aiwrapper), and its API may change
between 0.x releases.
