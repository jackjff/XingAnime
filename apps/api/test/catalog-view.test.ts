import { describe, expect, it } from 'vitest';
import { filterScheduleGroups, getPageWindow } from '../../web/app/lib/catalog-view.js';

describe('catalog view state', () => {
  it('filters schedule items by source without leaking other providers', () => {
    const groups = filterScheduleGroups([
      {
        day: 'Rabu',
        items: [
          { source: 'Otakudesu', slug: 'a', title: 'A' },
          { source: 'OPLOVERZ', slug: 'b', title: 'B' }
        ]
      }
    ], 'Semua', 'oploverz');

    expect(groups).toEqual([{
      day: 'Rabu',
      items: [{ source: 'OPLOVERZ', slug: 'b', title: 'B' }]
    }]);
  });

  it('clamps episode pages and returns the requested visible window', () => {
    const items = Array.from({ length: 101 }, (_, index) => index + 1);

    expect(getPageWindow(items, 2, 50)).toEqual({ page: 2, items: items.slice(50, 100), start: 51, end: 100, pageCount: 3 });
    expect(getPageWindow(items, 99, 50)).toEqual({ page: 3, items: [101], start: 101, end: 101, pageCount: 3 });
  });
});
