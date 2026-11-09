# How to publish

Follow these steps in order:

Before tagging, confirm the `aiwrapper` package on npm has a GitHub Actions
trusted publisher for `mitkury/aiwrapper`, workflow file `publish.yml`, with
`npm publish` allowed. The workflow uses short-lived OIDC credentials and does
not use an `NPM_TOKEN` secret. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

1. Check the package: `npm run check`
2. Commit changes with the right prefix
3. Push changes: `git push`
4. Create the patch release: `npm version patch`
5. Push the release commit and tag: `git push --follow-tags`
6. Let `.github/workflows/publish.yml` publish the tag to npm

Use `npm publish` directly only as a manual recovery path.

Automated catalog updates create a patch version and dispatch `publish.yml`
explicitly at its tag. See [dependency updates](../dependency-updates.md) for
triggers, permissions, and recovery.

## Rust crate

The `native/` crate is published to crates.io by hand, separately from npm and
with its own version. A release needs `cargo login` with a token that can
publish `aiwrapper`.

1. Check the crate: `npm run native:check`
2. Set `version` in `native/Cargo.toml` (0.x: patch for fixes and additions,
   minor for breaking changes) and commit it with a `ci:` prefix
3. Check the package: `cargo publish -p aiwrapper --dry-run`
4. Publish: `cargo publish -p aiwrapper`
5. Tag the commit `native-v<version>` and push the tag

A published version cannot be replaced. Use `cargo yank` to withdraw one.
