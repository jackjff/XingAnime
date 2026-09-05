import { describe, expect, it, vi } from 'vitest';
import { CatalogSyncWorker } from '../src/catalog/sync-worker.js';
import { PostgresCatalogRepository, type Queryable } from '../src/catalog/postgres-repository.js';

function sourceItem() {
  return {
    source: 'samehadaku' as const,
    slug: 'liar-game',
    detailSlug: 'liar-game',
    title: 'Liar Game',
    posterUrl: 'https://img.example/liar.jpg',
    latestEpisode: 22,
    releaseDay: 'Sabtu'
  };
}

describe('PostgresCatalogRepository', () => {
  it('upserts anime and provider identity without collapsing source IDs', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'anime-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresCatalogRepository({ query });

    await repository.upsertSourceHome('samehadaku', [sourceItem()]);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('WHEN $3::text IS NOT NULL');
    expect(query.mock.calls[0][0]).toContain('EXCLUDED.poster_url IS NOT NULL');
    expect(query.mock.calls[0][0]).toContain('EXCLUDED.poster_url ~');
    expect(query.mock.calls[0][0]).toContain('anilist');
    expect(query.mock.calls[0][0]).toContain('$3::text');
    expect(query.mock.calls[0][0]).toContain('poster_status');
    expect(query.mock.calls[0][0]).toContain("'resolved'");
    expect(query.mock.calls[0][1]).toEqual(['liar-game', 'Liar Game', 'https://img.example/liar.jpg', 'Sabtu']);
    expect(query.mock.calls[1][1]).toEqual(['anime-1', 'samehadaku', 'liar-game', 'liar-game']);
    expect(query.mock.calls[1][0]).toContain('WITH updated_source AS');
    expect(query.mock.calls[1][0]).toContain('anime_id = $1 AND provider_name = $2');
    expect(query.mock.calls[1][0]).toContain("'discovered'");
    expect(query.mock.calls[1][0]).toContain("source_status = 'verified' THEN 'verified'");
  });

  it('promotes a source only after persisting a structured valid episode number', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'anime-1' }] })
      .mockResolvedValue({ rows: [] });
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    await repository.upsertDetail('oploverz', {
      source: 'oploverz',
      slug: 'one-piece',
      title: 'One Piece',
      posterUrl: null,
      synopsis: null,
      status: 'Ongoing',
      type: null,
      studio: null,
      genres: [],
      episodes: [
        { id: 'placeholder', title: 'Dalam proses', number: null, releaseDate: null },
        { id: 'one-piece-episode-1015-5', title: 'One Piece Episode 1015.5', number: 1015.5, releaseDate: null }
      ]
    });

    const allSql = query.mock.calls.map(([sql]) => sql);
    expect(query.mock.calls.flatMap(([, parameters]) => parameters ?? [])).not.toContain('placeholder');
    expect(query.mock.calls.flatMap(([, parameters]) => parameters ?? [])).toContain(1015.5);
    expect(allSql.at(-1)).toContain("source_status = 'verified'");
  });

  it('uses the stable detail slug as Oploverz provider identity', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'anime-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresCatalogRepository({ query });

    await repository.upsertSourceHome('oploverz', [{
      ...sourceItem(),
      source: 'oploverz',
      slug: 'one-piece-episode-1176-subtitle-indonesia',
      detailSlug: 'one-piece',
      title: 'One Piece'
    }]);

    expect(query.mock.calls[1][1]).toEqual(['anime-1', 'oploverz', 'one-piece', 'one-piece']);
  });

  it('clears every poster outside the trusted AniList CDN allowlist', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresCatalogRepository({ query });

    await repository.clearUnusablePosters();

    expect(query.mock.calls[0][0]).toContain('anilist');
    expect(query.mock.calls[0][0]).toContain('anili');
  });

  it('selects missing posters fairly and delays repeated unresolved lookups', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'anime-1', title: 'One Piece' }] });
    const repository = new PostgresCatalogRepository({ query });

    await expect(repository.listMissingPosters(15)).resolves.toEqual([{ id: 'anime-1', title: 'One Piece' }]);

    expect(query.mock.calls[0][0]).toContain('poster_url IS NULL');
    expect(query.mock.calls[0][0]).toContain('poster_checked_at');
    expect(query.mock.calls[0][0]).toContain("source_status = 'verified'");
    expect(query.mock.calls[0][0]).toContain('DESC, poster_checked_at ASC NULLS FIRST');
    expect(query.mock.calls[0][1]).toEqual([15]);
  });

  it('persists trusted poster resolution state separately from unresolved state', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresCatalogRepository({ query });

    await repository.updatePoster('anime-1', 'https://s4.anilist.co/file/one-piece.jpg');
    await repository.markPosterUnresolved('anime-2');

    expect(query.mock.calls[0][0]).toContain("poster_status = 'resolved'");
    expect(query.mock.calls[0][1]).toEqual(['anime-1', 'https://s4.anilist.co/file/one-piece.jpg']);
    expect(query.mock.calls[1][0]).toContain("poster_status = 'unresolved'");
    expect(query.mock.calls[1][1]).toEqual(['anime-2']);
  });

  it('casts nullable provider HTTP status before PostgreSQL comparisons', async () => {
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => ({ rows: [] }));
    const repository = new PostgresCatalogRepository({ query });

    await repository.updateProviderHealth('otakudesu', 'degraded', null);

    expect(query.mock.calls[0][0]).toContain('$3::integer = 403');
    expect(query.mock.calls[0][0]).toContain('$3::integer = 429');
    expect(query.mock.calls[0][1]).toEqual(['otakudesu', 'degraded', null]);
  });

  it('selects discovered sources fairly for background detail hydration', async () => {
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => ({
      rows: [{ source: 'samehadaku', slug: 'liar-game' }]
    }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    await expect(repository.listDiscoveredSources(6)).resolves.toEqual([{ source: 'samehadaku', slug: 'liar-game' }]);
    expect(query.mock.calls[0][0]).toContain("source_status = 'discovered'");
    expect(query.mock.calls[0][0]).toContain('hydration_checked_at');
  });
});

