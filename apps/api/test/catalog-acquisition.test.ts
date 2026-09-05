import { describe, expect, it, vi } from 'vitest';
import { SankaSourceProvider } from '../src/providers/sanka/source-provider.js';
import { SankaCircuitBreaker } from '../src/providers/sanka/response.js';
import { CachedSourceProvider } from '../src/providers/sanka/cached-source-provider.js';
import { CatalogSyncWorker } from '../src/catalog/sync-worker.js';
import { MemoryCache } from '../src/cache/memory-cache.js';
import type { AnimeSourceProvider } from '../src/providers/source-types.js';

const fixture = { status: 'success', ok: true, data: { list: [{ startWith: 'A', animeList: [{ title: 'Anime A', animeId: 'anime-a' }] }] } };
function provider(payload: unknown = fixture) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(payload)));
  const acquire = vi.fn(async () => undefined);
  return { upstream: new SankaSourceProvider({ source: 'otakudesu', baseUrl: 'https://fixture.test', limiter: { acquire }, fetcher }), fetcher, acquire };
}

describe('catalog acquisition', () => {
  it('does not count unsupported Oploverz full-catalog seeding as a healthy successful request', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture)));
    const acquire = vi.fn(async () => undefined);
    const upstream = new SankaSourceProvider({ source: 'oploverz', baseUrl: 'https://fixture.test', limiter: { acquire }, fetcher });
    const cached = new CachedSourceProvider(upstream, new MemoryCache(), {});
    const updateProviderHealth = vi.fn(async () => undefined);
    const result = await new CatalogSyncWorker([cached], { upsertSourceHome: async () => undefined, updateProviderHealth }).runSeedAllAnime();
    expect(result).toEqual({ succeeded: 0, failed: 0, items: 0 });
    expect(updateProviderHealth).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });
  it('seeds Samehadaku from its documented grouped /list endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture)));
    const acquire = vi.fn(async () => undefined);
    const upstream = new SankaSourceProvider({ source: 'samehadaku', baseUrl: 'https://fixture.test', limiter: { acquire }, fetcher });
    expect(await upstream.getAllAnime()).toEqual([{ title: 'Anime A', slug: 'anime-a' }]);
    expect(fetcher).toHaveBeenCalledWith('https://fixture.test/anime/samehadaku/list', expect.anything());
    expect(acquire).toHaveBeenCalledOnce();
  });
  it.each(['getAllAnime', 'getHome'] as const)('rechecks the shared circuit after waiting for a permit: %s', async (operation) => {
    const circuit = new SankaCircuitBreaker();
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture)));
    const upstream = new SankaSourceProvider({
      source: 'otakudesu', baseUrl: 'https://fixture.test', circuit, fetcher,
      limiter: { acquire: async () => { circuit.open(429, 60_000); } }
    });
    await expect(upstream[operation]()).rejects.toMatchObject({ status: 429 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ data: {} }, { data: { list: [{}] } }])('rejects malformed unlimited responses rather than reporting an empty success', async (payload) => {
    const { upstream } = provider(payload);
    await expect(upstream.getAllAnime()).rejects.toMatchObject({ status: 502 });
  });
  it('exposes full catalog through the cache and coalesces requests', async () => {
    const { upstream, fetcher, acquire } = provider();
    const cached: AnimeSourceProvider = new CachedSourceProvider(upstream, new MemoryCache(), {});
    expect(cached.getAllAnime).toBeTypeOf('function');
    const results = await Promise.all([cached.getAllAnime!(), cached.getAllAnime!()]);
    expect(results).toEqual([[{ title: 'Anime A', slug: 'anime-a' }], [{ title: 'Anime A', slug: 'anime-a' }]]);
    await cached.getAllAnime!();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(acquire).toHaveBeenCalledOnce();
  });
});
