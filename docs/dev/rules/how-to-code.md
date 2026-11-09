# How to code here

Apply the [shared code rules](../../airul/rules/how-to-code.md).

The TypeScript runtime lives in `src/` and builds an ESM package for Node.js 20+
and modern browsers. Keep explicit `.js` extensions in relative imports;
TypeScript resolves them to source files and preserves them in the output.
Shared runtime code must not import Node.js built-ins or rely on unguarded Node
globals. Keep platform-specific transports at their existing boundaries.

The Rust runtime lives in `native/`. Keep its public API async and embeddable.
Applications supply credentials, tools, persistence and frontend transport.
Use the existing cancellation and transport interfaces; keep servers and device
I/O in host adapters or examples. Run the [native checks](how-to-test.md) for
Rust changes.

Keep messages and tool results provider-neutral, with protocol fields at the
provider edge. Do not silently invent prompts, tool results or provider
capabilities. Preserve caller intent and return a specific error when a provider
cannot represent a feature.

Use lowercase, dash-separated names for new TypeScript utility and provider
files, and follow existing Rust module names. Check both implementations when a
change affects their shared message format or documented behavior.
