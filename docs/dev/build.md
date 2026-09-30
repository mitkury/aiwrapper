# Build

AIWrapper is an ESM package for Node.js 20+ and modern browsers. Initialize the
pinned catalog and install dependencies before the first build:

```sh
git submodule update --init --recursive
npm ci
npm run build
```

The build validates, tests, and builds AIModels, refreshes the generated
`src/aimodels/`, compiles AIWrapper into a fresh `dist/`, then copies the catalog
and its license to `dist/aimodels/`. See [AIModels](aimodels.md) for catalog edits.
Only the catalog is bundled; AIWrapper uses TypeScript compilation without
import rewriting. Keep explicit `.js` extensions in relative source imports.

Public runtime code uses standard web APIs. Avoid Node-only imports and
unguarded Node globals. `npm run check:playground` checks browser compatibility
by building the playground against local source.

`npm run check` builds, runs unit tests, and installs a packed tarball into a
clean temporary consumer to verify runtime imports and TypeScript declarations.
It needs npm registry access for dependencies. The published package contains
`dist/`, `LICENSE`, and npm's standard package files.
