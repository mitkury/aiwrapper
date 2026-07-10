# Build

AIWrapper is an npm-first ESM package for Node.js 20 and newer. Source files use TypeScript and explicit `.js` extensions in relative imports so the same specifiers work in emitted JavaScript and declarations.

```bash
npm run build
```

The build has two stages:

1. `npm run clean` removes the previous `dist` directory.
2. TypeScript compiles `src` to ESM JavaScript, source maps, and declarations in `dist`.

There is no bundling or post-build import rewriting. Keep relative source imports ending in `.js` and let TypeScript resolve them to their `.ts` sources.

Run the complete deterministic package check with `npm run check`.

`package.json` publishes only `dist`, `LICENSE`, and npm's standard package files.
