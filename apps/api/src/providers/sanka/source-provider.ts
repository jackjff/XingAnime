import type { IntervalRateLimiter } from './rate-limiter.js';
import { isBlockedPosterUrl } from '../poster-enricher.js';
import { isJsonObject, readSankaJson, SankaCircuitBreaker, SankaUpstreamError } from './response.js';
import type {
  AnimeSourceProvider,
  PlaybackSource,
  SourceAnimeDetail,
  SourceAnimeSummary,
  SourceEpisodeDetail,
  SourceEpisodeSummary,
  SourceScheduleDay,
  SourceId,
  SourceDiscoveryPage,
  SourceDiscoveryQuery,
  SourceGenre,
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
  unlimited: string | null;
};

const sourcePaths: Record<SourceId, SourcePaths> = {
  otakudesu: {
    home: '/anime/home',
    detail: '/anime/anime/',
    episode: '/anime/episode/',
    schedule: '/anime/schedule',
    server: '/anime/server/',
    unlimited: '/anime/unlimited'
  },
  samehadaku: {
    home: '/anime/samehadaku/home',
    detail: '/anime/samehadaku/anime/',
    episode: '/anime/samehadaku/episode/',
    schedule: '/anime/samehadaku/schedule',
    server: '/anime/samehadaku/server/',
    unlimited: '/anime/samehadaku/list'
  },
  oploverz: {
    home: '/anime/oploverz/home',
    detail: '/anime/oploverz/anime/',
    episode: '/anime/oploverz/episode/',
    schedule: '/anime/oploverz/schedule',
    server: null,
    unlimited: null
  }
};

function discoveryPath(source: SourceId, query: SourceDiscoveryQuery): string | null {
  const page = `?page=${query.page}`;
  const value = query.query ? encodeURIComponent(query.query) : '';
  if (source === 'otakudesu') {
    if (query.kind === 'ongoing') return `/anime/ongoing-anime${page}`;
    if (query.kind === 'completed') return `/anime/complete-anime${page}`;
    if (query.kind === 'search' && value) return `/anime/search/${value}`;
    if (query.kind === 'genre' && value) return `/anime/genre/${value}${page}`;
  }
  if (source === 'samehadaku') {
    if (query.kind === 'ongoing') return `/anime/samehadaku/ongoing${page}`;
    if (query.kind === 'completed') return `/anime/samehadaku/completed${page}`;
    if (query.kind === 'search' && value) return `/anime/samehadaku/search?q=${value}&page=${query.page}`;
    if (query.kind === 'genre' && value) return `/anime/samehadaku/genres/${value}${page}`;
  }
  if (source === 'oploverz') {
    if (query.kind === 'ongoing') return `/anime/oploverz/ongoing${page}`;
    if (query.kind === 'completed') return `/anime/oploverz/completed${page}`;
    if (query.kind === 'search' && value) return `/anime/oploverz/search/${value}`;
  }
  return null;
}

function genresPath(source: SourceId): string | null {
  if (source === 'otakudesu') return '/anime/genre';
  if (source === 'samehadaku') return '/anime/samehadaku/genres';
  return null;
}

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
  const match = value.match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(',', '.')) : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
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
const knownUnavailablePlaybackHosts = new Set(['desustream.net', 'wibuu.info']);
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
  const structuredNumber = source === 'oploverz'
    ? item.episode
    : item.eps ?? (typeof item.title === 'number' ? item.title : null);
  const number = numberValue(structuredNumber);
  if (!id || number === null || number <= 0) return null;
  return {
    id,
    title: stringValue(item.title) ?? id,
    number,
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
    const latestEpisode = numberValue(item.episode ?? item.episodes);
    if (latestEpisode === null || latestEpisode <= 0) return [];
    const normalizedTitle = source === 'oploverz' ? title.replace(/\s+Episode\s+.*/i, '').trim() : title;
    if (/live\s*action/i.test(normalizedTitle)) return [];
    return [{
      source,
      slug,
      detailSlug,
      title: normalizedTitle,
      posterUrl: stringValue(item.poster),
      latestEpisode,
      releaseDay: stringValue(item.releaseDay ?? item.releasedOn)
    }];
  });
}

function discoveryItems(source: SourceId, payload: unknown): unknown[] {
  const root = payload as JsonObject;
  if (source === 'oploverz') return Array.isArray(root.anime_list) ? root.anime_list : [];
  return Array.isArray(root.data?.animeList) ? root.data.animeList : [];
}

