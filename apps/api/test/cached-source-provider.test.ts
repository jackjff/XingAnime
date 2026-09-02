import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../src/cache/memory-cache.js';
import { CachedSourceProvider } from '../src/providers/sanka/cached-source-provider.js';

const provider = {
  source: 'otakudesu' as const,
  getHome: vi.fn(async () => []),
  getDetail: vi.fn(async (slug: string) => ({ source: 'otakudesu' as const, slug, title: slug, posterUrl: null, synopsis: null, status: null, type: null, studio: null, genres: [], episodes: [] })),
  getEpisode: vi.fn(async (id: string) => ({ source: 'otakudesu' as const, id, title: id, animeSlug: null, releaseTime: null, previousEpisodeId: null, nextEpisodeId: null, playback: [] })),
  resolveServer: vi.fn(async (serverId: string) => ({ label: serverId, quality: null, kind: 'embed' as const, mode: 'unknown' as const, reason: 'not_verified' as const, url: null, serverId })),
  getSchedule: vi.fn(async () => [])
};

describe('CachedSourceProvider', () => {
  it('coalesces concurrent detail requests and serves the second request from cache', async () => {
    const cached = new CachedSourceProvider(provider, new MemoryCache(), { detail: 60_000 });

    await Promise.all([cached.getDetail('anime'), cached.getDetail('anime')]);
    await cached.getDetail('anime');

    expect(provider.getDetail).toHaveBeenCalledOnce();
  });
});
