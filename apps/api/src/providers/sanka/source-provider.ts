import type { IntervalRateLimiter } from './rate-limiter.js';
import { isBlockedPosterUrl } from '../poster-enricher.js';
import type {
  AnimeSourceProvider,
  PlaybackSource,
  SourceAnimeDetail,
  SourceAnimeSummary,
  SourceEpisodeDetail,
  SourceEpisodeSummary,
  SourceScheduleDay,
  SourceId,
  PlaybackMode,
  PlaybackReason
} from '../source-types.js';

type JsonObject = Record<string, any>;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

type SourcePaths = {
  home: string;
  detail: string;
  episode: string;
  schedule: string;
  server: string | null;
};

const sourcePaths: Record<SourceId, SourcePaths> = {
  otakudesu: {
    home: '/anime/home',
    detail: '/anime/anime/',
    episode: '/anime/episode/',
    schedule: '/anime/schedule',
    server: '/anime/server/'
  },
  samehadaku: {
    home: '/anime/samehadaku/home',
    detail: '/anime/samehadaku/anime/',
    episode: '/anime/samehadaku/episode/',
    schedule: '/anime/samehadaku/schedule',
    server: '/anime/samehadaku/server/'
  },
  oploverz: {
    home: '/anime/oploverz/home',
    detail: '/anime/oploverz/anime/',
    episode: '/anime/oploverz/episode/',
    schedule: '/anime/oploverz/schedule',
    server: null
  }
};

const englishDays: Record<string, string> = {
  monday: 'Senin',
  tuesday: 'Selasa',
  wednesday: 'Rabu',
  thursday: 'Kamis',
  friday: 'Jumat',
  saturday: 'Sabtu',
  sunday: 'Minggu'
};

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function synopsisValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  const paragraphs = (value as JsonObject).paragraphs;
  if (!Array.isArray(paragraphs)) return null;
  const text = paragraphs.filter((item) => typeof item === 'string' && item.trim()).join('\n\n');
  return text || null;
}

const externalOnlyPlaybackHosts = new Set(['desustream.com']);
const knownUnavailablePlaybackHosts = new Set(['desustream.net']);
const adHeavyPlaybackHostFragments = ['filedon'];
const knownUnavailableServerLabels = new Map<string, PlaybackReason>([
  ['ondesuhd', 'provider_unavailable'],
  ['odstreamhd', 'provider_unavailable'],
  ['filedon', 'provider_ads'],
  ['filedonhd', 'provider_ads']
]);

export function classifyPlaybackUrl(url: string): { mode: PlaybackMode; reason: PlaybackReason } {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if ([...knownUnavailablePlaybackHosts].some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
      return { mode: 'unavailable', reason: 'provider_unavailable' };
    }
    if (adHeavyPlaybackHostFragments.some((fragment) => hostname.includes(fragment))) {
      return { mode: 'unavailable', reason: 'provider_ads' };
    }
    if ([...externalOnlyPlaybackHosts].some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
      return { mode: 'external', reason: 'provider_frame_policy' };
    }
  } catch {
    return { mode: 'unknown', reason: 'not_verified' };
  }
  return { mode: 'unknown', reason: 'not_verified' };
}

export function classifyPlaybackServerLabel(label: string): { mode: PlaybackMode; reason: PlaybackReason } {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const reason = knownUnavailableServerLabels.get(normalized);
  return reason ? { mode: 'unavailable', reason } : { mode: 'unknown', reason: 'not_verified' };
}

function episodeSummary(source: SourceId, item: JsonObject): SourceEpisodeSummary | null {
  const id = stringValue(source === 'oploverz' ? item.slug : item.episodeId);
  if (!id) return null;
  return {
    id,
    title: stringValue(item.title) ?? id,
    number: numberValue(source === 'oploverz' ? item.episode : item.eps ?? item.title),
    releaseDate: stringValue(item.release_date ?? item.date ?? item.releasedOn)
  };
}

export function normalizeSourceHome(source: SourceId, payload: unknown): SourceAnimeSummary[] {
  const root = payload as JsonObject;
  const list = source === 'otakudesu'
    ? root.data?.ongoing?.animeList
    : source === 'samehadaku'
      ? root.data?.recent?.animeList
      : root.anime_list;
  if (!Array.isArray(list)) return [];

  return list.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as JsonObject;
    const slug = stringValue(source === 'oploverz' ? item.slug : item.animeId);
    const title = stringValue(item.title);
    if (!slug || !title) return [];
    const detailSlug = source === 'oploverz'
      ? slug.replace(/-episode-(?:\d+|end).*$/i, '')
      : slug;
    return [{
      source,
      slug,
      detailSlug,
      title: source === 'oploverz' ? title.replace(/\s+Episode\s+.*/i, '').trim() : title,
      posterUrl: stringValue(item.poster),
      latestEpisode: numberValue(item.episode ?? item.episodes ?? item.title),
      releaseDay: stringValue(item.releaseDay ?? item.releasedOn)
    }];
  });
}

