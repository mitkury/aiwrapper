/**
 * Npm package entry point.
 * Make sure to build with "npm run build" and run from /dist folder.
 * The compiled JS build goes to /dist.
 */

// **NOTE**: we import with ".js" because this will work with compiled JS files, not
// the current source ".ts" files.
import { setHttpRequestImpl } from "./http-request.js";

setHttpRequestImpl((url, options) => {
  // A regular browser's fetch and now we can use it in Node.
  // But will keep this in case if we need to implement a custom fetch.
  return fetch(url, options);
});

// Note: We're now using the default stream processing implementation
// which works in modern Node.js, browsers, and Deno
// We're keeping the isNode import for potential future environment-specific tweaks

export * from "./index.js";