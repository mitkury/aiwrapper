# Be brutally critical

Take a hard look at the code at hand and be blunt about weak engineering.

Look for hacks, brittle provider special cases, duplicated request flows, dead
helpers, confusing names, needless indirection, fake abstractions, unsafe
defaults, hidden prompt changes, and Node-only assumptions in shared runtime
code.

Pay special attention to:

- conversions between `LangMessages` and provider payloads
- tool-call and tool-result pairing
- streaming, abort, retry, and partial-result lifecycles
- browser compatibility
- public exports and backward-compatibility shims
- tests that assert implementation details but miss actual behavior

If a fix is small and obviously correct, make it. If the public API or provider
architecture is wrong and the proper change is larger, stop and propose the
refactor first. State what is wrong, what should replace it, and the smallest
useful first step.

When fixing:

- preserve sane caller-visible behavior
- treat hidden or surprising behavior as a bug
- delete dead code instead of keeping speculative compatibility
- replace hacks with boring, direct code
- keep the diff reviewable
- preserve unrelated dirty work
- run the relevant deterministic checks

End with a blunt summary of what was weak, what changed, and what still smells.
