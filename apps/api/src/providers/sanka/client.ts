import { normalizeHome, type AnimeSummary, type SankaHomeResponse } from './mapper.js';
import type { IntervalRateLimiter } from './rate-limiter.js';

type Limiter = Pick<IntervalRateLimiter, 'acquire'>;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type SankaClientOptions = {
  baseUrl: string;
  limiter: Limiter;
  fetcher?: Fetcher;
};

export class SankaClient {
  private readonly baseUrl: string;
  private readonly limiter: Limiter;
  private readonly fetcher: Fetcher;

  constructor(options: SankaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.limiter = options.limiter;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  async getHome(): Promise<AnimeSummary[]> {
    await this.limiter.acquire();
    const response = await this.fetcher(`${this.baseUrl}/anime/home`, {
      headers: { accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Sanka home request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as SankaHomeResponse;
    return normalizeHome(payload);
  }
}
