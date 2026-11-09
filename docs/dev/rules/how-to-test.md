# Testing

Use non-interactive tests. Keep deterministic checks separate from credential-
backed live tests so normal development and CI do not depend on provider access.
Choose checks for the affected code:

- TypeScript runtime, build, package or CI: `npm run check`.
- Rust runtime: `npm run native:check` (formatting, Clippy and deterministic tests).
- Playground, shared TypeScript exports or browser behavior:
  `npm run check:playground`.
- Native sandbox or its host adapter: `npm run native:test:sandbox`.
- Documentation only: verify commands, links and submodule references.

Run focused tests while working, then the relevant checks above before committing.
Do not add behavioral tests for documentation-only changes. Commands, provider
filters and live-test requirements are in the [testing guide](../../../tests/README.md).

Edit model data in the `aimodels/` submodule, regenerate the committed catalog
with `npm run aimodels:build`, and commit both; see [AIModels](../aimodels.md).
