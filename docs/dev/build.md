# Build

AIWrapper is an npm-first ESM package for Node.js 20+ and modern browsers.
Source files use TypeScript and explicit `.js` extensions in relative imports so
the same specifiers work in emitted JavaScript, declarations, and browser
bundles.

```bash
npm run build
```

Initialize the pinned catalog with `git submodule update --init --recursive`
before the first build. The build has three stages:

1. Build the AIModels submodule and refresh its generated runtime and declarations in `src/aimodels/`.
2. Remove the previous `dist` directory and compile AIWrapper with TypeScript.
3. Copy the compiled catalog and its license to `dist/aimodels/`.

AIWrapper itself uses TypeScript compilation without import rewriting. Keep
relative source imports ending in `.js`. Only the upstream catalog is bundled,
using AIModels' own build configuration.

The library relies on standard web APIs (`fetch`, streams, `Blob`, and
`FormData`) that are available in supported Node.js and browser environments.
Do not add Node.js built-in imports or unguarded Node globals to public runtime
code. `npm run check:playground` builds the Svelte browser playground against
`src` and is the browser-compatibility build check.

Run the complete package check with `npm run check`. Unit tests are
deterministic; the package check also packs a tarball, installs it in a temporary
consumer, and verifies runtime imports and TypeScript declarations. That clean
install needs npm registry access for AIWrapper's other dependencies.

`package.json` publishes only `dist`, `LICENSE`, and npm's standard package files.
