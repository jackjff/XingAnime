export type ScheduleViewItem = {
  source: string;
  slug: string;
  title: string;
  [key: string]: unknown;
};

export type ScheduleViewGroup = {
  day: string;
  items: ScheduleViewItem[];
};

export function filterScheduleGroups<T extends ScheduleViewItem>(groups: Array<{ day: string; items: T[] }>, activeDay: string, activeSource: string): Array<{ day: string; items: T[] }> {
  const normalizedDay = activeDay.trim().toLowerCase();
  const normalizedSource = activeSource.trim().toLowerCase();

  return groups
    .filter((group) => normalizedDay === 'semua' || group.day.trim().toLowerCase() === normalizedDay)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => normalizedSource === 'semua' || item.source.trim().toLowerCase() === normalizedSource)
    }))
    .filter((group) => group.items.length > 0);
}

export function getPageWindow<T>(items: T[], requestedPage: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const visibleItems = items.slice((page - 1) * pageSize, page * pageSize);

  return {
    page,
    items: visibleItems,
    start: items.length === 0 ? 0 : (page - 1) * pageSize + 1,
    end: Math.min(page * pageSize, items.length),
    pageCount
  };
}
