# How to code here

This is an npm-first ESM package for Node.js 20+ and modern browsers. Prefer
standard web platform APIs when they keep the implementation simple.

Most source code lives in `src` and is written in TypeScript with ESM imports. Follow the existing style in the surrounding files.

Keep explicit `.js` extensions in relative source imports. TypeScript resolves them to `.ts` sources and preserves the correct specifiers in JavaScript and declarations.

Prefer adding to existing provider and utility modules instead of introducing new abstractions too early. Keep the public API simple.

Be careful with new dependencies. Since this is a wrapper library, prefer lightweight solutions and avoid adding packages when the platform or current utilities already cover the need.

Public runtime code must not import Node.js built-ins or rely on unguarded Node
globals. Keep browser and Node.js support in mind when changing shared code.