export function normalizeSourceDiscovery(source: SourceId, payload: unknown, requestedPage: number): SourceDiscoveryPage {
  const root = payload as JsonObject;
  const items = discoveryItems(source, payload).flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as JsonObject;
    const slug = stringValue(source === 'oploverz' ? item.slug : item.animeId);
    const title = stringValue(item.title);
    if (!slug || !title) return [];
    const normalizedTitle = source === 'oploverz' ? title.replace(/\s+Episode\s+.*/i, '').trim() : title;
    const upstreamPoster = stringValue(item.poster);
    return [{
      source,
      slug,
      detailSlug: source === 'oploverz' ? slug.replace(/-episode-(?:\d+|end).*$/i, '') : slug,
      title: normalizedTitle,
      posterUrl: isBlockedPosterUrl(upstreamPoster) ? null : upstreamPoster,
      latestEpisode: numberValue(item.episode ?? item.episodes),
      releaseDay: stringValue(item.releaseDay ?? item.releasedOn)
    }];
  });
  const pagination = isJsonObject(root.pagination) ? root.pagination : {};
  return {
    items,
    page: numberValue(pagination.currentPage) ?? requestedPage,
    hasNext: booleanValue(pagination.hasNextPage ?? pagination.hasNext),
    hasPrevious: booleanValue(pagination.hasPrevPage ?? pagination.hasPrev),
    pageCount: numberValue(pagination.totalPages)
  };
}

