# How to test

`npm test` builds the package and runs deterministic unit tests. Credential-backed provider tests are separate so CI and releases do not depend on API keys or live services.

Use non-interactive Vitest runs so commands finish on their own. Prefer `vitest run` or the existing npm test scripts.

Useful commands:

`npm test`

`npm run test:unit`

`npm run test:integration`

`npm run test:all`

`npm run test:lang`

`npm run test:tools`

`npm run test:agents`

`npm run test:img-in`

`npm run test:img-out`

`npm run test:model`

To run a specific suite against one provider, set `PROVIDERS` and use `vitest run`.

Example:

`PROVIDERS=openai npx vitest run tests/agents/chat-agent.integration.test.ts`

Run `npm run check` before committing build, package, or CI changes.

To test new models before they are published to npm, use `npm run aimodels:link`, then switch back with `npm run aimodels:unlink`. The local `aimodels` repo must be available at `../aimodels/js`. See [docs/dev/aimodels-linking.md] for details.
