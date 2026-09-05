import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AnimeSourceProvider, SourceId } from '../src/providers/source-types.js';
import { SankaUpstreamError } from '../src/providers/sanka/response.js';

function provider(source: SourceId): AnimeSourceProvider {
  return {
    source,
    getHome: async () => [{ source, slug: `${source}-anime`, detailSlug: `${source}-anime`, title: source, posterUrl: null, latestEpisode: 1, releaseDay: null }],
    getDetail: async (slug) => ({ source, slug, title: source, posterUrl: null, synopsis: null, status: null, type: null, studio: null, genres: [], episodes: [] }),
    getEpisode: async (id) => ({ source, id, title: id, animeSlug: null, releaseTime: null, previousEpisodeId: null, nextEpisodeId: null, playback: [] }),
    resolveServer: async (serverId) => ({ label: 'Resolved server', quality: null, kind: 'embed', mode: 'unknown', reason: 'not_verified', url: `https://embed.example/${serverId}`, serverId }),
    getSchedule: async () => []
  };
}

describe('source routes', () => {
  it('lists the three prioritized sources', async () => {
    const app = buildApp({ homeClient: { getHome: async () => [] }, sourceProviders: { otakudesu: provider('otakudesu'), samehadaku: provider('samehadaku'), oploverz: provider('oploverz') } });
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((item: { id: string }) => item.id)).toEqual(['otakudesu', 'samehadaku', 'oploverz']);
    await app.close();
  });

  it('routes source home, detail, and episode requests to the selected provider', async () => {
    const app = buildApp({ homeClient: { getHome: async () => [] }, sourceProviders: { otakudesu: provider('otakudesu') } });

    const home = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/home' });
    const detail = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/anime/ota' });
    const episode = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/episode/ota-9' });

    expect(home.statusCode).toBe(200);
    expect(home.json().data[0].source).toBe('otakudesu');
    expect(detail.json().data.slug).toBe('ota');
    expect(episode.json().data.id).toBe('ota-9');
    await app.close();
  });

  it('routes schedule requests to the selected provider', async () => {
    const app = buildApp({ homeClient: { getHome: async () => [] }, sourceProviders: { otakudesu: provider('otakudesu') } });
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/schedule' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
    await app.close();
  });

  it('resolves a server URL through the selected provider', async () => {
    const app = buildApp({ homeClient: { getHome: async () => [] }, sourceProviders: { samehadaku: provider('samehadaku') } });
    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/samehadaku/server/server-7' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.url).toBe('https://embed.example/server-7');
    await app.close();
  });

  it('uses persisted detail, episode metadata, and schedule before the provider', async () => {
    const selected = provider('otakudesu');
    const getDetail = vi.spyOn(selected, 'getDetail');
    const getEpisode = vi.spyOn(selected, 'getEpisode');
    const getSchedule = vi.spyOn(selected, 'getSchedule');
    const repository = {
      findDetail: vi.fn(async () => ({ source: 'otakudesu' as const, slug: 'stored', title: 'Stored anime', posterUrl: null, synopsis: 'cached', status: 'Ongoing', type: null, studio: null, genres: [], episodes: [{ id: 'ep-1', title: 'Episode 1', number: 1, releaseDate: null }], firstEpisodeId: 'ep-1', latestEpisodeId: 'ep-1', availableSources: [] })),
      upsertDetail: vi.fn(async () => undefined),
      findEpisode: vi.fn(async () => ({ source: 'otakudesu' as const, id: 'ep-1', title: 'Episode 1', animeSlug: 'stored', releaseTime: null, previousEpisodeId: null, nextEpisodeId: null, playback: [] })),
      upsertEpisode: vi.fn(async () => undefined),
      listSchedule: vi.fn(async () => [{ day: 'Senin', items: [] }]),
      upsertSchedule: vi.fn(async () => undefined)
    };
    const app = buildApp({ homeClient: { getHome: async () => [] }, sourceProviders: { otakudesu: selected }, catalogRepository: repository });

    const detail = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/anime/stored' });
    const episode = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/episode/ep-1' });
    const schedule = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/schedule' });
    const playback = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/episode/ep-1/playback' });

    expect(detail.json().data.title).toBe('Stored anime');
    expect(episode.json().data.playback).toEqual([]);
    expect(schedule.json().data[0].day).toBe('Senin');
    expect(getDetail).not.toHaveBeenCalled();
    expect(getEpisode).toHaveBeenCalledTimes(1);
    expect(getSchedule).not.toHaveBeenCalled();
    expect(playback.statusCode).toBe(200);
    await app.close();
  });

  it('does not block persisted detail on request-time poster enrichment', async () => {
    const posterResolver = vi.fn(async () => 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/repaired.jpg');
    const app = buildApp({
      homeClient: { getHome: async () => [] },
      sourceProviders: { otakudesu: provider('otakudesu') },
      posterResolver,
      catalogRepository: {
        findDetail: vi.fn(async () => ({ source: 'otakudesu' as const, slug: 'stored', title: 'Stored anime', posterUrl: null, synopsis: null, status: null, type: null, studio: null, genres: [], episodes: [] }))
      }
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/anime/stored' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.posterUrl).toBeNull();
    expect(posterResolver).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not claim an episode was persisted without a structured episode number', async () => {
    const selected = provider('otakudesu');
    selected.getEpisode = vi.fn(async (id: string) => ({ source: 'otakudesu' as const, id, title: 'Episode', animeSlug: 'stored', posterUrl: null, releaseTime: null, previousEpisodeId: null, nextEpisodeId: null, playback: [] }));
    const upsertEpisode = vi.fn(async () => undefined);
    const app = buildApp({
      homeClient: { getHome: async () => [] },
      sourceProviders: { otakudesu: selected },
      catalogRepository: { findEpisode: vi.fn(async () => null), upsertEpisode }
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/episode/episode-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json().meta.persisted).toBe(false);
    expect(upsertEpisode).not.toHaveBeenCalled();
    await app.close();
  });

  it('hydrates a seeded discovered anime on demand when its stored episodes are missing', async () => {
    const selected = provider('otakudesu');
    selected.getDetail = vi.fn(async (slug: string) => ({ source: 'otakudesu' as const, slug, title: 'Hydrated anime', posterUrl: null, synopsis: 'fresh', status: 'Ongoing', type: null, studio: null, genres: [], episodes: [{ id: 'ep-1', title: 'Episode 1', number: 1, releaseDate: null }] }));
    const upsertDetail = vi.fn(async () => undefined);
    const app = buildApp({
      homeClient: { getHome: async () => [] },
      sourceProviders: { otakudesu: selected },
      catalogRepository: {
        findDetail: vi.fn(async () => ({ source: 'otakudesu' as const, slug: 'stored', title: 'Stored anime', posterUrl: null, synopsis: null, status: null, type: null, studio: null, genres: [], episodes: [], firstEpisodeId: null, latestEpisodeId: null, availableSources: [] })),
        upsertDetail
      }
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/anime/stored' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.title).toBe('Hydrated anime');
    expect(response.json().meta.storage).toBe('provider-fallback');
    expect(upsertDetail).toHaveBeenCalledWith('otakudesu', expect.objectContaining({ slug: 'stored' }));
    await app.close();
  });

  it('serves a stored detail without a provider call once episodes exist', async () => {
    const selected = provider('otakudesu');
    const getDetail = vi.spyOn(selected, 'getDetail');
    const app = buildApp({
      homeClient: { getHome: async () => [] },
      sourceProviders: { otakudesu: selected },
      catalogRepository: {
        findDetail: vi.fn(async () => ({ source: 'otakudesu' as const, slug: 'stored', title: 'Stored anime', posterUrl: null, synopsis: 'cached', status: 'Ongoing', type: null, studio: null, genres: [], episodes: [{ id: 'ep-1', title: 'Episode 1', number: 1, releaseDate: null }], firstEpisodeId: 'ep-1', latestEpisodeId: 'ep-1', availableSources: [] }))
      }
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/anime/stored' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.title).toBe('Stored anime');
    expect(response.json().meta.storage).toBe('postgres');
    expect(getDetail).not.toHaveBeenCalled();
    await app.close();
  });

  it('keeps serving stale stored metadata when on-demand hydration fails', async () => {
    const selected = provider('otakudesu');
    selected.getDetail = vi.fn(async () => { throw new Error('Sanka 429'); });
    const app = buildApp({
      homeClient: { getHome: async () => [] },
      sourceProviders: { otakudesu: selected },
      catalogRepository: {
        findDetail: vi.fn(async () => ({ source: 'otakudesu' as const, slug: 'stored', title: 'Stored anime', posterUrl: null, synopsis: null, status: null, type: null, studio: null, genres: [], episodes: [], firstEpisodeId: null, latestEpisodeId: null, availableSources: [] }))
      }
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/anime/stored' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.title).toBe('Stored anime');
    expect(response.json().meta.storage).toBe('postgres');
    await app.close();
  });

  it('returns not found and disables an unhydrated source after a definitive dead link', async () => {
    const selected = provider('otakudesu');
    selected.getDetail = vi.fn(async () => { throw new SankaUpstreamError('data tidak ditemukan', 500); });
    const markSourceUnavailable = vi.fn(async () => undefined);
    const app = buildApp({
      homeClient: { getHome: async () => [] },
      sourceProviders: { otakudesu: selected },
      catalogRepository: {
        findDetail: vi.fn(async () => ({ source: 'otakudesu' as const, slug: 'stored', title: 'Stored anime', posterUrl: null, synopsis: null, status: null, type: null, studio: null, genres: [], episodes: [], firstEpisodeId: null, latestEpisodeId: null, availableSources: [] })),
        markSourceUnavailable
      }
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/anime/stored' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SOURCE_NOT_FOUND');
    expect(markSourceUnavailable).toHaveBeenCalledWith('otakudesu', 'stored', 'data tidak ditemukan');
    await app.close();
  });
});
