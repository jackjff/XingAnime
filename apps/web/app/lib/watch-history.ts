export type WatchHistorySource = 'otakudesu' | 'samehadaku' | 'oploverz';

export type WatchHistoryEntry = {
  source: WatchHistorySource;
  animeSlug: string;
  episodeId: string;
  title: string;
  posterUrl: string | null;
  watchedAt: string;
};

export const WATCH_HISTORY_STORAGE_KEY = 'xing-anime:watch-history:v1';
export const WATCH_HISTORY_LIMIT = 50;

function isSource(value: unknown): value is WatchHistorySource {
  return value === 'otakudesu' || value === 'samehadaku' || value === 'oploverz';
}

function isEntry(value: unknown): value is WatchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return isSource(item.source)
    && typeof item.animeSlug === 'string'
    && item.animeSlug.length > 0
    && typeof item.episodeId === 'string'
    && item.episodeId.length > 0
    && typeof item.title === 'string'
    && typeof item.watchedAt === 'string'
    && (item.posterUrl === null || typeof item.posterUrl === 'string');
}

export function parseWatchHistory(raw: string | null): WatchHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, WATCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function upsertWatchHistory(current: WatchHistoryEntry[], entry: WatchHistoryEntry, limit = WATCH_HISTORY_LIMIT): WatchHistoryEntry[] {
  const deduplicated = current.filter((item) => !(item.source === entry.source && item.episodeId === entry.episodeId));
  return [entry, ...deduplicated].slice(0, Math.max(1, limit));
}

export function removeWatchHistory(current: WatchHistoryEntry[], source: WatchHistorySource, episodeId: string): WatchHistoryEntry[] {
  return current.filter((item) => item.source !== source || item.episodeId !== episodeId);
}
