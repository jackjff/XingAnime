import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { PostgresCatalogRepository, type Queryable } from '../src/catalog/postgres-repository.js';

// Opt in with POSTGRES_TEST_CONTAINER=websiteanime-api-1. Only temporary tables
// are touched; each invocation rolls back and never calls an upstream provider.
function postgresFixture(extraSql = '') {
  const commands: Array<{ text: string; values?: unknown[] }> = [];
  const setup = `
    CREATE TEMP TABLE anime (LIKE public.anime INCLUDING ALL);
    CREATE TEMP TABLE anime_sources (LIKE public.anime_sources INCLUDING ALL);
    CREATE TEMP TABLE episodes (LIKE public.episodes INCLUDING ALL);
    INSERT INTO anime (id, canonical_slug, title, visibility, release_day)
    SELECT md5(n::text)::uuid, 'title-' || n, 'Title ' || n, 'published', 'Senin'
    FROM generate_series(1, 5) n;
    INSERT INTO anime_sources (id, anime_id, provider_name, provider_anime_id, provider_slug, source_status)
    SELECT id, id, 'otakudesu', canonical_slug, canonical_slug, 'discovered' FROM anime;
    ${extraSql}
  `;
  const database: Queryable = {
    async query<Row>(text: string, values?: unknown[]) {
      commands.push({ text, values });
      const script = `
        const { Client } = require('pg');
        const { readFileSync } = require('node:fs');
        const input = JSON.parse(readFileSync(0, 'utf8'));
        (async () => {
          const client = new Client({ connectionString: process.env.DATABASE_URL });
          await client.connect();
          try {
            await client.query('BEGIN');
            await client.query(input.setup);
            let result;
            for (const command of input.commands) result = await client.query(command.text, command.values);
            console.log(JSON.stringify({ rows: result.rows }));
          } finally { await client.query('ROLLBACK'); await client.end(); }
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `;
      return JSON.parse(execFileSync('docker', [
        'exec', '-i', '-w', '/app/apps/api', process.env.POSTGRES_TEST_CONTAINER!, 'node', '-e', script
      ], { input: JSON.stringify({ setup, commands }), encoding: 'utf8', timeout: 20_000 })) as { rows: Row[] };
    }
  };
  return { database, commands, repository: new PostgresCatalogRepository(database) };
}

describe.skipIf(!process.env.POSTGRES_TEST_CONTAINER)('real PostgreSQL catalog regressions', () => {
  it.each(['%', '_', '\\'])('treats %s as a literal search character', async (character) => {
    const { repository } = postgresFixture(`UPDATE anime SET title = $$Literal ${character} title$$ WHERE canonical_slug = 'title-1'`);
    const result = await repository.listCatalog({ query: character, page: 99, limit: 2 });
    expect(result.total).toBe(1);
    expect(result.items.map(item => item.slug)).toEqual(['title-1']);
  });
  it('prefers valid episode-bearing sources while preserving discovered titles and explicit sources', async () => {
    const { repository } = postgresFixture(`
      INSERT INTO anime_sources (id, anime_id, provider_name, provider_anime_id, provider_slug, source_status)
      VALUES (md5('alternate')::uuid, md5('1')::uuid, 'samehadaku', 'alternate-1', 'alternate-1', 'verified');
      INSERT INTO episodes (anime_id, source_id, episode_number, provider_episode_id, episode_title)
      VALUES (md5('1')::uuid, md5('alternate')::uuid, 3, 'valid-3', 'Episode 3'),
             (md5('1')::uuid, md5('1')::uuid, 999, 'pembatas-999', 'Episode 999'),
             (md5('1')::uuid, md5('1')::uuid, 998, 'pending-998', 'Dalam Proses');
    `);
    const all = await repository.listCatalog();
    expect(all.total).toBe(5);
    expect(all.items[0]).toMatchObject({ source: 'samehadaku', slug: 'alternate-1', latestEpisode: 3 });
    expect(all.items[1]).toMatchObject({ source: 'otakudesu', latestEpisode: null });
    const explicit = await repository.listCatalog({ source: 'otakudesu' });
    expect(explicit.total).toBe(5);
    expect(explicit.items[0]).toMatchObject({ source: 'otakudesu', slug: 'title-1', latestEpisode: null });
  });

  it('uses a unique tie-breaker so equal titles paginate without overlap', async () => {
    const { repository } = postgresFixture("UPDATE anime SET title = 'Same title'");
    const pages = [];
    for (const page of [1, 2, 3]) pages.push(await repository.listCatalog({ page, limit: 2 }));
    expect(pages.flatMap(page => page.items.map(item => item.slug))).toEqual(['title-1', 'title-2', 'title-3', 'title-4', 'title-5']);
  });

  it('preserves a known release day during sparse home or detail ingestion', async () => {
    const { repository, database } = postgresFixture();
    const item = { source: 'otakudesu' as const, slug: 'title-1', detailSlug: 'title-1', title: 'Title 1', posterUrl: null, latestEpisode: null, releaseDay: null };
    await repository.upsertSourceHome('otakudesu', [item]);
    expect((await database.query<{ release_day: string }>("SELECT release_day FROM anime WHERE canonical_slug = 'title-1'")).rows[0].release_day).toBe('Senin');
    await repository.upsertSourceHome('otakudesu', [{ ...item, releaseDay: 'Selasa' }]);
    expect((await database.query<{ release_day: string }>("SELECT release_day FROM anime WHERE canonical_slug = 'title-1'")).rows[0].release_day).toBe('Selasa');
  });

  it('clamps out-of-range pages and fetches the matching final rows in one snapshot', async () => {
    const { repository, commands } = postgresFixture();
    const result = await repository.listCatalog({ page: 999, limit: 2 });
    expect(result).toMatchObject({ total: 5, page: 3, pageCount: 3, hasNext: false, hasPrevious: true });
    expect(result.items.map(item => item.slug)).toEqual(['title-5']);
    expect(commands).toHaveLength(1);
  });
});

