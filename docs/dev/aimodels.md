# Working with the AIModels catalog

`aimodels/` is a Git submodule of [mitkury/aimodels](https://github.com/mitkury/aimodels).
AIWrapper pins a specific upstream commit. Its build includes the compiled
JavaScript catalog, declarations, and MIT license in `dist/aimodels/`, so npm
consumers do not need Git, the submodule, or an `aimodels` npm dependency.

Import catalog APIs from AIWrapper: `import { models, Model } from 'aiwrapper'`.
These exports and AIWrapper's providers share the same catalog instance. A
separately installed `aimodels` package has its own instance and class identity.

## First checkout

```bash
git clone --recurse-submodules https://github.com/mitkury/aiwrapper.git
cd aiwrapper
npm ci
npm run build
```

For an existing checkout, run `git submodule update --init --recursive` first.
The build installs the submodule's locked JavaScript build dependencies on first
use and when its lockfile changes. It then validates the data, builds AIModels,
and runs AIModels' deterministic tests. No npm publication or global link is needed.

## Edit and test in the same checkout

Read `aimodels/AGENTS.md` and its linked editing rules. Edit canonical catalog
records in `aimodels/data/`, or the implementation in `aimodels/js/src/`.

```bash
npm run aimodels:build
npm run check
npm run check:playground
```

`aimodels:build` refreshes the generated, ignored `src/aimodels/` directory that
the playground imports. `npm --prefix playground run dev` does this before
starting Vite. After editing the catalog while Vite is running, rerun
`npm run aimodels:build`. Never edit the generated copy.

Submodules keep their own history. Before editing from a detached checkout,
create a branch inside `aimodels/`. Commit and push catalog changes to its
upstream repository first, then commit the `aimodels` pointer in AIWrapper.
Local uncommitted edits can be built, but are not captured by a parent commit.
Publish only pointers that other checkouts can fetch.

## Get upstream updates

```bash
npm run aimodels:status
npm run aimodels:update
npm run check
```

The updater fetches upstream `main` and advances only when catalog, runtime,
build inputs, or license content changed. It preserves local edits, refuses
diverged history, and skips repeated or older revisions. An exact upstream
commit or stable tag can be selected with `npm run aimodels:update -- <ref>`.

After pulling AIWrapper changes, use `git submodule update --init --recursive`
to check out its recorded catalog revision. Review local submodule changes
before updating; `git status` and `npm run aimodels:status` show them separately.

Automatic patch releases are described in [dependency updates](dependency-updates.md).
