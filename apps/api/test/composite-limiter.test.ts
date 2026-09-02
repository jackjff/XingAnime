import { describe, expect, it, vi } from 'vitest';
import { CompositeRateLimiter } from '../src/providers/sanka/rate-limiter.js';

describe('CompositeRateLimiter', () => {
  it('acquires the shared budget and local interval for every request', async () => {
    const calls: string[] = [];
    const limiter = new CompositeRateLimiter(
      { acquire: vi.fn(async () => { calls.push('global'); }) },
      { acquire: vi.fn(async () => { calls.push('interval'); }) }
    );

    await limiter.acquire();

    expect(calls).toEqual(['interval', 'global']);
  });
});