export function normalizeSourceGenres(payload: unknown): SourceGenre[] {
  const root = payload as JsonObject;
  const genres = Array.isArray(root.data?.genreList) ? root.data.genreList : [];
  return genres.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return [];
    const genre = raw as JsonObject;
    const id = stringValue(genre.genreId ?? genre.slug ?? genre.id);
    const title = stringValue(genre.title ?? genre.name);
    return id && title ? [{ id, title }] : [];
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

function deduplicatePlayback(items: PlaybackSource[]): PlaybackSource[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.serverId ? `server:${item.serverId}` : item.url ? `url:${item.url}` : `${item.label}:${item.quality ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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
    playback: deduplicatePlayback(playback)
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
  circuit?: SankaCircuitBreaker;
  posterResolver?: (title: string) => Promise<string | null>;
  fetcher?: Fetcher;
  requestTimeoutMilliseconds?: number;
};

export class SankaSourceProvider implements AnimeSourceProvider {
  readonly source: SourceId;
  private readonly baseUrl: string;
  private readonly limiter: Pick<IntervalRateLimiter, 'acquire'>;
  private readonly circuit: SankaCircuitBreaker;
  private readonly posterResolver?: (title: string) => Promise<string | null>;
  private readonly fetcher: Fetcher;
  private readonly requestTimeoutMilliseconds: number;

  constructor(options: SankaSourceProviderOptions) {
    this.source = options.source;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.limiter = options.limiter;
    this.circuit = options.circuit ?? new SankaCircuitBreaker();
    this.posterResolver = options.posterResolver;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.requestTimeoutMilliseconds = Math.max(1_000, options.requestTimeoutMilliseconds ?? 20_000);
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutError = () => new Error(`Sanka ${this.source} request timed out`);
    const abortTimer = setTimeout(() => controller.abort(timeoutError()), this.requestTimeoutMilliseconds);
    const rejectionTimer = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(timeoutError()), this.requestTimeoutMilliseconds);
    });
    try {
      return await Promise.race([
        this.fetcher(url, { headers: { accept: 'application/json' }, signal: controller.signal }),
        rejectionTimer
      ]);
    } finally {
      clearTimeout(abortTimer);
    }
  }

  async getAllAnime(): Promise<Array<{ title: string; slug: string }>> {
    const unlimitedPath = sourcePaths[this.source].unlimited;
    // Unsupported providers answer [] without consuming rate budget or provider health.
    if (!unlimitedPath) return [];
    if (this.circuit?.isOpen()) throw this.circuit.createOpenError(`${this.source} unlimited`);
    await this.limiter.acquire();
    // A different request may have opened the shared circuit while this one queued.
    if (this.circuit.isOpen()) throw this.circuit.createOpenError(this.source);
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}${unlimitedPath}`);
      const payload = await readSankaJson(response, `${this.source} unlimited`);
      const root = payload as JsonObject;
      const list = root.data?.list;
      if (!Array.isArray(list) || !list.every((group: unknown) => isJsonObject(group) && Array.isArray(group.animeList))) {
        throw new SankaUpstreamError(`Sanka ${this.source} unlimited returned an unsupported response shape`, 502);
      }

      const allAnime: Array<{ title: string; slug: string }> = [];
      for (const group of list) {
        if (!group || typeof group !== 'object') continue;
        const animeList = (group as JsonObject).animeList;
        if (!Array.isArray(animeList)) continue;
        for (const item of animeList) {
          if (!item || typeof item !== 'object') continue;
          const title = stringValue((item as JsonObject).title);
          const slug = stringValue((item as JsonObject).animeId);
          if (title && slug) {
            allAnime.push({ title, slug });
          }
        }
      }
      return allAnime;
    } catch (cause) {
      const error = cause instanceof SankaUpstreamError
        ? cause
        : new SankaUpstreamError(`Sanka ${this.source} unlimited request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      if (this.circuit && (error.status === 403 || error.status === 429)) {
        this.circuit.open(error.status, error.retryAfterMs);
      }
      throw error;
    }
  }

  private matchesExpectedShape(operation: 'home' | 'detail' | 'episode' | 'schedule' | 'server' | 'discovery' | 'genres', payload: unknown): boolean {
    if (!isJsonObject(payload)) return false;
    if (operation === 'home') {
      return this.source === 'otakudesu'
        ? Array.isArray(payload.data?.ongoing?.animeList)
        : this.source === 'samehadaku'
          ? Array.isArray(payload.data?.recent?.animeList)
          : Array.isArray(payload.anime_list);
    }
    if (operation === 'detail') return isJsonObject(this.source === 'oploverz' ? payload.detail : payload.data);
    if (operation === 'episode') {
      return this.source === 'oploverz'
        ? typeof payload.episode_title === 'string' || Array.isArray(payload.streams)
        : isJsonObject(payload.data);
    }
    if (operation === 'schedule') {
      return this.source === 'oploverz'
        ? isJsonObject(payload.schedule)
        : this.source === 'samehadaku'
          ? Array.isArray(payload.data?.days)
          : Array.isArray(payload.data);
    }
    if (operation === 'discovery') return Array.isArray(this.source === 'oploverz' ? payload.anime_list : payload.data?.animeList);
    if (operation === 'genres') return Array.isArray(payload.data?.genreList);
    return typeof (payload.data?.url ?? payload.url) === 'string';
  }

  private async request(path: string, operation: 'home' | 'detail' | 'episode' | 'schedule' | 'server' | 'discovery' | 'genres'): Promise<unknown> {
    if (this.circuit?.isOpen()) throw this.circuit.createOpenError(`${this.source} ${operation}`);
    await this.limiter.acquire();
    // A different request may have opened the shared circuit while this one queued.
    if (this.circuit.isOpen()) throw this.circuit.createOpenError(this.source);
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`);
      const payload = await readSankaJson(response, `${this.source} ${operation}`);
      if (!this.matchesExpectedShape(operation, payload)) {
        throw new SankaUpstreamError(`Sanka ${this.source} ${operation} returned an unsupported response shape`, 502);
      }
      return payload;
    } catch (cause) {
      const error = cause instanceof SankaUpstreamError
        ? cause
        : new SankaUpstreamError(`Sanka ${this.source} ${operation} request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      if (this.circuit && (error.status === 403 || error.status === 429)) {
        this.circuit.open(error.status, error.retryAfterMs);
      }
      throw error;
    }
  }

  async getHome(): Promise<SourceAnimeSummary[]> {
    return normalizeSourceHome(this.source, await this.request(sourcePaths[this.source].home, 'home'));
  }

  async getDetail(slug: string): Promise<SourceAnimeDetail> {
    const detail = normalizeSourceDetail(this.source, slug, await this.request(`${sourcePaths[this.source].detail}${encodeURIComponent(slug)}`, 'detail'));
    if (this.posterResolver && isBlockedPosterUrl(detail.posterUrl)) {
      const posterUrl = await this.posterResolver(detail.title);
      return posterUrl ? { ...detail, posterUrl } : detail;
    }
    return detail;
  }

  async getEpisode(id: string): Promise<SourceEpisodeDetail> {
    return normalizeSourceEpisode(this.source, id, await this.request(`${sourcePaths[this.source].episode}${encodeURIComponent(id)}`, 'episode'));
  }

  async resolveServer(serverId: string): Promise<PlaybackSource> {
    const path = sourcePaths[this.source].server;
    if (!path) throw new Error(`Sanka ${this.source} does not expose a server resolver`);
    return normalizeSourceServer(this.source, serverId, await this.request(`${path}${encodeURIComponent(serverId)}`, 'server'));
  }

  async getSchedule(): Promise<SourceScheduleDay[]> {
    return normalizeSourceSchedule(this.source, await this.request(sourcePaths[this.source].schedule, 'schedule'));
  }

  async discover(query: SourceDiscoveryQuery): Promise<SourceDiscoveryPage> {
    const path = discoveryPath(this.source, query);
    if (!path) throw new Error(`Sanka ${this.source} does not support ${query.kind} discovery`);
    return normalizeSourceDiscovery(this.source, await this.request(path, 'discovery'), query.page);
  }

  async getGenres(): Promise<SourceGenre[]> {
    const path = genresPath(this.source);
    if (!path) return [];
    return normalizeSourceGenres(await this.request(path, 'genres'));
  }
}