export function normalizeSourceDetail(source: SourceId, slug: string, payload: unknown): SourceAnimeDetail {
  const root = payload as JsonObject;
  const data = source === 'oploverz' ? root.detail : root.data;
  const info = source === 'oploverz' ? data?.info ?? {} : data ?? {};
  const rawEpisodes = source === 'oploverz' ? data?.episode_list : data?.episodeList;
  const episodes = Array.isArray(rawEpisodes)
    ? rawEpisodes.flatMap((item: unknown) => item && typeof item === 'object' ? episodeSummary(source, item as JsonObject) ?? [] : [])
    : [];
  const genres = (source === 'oploverz' ? data?.genres : data?.genreList);
  const title = stringValue(data?.title) ?? stringValue(data?.english) ?? slug;

  return {
    source,
    slug,
    title,
    posterUrl: stringValue(data?.poster),
    synopsis: synopsisValue(data?.synopsis),
    status: stringValue(info.status),
    type: stringValue(info.type ?? data?.type),
    studio: stringValue(info.studio ?? data?.studios),
    genres: Array.isArray(genres)
      ? genres.flatMap((item: unknown) => {
          if (!item || typeof item !== 'object') return [];
          return [stringValue((item as JsonObject).name ?? (item as JsonObject).title)].filter((value): value is string => Boolean(value));
        })
      : [],
    episodes
  };
}

export function normalizeSourceSchedule(source: SourceId, payload: unknown): SourceScheduleDay[] {
  const root = payload as JsonObject;
  const groups: Array<{ day: string; items: unknown[] }> = [];

  if (source === 'otakudesu' && Array.isArray(root.data)) {
    for (const group of root.data) {
      if (group && typeof group === 'object') {
        const data = group as JsonObject;
        groups.push({ day: stringValue(data.day) ?? 'Lainnya', items: Array.isArray(data.anime_list) ? data.anime_list : [] });
      }
    }
  } else if (source === 'samehadaku' && Array.isArray(root.data?.days)) {
    for (const group of root.data.days) {
      if (group && typeof group === 'object') {
        const data = group as JsonObject;
        const rawDay = stringValue(data.day)?.toLowerCase() ?? '';
        groups.push({ day: englishDays[rawDay] ?? stringValue(data.day) ?? 'Lainnya', items: Array.isArray(data.animeList) ? data.animeList : [] });
      }
    }
  } else if (source === 'oploverz' && root.schedule && typeof root.schedule === 'object') {
    for (const [rawDay, items] of Object.entries(root.schedule as JsonObject)) {
      groups.push({ day: englishDays[rawDay.toLowerCase()] ?? rawDay, items: Array.isArray(items) ? items : [] });
    }
  }

  return groups.map(({ day, items }) => ({
    day,
    items: items.flatMap((raw: unknown) => {
      if (!raw || typeof raw !== 'object') return [];
      const item = raw as JsonObject;
      const slug = stringValue(item.slug ?? item.animeId);
      const title = stringValue(item.title);
      if (!slug || !title) return [];
      return [{
        source,
        slug,
        title: title.replace(/\s+Episode\s+.*/i, '').trim(),
        posterUrl: stringValue(item.poster),
        episodeLabel: stringValue(item.episode_info ?? item.estimation)
      }];
    })
  }));
}

function serverPlayback(source: SourceId, data: JsonObject): PlaybackSource[] {
  const qualities = data.server?.qualities;
  if (!Array.isArray(qualities)) return [];
  return qualities.flatMap((quality: unknown) => {
    if (!quality || typeof quality !== 'object') return [];
    const qualityData = quality as JsonObject;
    const qualityName = stringValue(qualityData.title);
    return Array.isArray(qualityData.serverList)
      ? qualityData.serverList.flatMap((server: unknown) => {
          if (!server || typeof server !== 'object') return [];
          const serverData = server as JsonObject;
          const serverId = stringValue(serverData.serverId);
          if (!serverId) return [];
          const label = stringValue(serverData.title) ?? `${source} server`;
          return [{
            label,
            quality: qualityName,
            kind: 'server' as const,
            ...classifyPlaybackServerLabel(label),
            url: null,
            serverId
          }];
        })
      : [];
  });
}

