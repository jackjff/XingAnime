import type { SourceAnimeDetail, SourceAnimeSummary, SourceId, SourceScheduleDay } from '../providers/source-types.js';
import { PosterRateLimitError } from '../providers/anilist/client.js';
import { isBlockedPosterUrl } from '../providers/poster-enricher.js';
import { isDefinitiveDeadLink } from '../providers/sanka/response.js';

type SyncProvider = {
  source: SourceId;
  getHome(): Promise<SourceAnimeSummary[]>;
  getAllAnime?(): Promise<Array<{ title: string; slug: string }>>;
  getDetail?(slug: string): Promise<SourceAnimeDetail>;
  getSchedule?(): Promise<SourceScheduleDay[]>;
};

type SyncRepository = {
  clearUnusablePosters?(): Promise<void>;
  startSyncRun?(provider: SourceId, operation: string): Promise<string | null>;
  finishSyncRun?(runId: string | null, result: { status: 'success' | 'partial' | 'failed'; requestsUsed: number; recordsFound: number; recordsFailed: number; errorMessage?: string }): Promise<void>;
  updateProviderHealth?(provider: SourceId, status: 'healthy' | 'degraded' | 'paused', httpStatus: number | null): Promise<void>;
  upsertSourceHome(source: SourceId, items: SourceAnimeSummary[]): Promise<void>;
  upsertSchedule?(source: SourceId, schedule: SourceScheduleDay[]): Promise<void>;
  listMissingPosters?(limit: number): Promise<Array<{ id: string; title: string }>>;
  updatePoster?(animeId: string, posterUrl: string): Promise<void>;
  markPosterUnresolved?(animeId: string): Promise<void>;
  listDiscoveredSources?(limit: number): Promise<Array<{ source: SourceId; slug: string }>>;
  upsertDetail?(source: SourceId, detail: SourceAnimeDetail): Promise<void>;
  markSourceHydrationAttempt?(source: SourceId, slug: string, errorMessage: string): Promise<void>;
  markSourceUnavailable?(source: SourceId, slug: string, errorMessage: string): Promise<void>;
  markSourceRediscovered?(source: SourceId, slug: string): Promise<void>;
  listDeadLinkRecheckCandidates?(limit: number): Promise<Array<{ source: SourceId; slug: string }>>;
};
type PosterResolver = (title: string) => Promise<string | null>;

export type SyncResult = { succeeded: number; failed: number; items: number; stoppedOnRateLimit?: boolean };

function httpStatusOf(cause: unknown): number | null {
  if (cause && typeof cause === 'object' && 'status' in cause && typeof cause.status === 'number') return cause.status;
  const message = cause instanceof Error ? cause.message : String(cause);
  const match = /HTTP (\d{3})/.exec(message);
  return match ? Number(match[1]) : null;
}

export class CatalogSyncWorker {
  constructor(
    private readonly providers: SyncProvider[],
    private readonly repository: SyncRepository,
    private readonly resolvePoster?: PosterResolver
  ) {}

  async runSeedAllAnime(): Promise<SyncResult> {
    let succeeded = 0;
    let failed = 0;
    let items = 0;

    for (const provider of this.providers) {
      if (!provider.getAllAnime) continue;
      const runId = await this.repository.startSyncRun?.(provider.source, 'seed_all');
      let allAnime: Array<{ title: string; slug: string }> = [];
      try {
        allAnime = await provider.getAllAnime!();
      } catch (cause) {
        failed += 1;
        const message = cause instanceof Error ? cause.message : String(cause);
        const httpStatus = httpStatusOf(cause);
        await this.repository.updateProviderHealth?.(provider.source, httpStatus === 403 || httpStatus === 429 ? 'paused' : 'degraded', httpStatus === 403 || httpStatus === 429 ? httpStatus : null);
        await this.repository.finishSyncRun?.(runId ?? null, { status: 'failed', requestsUsed: 1, recordsFound: 0, recordsFailed: 1, errorMessage: message });
        if (httpStatus === 403 || httpStatus === 429) return { succeeded, failed, items, stoppedOnRateLimit: true };
        continue;
      }
      // An empty catalog means the provider has no unlimited endpoint; do not record health or a successful run.
      if (allAnime.length === 0) {
        await this.repository.finishSyncRun?.(runId ?? null, { status: 'success', requestsUsed: 0, recordsFound: 0, recordsFailed: 0 });
        continue;
      }
      const normalized = allAnime.map((item: { title: string; slug: string }) => ({
        source: provider.source,
        slug: item.slug,
        detailSlug: item.slug,
        title: item.title,
        posterUrl: null,
        latestEpisode: null,
        releaseDay: null
      }));
      await this.repository.upsertSourceHome(provider.source, normalized);
      succeeded += 1;
      items += normalized.length;
      await this.repository.updateProviderHealth?.(provider.source, 'healthy', 200);
      await this.repository.finishSyncRun?.(runId ?? null, { status: 'success', requestsUsed: 1, recordsFound: normalized.length, recordsFailed: 0 });
    }

    return { succeeded, failed, items };
  }

