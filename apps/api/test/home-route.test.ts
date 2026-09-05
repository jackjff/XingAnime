import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /api/v1/home', () => {
  it('serves the canonical PostgreSQL read model without provider fan-out', async () => {
    const providerHome = vi.fn(async () => []);
    const listSourceHome = vi.fn(async () => [{ title: 'duplicate source row' }]);
    const listCatalog = vi.fn(async () => ({
      items: [{ source: 'otakudesu' as const, slug: 'one-piece', detailSlug: 'one-piece', title: 'One Piece', posterUrl: null, latestEpisode: 1177, releaseDay: 'Minggu' }],
      page: 1,
      limit: 15,
      total: 1,
      pageCount: 1,
      hasNext: false,
      hasPrevious: false
    }));
    const app = buildApp({
      homeClient: { getHome: providerHome },
      sourceProviders: {
        otakudesu: { getHome: providerHome } as never,
        samehadaku: { getHome: providerHome } as never
      },
      catalogRepository: { listCatalog, listSourceHome }
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/home' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
    expect(response.json().meta).toMatchObject({ storage: 'postgres', cached: true });
    expect(listCatalog).toHaveBeenCalledWith({ page: 1, limit: 15 });
    expect(listSourceHome).not.toHaveBeenCalled();
    expect(providerHome).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns the normalized home catalog envelope', async () => {
    const app = buildApp({
      homeClient: {
        getHome: async () => [{
          slug: 'example',
          title: 'Example',
          posterUrl: null,
          latestEpisode: 1,
          releaseDay: 'Selasa',
          source: 'otakudesu'
        }]
      }
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/home' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: [{
        slug: 'example',
        title: 'Example',
        posterUrl: null,
        latestEpisode: 1,
        releaseDay: 'Selasa',
        source: 'otakudesu'
      }],
      meta: { cached: false },
      error: null
    });
    await app.close();
  });

  it('does not block persisted home results on external poster enrichment', async () => {
    const posterResolver = vi.fn(async () => 'https://s4.anilist.co/file/example.jpg');
    const app = buildApp({
      homeClient: { getHome: async () => [] },
      sourceProviders: {
        otakudesu: { getHome: async () => [] } as never
      },
      catalogRepository: {
        listSourceHome: async () => [{
          slug: 'example',
          title: 'Example',
          posterUrl: null,
          latestEpisode: 1,
          releaseDay: 'Selasa',
          source: 'otakudesu'
        }]
      },
      posterResolver
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/home' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].posterUrl).toBeNull();
    expect(posterResolver).not.toHaveBeenCalled();
    await app.close();
  });
});
