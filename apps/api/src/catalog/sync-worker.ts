import type { SourceAnimeSummary, SourceId, SourceScheduleDay } from '../providers/source-types.js';

type SyncProvider = {
  source: SourceId;
  getHome(): Promise<SourceAnimeSummary[]>;
  getSchedule?(): Promise<SourceScheduleDay[]>;
};

type SyncRepository = {
  clearUnusablePosters?(): Promise<void>;
  startSyncRun?(provider: SourceId, operation: string): Promise<string | null>;
  finishSyncRun?(runId: string | null, result: { status: 'success' | 'partial' | 'failed'; requestsUsed: number; recordsFound: number; recordsFailed: number; errorMessage?: string }): Promise<void>;
  updateProviderHealth?(provider: SourceId, status: 'healthy' | 'degraded' | 'paused', httpStatus: number | null): Promise<void>;
  upsertSourceHome(source: SourceId, items: SourceAnimeSummary[]): Promise<void>;
  upsertSchedule?(source: SourceId, schedule: SourceScheduleDay[]): Promise<void>;
};
type PosterResolver = (title: string) => Promise<string | null>;

export type SyncResult = { succeeded: number; failed: number; items: number };

export class CatalogSyncWorker {
  constructor(
    private readonly providers: SyncProvider[],
    private readonly repository: SyncRepository,
    private readonly resolvePoster?: PosterResolver
  ) {}

  async runOnce(): Promise<SyncResult> {
    await this.repository.clearUnusablePosters?.();
    let succeeded = 0;
    let failed = 0;
    let items = 0;

    for (const provider of this.providers) {
      const runId = await this.repository.startSyncRun?.(provider.source, 'home');
      try {
        const sourceItems = await provider.getHome();
        const persistedItems = this.resolvePoster
          ? await this.enrichPosters(sourceItems)
          : sourceItems;
        await this.repository.upsertSourceHome(provider.source, persistedItems);
        succeeded += 1;
        items += persistedItems.length;
        await this.repository.updateProviderHealth?.(provider.source, 'healthy', 200);
        await this.repository.finishSyncRun?.(runId ?? null, { status: 'success', requestsUsed: 1, recordsFound: persistedItems.length, recordsFailed: 0 });
      } catch (cause) {
        failed += 1;
        const message = cause instanceof Error ? cause.message : String(cause);
        const httpStatus = /HTTP (403|429)/.exec(message)?.[1];
        await this.repository.updateProviderHealth?.(provider.source, httpStatus ? 'paused' : 'degraded', httpStatus ? Number(httpStatus) : null);
        await this.repository.finishSyncRun?.(runId ?? null, { status: 'failed', requestsUsed: 1, recordsFound: 0, recordsFailed: 1, errorMessage: message });
      }
    }

    return { succeeded, failed, items };
  }

  async runSchedulesOnce(): Promise<SyncResult> {
    let succeeded = 0;
    let failed = 0;
    let items = 0;
    for (const provider of this.providers) {
      if (!provider.getSchedule || !this.repository.upsertSchedule) continue;
      const runId = await this.repository.startSyncRun?.(provider.source, 'schedule');
      try {
        const schedule = await provider.getSchedule();
        const persistedSchedule = this.resolvePoster ? await this.enrichSchedule(schedule) : schedule;
        await this.repository.upsertSchedule(provider.source, persistedSchedule);
        const scheduleItems = persistedSchedule.reduce((total, group) => total + group.items.length, 0);
        succeeded += 1;
        items += scheduleItems;
        await this.repository.updateProviderHealth?.(provider.source, 'healthy', 200);
        await this.repository.finishSyncRun?.(runId ?? null, { status: 'success', requestsUsed: 1, recordsFound: scheduleItems, recordsFailed: 0 });
      } catch (cause) {
        failed += 1;
        const message = cause instanceof Error ? cause.message : String(cause);
        const httpStatus = /HTTP (403|429)/.exec(message)?.[1];
        await this.repository.updateProviderHealth?.(provider.source, httpStatus ? 'paused' : 'degraded', httpStatus ? Number(httpStatus) : null);
        await this.repository.finishSyncRun?.(runId ?? null, { status: 'failed', requestsUsed: 1, recordsFound: 0, recordsFailed: 1, errorMessage: message });
      }
    }
    return { succeeded, failed, items };
  }

  private async enrichPosters(items: SourceAnimeSummary[]): Promise<SourceAnimeSummary[]> {
    const { enrichSourcePosters } = await import('../providers/poster-enricher.js');
    return enrichSourcePosters(items, this.resolvePoster as PosterResolver);
  }

  private async enrichSchedule(groups: SourceScheduleDay[]): Promise<SourceScheduleDay[]> {
    const { enrichSourcePosters } = await import('../providers/poster-enricher.js');
    return Promise.all(groups.map(async (group) => {
      const summaries = await enrichSourcePosters(group.items.map((item) => ({ ...item, detailSlug: item.slug, latestEpisode: null, releaseDay: group.day })), this.resolvePoster as PosterResolver);
      return { ...group, items: summaries.map(({ detailSlug: _detailSlug, latestEpisode: _latestEpisode, releaseDay: _releaseDay, ...item }, index) => ({ ...item, episodeLabel: group.items[index]?.episodeLabel ?? null })) };
    }));
  }
}
