import { describe, expect, it, vi } from 'vitest';
import { RedisCache } from '../src/cache/redis-cache.js';
import { RateLimitExceededError, RedisWindowRateLimiter } from '../src/cache/redis-rate-limiter.js';

describe('RedisCache', () => {
  it('serializes values and sets the requested TTL', async () => {
    const redis = {
      get: vi.fn(async () => '{"title":"cached"}'),
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 1)
    };
    const cache = new RedisCache(redis);

    await cache.set('anime:1', { title: 'cached' }, 5000);

    await expect(cache.get<{ title: string }>('anime:1')).resolves.toEqual({ title: 'cached' });
    expect(redis.set).toHaveBeenCalledWith('anime:1', '{"title":"cached"}', { PX: 5000 });
  });
});

describe('RedisWindowRateLimiter', () => {
  it('throws when the shared provider budget is exhausted', async () => {
    const redis = { eval: vi.fn(async () => 0) };
    const limiter = new RedisWindowRateLimiter(redis, 18, 60_000, 'sanka:budget');

    await expect(limiter.acquire()).rejects.toBeInstanceOf(RateLimitExceededError);
    expect(redis.eval).toHaveBeenCalledOnce();
  });
});
