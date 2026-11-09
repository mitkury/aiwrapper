# AIWrapper for Rust

An embeddable async library for streaming language models, tool agents, context
compression, speech and native live voice. The crate does not start a server.

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

See the [native guide](https://github.com/mitkury/aiwrapper/blob/main/docs/native.md)
for agents, compression, injected transports, frontend integration, live sessions
and the compatibility matrix. The crate is versioned separately from the
[npm package](https://www.npmjs.com/package/aiwrapper), and its API may change
between 0.x releases.
