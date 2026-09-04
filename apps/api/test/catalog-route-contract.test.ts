import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AnimeSourceProvider, SourceId } from '../src/providers/source-types.js';

function provider(source: SourceId): AnimeSourceProvider {
  return {
    source,
    getHome: async () => [],
    getDetail: async (slug) => ({ source, slug, title: source, posterUrl: null, synopsis: null, status: null, type: null, studio: null, genres: [], episodes: [] }),
    getEpisode: async (id) => ({ source, id, title: id, animeSlug: 'sample', releaseTime: null, previousEpisodeId: null, nextEpisodeId: null, playback: [] }),
    resolveServer: async () => ({ label: 'server', quality: null, kind: 'embed', mode: 'unknown', reason: 'not_verified', url: null, serverId: null }),
    getSchedule: async () => []
  };
}

describe('catalog route contracts', () => {
  it('exposes search and A-Z catalog pages through stable JSON pagination', async () => {
    const listCatalog = vi.fn(async (options: { letter?: string; page?: number; limit?: number }) => ({ items: [{ source: 'otakudesu' as const, slug: 'one', detailSlug: 'one', title: options.letter === 'O' ? 'One Piece' : 'Naruto', posterUrl: null, latestEpisode: 1, releaseDay: null }], page: options.page ?? 1, limit: options.limit ?? 24, total: 1, pageCount: 1, hasNext: false, hasPrevious: false }));
    const app = buildApp({
      homeClient: { getHome: async () => [] },
      catalogRepository: { listCatalog }
    });

    const search = await app.inject({ method: 'GET', url: '/api/v1/catalog/search?q=one&letter=O&page=2&limit=12' });
    const az = await app.inject({ method: 'GET', url: '/api/v1/catalog?letter=O&page=1&limit=24' });

    expect(search.statusCode).toBe(200);
    expect(search.json().meta).toMatchObject({ page: 2, limit: 12, total: 1, pageCount: 1 });
    expect(listCatalog).toHaveBeenNthCalledWith(1, expect.objectContaining({ query: 'one', letter: 'O', page: 2, limit: 12 }));
    expect(az.statusCode).toBe(200);
    expect(az.json().data[0].title).toBe('One Piece');
    await app.close();
  });

  it('exposes server-side episode pagination and rejects invalid letters', async () => {
    const app = buildApp({
      homeClient: { getHome: async () => [] },
      catalogRepository: {
        listEpisodes: async () => ({ items: [{ id: 'ep-1', title: 'Episode 1', number: 1, releaseDate: null }], page: 1, limit: 50, total: 1, pageCount: 1, hasNext: false, hasPrevious: false })
      }
    });

    const episodes = await app.inject({ method: 'GET', url: '/api/v1/sources/otakudesu/anime/one-piece/episodes?q=1&page=1&limit=50' });
    const invalid = await app.inject({ method: 'GET', url: '/api/v1/catalog?letter=1' });

    expect(episodes.statusCode).toBe(200);
    expect(episodes.json().meta.storage).toBe('postgres');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('INVALID_LETTER');
    await app.close();
  });

  it('returns partial home data and provider statuses when one source fails', async () => {
    const app = buildApp({
      homeClient: { getHome: async () => [] },
      sourceProviders: {
        otakudesu: provider('otakudesu'),
        samehadaku: { ...provider('samehadaku'), getHome: async () => { throw new Error('HTTP 503'); } }
      }
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/home' });
    const payload = response.json();

    expect(response.statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.meta.partial).toBe(true);
    expect(payload.meta.providers).toMatchObject({ otakudesu: 'healthy', samehadaku: 'unavailable' });
    await app.close();
  });
});
