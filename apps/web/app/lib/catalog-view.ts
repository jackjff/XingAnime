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

export type CatalogRequestOptions = {
  query?: string;
  letter?: string;
  source?: string;
  page: number;
  limit: number;
};

export function buildCatalogApiUrl(apiBaseUrl: string, options: CatalogRequestOptions): string {
  const query = options.query?.trim();
  const path = query ? '/api/v1/catalog/search' : '/api/v1/catalog';
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (options.letter) params.set('letter', options.letter);
  if (options.source) params.set('source', options.source);
  params.set('page', String(options.page));
  params.set('limit', String(options.limit));
  return `${apiBaseUrl.replace(/\/$/, '')}${path}?${params.toString()}`;
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
