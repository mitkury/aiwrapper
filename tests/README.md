# Tests

The suite contains deterministic unit tests and credential-gated provider integration tests.

## Commands

```bash
npm test
npm run test:lang
npm run test:tools
npm run test:agents
npm run test:img-in
npm run test:img-out
npm run test:reasoning
```

`npm test` runs the build first. When running `vitest` directly after source changes, run `npm run build` first.

Use `PROVIDERS` to limit integration tests:

```bash
PROVIDERS=openai npx vitest run tests/lang/basic-lang.test.ts
PROVIDERS=openai,anthropic npm run test:tools
```

Provider tests are skipped when the corresponding API key is absent. A present but expired or invalid key still causes a provider failure.

## Model check

Use `test:model` for one catalog entry:

```bash
MODEL=<model-id> npm run test:model
MODEL="<model-id>@<provider>" npm run test:model
```

The model test selects checks from the capabilities stored in `aimodels`. See [docs/dev/aimodels-linking.md](../docs/dev/aimodels-linking.md) to test unpublished catalog changes.

## Generated files

Image-output tests may write generated images under `tests/img-out`. Those files are ignored and should not be committed.
