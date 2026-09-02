import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../src/cache/memory-cache.js';
import { CachedSankaClient } from '../src/providers/sanka/cached-client.js';

describe('MemoryCache', () => {
  it('returns a cached value until its TTL expires', async () => {
    const cache = new MemoryCache();
    await cache.set('home', ['cached'], 1000);

    await expect(cache.get<string[]>('home')).resolves.toEqual(['cached']);
  });
});

describe('CachedSankaClient', () => {
  it('reports whether the home result came from cache', async () => {
    const items = [{
      slug: 'example',
      title: 'Example',
      posterUrl: null,
      latestEpisode: null,
      releaseDay: null,
      source: 'sanka' as const
    }];
    const upstream = { getHome: vi.fn(async () => items) };
    const client = new CachedSankaClient(upstream, new MemoryCache(), 60_000);

    await expect(client.getHomeWithMeta()).resolves.toEqual({ items, cached: false });
    await expect(client.getHomeWithMeta()).resolves.toEqual({ items, cached: true });
  });
});
