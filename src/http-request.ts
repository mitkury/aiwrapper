import { createAbortError, isAbortError } from "./errors.js";

export type HttpRequestInit = RequestInit;

export type HttpResponseOnErrorAction =
  | { retry: true }
  | { retry: false };

/**
 * Options for httpRequestWithRetry that adds automatic retry logic.
 * 
 * Retry behavior:
 * - Network errors (timeout, DNS failures, etc.) are automatically retried
 * - HTTP 400 errors: can use `on400Error` callback to fix the request and retry, otherwise not retried
 * - HTTP 429 errors: always retried (rate limiting is usually temporary)
 * - HTTP 4xx errors (other): not retried by default (client errors that won't fix themselves)
 * - HTTP 5xx errors: always retried (server errors are usually transient)
 * 
 * Custom 400 error handling:
 * - Use `on400Error` to inspect the error response and potentially fix the request:
 *   - `{ retry: true }` - fix the request and retry
 *   - `{ retry: false }` - don't retry, throw immediately
 * 
 * Retry limits:
 * - `retries` - maximum number of retry attempts (default: 6)
 * - Total attempts are capped at `retries + 1` (initial + retries)
 * 
 * Backoff:
 * - Exponential backoff starts at `backoffMs` (default: 100ms) and doubles each retry
 * - Capped at `maxBackoffMs` (default: 3000ms)
 * - If `Retry-After` header is present in the response (e.g., 429, 503), uses that value
 *   instead of exponential backoff. Supports both seconds format and HTTP date format.
 * 
 * Retry bookkeeping is local to each call, so the same options object can be
 * reused. An `on400Error` callback may still modify request fields such as
 * `body` or `headers` before the next attempt.
 */
export interface HttpResponseWithRetries extends HttpRequestInit {
  retries?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  /**
   * Called when a 400 Bad Request error occurs. Allows fixing the request and retrying.
   * Examples: adding missing headers, fixing data format, handling API version mismatches.
   * 
   * You can modify the `options` object (e.g., `options.body`, `options.headers`) to fix
   * the request before retrying. The modified options will be used in the retry.
   * 
   * @param res - The HTTP response with status 400
   * @param error - Error object with status information
   * @param options - The request options object (can be mutated to fix the request)
   * @returns Action indicating whether to retry
   */
  on400Error?: (res: Response, error: Error, options: HttpResponseWithRetries) => Promise<HttpResponseOnErrorAction>;
}

let _httpRequest = (
  url: string | URL,
  options: HttpRequestInit,
): Promise<Response> => {
  return globalThis.fetch(url, options);
};

export const setHttpRequestImpl = (
  impl: (url: string | URL, options: HttpRequestInit) => Promise<Response>,
) => {
  _httpRequest = impl;
};

export const httpRequest = (
  url: string | URL,
  options: HttpRequestInit,
): Promise<Response> => {
  return _httpRequest(url, options);
};

/**
 * Helper function to parse response body as JSON or text.
 * Attempts JSON first, falls back to text if parsing fails.
 */
async function parseResponseBody(response: Response): Promise<{ json?: any; text?: string }> {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  
  try {
    const text = await response.text();
    if (isJson && text) {
      try {
        return { json: JSON.parse(text), text };
      } catch {
        // JSON parse failed, return as text
        return { text };
      }
    }
    return { text };
  } catch {
    // Body read failed
    return {};
  }
}

export class HttpRequestError extends Error {
  /**
   * Parsed JSON body if the response was JSON, otherwise undefined.
   * Only available if response was present and parseable.
   */
  public body?: any;
  
  /**
   * Raw text body if available.
   * Only available if response was present and body could be read.
   */
  public bodyText?: string;

  constructor(
    message: string,
    public response: Response | null,
    public action: HttpResponseOnErrorAction,
    bodyData?: { json?: any; text?: string }
  ) {
    const responseMessage = bodyData?.json?.error?.message
      ?? bodyData?.json?.message;
    const detail = typeof responseMessage === "string"
      ? responseMessage.trim().slice(0, 500)
      : "";
    super(detail ? `${message}: ${detail}` : message);
    
    if (bodyData) {
      this.body = bodyData.json;
      this.bodyText = bodyData.text;
    }
  }
}

/**
 * Parses the Retry-After header value and returns the delay in milliseconds.
 * Supports both formats:
 * - Seconds as number: "60" → 60000ms
 * - HTTP date: "Wed, 21 Oct 2015 07:28:00 GMT" → milliseconds until that date
 */