  async runSeedCycle(hydrationLimit = 12): Promise<{ seeded: number; hydrated: number; schedule: number }> {
    // Step 1: Re-seed from unlimited endpoint (to catch new anime)
    const seedResult = await this.runSeedAllAnime();
    const seeded = seedResult.succeeded;
    if (seedResult.stoppedOnRateLimit) return { seeded, hydrated: 0, schedule: 0 };

    // Step 2: Hydrate discovered sources
    const hydrationResult = await this.hydrateDiscoveredSources(hydrationLimit);
    if (hydrationResult.stoppedOnRateLimit) return { seeded, hydrated: hydrationResult.succeeded, schedule: 0 };

    // Step 3: Update schedules
    let schedule = 0;
    try {
      const scheduleResult = await this.runSchedulesOnce();
      schedule = scheduleResult.succeeded;
    } catch {}

    return {
      seeded,
      hydrated: hydrationResult.succeeded,
      schedule
    };
  }

  async runOnce(): Promise<SyncResult> {
    await this.repository.clearUnusablePosters?.();
    let succeeded = 0;
    let failed = 0;
    let items = 0;
    let stoppedOnRateLimit = false;

    for (const provider of this.providers) {
      const runId = await this.repository.startSyncRun?.(provider.source, 'home');
      try {
        const sourceItems = await provider.getHome();
        const persistedItems = sourceItems.map((item) =>
          isBlockedPosterUrl(item.posterUrl) ? { ...item, posterUrl: null } : item
        );
        await this.repository.upsertSourceHome(provider.source, persistedItems);
        succeeded += 1;
        items += persistedItems.length;
        await this.repository.updateProviderHealth?.(provider.source, 'healthy', 200);
        await this.repository.finishSyncRun?.(runId ?? null, { status: 'success', requestsUsed: 1, recordsFound: persistedItems.length, recordsFailed: 0 });
      } catch (cause) {
        failed += 1;
        const message = cause instanceof Error ? cause.message : String(cause);
        const httpStatus = httpStatusOf(cause);
        if (httpStatus === 403 || httpStatus === 429) stoppedOnRateLimit = true;
        await this.repository.updateProviderHealth?.(provider.source, httpStatus === 403 || httpStatus === 429 ? 'paused' : 'degraded', httpStatus === 403 || httpStatus === 429 ? httpStatus : null);
        await this.repository.finishSyncRun?.(runId ?? null, { status: 'failed', requestsUsed: 1, recordsFound: 0, recordsFailed: 1, errorMessage: message });
        if (stoppedOnRateLimit) break;
      }
    }

    return stoppedOnRateLimit ? { succeeded, failed, items, stoppedOnRateLimit: true } : { succeeded, failed, items };
  }

  async runSchedulesOnce(): Promise<SyncResult> {
    let succeeded = 0;
    let failed = 0;
    let items = 0;
    let stoppedOnRateLimit = false;
    for (const provider of this.providers) {
      if (!provider.getSchedule || !this.repository.upsertSchedule) continue;
      const runId = await this.repository.startSyncRun?.(provider.source, 'schedule');
      try {
        const schedule = await provider.getSchedule();
        await this.repository.upsertSchedule(provider.source, schedule);
        const scheduleItems = schedule.reduce((total, group) => total + group.items.length, 0);
        succeeded += 1;
        items += scheduleItems;
        await this.repository.updateProviderHealth?.(provider.source, 'healthy', 200);
        await this.repository.finishSyncRun?.(runId ?? null, { status: 'success', requestsUsed: 1, recordsFound: scheduleItems, recordsFailed: 0 });
      } catch (cause) {
        failed += 1;
        const message = cause instanceof Error ? cause.message : String(cause);
        const httpStatus = httpStatusOf(cause);
        if (httpStatus === 403 || httpStatus === 429) stoppedOnRateLimit = true;
        await this.repository.updateProviderHealth?.(provider.source, httpStatus === 403 || httpStatus === 429 ? 'paused' : 'degraded', httpStatus === 403 || httpStatus === 429 ? httpStatus : null);
        await this.repository.finishSyncRun?.(runId ?? null, { status: 'failed', requestsUsed: 1, recordsFound: 0, recordsFailed: 1, errorMessage: message });
        if (stoppedOnRateLimit) break;
      }
    }
    return stoppedOnRateLimit ? { succeeded, failed, items, stoppedOnRateLimit: true } : { succeeded, failed, items };
  }

