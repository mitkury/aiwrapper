# Working with the AIModels catalog

`aimodels/` pins a commit of [mitkury/aimodels](https://github.com/mitkury/aimodels)
as a Git submodule. AIWrapper bundles its runtime, declarations, and license;
npm consumers need neither Git nor a separate `aimodels` dependency.

Import `models` and `Model` from `aiwrapper` to share the providers' catalog
instance. A separately installed `aimodels` has its own instance and classes.

## Checkout and edit

Initialize with `git submodule update --init --recursive`, then follow the
[build guide](build.md). The build installs the submodule's locked dependencies
on first use and when its lockfile changes, validates data, and runs its tests.

Read `aimodels/AGENTS.md` before editing canonical records in `aimodels/data/`
or runtime code in `aimodels/js/src/`. Create a branch inside a detached
submodule before editing. Then run:

```sh
npm run aimodels:build
npm run check
npm run check:playground
```

`aimodels:build` refreshes the ignored `src/aimodels/` used by the playground.
Its dev command does this before Vite starts; rerun it after catalog edits
while Vite is running. Never edit the generated copy.

Commit and push catalog changes upstream before committing the parent
submodule pointer. Local uncommitted edits build but are not captured by a
parent commit. Publish only pointers that other checkouts can fetch.

## Update

```sh
npm run aimodels:status
npm run aimodels:update
npm run check
```

The updater fetches upstream `main` and advances only for catalog, runtime,
build-input, or license changes. It preserves local edits, refuses diverged
history, and skips repeated or older revisions. Select an exact commit or
stable tag with `npm run aimodels:update -- <ref>`.

After pulling AIWrapper, inspect local submodule changes with
`npm run aimodels:status`, then run `git submodule update --init --recursive`
to use its recorded revision. See [dependency updates](dependency-updates.md)
for automatic patch releases.
