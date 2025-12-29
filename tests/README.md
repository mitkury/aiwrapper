Test categories

- Image input tests: files matching `images-in-*.test.*` and `*vision*.int.test.*`
  - Run once: `npm run test:img-in`
  - Watch: `npm run test:watch:img-in`
- Image output tests: files matching `images-out-*.test.*` (placeholder for future)
  - Run once: `npm run test:img-out`

- Text tests (regular, structured, reasoning):
  - Run once: `npm run test:text`

- Tools/function calling tests:
  - Run once: `npm run test:tools`

- Model-specific tests: quickly test any model from aimodels database
  - Run: `MODEL=<model-id> npm run test:model`
  - With provider: `MODEL="<model-id>@<provider>" npm run test:model`
  - Examples:
    - `MODEL=claude-3-7-sonnet-20250219 npm run test:model`
    - `MODEL="gpt-4@openai" npm run test:model`
  - The test automatically detects model capabilities and runs appropriate tests

Notes
- Integration vision tests require API keys and sometimes regional access. They are skipped unless keys are present (and for some providers may still be skipped until enabled).
- Model tests require the appropriate API key for the model's provider (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

