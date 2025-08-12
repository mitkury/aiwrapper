Test categories

- Image input tests: files matching `images-in-*.test.*` and `*vision*.int.test.*`
  - Run once: `npm run test:img-in`
  - Watch: `npm run test:watch:img-in`
- Image output tests: files matching `images-out-*.test.*` (placeholder for future)
  - Run once: `npm run test:img-out`

Notes
- Integration vision tests require API keys and sometimes regional access. They are skipped unless keys are present (and for some providers may still be skipped until enabled).

