import { describe, expect, it } from 'vitest';
import { normalizeSourceSchedule } from '../src/providers/sanka/source-provider.js';

describe('normalizeSourceSchedule', () => {
  it('normalizes the three schedule response shapes into Indonesian day groups', () => {
    const otakudesu = normalizeSourceSchedule('otakudesu', { data: [{ day: 'Selasa', anime_list: [{ title: 'Ota', slug: 'ota', poster: 'https://img/ota.jpg' }] }] });
    const samehadaku = normalizeSourceSchedule('samehadaku', { data: { days: [{ day: 'Monday', animeList: [{ title: 'Same', animeId: 'same', poster: 'https://img/same.jpg', estimation: 'Update' }] }] } });
    const oploverz = normalizeSourceSchedule('oploverz', { schedule: { sunday: [{ title: 'Op', slug: 'op', episode_info: 'at 18:00 (3)' }] } });

    expect(otakudesu).toEqual([{ day: 'Selasa', items: [{ source: 'otakudesu', slug: 'ota', title: 'Ota', posterUrl: 'https://img/ota.jpg', episodeLabel: null }] }]);
    expect(samehadaku[0]).toMatchObject({ day: 'Senin', items: [{ source: 'samehadaku', slug: 'same', title: 'Same', episodeLabel: 'Update' }] });
    expect(oploverz[0]).toMatchObject({ day: 'Minggu', items: [{ source: 'oploverz', slug: 'op', title: 'Op', episodeLabel: 'at 18:00 (3)' }] });
  });
});
