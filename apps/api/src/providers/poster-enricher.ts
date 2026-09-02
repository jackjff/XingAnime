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

export async function enrichPosters(
  items: AnimeSummary[],
  resolvePoster: PosterResolver
): Promise<AnimeSummary[]> {
  return Promise.all(items.map(async (item) => {
    if (!isBlockedPosterUrl(item.posterUrl)) return item;

    try {
      const posterUrl = await resolvePoster(item.title);
      return posterUrl ? { ...item, posterUrl } : item;
    } catch {
      return item;
    }
  }));
}

export async function enrichSourcePosters(
  items: SourceAnimeSummary[],
  resolvePoster: PosterResolver
): Promise<SourceAnimeSummary[]> {
  return Promise.all(items.map(async (item) => {
    if (!isBlockedPosterUrl(item.posterUrl)) return item;
    try {
      const posterUrl = await resolvePoster(item.title);
      return { ...item, posterUrl };
    } catch {
      return { ...item, posterUrl: null };
    }
  }));
}
