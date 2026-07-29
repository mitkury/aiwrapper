# How to create pull requests

Before creating or updating a pull request, read the current workflows under
`.github/workflows`. They are the source of truth for required checks.

Use a typed, imperative title that follows [Git commits](how-to-commit.md).
Explain user-visible behavior changes, provider compatibility constraints, and
which checks ran.

Run `npm run check` before opening the pull request. Also run
`npm run check:demo` when shared exports, browser compatibility, or the demo
changed.

Do not create or publish a pull request unless the user explicitly asks.