function parseRetryAfter(retryAfter: string): number {
  // Try parsing as seconds (number)
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try parsing as HTTP date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    const now = Date.now();
    const delayMs = date.getTime() - now;
    // Return at least 0 (if date is in the past, don't wait)
    return Math.max(0, delayMs);
  }

  // Fallback: if parsing fails, return 0 (don't wait)
  return 0;
}

function toRequestInit(options: HttpResponseWithRetries): RequestInit {
  const {
    retries: _retries,
    backoffMs: _backoffMs,
    maxBackoffMs: _maxBackoffMs,
    on400Error: _on400Error,
    ...requestInit
  } = options;

  return requestInit;
}

function retryDelay(error: HttpRequestError, fallbackMs: number): number {
  const retryAfter = error.response?.headers.get("retry-after");
  if (!retryAfter) return fallbackMs;

  const retryAfterMs = parseRetryAfter(retryAfter);
  return retryAfterMs > 0 ? retryAfterMs : fallbackMs;
}

async function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw createAbortError();

  await new Promise<void>((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;

    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });

  if (signal?.aborted) throw createAbortError();
}

async function requestErrorFromResponse(
  response: Response,
  options: HttpResponseWithRetries,
): Promise<HttpRequestError> {
  const status = response.status;
  const message = `HTTP error! status: ${status}`;

  let responseForCallback = response;
  let responseForBody = response;
  try {
    responseForCallback = response.clone();
    responseForBody = response.clone();
  } catch {
    // Some streaming responses cannot be cloned.
  }

  const bodyData = await parseResponseBody(responseForBody);

  if (status === 400 && options.on400Error) {
    try {
      const action = await options.on400Error(
        responseForCallback,
        new Error(message),
        options,
      );
      return new HttpRequestError(message, response, action, bodyData);
    } catch (error) {
      if (error instanceof HttpRequestError) return error;
      return new HttpRequestError(
        message,
        response,
        { retry: false },
        bodyData,
      );
    }
  }

  const retry = status === 429 || status >= 500;
  return new HttpRequestError(message, response, { retry }, bodyData);
}

/**
 * Performs an HTTP request with automatic retry logic and exponential backoff.
 * 
 * Why use this instead of plain fetch?
 * - Network errors (timeouts, DNS failures, connection issues) are common in production
 *   and should be automatically retried rather than failing immediately
 * - HTTP 5xx errors often indicate temporary server issues that resolve on retry
 * - Exponential backoff prevents overwhelming servers during outages or rate limiting
 * - Custom error handling allows fine-grained control over retry behavior per error type
 * - Provides a unified interface that works across different environments (Node.js, browsers, etc.)
 * 
 * This function wraps httpRequest (which can be configured for different HTTP implementations)
 * and adds retry logic with configurable backoff and error handling strategies.
 */
export const httpRequestWithRetry = async (
  url: string | URL,
  options: HttpResponseWithRetries,
): Promise<Response> => {
  const retries = options.retries ?? 6;
  const maxBackoffMs = options.maxBackoffMs ?? 3000;

  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError("retries must be a non-negative integer");
  }
  if (!Number.isFinite(maxBackoffMs) || maxBackoffMs < 0) {
    throw new RangeError("maxBackoffMs must be non-negative");
  }

  const initialBackoffMs = options.backoffMs ?? 100;
  if (!Number.isFinite(initialBackoffMs) || initialBackoffMs < 0) {
    throw new RangeError("backoffMs must be non-negative");
  }
  let backoffMs = Math.min(initialBackoffMs, maxBackoffMs);

  const maxAttempts = retries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) throw createAbortError();

    let requestError: HttpRequestError;
    try {
      const response = await httpRequest(url, toRequestInit(options));
      if (response.ok) return response;
      requestError = await requestErrorFromResponse(response, options);
    } catch (error) {
      if (isAbortError(error)) throw error;
      requestError = error instanceof HttpRequestError
        ? error
        : new HttpRequestError(
            error instanceof Error ? error.message : String(error),
            null,
            { retry: true },
          );
    }

    if (!requestError.action.retry || attempt === maxAttempts) {
      throw requestError;
    }

    await delay(retryDelay(requestError, backoffMs), options.signal);
    backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
  }

  throw new Error("Unreachable retry state");
};
