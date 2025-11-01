export interface HttpRequestInit {
  body?: object | string | null;
  cache?: string;
  credentials?: string;
  headers?: Record<string, string>;
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

export interface HttpResponseWithRetries extends HttpRequestInit {
  retries?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  onError?: (res: Response, error: Error) => Promise<HttpResponseOnErrorAction>;
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

export class HttpRequestError extends Error {
  constructor(message: string, public response: Response | null, public action: HttpResponseOnErrorAction) {
    super(message);
  }
}

export const httpRequestWithRetry = async (
  url: string | URL,
  options: HttpResponseWithRetries,
): Promise<Response> => {
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
      // Handle custom error logic
      if (options.onError) {
        try {
          const error = new Error(`HTTP error! status: ${response.status}`);
          const action = await options.onError(response, error);
          throw new HttpRequestError(`HTTP error! status: ${response.status}`, response, action);
        } catch (customError) {
          // If onError throws, don't retry
          if (customError instanceof HttpRequestError) {
            throw customError;
          }
          throw new HttpRequestError(`HTTP error! status: ${response.status}`, response, { retry: false });
        }
      } else {
        let retry = true;
        // Default behavior: don't retry 4xx errors, retry 5xx errors
        // Because 500 errors are usually due to server issues, and we want to retry in that case
        if (response.status >= 400 && response.status < 500) {
          retry = false;
        }

        throw new HttpRequestError(`HTTP error! status: ${response.status}`, response, { retry });
      }
    }
    return response;
  } catch (error) {
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

        const targetBackoffMs = Math.min(options.backoffMs * 2, options.maxBackoffMs);
        options.backoffMs = targetBackoffMs;
        await new Promise((resolve) => setTimeout(resolve, targetBackoffMs));
        return httpRequestWithRetry(url, options);
      }
    }

    throw error;
  }
};