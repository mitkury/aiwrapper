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
