# AIWrapper

AIWrapper provides a JavaScript/TypeScript package and an embeddable Rust crate.

Start with:

- [README.md](README.md) and the [documentation index](docs/README.md)
- [Shared agent guidance](docs/airul/README.md): rules and focused actions
- [Local development rules](docs/dev/rules/README.md): AIWrapper-specific guidance
- The user and development docs relevant to the task

Read the relevant shared and local rules before working. Local rules take
precedence over shared defaults. For a focused task, use the
[agent actions](docs/dev/actions-for-agents/README.md).

If the shared docs are missing, initialize their pinned submodule from the repo
root:

```sh
git submodule update --init docs/airul
```

Keep detailed guidance in the appropriate documentation file instead of
expanding this entry point.
