# Red-green TDD

Use a short red-green-refactor loop.

First add or tighten a deterministic test that demonstrates the bug or missing
behavior. Run the narrow test and confirm it fails for the expected reason.

Make the smallest implementation change that passes the test. Run the narrow
test again, then refactor only if the result becomes clearer.

Finish with `npm run check`. Run `npm run check:playground` as well when shared
exports or browser behavior changed.

Do not use live provider calls as the red test when a captured stream or mocked
request can prove the same behavior.
