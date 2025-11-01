import { setHttpRequestImpl } from "./http-request.ts";

// Set up the HTTP request implementation to use the standard fetch API
// This works in modern Node.js, browsers, and Deno
setHttpRequestImpl((url, options) => {
  return fetch(url, options);
});

// Export all the modules
export * from "./lang/index.ts";
export * from "./speech2text/index.ts";
export * from "./text2speech/index.ts";
// Re-export everything from aimodels
export * from 'aimodels';
// Img
export * from "./img/img.ts";

// Agents
export * from "./agents/index.ts";

// HTTP Request utilities
export {
  httpRequestWithRetry,
  HttpRequestError,
  setHttpRequestImpl,
  type HttpResponseWithRetries,
  type HttpResponseOnErrorAction,
} from "./http-request.ts";
