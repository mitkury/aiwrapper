# Working with the AIModels catalog

`aimodels/` pins a commit of [mitkury/aimodels](https://github.com/mitkury/aimodels)
as a Git submodule. `src/aimodels/` is its built runtime, declarations, and
license, generated from the pinned commit and committed. AIWrapper's build and
its consumers use that copy; npm consumers need neither Git nor a separate
`aimodels` dependency, and source checkouts need the submodule only to change
the catalog. CI fails when the committed copy differs from a fresh build.

Import `models` and `Model` from `aiwrapper` to share the providers' catalog
instance. A separately installed `aimodels` has its own instance and classes.

## Checkout and edit

Initialize with `git submodule update --init --recursive`. `npm run
aimodels:build` installs the submodule's locked dependencies on first use and
when its lockfile changes, validates data, runs its tests, and regenerates
`src/aimodels/`.

Read `aimodels/AGENTS.md` before editing canonical records in `aimodels/data/`
or runtime code in `aimodels/js/src/`. Create a branch inside a detached
submodule before editing. Then run:

```sh
npm run aimodels:build
npm run check
npm run check:playground
```

Never edit the generated copy by hand. Push catalog changes upstream first,
then commit the submodule pointer and the regenerated copy together. Publish
only pointers that other checkouts can fetch.

## Update

```sh
npm run aimodels:status
npm run aimodels:update
npm run aimodels:build
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
