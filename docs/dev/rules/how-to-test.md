# How to test

Use non-interactive runs (`vitest run` or npm scripts). `npm test` builds and
runs deterministic unit tests; credential-backed integration checks stay
separate so default CI and releases do not depend on live services.

Run `npm run check` before committing build, package, or CI changes. Run
`npm run check:playground` for playground changes or browser compatibility.
Commands, provider filters, and live-test requirements are in the
[testing guide](../../../tests/README.md).

Edit model data in the `aimodels/` submodule and refresh it with
`npm run aimodels:build`; see [AIModels](../aimodels.md).
