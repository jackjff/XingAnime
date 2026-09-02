import { describe, expect, it } from 'vitest';
import { AniListPosterClient } from '../src/providers/anilist/client.js';

describe('AniListPosterClient', () => {
  it('falls back to a meaningful phrase for long titles', async () => {
    const searches: string[] = [];
    const client = new AniListPosterClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { variables: { search: string } };
      searches.push(body.variables.search);
      const found = body.variables.search === 'Mukashi Danshi to Omotte';
      return new Response(JSON.stringify({
        data: found ? { Media: { coverImage: { large: 'https://s4.anilist.co/fallback.jpg' } } } : { Media: null }
      }), { status: 200 });
    });

    await expect(client.resolve('Tenkou-saki no Seiso Karen na Bishoujo ga, Mukashi Danshi to Omotte Issho ni Asonda Osananajimi Datta Ken'))
      .resolves.toBe('https://s4.anilist.co/fallback.jpg');
    expect(searches).toContain('Mukashi Danshi to Omotte');
  });

  it('tries a season alias for provider shorthand titles', async () => {
    const searches: string[] = [];
    const client = new AniListPosterClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { variables: { search: string } };
      searches.push(body.variables.search);
      const found = body.variables.search === 'Kusuriya no Hitorigoto 2nd Season';
      return new Response(JSON.stringify({ data: found ? { Media: { coverImage: { large: 'https://s4.anilist.co/season.jpg' } } } : { Media: null } }), { status: 200 });
    });

    await expect(client.resolve('Kusuriya no Hitorigoto S2')).resolves.toBe('https://s4.anilist.co/season.jpg');
    expect(searches).toContain('Kusuriya no Hitorigoto 2nd Season');
  });
});
