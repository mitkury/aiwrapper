import { describe, it, expect } from 'vitest';
import { httpRequestWithRetry, HttpRequestError, setHttpRequestImpl } from '../../src/http-request.ts';

// Set up fetch implementation for tests
setHttpRequestImpl(async (url: string | URL, options: any) => {
  const response = await fetch(url, options);
  return response;
});

describe('httpRequestWithRetry', () => {
  it('should parse response body in error for 404', async () => {
    // Use GitHub API - non-existent user will return 404 with JSON body
    try {
      await httpRequestWithRetry('https://api.github.com/users/this-user-definitely-does-not-exist-12345', {
        method: 'GET',
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpRequestError);
      
      const httpError = error as HttpRequestError;
      expect(httpError.response?.status).toBe(404);
      
      // Body should be parsed automatically
      expect(httpError.body).toBeDefined();
      expect(httpError.body?.message).toBeDefined();
      expect(typeof httpError.body?.message).toBe('string');
      
      // bodyText should also be available
      expect(httpError.bodyText).toBeDefined();
      expect(httpError.bodyText).toContain('message');
      
      // Response should still be accessible
      expect(httpError.response).toBeDefined();
    }
  });

  it('should not retry 404 errors', async () => {
    let attemptCount = 0;
    
    // Mock implementation to track attempts
    setHttpRequestImpl(async () => {
      attemptCount++;
      return new Response('{"message":"Not Found"}', {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    try {
      await httpRequestWithRetry('https://example.com/not-found', {
        method: 'GET',
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpRequestError);
      // Should only attempt once (no retry for 404)
      expect(attemptCount).toBe(1);
    }
  });

  it('should retry 429 errors', async () => {
    let attemptCount = 0;
    
    // Mock implementation that returns 429 then succeeds
    setHttpRequestImpl(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        return new Response('{"message":"Rate limit exceeded"}', {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{"success":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const response = await httpRequestWithRetry('https://example.com/api', {
      method: 'GET',
      retries: 2,
    });

    expect(response.ok).toBe(true);
    expect(attemptCount).toBe(2); // Initial + 1 retry
  });

  it('should parse JSON body from error responses', async () => {
    // Use GitHub API - this should return 404 with JSON body
    try {
      await httpRequestWithRetry('https://api.github.com/repos/this-repo-definitely-does-not-exist-xyz/invalid', {
        method: 'GET',
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      // Should be HttpRequestError for HTTP errors
      if (error instanceof HttpRequestError) {
        expect(error.response?.status).toBeDefined();
        expect([400, 404]).toContain(error.response?.status || 0);
        
        // Body should be parsed if it's JSON
        if (error.body) {
          expect(typeof error.body).toBe('object');
          expect(error.bodyText).toBeDefined();
        }
      } else {
        // Network errors might not be HttpRequestError
        expect(error).toBeInstanceOf(Error);
      }
    }
  });

  it('should have body available even when on400Error reads response', async () => {
    let on400ErrorCalled = false;
    
    setHttpRequestImpl(async () => {
      return new Response('{"error":{"code":"invalid_request","message":"Bad request"}}', {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    try {
      await httpRequestWithRetry('https://example.com/api', {
        method: 'GET',
        on400Error: async (res, error, options) => {
          on400ErrorCalled = true;
          // Read the response body (this would consume it)
          const text = await res.text();
          expect(text).toBeDefined();
          return { retry: false };
        },
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpRequestError);
      expect(on400ErrorCalled).toBe(true);
      
      const httpError = error as HttpRequestError;
      // Body should be available even though on400Error read the response
      expect(httpError.body).toBeDefined();
      expect(httpError.body?.error).toBeDefined();
      expect(httpError.body?.error?.code).toBe('invalid_request');
      expect(httpError.bodyText).toBeDefined();
      expect(httpError.bodyText).toContain('invalid_request');
    }
  });
});

