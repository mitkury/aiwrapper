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

export interface HttpResponseWithRetries extends HttpRequestInit {
  retries?: number;
  backoffMs?: number;
  // Simplified API: throw an error to prevent retry, don't throw to use default behavior
  onError?: (res: Response, error: Error) => Promise<void>;
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


export const httpRequestWithRetry = async (
  url: string | URL,
  options: HttpResponseWithRetries,
): Promise<Response> => {
  if (options.retries === undefined) {
    options.retries = 6;
  }
  if (options.backoffMs === undefined) {
    options.backoffMs = 100;
  }

  try {
    const response = await httpRequest(url, options);
    if (!response.ok) {
      // Handle custom error logic
      if (options.onError) {
        try {
          const error = new Error(`HTTP error! status: ${response.status}`);
          await options.onError(response, error);
          // If onError doesn't throw, we'll continue with default behavior
        } catch (customError) {
          // Custom error handling - don't retry
          throw customError;
        }
      }

      // Default behavior: don't retry 4xx errors, retry 5xx errors
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response;
  } catch (error) {
    // Check if this is a retryable error (5xx or network errors)
    const isRetryable = !error.message.includes('status: 4') && 
                       options.retries > 0;

    if (isRetryable) {
      options.retries -= 1;
      options.backoffMs *= 2;

      await new Promise((resolve) => setTimeout(resolve, options.backoffMs));
      return httpRequestWithRetry(url, options);
    } else {
      throw error;
    }
  }
};