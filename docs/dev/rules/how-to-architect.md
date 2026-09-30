# How to architect

AIWrapper should remain small enough that one person or agent can explain the
whole runtime without a diagram.

Keep the main boundaries simple:

- `LangMessages` is the provider-neutral conversation model.
- `LanguageProvider` defines the common request lifecycle.
- Provider modules translate messages, tools, options, and streams at the API edge.
- `ChatAgent` owns orchestration, not provider protocol details.
- Image APIs stay separate from chat unless the shared message model genuinely applies.

Prefer a direct helper over a framework. Add a shared abstraction only when
several providers need the same behavior and the abstraction removes real
duplication without hiding protocol differences.

Public APIs should be boring and explicit. Before changing message shapes,
tool-result semantics, lifecycle flags, or exports, inspect every provider and
the browser playground because those changes cross most of the package.

Agent implementations must support both embedding in a local process and
independent hosting. Keep runnable agents in separate packages in this
repository as they are extracted, with importable and executable entrypoints
over the same core. Supply credentials, tools, storage and host services
explicitly; never import a consuming application's API internals. Keep remote
control and media transport in host adapters, outside provider modules.
