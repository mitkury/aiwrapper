# AIWrapper for Rust

An embeddable async library for streaming language models, tool agents, context
compression, speech and native live voice. The crate does not start a server.

Use a path dependency during development:

```toml
[dependencies]
aiwrapper = { path = "../aiwrapper/native" }
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

See the repository's [native guide](../docs/native.md) for agents, compression,
injected transports, frontend integration, live sessions and the compatibility
matrix. Version 0.1 is an additive native implementation; the npm package remains
available. This crate has not been published to crates.io.
