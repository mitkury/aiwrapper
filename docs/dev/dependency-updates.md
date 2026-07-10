# Dependency updates

Most dependencies are updated through normal pull requests. `aimodels` also has a repository-dispatch workflow because AIWrapper should react immediately when a new model catalog is published.

## Automated aimodels update

The upstream `aimodels` release process sends an `aimodels-package-updated` repository dispatch with a `version` field.

`.github/workflows/update-aimodels-dependency.yml` then:

1. installs the requested `aimodels` version;
2. builds and tests AIWrapper;
3. commits `package.json` and `package-lock.json` to the current default branch;
4. creates a patch version and tag;
5. pushes the commit and tag;
6. publishes the package to npm.

The workflow needs an npm publishing token in `NPM_TOKEN`. The upstream repository also needs credentials that can send the repository dispatch.

## Tagged releases

`.github/workflows/publish.yml` publishes tags matching `v*`. It installs with `npm ci`, runs the test suite, and publishes with npm provenance.

## Local dependency checks

```bash
npm outdated
npm audit
```

Use `npm audit fix` only after reviewing its proposed dependency changes. Do not use `--force` without testing the required major upgrades.

For unpublished model data, use the local linking workflow in [aimodels-linking.md](aimodels-linking.md).
