import { describe, expect, it, vi } from 'vitest';
import { normalizeHome } from '../src/providers/sanka/mapper.js';
import { IntervalRateLimiter } from '../src/providers/sanka/rate-limiter.js';
import { SankaClient } from '../src/providers/sanka/client.js';

describe('normalizeHome', () => {
  it('maps Sanka ongoing anime into Xing Anime summaries', () => {
    const result = normalizeHome({
      data: {
        ongoing: {
          animeList: [
            {
              title: 'Example Anime',
              poster: 'https://cdn.example/poster.jpg',
              episodes: 7,
              releaseDay: 'Selasa',
              latestReleaseDate: '01 Sep',
              animeId: 'example-anime-sub-indo',
              href: '/anime/anime/example-anime-sub-indo'
            }
          ]
        }
      }
    });

    expect(result).toEqual([
      {
        slug: 'example-anime-sub-indo',
        title: 'Example Anime',
        posterUrl: 'https://cdn.example/poster.jpg',
        latestEpisode: 7,
        releaseDay: 'Selasa',
        source: 'sanka'
      }
    ]);
  });
});

describe('SankaClient', () => {
  it('fetches and normalizes home through the provider boundary', async () => {
    const calls: string[] = [];
    const limiter = { acquire: vi.fn(async () => undefined) };
    const client = new SankaClient({
      baseUrl: 'https://provider.test',
      limiter,
      fetcher: vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify({
          data: { ongoing: { animeList: [{ title: 'Example', animeId: 'example' }] } }
        }), { status: 200 });
      })
    });

    await expect(client.getHome()).resolves.toEqual([
      {
        slug: 'example',
        title: 'Example',
        posterUrl: null,
        latestEpisode: null,
        releaseDay: null,
        source: 'sanka'
      }
    ]);
    expect(calls).toEqual(['https://provider.test/anime/home']);
    expect(limiter.acquire).toHaveBeenCalledOnce();
  });
});

describe('IntervalRateLimiter', () => {
  it('waits at least the configured interval between permits', async () => {
    vi.useFakeTimers();
    const limiter = new IntervalRateLimiter(3500);

    await limiter.acquire();
    let settled = false;
    const pending = limiter.acquire().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(3499);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
    vi.useRealTimers();
  });
});
