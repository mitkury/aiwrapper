# How to branch

Do not create a branch automatically for every task.

Stay on the current branch for focused fixes, docs, tests, and cleanup unless
the user asks for a separate branch. Ask before branching for a broad refactor,
risky public API change, or long-running feature.

When a new standalone branch is requested, start from an up-to-date
`origin/main` unless the user names another base. Use a short descriptive prefix
such as `feat/`, `fix/`, `refactor/`, or the environment's required agent prefix.

Pull requests normally target `main`.
