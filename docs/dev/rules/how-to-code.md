# How to code here

This package targets servers, browsers, and other JavaScript runtimes. Keep portability in mind and avoid Node-only behavior in runtime code unless the file is clearly server-only.

Most source code lives in `src` and is written in TypeScript with ESM imports. Follow the existing style in the surrounding files.

Keep explicit `.ts` extensions in source imports. The build step rewrites them to `.js` in `dist`.

Prefer adding to existing provider and utility modules instead of introducing new abstractions too early. Keep the public API simple.

Be careful with new dependencies. Since this is a wrapper library, prefer lightweight solutions and avoid adding packages when the platform or current utilities already cover the need.
