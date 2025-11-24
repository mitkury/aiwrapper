export interface HttpRequestInit {
  body?: object | string | null;
  cache?: string;
  credentials?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /**
   * A cryptographic hash of the resource to be fetched by request. Sets
   * request's integrity.
   */
  integrity?: string;
  /**
   * A boolean to set request's keepalive.
   */
  keepalive?: boolean;
  /**
   * A string to set request's method.
   */
  method?: string;
  /**
   * A string to indicate whether the request will use CORS, or will be
   * restricted to same-origin URLs. Sets request's mode.
   */
  mode?: string;
  /**
   * A string indicating whether request follows redirects, results in an error
   * upon encountering a redirect, or returns the redirect (in an opaque
   * fashion). Sets request's redirect.
   */
  redirect?: string;
  /**
   * A string whose value is a same-origin URL, "about:client", or the empty
   * string, to set request's referrer.
   */
  referrer?: string;
  /**
   * A referrer policy to set request's referrerPolicy.
   */
  referrerPolicy?: string;
}

export type HttpResponseOnErrorAction =
  | { retry: true; consumeRetry?: boolean }
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
 *   - `{ retry: true }` - fix the request and retry (consumes one retry attempt)
 *   - `{ retry: true, consumeRetry: false }` - fix the request and retry without consuming budget
 *   - `{ retry: false }` - don't retry, throw immediately
 * 
 * Retry limits:
 * - `retries` - maximum number of retry attempts that can be consumed (default: 6)
 * - Total attempts are capped at `retries + 1` (initial + retries) to prevent infinite loops
 *   when using `consumeRetry: false`
 * 
 * Backoff:
 * - Exponential backoff starts at `backoffMs` (default: 100ms) and doubles each retry
 * - Capped at `maxBackoffMs` (default: 3000ms)
 * - If `Retry-After` header is present in the response (e.g., 429, 503), uses that value
 *   instead of exponential backoff. Supports both seconds format and HTTP date format.
 * 
 * Note: The options object is mutated during execution (retries countdown, backoff increases).
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
   * @returns Action indicating whether to retry and whether to consume retry budget
   */
  on400Error?: (res: Response, error: Error, options: HttpResponseWithRetries) => Promise<HttpResponseOnErrorAction>;
  // Internal: tracks total attempts to prevent infinite loops (not part of public API)
  _attemptCount?: number;
  _maxTotalAttempts?: number;
}

let _httpRequest = (
  _url: string | URL,
  _options: HttpRequestInit,
): Promise<Response> => {
  throw new Error("Not implemented");
};

