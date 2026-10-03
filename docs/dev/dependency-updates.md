# Dependency updates

AIModels is a pinned Git submodule whose compiled catalog ships inside
AIWrapper. Other dependencies use normal npm updates and review.

## Catalog automation

[update-aimodels.yml](../../.github/workflows/update-aimodels.yml) checks upstream
`main` hourly, on manual runs, and on `aimodels-updated` or legacy
`aimodels-package-updated` notifications. A notification's `sha` selects an
exact commit; a legacy `version` only wakes the main-branch check.

The updater skips repeated, older, and documentation-only revisions. Dirty or
diverged submodules stop the update. Changes to catalog data, runtime, build
inputs, or license advance the pin, regenerate `src/aimodels/`, bump
AIWrapper's patch version, and run package and playground checks. It then atomically pushes the default branch
and release tag; concurrent branch changes cause the push to fail.

It explicitly dispatches [publish.yml](../../.github/workflows/publish.yml) at
that tag because `GITHUB_TOKEN` pushes do not trigger another push workflow.
Breaking catalog changes require manual review. No upstream npm release is
needed.

## Setup and recovery

Automation runs from the default branch. Its `GITHUB_TOKEN` needs contents and
actions write permissions, and branch rules must allow the release commit.
Hourly checks need no cross-repository secret; dispatch notifications use
their configured token. Configure npm trusted publishing as described in the
[publishing rules](rules/how-to-publish.md).

Publication checks that the tag matches the package version and skips versions
already on npm. Only a missing-version response counts as unpublished; other
registry errors stop the workflow. The updater retries a missed dispatch for
the current release tag. Retry a failed publish manually with:

```sh
gh workflow run publish.yml --ref v<aiwrapper-version>
```

For local catalog changes, see [AIModels](aimodels.md). For other dependencies,
use `npm outdated` and `npm audit`, then review and test updates before applying
automatic fixes or major upgrades.
