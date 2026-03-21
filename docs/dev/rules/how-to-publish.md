# How to publish

Follow these steps in order:

1. Build and test: `npm run build && npm test`
2. Commit changes with the right prefix
3. Push changes: `git push`
4. Create the patch release: `npm version patch`
5. Push tags: `git push --tags`
6. Publish: `npm publish`
