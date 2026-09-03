import { describe, expect, it } from 'vitest';
import { parseWatchHistory, upsertWatchHistory, type WatchHistoryEntry } from '../../web/app/lib/watch-history.js';

const entry = (episodeId: string, watchedAt: string): WatchHistoryEntry => ({
  source: 'otakudesu',
  animeSlug: 'one-piece',
  episodeId,
  title: `One Piece ${episodeId}`,
  posterUrl: null,
  watchedAt
});

describe('source-aware local watch history', () => {
  it('moves the same source and episode to the front without merging other sources', () => {
    const current = [entry('ep-1', '2026-01-01T00:00:00.000Z'), { ...entry('ep-1', '2026-01-02T00:00:00.000Z'), source: 'samehadaku' as const }];
    const result = upsertWatchHistory(current, entry('ep-1', '2026-01-03T00:00:00.000Z'));

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ source: 'otakudesu', episodeId: 'ep-1', watchedAt: '2026-01-03T00:00:00.000Z' });
    expect(result[1].source).toBe('samehadaku');
  });

  it('keeps local history bounded and discards malformed storage entries', () => {
    const values = Array.from({ length: 52 }, (_, index) => entry(`ep-${index}`, `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`));
    const result = upsertWatchHistory([], values[0]);
    const parsed = parseWatchHistory(JSON.stringify([...values, { episodeId: 'bad' }]));

    expect(result).toHaveLength(1);
    expect(parsed).toHaveLength(50);
    expect(parsed.every((item) => item.source && item.episodeId && item.animeSlug)).toBe(true);
  });
});
