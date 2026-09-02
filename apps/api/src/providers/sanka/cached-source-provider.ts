import type { CacheStore } from '../../cache/memory-cache.js';
import type {
  AnimeSourceProvider,
  PlaybackSource,
  SourceAnimeDetail,
  SourceAnimeSummary,
  SourceEpisodeDetail,
  SourceScheduleDay
} from '../source-types.js';

export type SourceCacheTtls = {
  home: number;
  detail: number;
  episode: number;
  playback: number;
  schedule: number;
};

export class CachedSourceProvider implements AnimeSourceProvider {
  readonly source: AnimeSourceProvider['source'];
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly ttl: SourceCacheTtls;

  constructor(
    private readonly upstream: AnimeSourceProvider,
    private readonly cache: CacheStore,
    ttlOverrides: Partial<SourceCacheTtls>
  ) {
    this.source = upstream.source;
    this.ttl = {
      home: 600_000,
      detail: 86_400_000,
      episode: 43_200_000,
      playback: 180_000,
      schedule: 600_000,
      ...ttlOverrides
    };
  }

  private async cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const stored = await this.cache.get<T>(key);
    if (stored !== undefined) return stored;

    let flight = this.inFlight.get(key) as Promise<T> | undefined;
    if (!flight) {
      flight = load()
        .then(async (value) => {
          await this.cache.set(key, value, ttl);
          return value;
        })
        .finally(() => {
          this.inFlight.delete(key);
        });
      this.inFlight.set(key, flight);
    }
    return flight;
  }

  getHome(): Promise<SourceAnimeSummary[]> {
    return this.cached(`sanka:${this.source}:home`, this.ttl.home, () => this.upstream.getHome());
  }

  getDetail(slug: string): Promise<SourceAnimeDetail> {
    return this.cached(`sanka:${this.source}:detail:${slug}`, this.ttl.detail, () => this.upstream.getDetail(slug));
  }

  getEpisode(id: string): Promise<SourceEpisodeDetail> {
    return this.cached(`sanka:${this.source}:episode:${id}`, this.ttl.episode, () => this.upstream.getEpisode(id));
  }

  resolveServer(serverId: string): Promise<PlaybackSource> {
    return this.cached(`sanka:${this.source}:playback:${serverId}`, this.ttl.playback, () => this.upstream.resolveServer(serverId));
  }

  getSchedule(): Promise<SourceScheduleDay[]> {
    return this.cached(`sanka:${this.source}:schedule`, this.ttl.schedule, () => this.upstream.getSchedule());
  }
}