export function normalizeSourceEpisode(source: SourceId, id: string, payload: unknown): SourceEpisodeDetail {
  const root = payload as JsonObject;
  const data = source === 'oploverz' ? root : root.data ?? {};
  const directUrl = stringValue(data.defaultStreamingUrl);
  const playback: PlaybackSource[] = directUrl
    ? [{ label: 'Default', quality: null, kind: 'embed', ...classifyPlaybackUrl(directUrl), url: directUrl, serverId: null }]
    : [];

  if (source === 'oploverz' && Array.isArray(data.streams)) {
    playback.push(...data.streams.flatMap((stream: unknown) => {
      if (!stream || typeof stream !== 'object') return [];
      const streamData = stream as JsonObject;
      const url = stringValue(streamData.url);
      if (!url) return [];
      return [{ label: stringValue(streamData.name) ?? 'Stream', quality: null, kind: 'embed' as const, ...classifyPlaybackUrl(url), url, serverId: null }];
    }));
  } else {
    playback.push(...serverPlayback(source, data));
  }

  return {
    source,
    id,
    title: stringValue(data.episode_title ?? data.title) ?? id,
    animeSlug: stringValue(data.animeId),
    releaseTime: stringValue(data.releaseTime ?? data.releasedOn),
    previousEpisodeId: stringValue(data.prevEpisode?.episodeId),
    nextEpisodeId: stringValue(data.nextEpisode?.episodeId),
    playback
  };
}

export function normalizeSourceServer(source: SourceId, serverId: string, payload: unknown): PlaybackSource {
  const root = payload as JsonObject;
  const url = stringValue(root.data?.url ?? root.url);
  if (!url) throw new Error(`Sanka ${source} server response did not contain a URL`);
  return { label: 'Resolved server', quality: null, kind: 'embed', ...classifyPlaybackUrl(url), url, serverId };
}

export type SankaSourceProviderOptions = {
  source: SourceId;
  baseUrl: string;
  limiter: Pick<IntervalRateLimiter, 'acquire'>;
  posterResolver?: (title: string) => Promise<string | null>;
  fetcher?: Fetcher;
};

export class SankaSourceProvider implements AnimeSourceProvider {
  readonly source: SourceId;
  private readonly baseUrl: string;
  private readonly limiter: Pick<IntervalRateLimiter, 'acquire'>;
  private readonly posterResolver?: (title: string) => Promise<string | null>;
  private readonly fetcher: Fetcher;

  constructor(options: SankaSourceProviderOptions) {
    this.source = options.source;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.limiter = options.limiter;
    this.posterResolver = options.posterResolver;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  private async request(path: string): Promise<unknown> {
    await this.limiter.acquire();
    const response = await this.fetcher(`${this.baseUrl}${path}`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Sanka ${this.source} request failed with HTTP ${response.status}`);
    return response.json();
  }

  async getHome(): Promise<SourceAnimeSummary[]> {
    return normalizeSourceHome(this.source, await this.request(sourcePaths[this.source].home));
  }

  async getDetail(slug: string): Promise<SourceAnimeDetail> {
    const detail = normalizeSourceDetail(this.source, slug, await this.request(`${sourcePaths[this.source].detail}${encodeURIComponent(slug)}`));
    if (this.posterResolver && isBlockedPosterUrl(detail.posterUrl)) {
      const posterUrl = await this.posterResolver(detail.title);
      return posterUrl ? { ...detail, posterUrl } : detail;
    }
    return detail;
  }

  async getEpisode(id: string): Promise<SourceEpisodeDetail> {
    return normalizeSourceEpisode(this.source, id, await this.request(`${sourcePaths[this.source].episode}${encodeURIComponent(id)}`));
  }

  async resolveServer(serverId: string): Promise<PlaybackSource> {
    const path = sourcePaths[this.source].server;
    if (!path) throw new Error(`Sanka ${this.source} does not expose a server resolver`);
    return normalizeSourceServer(this.source, serverId, await this.request(`${path}${encodeURIComponent(serverId)}`));
  }

  async getSchedule(): Promise<SourceScheduleDay[]> {
    return normalizeSourceSchedule(this.source, await this.request(sourcePaths[this.source].schedule));
  }
}
