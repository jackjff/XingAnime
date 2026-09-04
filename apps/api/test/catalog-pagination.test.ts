import { describe, expect, it, vi } from 'vitest';
import { PostgresCatalogRepository, type Queryable } from '../src/catalog/postgres-repository.js';

describe('Postgres catalog pagination', () => {
  it('returns source-aware catalog pages for search and A-Z browsing', async () => {
    const query = vi.fn(async () => ({ rows: [{
      total_count: '101',
      provider_name: 'otakudesu',
      provider_slug: 'one-piece-sub-indo',
      provider_anime_id: 'one-piece-id',
      title: 'One Piece',
      poster_url: 'https://s4.anilist.co/poster.jpg',
      release_day: 'Minggu',
      latest_episode: '1177'
    }] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    const result = await repository.listCatalog({ query: 'one', letter: 'O', page: 2, limit: 24, source: 'otakudesu' });

    expect(result).toMatchObject({
      page: 2,
      limit: 24,
      total: 101,
      pageCount: 5,
      hasNext: true,
      hasPrevious: true
    });
    expect(result.items[0]).toMatchObject({ source: 'otakudesu', slug: 'one-piece-sub-indo', detailSlug: 'one-piece-sub-indo', latestEpisode: 1177 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('COUNT(*) OVER'), ['one', 'O', 'otakudesu', 24, 24]);
    const sql = (query.mock.calls as unknown as Array<[string]>)[0]?.[0] ?? '';
    expect(sql).not.toContain('src.provider_slug ILIKE');
  });

  it('returns an empty page without losing pagination metadata', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    const result = await repository.listCatalog({ letter: 'Z', page: 1, limit: 24 });

    expect(result).toEqual({ items: [], page: 1, limit: 24, total: 0, pageCount: 0, hasNext: false, hasPrevious: false });
  });

  it('only exposes home sources that have a valid episode and reports the latest episode', async () => {
    const query = vi.fn(async () => ({ rows: [{
      provider_slug: 'one-piece',
      provider_anime_id: 'one-piece-id',
      canonical_slug: 'one-piece',
      title: 'One Piece',
      poster_url: null,
      release_day: 'Minggu',
      latest_episode: '1177'
    }] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    const result = await repository.listSourceHome('samehadaku', 15);

    expect(result[0]).toMatchObject({ source: 'samehadaku', latestEpisode: 1177 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('JOIN episodes AS e'), ['samehadaku', 15]);
  });

  it('returns source-aware episode pages with a server-side search query', async () => {
    const query = vi.fn(async () => ({ rows: [{
      total_count: '101',
      provider_episode_id: 'one-piece-episode-11',
      episode_title: 'One Piece Episode 11',
      episode_number: '11',
      release_date: null
    }] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    const result = await repository.listEpisodes('samehadaku', 'one-piece', { query: '11', page: 2, limit: 50 });

    expect(result).toMatchObject({ page: 2, limit: 50, total: 101, pageCount: 3, hasNext: true, hasPrevious: true });
    expect(result.items).toEqual([{ id: 'one-piece-episode-11', title: 'One Piece Episode 11', number: 11, releaseDate: null }]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('COUNT(*) OVER'), ['samehadaku', 'one-piece', '11', 50, 50]);
  });

  it('does not persist episode zero because it is not playable catalog data', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    await repository.upsertEpisode('otakudesu', 'one-piece', { id: 'episode-0', title: 'Episode 0', number: 0 });

    expect(query).not.toHaveBeenCalled();
  });

  it('keeps the first and latest episode IDs available in lightweight detail responses', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ anime_id: 'anime-1', title: 'One Piece', poster_url: null, synopsis: null, status: 'ongoing', provider_slug: 'one-piece', first_episode_id: 'episode-1', latest_episode_id: 'episode-479' }] })
      .mockResolvedValueOnce({ rows: [{ provider_name: 'otakudesu', provider_slug: 'one-piece', provider_anime_id: 'anime-1' }] });
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    const result = await repository.findDetail('otakudesu', 'one-piece', { includeEpisodes: false });

    expect(result).toMatchObject({ firstEpisodeId: 'episode-1', latestEpisodeId: 'episode-479', episodes: [] });
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('first_episode_id'));
  });
});
