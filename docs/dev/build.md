# Build

Initialize the pinned [agent guidance](../airul/README.md) when setting up a
contributor checkout:

```sh
git submodule update --init docs/airul
```

AIWrapper builds an ESM package for Node.js 20+ and modern browsers, plus an
independent [Rust crate](../native.md). For the TypeScript package, install
dependencies before the first build:

```sh
npm ci
npm run build
```

The build compiles AIWrapper into a fresh `dist/` with TypeScript, then copies
the committed catalog in `src/aimodels/` to `dist/aimodels/`. It needs neither
the `aimodels/` submodule nor a shell, so it runs the same on Windows. See
[AIModels](aimodels.md) for regenerating the catalog.

Only the catalog is bundled; AIWrapper uses TypeScript compilation without
import rewriting. Keep explicit `.js` extensions in relative source imports.

Public runtime code uses standard web APIs. Avoid Node-only imports and
unguarded Node globals. `npm run check:playground` checks browser compatibility
by building the playground against local source.

`npm run check` builds, runs unit tests, and installs a packed tarball into a
clean temporary consumer to verify runtime imports and TypeScript declarations.
It needs npm registry access for dependencies. The published package contains
`dist/`, `LICENSE`, and npm's standard package files.

For the native library, use `cargo build --locked -p aiwrapper` and
`npm run native:check`. The docs submodule is development guidance; neither the
npm build nor the Rust build reads it.
