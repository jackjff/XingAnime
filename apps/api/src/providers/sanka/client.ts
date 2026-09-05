import { normalizeHome, type AnimeSummary, type SankaHomeResponse } from './mapper.js';
import type { IntervalRateLimiter } from './rate-limiter.js';
import { isJsonObject, readSankaJson, SankaCircuitBreaker } from './response.js';

type Limiter = Pick<IntervalRateLimiter, 'acquire'>;
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type SankaClientOptions = {
  baseUrl: string;
  limiter: Limiter;
  circuit?: SankaCircuitBreaker;
  fetcher?: Fetcher;
};

export class SankaClient {
  private readonly baseUrl: string;
  private readonly limiter: Limiter;
  private readonly circuit: SankaCircuitBreaker;
  private readonly fetcher: Fetcher;

  constructor(options: SankaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.limiter = options.limiter;
    this.circuit = options.circuit ?? new SankaCircuitBreaker();
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  async getHome(): Promise<AnimeSummary[]> {
    const operation = 'home';
    if (this.circuit?.isOpen()) throw this.circuit.createOpenError(operation);
    await this.limiter.acquire();
    try {
      const response = await this.fetcher(`${this.baseUrl}/anime/home`, {
        headers: { accept: 'application/json' }
      });
      const payload = await readSankaJson(response, operation);
      if (!isJsonObject(payload) || !Array.isArray(payload.data?.ongoing?.animeList)) {
        throw new Error('unsupported response shape');
      }
      return normalizeHome(payload as SankaHomeResponse);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const status = 'status' in error && typeof error.status === 'number' ? error.status : null;
      const retryAfterMs = 'retryAfterMs' in error && typeof error.retryAfterMs === 'number' ? error.retryAfterMs : null;
      if (this.circuit && (status === 403 || status === 429)) this.circuit.open(status, retryAfterMs);
      throw error;
    }
  }
}
