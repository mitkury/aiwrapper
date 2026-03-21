# How to test

If you changed source files in `src`, run `npm run build` before running a targeted `vitest` command. You can skip the manual build when using `npm test` because `pretest` already builds first.

Use non-interactive Vitest runs so commands finish on their own. Prefer `vitest run` or the existing npm test scripts.

Useful commands:

`npm test`

`npm run test:lang`

`npm run test:tools`

`npm run test:agents`

`npm run test:img-in`

`npm run test:img-out`

`npm run test:reasoning`

`npm run test:model`

To run a specific suite against one provider, set `PROVIDERS` and use `vitest run`.

Example:

`PROVIDERS=openai npx vitest run tests/agents/chat-agent.test.ts`

To test new models before they are published to npm, use `npm run aimodels:link`, then switch back with `npm run aimodels:unlink`. The local `aimodels` repo must be available at `../aimodels/js`. See [docs/dev/aimodels-linking.md] for details.
