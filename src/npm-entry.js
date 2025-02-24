/**
 * Npm package entry point.
 * Make sure to build with "npm run build" and run from /dist folder.
 * The compiled JS build goes to /dist.
 */

// **NOTE**: we import with ".js" because this will work with compiled JS files, not
// the current source ".ts" files.
import { setHttpRequestImpl } from "./http-request.js";
import { setProcessResponseStreamImpl } from "./process-response-stream.js";
import processLinesFromStream from "./lang/process-lines-from-stream.js";

const needsCustomFetch = typeof fetch === 'undefined';
if (needsCustomFetch) {
  // For HTTP calls from Node.
  // Because NodeJS doesn't have browser's fetch yet
  nodeFetch = await import('node-fetch').then(module => module.default);

  setHttpRequestImpl((url, options) => {
    return nodeFetch(url, options);
  });
} else {
  setHttpRequestImpl((url, options) => {
    // A regular browser's fetch
    return fetch(url, options);
  });
}

const isNodeJs = typeof process !== 'undefined' &&
  process.versions != null &&
  process.versions.node != null;
const needsCustomProcessResponseStream = isNodeJs;

if (needsCustomProcessResponseStream) {
  // For processing response streams from Node.
  setProcessResponseStreamImpl(async (response, onData) => {
    if (response.ok === false) {
      throw new Error(`Response from server was not ok. Status code: ${response.status}.`);
    }
    let rawData = "";
    const decoder = new TextDecoder("utf-8");
    const reader = response.body.getReader();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        rawData += decoder.decode(value, { stream: true });
        // Process each complete message (messages are divided by newlines)
        let lastIndex = rawData.lastIndexOf("\n");
        if (lastIndex > -1) {
          processLinesFromStream(rawData.slice(0, lastIndex), onData);
          rawData = rawData.slice(lastIndex + 1);
        }
      }
      // Process any remaining data
      if (rawData.length > 0) {
        processLinesFromStream(rawData, onData);
      }
    } finally {
      reader.releaseLock();
    }
  });
}

export * from "./index.js";