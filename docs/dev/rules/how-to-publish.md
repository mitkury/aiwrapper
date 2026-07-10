# How to publish

Follow these steps in order:

1. Check the package: `npm run check`
2. Commit changes with the right prefix
3. Push changes: `git push`
4. Create the patch release: `npm version patch`
5. Push the release commit and tag: `git push --follow-tags`
6. Let `.github/workflows/publish.yml` publish the tag to npm

Use `npm publish` directly only as a manual recovery path.