  async backfillPosters(limit = 15): Promise<{ attempted: number; updated: number; unresolved: number }> {
    if (!this.resolvePoster || !this.repository.listMissingPosters || !this.repository.updatePoster) {
      return { attempted: 0, updated: 0, unresolved: 0 };
    }
    const candidates = await this.repository.listMissingPosters(limit);
    let attempted = 0;
    let updated = 0;
    let unresolved = 0;
    for (const candidate of candidates) {
      attempted += 1;
      let posterUrl: string | null;
      try {
        posterUrl = await this.resolvePoster(candidate.title);
      } catch (cause) {
        if (cause instanceof PosterRateLimitError) return { attempted, updated, unresolved };
        posterUrl = null;
      }
      if (isBlockedPosterUrl(posterUrl)) {
        await this.repository.markPosterUnresolved?.(candidate.id);
        unresolved += 1;
        continue;
      }
      await this.repository.updatePoster(candidate.id, posterUrl as string);
      updated += 1;
    }
    return { attempted, updated, unresolved };
  }

  async hydrateDiscoveredSources(limit = 12): Promise<{ attempted: number; succeeded: number; failed: number; stoppedOnRateLimit: boolean }> {
    if (!this.repository.listDiscoveredSources || !this.repository.upsertDetail) {
      return { attempted: 0, succeeded: 0, failed: 0, stoppedOnRateLimit: false };
    }
    const candidates = await this.repository.listDiscoveredSources(limit);
    const providers = new Map(this.providers.map((provider) => [provider.source, provider]));
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let stoppedOnRateLimit = false;

    for (const candidate of candidates) {
      const provider = providers.get(candidate.source);
      if (!provider?.getDetail) continue;
      attempted += 1;
      try {
        const detail = await provider.getDetail(candidate.slug);
        const validEpisodes = detail.episodes.filter((episode) => episode.number !== null && Number.isFinite(episode.number) && episode.number > 0);
        if (validEpisodes.length === 0) throw new Error('Provider detail contains no valid episodes');
        await this.repository.upsertDetail(candidate.source, { ...detail, episodes: validEpisodes });
        succeeded += 1;
      } catch (cause) {
        failed += 1;
        const message = cause instanceof Error ? cause.message : String(cause);
        const status = httpStatusOf(cause);
        // A definitive 404 from the provider means the title no longer exists upstream:
        // hide it from the catalog instead of retrying it forever.
        if (isDefinitiveDeadLink(cause)) {
          await this.repository.markSourceUnavailable?.(candidate.source, candidate.slug, message);
          continue;
        }
        await this.repository.markSourceHydrationAttempt?.(candidate.source, candidate.slug, message);
        await this.repository.updateProviderHealth?.(candidate.source, status === 403 || status === 429 ? 'paused' : 'degraded', status);
        if (status === 403 || status === 429) {
          stoppedOnRateLimit = true;
          break;
        }
      }
    }

    return { attempted, succeeded, failed, stoppedOnRateLimit };
  }

  // Weekly second chance: a disabled link whose detail request succeeds again is restored.
  async recheckDeadLinks(limit = 5): Promise<{ attempted: number; restored: number; stillDead: number; stoppedOnRateLimit: boolean }> {
    if (!this.repository.listDeadLinkRecheckCandidates || !this.repository.markSourceRediscovered) {
      return { attempted: 0, restored: 0, stillDead: 0, stoppedOnRateLimit: false };
    }
    const candidates = await this.repository.listDeadLinkRecheckCandidates(limit);
    const providers = new Map(this.providers.map((provider) => [provider.source, provider]));
    let restored = 0;
    let stillDead = 0;
    let stoppedOnRateLimit = false;

    for (const candidate of candidates) {
      const provider = providers.get(candidate.source);
      if (!provider?.getDetail) continue;
      try {
        const detail = await provider.getDetail(candidate.slug);
        const validEpisodes = detail.episodes.filter((episode) => episode.number !== null && Number.isFinite(episode.number) && episode.number > 0);
        if (validEpisodes.length > 0) {
          await this.repository.markSourceRediscovered(candidate.source, candidate.slug);
          await this.repository.upsertDetail?.(candidate.source, { ...detail, episodes: validEpisodes });
          restored += 1;
        } else {
          stillDead += 1;
          await this.repository.markSourceHydrationAttempt?.(candidate.source, candidate.slug, 'Recheck returned no valid episodes');
        }
      } catch (cause) {
        const status = httpStatusOf(cause);
        if (status === 403 || status === 429) {
          stoppedOnRateLimit = true;
          break;
        }
        stillDead += 1;
      }
    }

    return { attempted: candidates.length, restored, stillDead, stoppedOnRateLimit };
  }
}
