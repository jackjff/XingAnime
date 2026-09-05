import { buildCatalogApiUrl, type CatalogRequestOptions } from './catalog-view';

export type CatalogItem = {
  source: string;
  slug: string;
  detailSlug: string | null;
  title: string;
  posterUrl: string | null;
  latestEpisode: number | null;
  releaseDay: string | null;
};
export type CatalogMeta = { page: number; limit: number; total: number; pageCount: number; hasNext: boolean; hasPrevious: boolean; storage: string };
export type CatalogPage = { items: CatalogItem[]; meta: CatalogMeta };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function catalogItem(value: unknown): value is CatalogItem {
  return record(value) && typeof value.source === 'string' && typeof value.slug === 'string' && !!value.slug
    && typeof value.title === 'string' && nullableString(value.detailSlug) && nullableString(value.posterUrl)
    && nullableString(value.releaseDay) && (value.latestEpisode === null || (typeof value.latestEpisode === 'number' && Number.isFinite(value.latestEpisode)));
}

function catalogMeta(value: unknown): value is CatalogMeta {
  if (!record(value)) return false;
  for (const key of ['page', 'limit', 'total', 'pageCount']) {
    const number = value[key];
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < (key === 'page' || key === 'limit' ? 1 : 0)) return false;
  }
  return typeof value.hasNext === 'boolean' && typeof value.hasPrevious === 'boolean' && typeof value.storage === 'string';
}

export async function fetchCatalogPage(apiBaseUrl: string, options: CatalogRequestOptions, signal: AbortSignal): Promise<CatalogPage> {
  signal.throwIfAborted();
  const response = await fetch(buildCatalogApiUrl(apiBaseUrl, options), { signal });
  if (!response.ok) throw new Error(`Katalog tidak tersedia (HTTP ${response.status})`);
  const payload: unknown = await response.json();
  signal.throwIfAborted();
  if (!record(payload) || payload.success !== true || !Array.isArray(payload.data) || !payload.data.every(catalogItem) || !catalogMeta(payload.meta)) {
    throw new Error('Respons katalog tidak valid');
  }
  return { items: payload.data, meta: payload.meta };
}
