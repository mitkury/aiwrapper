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
  onNotOkResponse?: (res: Response, decision: DecisionOnNotOkResponse) => Promise<DecisionOnNotOkResponse>;
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

export type DecisionOnNotOkResponse = {
  retry: boolean;
  consumeReties: boolean;
}

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

  let decision = {
    retry: true,
    consumeReties: true,
  } as DecisionOnNotOkResponse;

  try {
    const response = await httpRequest(url, options);
    if (!response.ok) {
      if (options.onNotOkResponse) {
        decision = await options.onNotOkResponse(response, decision);
      }

      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response;
  } catch (error) {
    if (decision.retry && options.retries > 0) {
      if (decision.consumeReties) {
        options.retries -= 1;
      }

      options.backoffMs *= 2;

      await new Promise((resolve) => setTimeout(resolve, options.backoffMs));
      return httpRequestWithRetry(url, options);
    } else {
      throw error;
    }
  }
};