import processLinesFromStream from "./lang/process-lines-from-stream.ts";

// This would work only in Deno and browsers, not in Node.
let _processServerEvents = (response: Response, onData: (data: any) => void): Promise<void> => {
  if (response.ok === false) {
    throw new Error(
      `Response from server was not ok. Status code: ${response.status}.`,
    );
  }

  const reader = response.body!.getReader();
  let decoder = new TextDecoder("utf-8");
  let rawData = "";

  return reader.read().then(function processStream(result): Promise<void> {
    if (result.done || result.value === undefined) {
      return Promise.resolve();
    }

    rawData += decoder.decode(result.value, {
      stream: true,
    });

    // Process each complete message (messages are devived by newlines)
    let lastIndex = rawData.lastIndexOf("\n");
    if (lastIndex > -1) {
      processLinesFromStream(rawData.slice(0, lastIndex), onData);
      rawData = rawData.slice(lastIndex + 1);
    }

    return reader.read().then(processStream);
  });
};

/*
 * Set the implementation of the processServerEvents function.
 * This is useful for testing and for customizing the behavior of the processServerEvents function.
 */
export const setProcessServerEventsImpl = (
  impl: (response: Response, onProgress: (data: any) => void) => Promise<void>,
) => {
  _processServerEvents = impl;
};

export const processServerEvents = (
  response: Response,
  onProgress: (data: any) => void,
): Promise<void> => {
  return _processServerEvents(response, onProgress);
};
