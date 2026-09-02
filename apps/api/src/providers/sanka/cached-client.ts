import type { CacheStore } from '../../cache/memory-cache.js';
import type { AnimeSummary } from './mapper.js';

type HomeClient = {
  getHome(): Promise<AnimeSummary[]>;
};

export type HomeResult = {
  items: AnimeSummary[];
  cached: boolean;
};

export class CachedSankaClient implements HomeClient {
  private inFlight?: Promise<AnimeSummary[]>;

  constructor(
    private readonly upstream: HomeClient,
    private readonly cache: CacheStore,
    private readonly homeTtlMilliseconds: number,
    private readonly cacheKey = 'sanka:home'
  ) {}

  async getHome(): Promise<AnimeSummary[]> {
    const result = await this.getHomeWithMeta();
    return result.items;
  }

  async getHomeWithMeta(): Promise<HomeResult> {
    const cached = await this.cache.get<AnimeSummary[]>(this.cacheKey);
    if (cached) return { items: cached, cached: true };

    if (!this.inFlight) {
      this.inFlight = this.upstream.getHome()
        .then(async (items) => {
          await this.cache.set(this.cacheKey, items, this.homeTtlMilliseconds);
          return items;
        })
        .finally(() => {
          this.inFlight = undefined;
        });
    }

    return { items: await this.inFlight, cached: false };
  }
}
