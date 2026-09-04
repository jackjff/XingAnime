import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /api/v1/home', () => {
  it('returns the normalized home catalog envelope', async () => {
    const app = buildApp({
      homeClient: {
        getHome: async () => [{
          slug: 'example',
          title: 'Example',
          posterUrl: null,
          latestEpisode: 1,
          releaseDay: 'Selasa',
          source: 'sanka'
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
        source: 'sanka'
      }],
      meta: { cached: false },
      error: null
    });
    await app.close();
  });

  it('enriches persisted home posters before returning the client-agnostic contract', async () => {
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
      posterResolver: async () => 'https://s4.anilist.co/file/example.jpg'
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/home' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].posterUrl).toBe('https://s4.anilist.co/file/example.jpg');
    await app.close();
  });
});
