# Pull requests

Apply the [shared pull request rules](../../airul/rules/how-to-create-prs.md).
Read the current workflows under `.github/workflows` for the required checks.

Use a typed, imperative title following the [commit format](how-to-commit.md).
Describe behavior changes, provider compatibility constraints and validation.

Run `npm run check` before opening a pull request. Include
`npm run native:check` for Rust changes and `npm run check:playground` when shared
TypeScript exports, browser compatibility or the playground changed.

Create or publish a pull request only when the user explicitly asks.
