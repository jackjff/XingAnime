import { describe, expect, it, vi } from 'vitest';
import { canonicalSlug, PostgresCatalogRepository, type Queryable } from '../src/catalog/postgres-repository.js';

describe('PostgresCatalogRepository.findEpisode', () => {
  it('returns adjacent episode ids for player navigation', async () => {
    const query = vi.fn(async () => ({ rows: [{
        provider_episode_id: 'episode-2',
        episode_title: 'Episode 2',
        episode_number: '2',
        anime_slug: 'sample-anime',
        poster_url: 'https://s4.anilist.co/file/poster.jpg',
        previous_episode_id: 'episode-1',
        next_episode_id: 'episode-3'
      }] }));
    const database = { query } as unknown as Queryable;

    const result = await new PostgresCatalogRepository(database).findEpisode('otakudesu', 'episode-2');

    expect(result).toMatchObject({
      id: 'episode-2',
      previousEpisodeId: 'episode-1',
      nextEpisodeId: 'episode-3',
    });
    expect(query.mock.calls).toContainEqual([expect.stringContaining('LAG'), ['otakudesu', 'episode-2']]);
    expect(query.mock.calls).toContainEqual([expect.stringContaining('e.episode_number = $2'), [undefined, '2']]);
  });

  it('normalizes the provider ongoing suffix into the canonical identity', () => {
    expect(canonicalSlug('One Piece On-Going')).toBe('one-piece');
  });

  it('normalizes Latin diacritics consistently with the database identity function', () => {
    expect(canonicalSlug('Pokémon On-Going')).toBe('pokemon');
  });

  it('requests cross-source alternatives for the selected episode number', async () => {
    const query = vi.fn(async () => ({ rows: [{
      anime_id: 'anime-1', provider_episode_id: 'episode-10', episode_title: 'Episode 10', episode_number: '10', anime_slug: 'one-piece', previous_episode_id: 'episode-9', next_episode_id: 'episode-11'
    }] }));
    await new PostgresCatalogRepository({ query } as unknown as Queryable).findEpisode('otakudesu', 'episode-10');
    expect(query.mock.calls).toContainEqual([expect.stringContaining('e.episode_number = $2'), ['anime-1', '10']]);
    expect(query.mock.calls).toContainEqual([expect.stringContaining("src.source_status <> 'disabled'"), ['anime-1', '10']]);
  });

  it('excludes disabled sources when selecting a canonical schedule representative', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await new PostgresCatalogRepository({ query } as unknown as Queryable).listSchedule();

    expect(query).toHaveBeenCalledWith(expect.stringContaining("s.source_status <> 'disabled'"), [null]);
  });
});
