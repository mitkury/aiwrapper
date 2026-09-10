# Tidy

Improve the relevant code without changing intended product behavior.

Good tidy work includes:

- removing dead, duplicate, or unnecessary code
- simplifying names, control flow, and file structure
- consolidating genuinely shared provider-neutral behavior
- keeping provider-specific protocol details at the provider edge
- tightening directly related tests and comments

Do not add provider features or redesign the public API during a tidy pass.
Propose those separately.

Run the narrow tests while working and `npm run check` before finishing.
