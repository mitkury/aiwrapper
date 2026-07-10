# Build

Source files use TypeScript, ESM, and explicit `.ts` import extensions. The package build produces ESM JavaScript and declarations in `dist`.

```bash
npm run build
```

The build has three stages:

1. `prebuild` removes the previous `dist` directory.
2. `build.js` compiles every `src/**/*.ts` file with esbuild for the ES2017 target while preserving the source directory structure.
3. The build rewrites relative `.ts` imports to `.js` and uses TypeScript to emit declaration files.

The runtime build uses `platform: "neutral"` so it remains suitable for modern browsers, Node.js, Deno, and other JavaScript runtimes. Runtime source should therefore avoid Node-only APIs unless a module is explicitly server-only.

`package.json` publishes only `dist` and `LICENSE`.
