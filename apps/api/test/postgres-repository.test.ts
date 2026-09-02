import { describe, expect, it, vi } from 'vitest';
import { PostgresCatalogRepository, type Queryable } from '../src/catalog/postgres-repository.js';

describe('PostgresCatalogRepository.findEpisode', () => {
  it('returns adjacent episode ids for player navigation', async () => {
    const query = vi.fn(async () => ({ rows: [{
        provider_episode_id: 'episode-2',
        episode_title: 'Episode 2',
        episode_number: '2',
        anime_slug: 'sample-anime',
        previous_episode_id: 'episode-1',
        next_episode_id: 'episode-3'
      }] }));
    const database = { query } as unknown as Queryable;

    const result = await new PostgresCatalogRepository(database).findEpisode('otakudesu', 'episode-2');

    expect(result).toMatchObject({
      id: 'episode-2',
      previousEpisodeId: 'episode-1',
      nextEpisodeId: 'episode-3'
    });
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('LAG'), ['otakudesu', 'episode-2']);
  });
});
