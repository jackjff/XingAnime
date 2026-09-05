import { describe, expect, it, vi } from 'vitest';
import { normalizeHome } from '../src/providers/sanka/mapper.js';
import { IntervalRateLimiter } from '../src/providers/sanka/rate-limiter.js';
import { SankaClient } from '../src/providers/sanka/client.js';
import { readSankaJson, retryAfterMilliseconds } from '../src/providers/sanka/response.js';

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
        source: 'otakudesu'
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
          data: { ongoing: { animeList: [{ title: 'Example', animeId: 'example', episodes: 1 }] } }
        }), { status: 200 });
      })
    });

    await expect(client.getHome()).resolves.toEqual([
      {
        slug: 'example',
        title: 'Example',
        posterUrl: null,
        latestEpisode: 1,
        releaseDay: null,
        source: 'otakudesu'
      }
    ]);
    expect(calls).toEqual(['https://provider.test/anime/home']);
    expect(limiter.acquire).toHaveBeenCalledOnce();
  });

  it('rejects an API-level error envelope even when HTTP is 200', async () => {
    const client = new SankaClient({
      baseUrl: 'https://provider.test',
      limiter: { acquire: vi.fn(async () => undefined) },
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        status: 'success',
        statusCode: 404,
        statusMessage: 'Not Found',
        message: 'data tidak ditemukan',
        ok: false,
        data: null
      }), { status: 200 }))
    });

    await expect(client.getHome()).rejects.toMatchObject({ status: 404 });
  });

  it('opens a shared cooldown on 429 and does not immediately call Sanka again', async () => {
    const limiter = { acquire: vi.fn(async () => undefined) };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: 'error', statusCode: 429, message: 'too many requests', ok: false
    }), { status: 429, headers: { 'Retry-After': '7' } }));
    const client = new SankaClient({ baseUrl: 'https://provider.test', limiter, fetcher });

    await expect(client.getHome()).rejects.toMatchObject({ status: 429, retryAfterMs: 7000 });
    await expect(client.getHome()).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(limiter.acquire).toHaveBeenCalledOnce();
  });

  it('prioritizes a real HTTP 429 over an inconsistent successful body status', async () => {
    const response = new Response(JSON.stringify({ status: 'success', statusCode: 200, ok: true }), {
      status: 429,
      headers: { 'Retry-After': '0' }
    });

    await expect(readSankaJson(response, 'home')).rejects.toMatchObject({ status: 429, retryAfterMs: 1000 });
  });

  it('bounds Retry-After to a safe non-zero cooldown', () => {
    expect(retryAfterMilliseconds(new Response('{}', { headers: { 'Retry-After': '0' } }))).toBe(1000);
    expect(retryAfterMilliseconds(new Response('{}', { headers: { 'Retry-After': '999999999999' } }))).toBe(900000);
    expect(retryAfterMilliseconds(new Response('{}', { headers: { 'Retry-After': 'Thu, 01 Jan 1970 00:00:00 GMT' } }))).toBe(1000);
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
