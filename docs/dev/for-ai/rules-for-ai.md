# Basics for AI agents

# Git commits
Use imperative mood and use a prefix for the type of change.
Examples:
feat(auth): add user login
fix(payment): resolve gateway timeout
ci: update release workflow
docs: update README
dev: add the core and the client as aliases to the sveltkit config

### Commit types
Any product-related feature - "feature(name): description"
Any product-related fix - "fix(name): description"
Anything related to building and releasing (including fixes of CI) - "ci: description"
Anything related to testing - "tests: description"
Anything related to documentation - "docs: description"
Anything related to the build pipelines and dev convinience - "dev: description"

### Testing
To run a specific test suite against a single provider, set the `PROVIDERS` env variable and execute Vitest in non-interactive mode. Example:
`PROVIDERS=openai npx vitest run tests/agents/chat-agent.test.ts`
This runs the `chat-agent` suite using only the OpenAI provider. Make sure you use `vitest run` (or keep the `--run` flag) so the test run completes once and doesn't wait for file changes.

## Publishing Steps
When publishing, follow these steps in order:
1. Build and test: `npm run build && npm test`
2. Commit changes with scope prefix: `feat: short description`
3. Push changes: `git push`
4. Create patch version: `npm version patch`
5. Push tags: `git push --tags`
6. Publish: `npm publish`