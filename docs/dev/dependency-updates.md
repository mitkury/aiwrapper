# Dependency updates

Most dependencies are updated through normal pull requests. AIModels is a pinned
Git submodule; AIWrapper's npm package includes its compiled catalog instead of
fetching an `aimodels` npm dependency.

## Automatic catalog updates

`.github/workflows/update-aimodels.yml` checks upstream `main` hourly. It also
accepts `aimodels-updated` and legacy `aimodels-package-updated` repository
notifications, plus manual workflow runs. No upstream npm release is required.
An optional notification `sha` selects an exact upstream commit. Legacy
`version` notifications simply wake the main-branch check.

The workflow:

1. Fetches upstream `main` and compares it with the pinned catalog commit.
2. Skips repeated, older, and documentation-only updates. Uncommitted edits or
   diverged history stop the update without replacing local work.
3. Advances the submodule, increments AIWrapper's patch version (for example,
   `4.0.0` to `4.0.1`), and runs package and browser playground checks.
4. Commits the pointer and version files, then atomically pushes the default
   branch and release tag. A concurrent branch update causes this push to fail.
5. Explicitly dispatches `publish.yml` at that tag. Tag pushes made with
   `GITHUB_TOKEN` do not trigger another push workflow.

Only changes under the upstream data, JavaScript runtime, build inputs, or
license cause a patch release. An upstream API change that breaks the checks
requires manual review. No website deployment is part of this workflow.

## Activation and recovery

The workflows become active when merged into the default branch. The updater
uses `GITHUB_TOKEN` with contents and actions write permissions; branch rules
must permit the automation's release commit. It needs no cross-repository
secret for hourly checks because the upstream repository is public. Existing
upstream dispatch notifications can still use their configured token.

The `aiwrapper` package must trust `mitkury/aiwrapper`'s `publish.yml` through
npm trusted publishing, with direct `npm publish` allowed. See
[publishing rules](rules/how-to-publish.md).

Publication verifies the tag against the package version and skips a version
already on npm. A later updater run retries publication if the current release
tag was pushed but dispatch failed. A failed publish can also be retried with:

```bash
gh workflow run publish.yml --ref v<aiwrapper-version>
```

Registry errors other than a missing version stop the workflow rather than
being treated as evidence that a version is unpublished.

## Local work

See [working with AIModels](aimodels.md) to edit, build, or advance the catalog
inside this checkout. Other dependencies still use normal npm commands:

```bash
npm outdated
npm audit
```

Use `npm audit fix` only after reviewing its proposed dependency changes. Do not
use `--force` without testing the required major upgrades.