describe('Postgres catalog pagination', () => {
  it('lists only active source rows with valid published episodes', async () => {
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => ({ rows: [] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    await repository.listSourceHome('samehadaku');

    expect(query.mock.calls[0][0]).toContain("src.source_status = 'verified'");
    expect(query.mock.calls[0][0]).toContain("e.visibility = 'published'");
    expect(query.mock.calls[0][0]).toContain('e.episode_number > 0');
  });

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
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT COUNT(*) AS total_count FROM catalog'), ['one', 'O', 'otakudesu', 24, 24]);
    const sql = (query.mock.calls as unknown as Array<[string]>)[0]?.[0] ?? '';
    expect(sql).not.toContain('src.provider_slug ILIKE');
    expect(sql).toContain('ROW_NUMBER() OVER');
    expect(sql).toContain('PARTITION BY a.id');
    expect(sql).toContain("WHERE source_rank = 1");
    expect(sql).not.toContain('HAVING COUNT(e.id) > 0');
    expect(sql).toContain('LEFT JOIN episodes AS e');
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

  it('replaces an older provider row for the same logical episode number', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    await repository.upsertEpisode('oploverz', 'one-piece', {
      id: 'one-piece-episode-10155',
      title: 'One Piece Episode 1015.5',
      number: 1015.5
    });

    const sql = (query.mock.calls as unknown as Array<[string]>)[0]?.[0] ?? '';
    expect(sql).toContain('DELETE FROM episodes');
    expect(sql).toContain('episode_number = $4');
    expect(sql).toContain('provider_episode_id <> $3');
  });

  it('keeps the first and latest episode IDs available in lightweight detail responses', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ anime_id: 'anime-1', title: 'One Piece', poster_url: null, synopsis: null, status: 'ongoing', provider_slug: 'one-piece', first_episode_id: 'episode-1', latest_episode_id: 'episode-479' }] })
      .mockResolvedValueOnce({ rows: [{ provider_name: 'otakudesu', provider_slug: 'one-piece', provider_anime_id: 'anime-1' }] });
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    const result = await repository.findDetail('otakudesu', 'one-piece', { includeEpisodes: false });

    expect(result).toMatchObject({ firstEpisodeId: 'episode-1', latestEpisodeId: 'episode-479', episodes: [] });
    expect(query.mock.calls[0]?.[0]).toEqual(expect.stringContaining('first_episode_id'));
    expect(query.mock.calls[1]?.[0]).toEqual(expect.stringContaining("src.source_status <> 'disabled'"));
  });
});
