import { describe, expect, it, vi } from 'vitest';
import { CatalogSyncWorker } from '../src/catalog/sync-worker.js';

describe('sync circuit stop propagation', () => {
  it('skips schedules when hydration opens the circuit', async () => {
    const getSchedule = vi.fn(async () => []);
    const worker = new CatalogSyncWorker([{ source: 'otakudesu', getHome: async () => [], getAllAnime: async () => [], getDetail: async () => { throw Object.assign(new Error('paused'), { status: 429 }); }, getSchedule }], {
      upsertSourceHome: async () => undefined, upsertSchedule: async () => undefined,
      listDiscoveredSources: async () => [{ source: 'otakudesu', slug: 'a' }], upsertDetail: async () => undefined
    });
    await worker.runSeedCycle();
    expect(getSchedule).not.toHaveBeenCalled();
  });
  it.each([403, 429])('stops seed and skips hydration/schedules after HTTP %s', async (status) => {
    const secondSeed = vi.fn(async () => []);
    const listDiscoveredSources = vi.fn(async () => []);
    const getSchedule = vi.fn(async () => []);
    const worker = new CatalogSyncWorker([
      { source: 'otakudesu', getHome: async () => [], getAllAnime: async () => { throw Object.assign(new Error('paused'), { status }); }, getSchedule },
      { source: 'samehadaku', getHome: async () => [], getAllAnime: secondSeed }
    ], { upsertSourceHome: async () => undefined, listDiscoveredSources, upsertDetail: async () => undefined, upsertSchedule: async () => undefined });
    expect(await worker.runSeedCycle()).toEqual({ seeded: 0, hydrated: 0, schedule: 0 });
    expect(secondSeed).not.toHaveBeenCalled();
    expect(listDiscoveredSources).not.toHaveBeenCalled();
    expect(getSchedule).not.toHaveBeenCalled();
  });

  it.each(['runOnce', 'runSchedulesOnce'] as const)('stops %s on HTTP 403 as well as 429', async (operation) => {
    const fail = async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); };
    const second = vi.fn(async () => []);
    const worker = new CatalogSyncWorker([
      { source: 'otakudesu', getHome: fail, getSchedule: fail },
      { source: 'samehadaku', getHome: second, getSchedule: second }
    ], { upsertSourceHome: async () => undefined, upsertSchedule: async () => undefined });
    expect(await worker[operation]()).toEqual({ succeeded: 0, failed: 1, items: 0, stoppedOnRateLimit: true });
    expect(second).not.toHaveBeenCalled();
  });
});
