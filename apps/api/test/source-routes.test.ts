import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AnimeSourceProvider, SourceId } from '../src/providers/source-types.js';

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
      findDetail: vi.fn(async () => ({ source: 'otakudesu' as const, slug: 'stored', title: 'Stored anime', posterUrl: null, synopsis: 'cached', status: 'Ongoing', type: null, studio: null, genres: [], episodes: [] })),
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

  it('repairs a missing persisted detail poster from the poster resolver', async () => {
    const app = buildApp({
      homeClient: { getHome: async () => [] },
      sourceProviders: { otakudesu: provider('otakudesu') },
      posterResolver: vi.fn(async () => 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/repaired.jpg'),
      catalogRepository: {
        findDetail: vi.fn(async () => ({ source: 'otakudesu' as const, slug: 'stored', title: 'Stored anime', posterUrl: null, synopsis: null, status: null, type: null, studio: null, genres: [], episodes: [] }))
      }
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/anime/stored' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.posterUrl).toContain('s4.anilist.co');
    await app.close();
  });
});
