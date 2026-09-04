import type { AnimeSummary } from './sanka/mapper.js';
import type { SourceAnimeSummary } from './source-types.js';

export type PosterResolver = (title: string) => Promise<string | null>;

const blockedPosterHosts = new Set([
  'otakudesu.blog',
  'www.otakudesu.blog',
  'v2.samehadaku.how',
  'oploverz.am',
  'i2.wp.com',
  'i3.wp.com'
]);

export function isBlockedPosterUrl(url: string | null): boolean {
  if (!url) return true;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (/^i\d+\.wp\.com$/.test(hostname)) return true;
    if (blockedPosterHosts.has(hostname)) return true;
    return hostname !== 'img.anili.st' && !/^s\d+\.anilist\.co$/.test(hostname);
  } catch {
    return true;
  }
}

async function enrichItems<T extends { title: string; posterUrl: string | null }>(items: T[], resolvePoster: PosterResolver): Promise<T[]> {
  const resolvedPosters = new Map<string, Promise<string | null>>();
  const getPoster = (title: string): Promise<string | null> => {
    const existing = resolvedPosters.get(title);
    if (existing) return existing;
    const pending = Promise.resolve(resolvePoster(title)).catch(() => null);
    resolvedPosters.set(title, pending);
    return pending;
  };

  const enriched: T[] = [];
  for (const item of items) {
    if (!isBlockedPosterUrl(item.posterUrl)) {
      enriched.push(item);
      continue;
    }
    enriched.push({ ...item, posterUrl: await getPoster(item.title) });
  }
  return enriched;
}

export async function enrichPosters(
  items: AnimeSummary[],
  resolvePoster: PosterResolver
): Promise<AnimeSummary[]> {
  return enrichItems(items, resolvePoster);
}

export async function enrichSourcePosters(
  items: SourceAnimeSummary[],
  resolvePoster: PosterResolver
): Promise<SourceAnimeSummary[]> {
  return enrichItems(items, resolvePoster);
}
