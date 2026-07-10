import processLinesFromStream from "./lang/process-lines-from-stream.js";

export function processServerEvents(
  response: Response,
  onData: (data: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (response.ok === false) {
    throw new Error(
      `Response from server was not ok. Status code: ${response.status}.`,
    );
  }

  return readServerEvents(response, onData, signal);
}

async function readServerEvents(
  response: Response,
  onData: (data: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) {
    throw new Error("Response body is missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let rawData = "";
  const createAbortError = () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    return error;
  };
  const abortHandler = () => {
    void reader.cancel();
  };

  if (signal?.aborted) {
    throw createAbortError();
  }
  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    while (true) {
      const result = await reader.read();
      if (signal?.aborted) {
        throw createAbortError();
      }
      if (result.done) {
        break;
      }

      rawData += decoder.decode(result.value, { stream: true });
      const lastIndex = rawData.lastIndexOf("\n");
      if (lastIndex >= 0) {
        processLinesFromStream(rawData.slice(0, lastIndex), onData);
        rawData = rawData.slice(lastIndex + 1);
      }
    }

    rawData += decoder.decode();
    if (rawData.trim()) {
      processLinesFromStream(rawData, onData);
    }
  } finally {
    signal?.removeEventListener("abort", abortHandler);
  }
}
