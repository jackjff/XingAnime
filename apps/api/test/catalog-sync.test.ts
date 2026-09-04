import { describe, expect, it, vi } from 'vitest';
import { CatalogSyncWorker } from '../src/catalog/sync-worker.js';
import { PostgresCatalogRepository } from '../src/catalog/postgres-repository.js';

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
    expect(query.mock.calls[0][0]).toContain('WHEN $3 IS NOT NULL');
    expect(query.mock.calls[0][0]).toContain('EXCLUDED.poster_url IS NOT NULL');
    expect(query.mock.calls[0][0]).toContain('EXCLUDED.poster_url ~');
    expect(query.mock.calls[0][0]).toContain('anilist');
    expect(query.mock.calls[0][1]).toEqual(['liar-game', 'Liar Game', 'https://img.example/liar.jpg', 'Sabtu']);
    expect(query.mock.calls[1][1]).toEqual(['anime-1', 'samehadaku', 'liar-game', 'liar-game']);
  });

  it('clears every poster outside the trusted AniList CDN allowlist', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresCatalogRepository({ query });

    await repository.clearUnusablePosters();

    expect(query.mock.calls[0][0]).toContain('anilist');
    expect(query.mock.calls[0][0]).toContain('anili');
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
    expect(repository.upsertSourceHome).toHaveBeenCalledWith('samehadaku', [sourceItem()]);
  });

  it('replaces blocked provider posters before persisting them', async () => {
    const repository = { upsertSourceHome: vi.fn(async () => undefined) };
    const worker = new CatalogSyncWorker(
      [{ source: 'samehadaku' as const, getHome: vi.fn(async () => [{ ...sourceItem(), posterUrl: 'https://v2.samehadaku.how/poster.jpg' }]) }],
      repository,
      async () => 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/fallback.jpg'
    );

    await worker.runOnce();

    const calls = repository.upsertSourceHome.mock.calls as unknown as Array<[string, Array<{ posterUrl: string | null }>] >;
    const persisted = calls[0]?.[1];
    expect(persisted?.[0]?.posterUrl).toContain('s4.anilist.co');
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
});