export const setHttpRequestImpl = (
  impl: (url: string | URL, options: object) => Promise<Response>,
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
    super(message);
    
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

function createAbortError(): Error {
  const abortError = new Error("The operation was aborted");
  abortError.name = "AbortError";
  return abortError;
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
  if (options.signal?.aborted) {
    throw createAbortError();
  }
  // Initialize defaults (mutates options object)
  if (options.retries === undefined) {
    options.retries = 6;
  }
  if (options.backoffMs === undefined) {
    options.backoffMs = 100;
  }
  if (options.maxBackoffMs === undefined) {
    options.maxBackoffMs = 3000;
  }

  // Track total attempts to prevent infinite loops when consumeRetry: false
  // Initialize on first call only
  if (options._maxTotalAttempts === undefined) {
    options._maxTotalAttempts = (options.retries || 6) + 1; // Initial attempt + retries
    options._attemptCount = 0;
  }

  // Increment attempt count (tracks total attempts, not just retries)
  options._attemptCount = (options._attemptCount || 0) + 1;

  try {
    const response = await httpRequest(url, options);
    if (!response.ok) {
      const status = response.status;
      const error = new Error(`HTTP error! status: ${status}`);

      // Parse response body once (body can only be read once)
      // Clone response so on400Error can also read it if needed
      let responseForCallback = response;
      try {
        responseForCallback = response.clone();
      } catch {
        // Clone failed (e.g., streaming response), use original
      }
      const bodyData = await parseResponseBody(response).catch(() => ({}));

      // Handle 400 errors with custom callback
      if (status === 400 && options.on400Error) {
        try {
          const action = await options.on400Error(responseForCallback, error, options);
          throw new HttpRequestError(`HTTP error! status: ${status}`, response, action, bodyData);
        } catch (customError) {
          // If on400Error throws, don't retry
          if (customError instanceof HttpRequestError) {
            throw customError;
          }
          throw new HttpRequestError(`HTTP error! status: ${status}`, response, { retry: false }, bodyData);
        }
      }

      // Default behavior based on status code
      let retry = true;
      // 429 (Too Many Requests) should be retried - rate limiting is usually temporary
      // Other 4xx errors (client errors) are not retried, except if on400Error handled it above
      // 5xx errors (server errors) are retried - they're usually transient
      if (status >= 400 && status < 500 && status !== 429) {
        retry = false;
      }

      throw new HttpRequestError(`HTTP error! status: ${status}`, response, { retry }, bodyData);
    }
    return response;
  } catch (error) {
    if ((error as any)?.name === "AbortError") {
      throw error;
    }
    // Handle network errors (no Response object) - treat as retryable
    if (!(error instanceof HttpRequestError)) {
      // Network errors (timeout, DNS, connection refused, etc.) should be retried
      throw new HttpRequestError(
        error instanceof Error ? error.message : String(error),
        null,
        { retry: true }
      );
    }

    if (error instanceof HttpRequestError) {
      if (error.action.retry) {
        // Prevent infinite retry loops (attemptCount already incremented above)
        if (options._attemptCount! >= options._maxTotalAttempts!) {
          throw error;
        }

        // Check if we have retries left (for consumeRetry: true case)
        if (options.retries <= 0 && error.action.consumeRetry !== false) {
          throw error;
        }

        // Default consumeRetry to true when retry is true
        // Only skip consuming if explicitly set to false
        if (error.action.consumeRetry !== false) {
          options.retries -= 1;
        }

        // Check for Retry-After header (429, 503 responses may include this)
        let delayMs: number;
        const targetBackoffMs = Math.min(options.backoffMs * 2, options.maxBackoffMs);
        
        if (error.response) {
          const retryAfter = error.response.headers.get('retry-after');
          if (retryAfter) {
            const retryAfterMs = parseRetryAfter(retryAfter);
            // Use Retry-After if valid (> 0), otherwise fall back to exponential backoff
            delayMs = retryAfterMs > 0 ? retryAfterMs : targetBackoffMs;
          } else {
            // Use exponential backoff if no Retry-After header
            delayMs = targetBackoffMs;
          }
        } else {
          // No response (network error), use exponential backoff
          delayMs = targetBackoffMs;
        }

        // Update backoff for next retry (only if not using Retry-After or Retry-After was invalid)
        if (delayMs === targetBackoffMs) {
          options.backoffMs = targetBackoffMs;
        }

        await new Promise((resolve) => {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          let onAbort: (() => void) | undefined;
          if (options.signal) {
            onAbort = () => {
              if (timeout !== undefined) {
                clearTimeout(timeout);
              }
              options.signal?.removeEventListener("abort", onAbort!);
              resolve(null);
            };
            if (options.signal.aborted) {
              options.signal.removeEventListener("abort", onAbort);
              resolve(null);
              return;
            }
            options.signal.addEventListener("abort", onAbort, { once: true });
          }
          timeout = setTimeout(() => {
            if (options.signal && onAbort) {
              options.signal.removeEventListener("abort", onAbort);
            }
            resolve(null);
          }, delayMs);
        });
        if (options.signal?.aborted) {
          throw createAbortError();
        }
        return httpRequestWithRetry(url, options);
      }
    }

    throw error;
  }
};
