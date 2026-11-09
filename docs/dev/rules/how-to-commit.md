# Commit format

Apply the [shared commit rules](../../airul/rules/how-to-commit.md).
Use an imperative message with a typed prefix:

| Prefix | Change |
| --- | --- |
| `feat(scope):` | Product feature |
| `fix(scope):` | Product fix |
| `refactor(scope):` | Behavior-preserving restructuring |
| `ci:` | Build, release or CI |
| `tests:` | Tests |
| `docs:` | Documentation |
| `deps:` | Dependency update |
| `dev:` | Developer workflow |

For example: `fix(native): preserve partial output on cancellation`.
