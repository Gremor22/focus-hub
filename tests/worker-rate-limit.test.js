import { describe, expect, it } from 'vitest';
import { checkRateLimit, rateLimitConfigForPath, rateLimitErrorResponse } from '../_worker.js';

describe('worker rate limiting', () => {
  it('allows requests below the configured limit', () => {
    const store = new Map();
    const config = rateLimitConfigForPath('/api/push/test');

    for (let i = 0; i < config.limit; i += 1) {
      const result = checkRateLimit(store, 'user-1:/api/push/test', config, 1_000);
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks requests after the configured limit', () => {
    const store = new Map();
    const config = rateLimitConfigForPath('/api/push/test');

    for (let i = 0; i < config.limit; i += 1) {
      checkRateLimit(store, 'user-1:/api/push/test', config, 1_000);
    }
    const blocked = checkRateLimit(store, 'user-1:/api/push/test', config, 1_000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets the bucket after the window expires', () => {
    const store = new Map();
    const config = { limit: 1, windowMs: 1_000 };

    expect(checkRateLimit(store, 'user-1:/custom', config, 1_000).allowed).toBe(true);
    expect(checkRateLimit(store, 'user-1:/custom', config, 1_500).allowed).toBe(false);
    expect(checkRateLimit(store, 'user-1:/custom', config, 2_001).allowed).toBe(true);
  });

  it('returns a consistent 429 response for rate limited requests', async () => {
    const response = rateLimitErrorResponse('request-1', 42);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(body).toEqual({
      ok: false,
      error: 'rate_limited',
      message: 'Too many requests. Try again later.',
      requestId: 'request-1'
    });
  });
});