describe('CatalogSyncWorker', () => {
  it('continues syncing other sources when one provider fails', async () => {
    const repository = { upsertSourceHome: vi.fn(async () => undefined) };
    const providers = [
      { source: 'otakudesu' as const, getHome: vi.fn(async () => { throw new Error('paused'); }) },
      { source: 'samehadaku' as const, getHome: vi.fn(async () => [sourceItem()]) }
    ];
    const worker = new CatalogSyncWorker(providers, repository);

    await expect(worker.runOnce()).resolves.toEqual({ succeeded: 1, failed: 1, items: 1 });
    expect(repository.upsertSourceHome).toHaveBeenCalledWith('samehadaku', [{ ...sourceItem(), posterUrl: null }]);
  });

  it('sanitizes blocked provider posters without calling AniList during catalog sync', async () => {
    const repository = { upsertSourceHome: vi.fn(async () => undefined) };
    const posterResolver = vi.fn(async () => 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/fallback.jpg');
    const worker = new CatalogSyncWorker(
      [{ source: 'samehadaku' as const, getHome: vi.fn(async () => [{ ...sourceItem(), posterUrl: 'https://v2.samehadaku.how/poster.jpg' }]) }],
      repository,
      posterResolver
    );

    await worker.runOnce();

    const calls = repository.upsertSourceHome.mock.calls as unknown as Array<[string, Array<{ posterUrl: string | null }>] >;
    const persisted = calls[0]?.[1];
    expect(persisted?.[0]?.posterUrl).toBeNull();
    expect(posterResolver).not.toHaveBeenCalled();
  });

  it('syncs schedules separately from the home catalog', async () => {
    const repository = { upsertSourceHome: vi.fn(async () => undefined), upsertSchedule: vi.fn(async () => undefined) };
    const schedule = [{ day: 'Senin', items: [{ source: 'samehadaku' as const, slug: 'liar-game', title: 'Liar Game', posterUrl: null, episodeLabel: 'Episode 1' }] }];
    const provider = { source: 'samehadaku' as const, getHome: vi.fn(async () => []), getSchedule: vi.fn(async () => schedule) };

    const result = await new CatalogSyncWorker([provider], repository).runSchedulesOnce();

    expect(result).toEqual({ succeeded: 1, failed: 0, items: 1 });
    expect(repository.upsertSchedule).toHaveBeenCalledWith('samehadaku', schedule);
  });

  it('records provider pause state when a sync receives HTTP 403', async () => {
    const repository = {
      upsertSourceHome: vi.fn(async () => undefined),
      startSyncRun: vi.fn(async () => 'run-1'),
      updateProviderHealth: vi.fn(async () => undefined),
      finishSyncRun: vi.fn(async () => undefined)
    };
    const provider = { source: 'otakudesu' as const, getHome: vi.fn(async () => { throw new Error('Sanka request failed with HTTP 403'); }) };

    await new CatalogSyncWorker([provider], repository).runOnce();

    expect(repository.updateProviderHealth).toHaveBeenCalledWith('otakudesu', 'paused', 403);
    expect(repository.finishSyncRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'failed', recordsFailed: 1 }));
  });

  it('stops the shared sync queue after HTTP 429', async () => {
    const repository = {
      upsertSourceHome: vi.fn(async () => undefined),
      startSyncRun: vi.fn(async () => null),
      updateProviderHealth: vi.fn(async () => undefined),
      finishSyncRun: vi.fn(async () => undefined)
    };
    const first = { source: 'otakudesu' as const, getHome: vi.fn(async () => { throw Object.assign(new Error('rate limited'), { status: 429, retryAfterMs: 7000 }); }) };
    const second = { source: 'samehadaku' as const, getHome: vi.fn(async () => [sourceItem()]) };

    await expect(new CatalogSyncWorker([first, second], repository).runOnce()).resolves.toEqual({
      succeeded: 0,
      failed: 1,
      items: 0,
      stoppedOnRateLimit: true
    });
    expect(second.getHome).not.toHaveBeenCalled();
  });

  it('backfills missing posters independently from provider sync health', async () => {
    const repository = {
      upsertSourceHome: vi.fn(async () => undefined),
      listMissingPosters: vi.fn(async () => [
        { id: 'anime-1', title: 'One Piece' },
        { id: 'anime-2', title: 'Unknown Anime' }
      ]),
      updatePoster: vi.fn(async () => undefined),
      markPosterUnresolved: vi.fn(async () => undefined)
    };
    const resolvePoster = vi.fn(async (title: string) => title === 'One Piece'
      ? 'https://s4.anilist.co/file/one-piece.jpg'
      : null);
    const worker = new CatalogSyncWorker([], repository, resolvePoster);

    const result = await worker.backfillPosters(10);

    expect(result).toEqual({ attempted: 2, updated: 1, unresolved: 1 });
    expect(repository.listMissingPosters).toHaveBeenCalledWith(10);
    expect(repository.updatePoster).toHaveBeenCalledWith('anime-1', 'https://s4.anilist.co/file/one-piece.jpg');
    expect(repository.markPosterUnresolved).toHaveBeenCalledWith('anime-2');
  });

  it('hydrates discovered sources through detail endpoints before promotion', async () => {
    const getDetail = vi.fn(async () => ({
      source: 'samehadaku' as const,
      slug: 'liar-game',
      title: 'Liar Game',
      posterUrl: null,
      synopsis: null,
      status: 'Ongoing',
      type: null,
      studio: null,
      genres: [],
      episodes: [{ id: 'liar-game-episode-1', title: 'Episode 1', number: 1, releaseDate: null }]
    }));
    const selected = { source: 'samehadaku' as const, getHome: vi.fn(async () => []), getDetail };
    const repository = {
      upsertSourceHome: vi.fn(async () => undefined),
      recordProviderHealth: vi.fn(async () => undefined),
      listDiscoveredSources: vi.fn(async () => [{ source: 'samehadaku' as const, slug: 'liar-game' }]),
      upsertDetail: vi.fn(async () => undefined),
      markSourceHydrationAttempt: vi.fn(async () => undefined)
    };
    const worker = new CatalogSyncWorker([selected], repository);

    await expect(worker.hydrateDiscoveredSources(6)).resolves.toEqual({ attempted: 1, succeeded: 1, failed: 0, stoppedOnRateLimit: false });
    expect(getDetail).toHaveBeenCalledWith('liar-game');
    expect(repository.upsertDetail).toHaveBeenCalledOnce();
    expect(repository.markSourceHydrationAttempt).not.toHaveBeenCalled();
  });
});
