import { describe, expect, it } from 'vitest';
import { classifyPlaybackUrl, normalizeSourceDetail, normalizeSourceEpisode, normalizeSourceHome, SankaSourceProvider } from '../src/providers/sanka/source-provider.js';
import type { SourceId } from '../src/providers/source-types.js';

const fixtures: Record<SourceId, { home: unknown; detail: unknown; episode: unknown }> = {
  otakudesu: {
    home: { data: { ongoing: { animeList: [{ title: 'Ota', poster: 'https://img/ota.jpg', episodes: 9, releaseDay: 'Selasa', animeId: 'ota', href: '/anime/anime/ota' }] } } },
    detail: { data: { title: 'Ota', poster: 'https://img/ota.jpg', synopsis: { paragraphs: ['A story.'] }, genreList: [{ title: 'Action' }], episodeList: [{ title: 'Ota Episode 9', eps: 9, episodeId: 'ota-9', date: 'Today' }] } },
    episode: { data: { title: 'Ota Episode 9', animeId: 'ota', defaultStreamingUrl: 'https://embed.example/ota-9', server: { qualities: [{ title: '720p', serverList: [{ title: 'Server A', serverId: 'ota-server-9' }] }] } } }
  },
  samehadaku: {
    home: { data: { recent: { animeList: [{ title: 'Same', poster: 'https://img/same.jpg', episodes: '7', releasedOn: '1 hour lalu', animeId: 'same', href: '/samehadaku/anime/same' }] } } },
    detail: { data: { title: '', english: 'Same', poster: 'https://img/same.jpg', synopsis: { paragraphs: ['Another story.'] }, genreList: [{ title: 'Drama' }], episodeList: [{ title: 7, episodeId: 'same-7' }] } },
    episode: { data: { title: 'Same Episode 7', animeId: 'same', defaultStreamingUrl: 'https://blogger.example/same-7', server: { qualities: [{ title: '1080p', serverList: [{ title: 'Server B', serverId: 'same-server-7' }] }] } } }
  },
  oploverz: {
    home: { anime_list: [{ title: 'Oploverz Episode 12 Subtitle Indonesia', slug: 'oploverz-episode-12-subtitle-indonesia', poster: 'https://img/op.jpg', episode: 'Ep 12', oploverz_url: 'https://oploverz.example/episode' }] },
    detail: { detail: { title: 'Oploverz', poster: 'https://img/op.jpg', synopsis: 'Oploverz synopsis', info: { status: 'Ongoing', studio: 'Studio' }, genres: [{ name: 'Fantasy' }], episode_list: [{ slug: 'op-12', title: 'Oploverz Episode 12', episode: '12', release_date: 'Today' }] } },
    episode: { episode_title: 'Oploverz Episode 12', streams: [{ name: 'Main', url: 'https://embed.example/op-12' }], downloads: [] }
  }
};

describe.each(Object.keys(fixtures) as SourceId[])('source normalizers: %s', (source) => {
  it('normalizes home, detail, and episode into one contract', () => {
    const fixture = fixtures[source];
    const home = normalizeSourceHome(source, fixture.home);
    const detail = normalizeSourceDetail(source, 'detail-slug', fixture.detail);
    const episode = normalizeSourceEpisode(source, 'episode-slug', fixture.episode);

    expect(home[0]).toMatchObject({ source, title: expect.any(String), posterUrl: expect.any(String) });
    expect(detail).toMatchObject({ source, slug: 'detail-slug', episodes: [{ id: expect.any(String) }] });
    expect(episode).toMatchObject({ source, id: 'episode-slug' });
    expect(episode.playback.some((item) => item.url)).toBe(true);
  });
});

describe('Sanka source provider boundary', () => {
  it('aborts a hung upstream request after the configured timeout', async () => {
    const provider = new SankaSourceProvider({
      source: 'otakudesu',
      baseUrl: 'https://provider.test/',
      limiter: { acquire: async () => undefined },
      requestTimeoutMilliseconds: 1,
      fetcher: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })
    });

    await expect(provider.getHome()).rejects.toThrow(/timed out/i);
  });

  it('uses the documented Samehadaku path and rejects API error envelopes', async () => {
    const calls: string[] = [];
    const provider = new SankaSourceProvider({
      source: 'samehadaku',
      baseUrl: 'https://provider.test/',
      limiter: { acquire: async () => undefined },
      fetcher: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({
          status: 'success', statusCode: 404, message: 'data tidak ditemukan', ok: false, data: null
        }), { status: 200 });
      }
    });

    await expect(provider.getHome()).rejects.toMatchObject({ status: 404 });
    expect(calls).toEqual(['https://provider.test/anime/samehadaku/home']);
  });

  it('uses the documented Otakudesu ongoing endpoint with upstream pagination', async () => {
    const calls: string[] = [];
    const provider = new SankaSourceProvider({
      source: 'otakudesu',
      baseUrl: 'https://provider.test/',
      limiter: { acquire: async () => undefined },
      fetcher: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({
          data: { animeList: [{ title: 'Ongoing', animeId: 'ongoing', poster: null, episodes: '12', releaseDay: 'Senin' }] },
          pagination: { currentPage: 2, hasPrevPage: true, hasNextPage: true, totalPages: 5 }
        }));
      }
    });

    const discoveryProvider = provider as unknown as {
      discover(query: { kind: 'ongoing'; page: number }): Promise<{
        items: Array<{ title: string }>;
        page: number;
        hasNext: boolean;
        hasPrevious: boolean;
        pageCount: number | null;
      }>;
    };
    const result = await discoveryProvider.discover({ kind: 'ongoing', page: 2 });

    expect(calls).toEqual(['https://provider.test/anime/ongoing-anime?page=2']);
    expect(result).toMatchObject({ items: [{ title: 'Ongoing' }], page: 2, hasNext: true, hasPrevious: true, pageCount: 5 });
  });
});

describe('source data quality', () => {
  it.each(['otakudesu', 'samehadaku', 'oploverz'] as SourceId[])('drops home entries without a positive episode number: %s', (source) => {
    const payload = source === 'oploverz'
      ? { anime_list: [{ title: 'No Episode', slug: 'no-episode', episode: 'Episode 0' }] }
      : source === 'otakudesu'
        ? { data: { ongoing: { animeList: [{ title: 'No Episode', animeId: 'no-episode', episodes: 0 }] } } }
        : { data: { recent: { animeList: [{ title: 'No Episode', animeId: 'no-episode', episodes: '0' }] } } };

    expect(normalizeSourceHome(source, payload)).toEqual([]);
  });

  it('does not infer latest episode from numbers in a title', () => {
    const payloads: Record<SourceId, unknown> = {
      otakudesu: { data: { ongoing: { animeList: [{ title: 'Blue Lock Season 2', animeId: 'blue-lock', poster: 'https://img/blue-lock.jpg' }] } } },
      samehadaku: { data: { recent: { animeList: [{ title: 'Blue Lock Season 2', animeId: 'blue-lock', poster: 'https://img/blue-lock.jpg' }] } } },
      oploverz: { anime_list: [{ title: 'Blue Lock Season 2', slug: 'blue-lock', poster: 'https://img/blue-lock.jpg' }] }
    };

    for (const source of Object.keys(payloads) as SourceId[]) {
      expect(normalizeSourceHome(source, payloads[source])).toEqual([]);
    }
  });

  it('drops episode detail entries with zero or missing episode numbers', () => {
    const detail = normalizeSourceDetail('samehadaku', 'same', {
      data: {
        title: 'Same',
        episodeList: [
          { title: 'Episode 0', eps: 0, episodeId: 'same-0' },
          { title: 'Episode 1', eps: 1, episodeId: 'same-1' },
          { title: 'Episode tanpa nomor', episodeId: 'same-x' }
        ]
      }
    });

    expect(detail.episodes).toEqual([{ id: 'same-1', title: 'Episode 1', number: 1, releaseDate: null }]);
  });

  it('does not infer episode number from a free-form episode title', () => {
    const detail = normalizeSourceDetail('samehadaku', 'same', {
      data: {
        title: 'Same',
        episodeList: [{ title: 'Blue Lock Season 2', episodeId: 'same-season-2' }]
      }
    });

    expect(detail.episodes).toEqual([]);
  });

  it('preserves decimal Oploverz episode numbers instead of collapsing specials', () => {
    const detail = normalizeSourceDetail('oploverz', 'one-piece', {
      detail: {
        title: 'One Piece',
        episode_list: [
          { slug: 'one-piece-episode-1015', title: 'One Piece Episode 1015', episode: '1015' },
          { slug: 'one-piece-episode-1015-5', title: 'One Piece Episode 1015.5', episode: '1015.5' }
        ]
      }
    });

    expect(detail.episodes.map((episode) => episode.number)).toEqual([1015, 1015.5]);
  });

  it('does not publish an Oploverz tamat card without a positive episode number', () => {
    const items = normalizeSourceHome('oploverz', {
      anime_list: [{
        title: 'Ore Monogatari Episode Tamat',
        slug: 'ore-monogatari-episode-tamat',
        episode: 'Tamat'
      }]
    });

    expect(items).toEqual([]);
  });

  it('does not publish live-action releases in the anime catalog', () => {
    const items = normalizeSourceHome('oploverz', {
      anime_list: [{ title: 'One Piece Live Action S2', slug: 'one-piece-live-action-s2-episode-1', episode: 'Ep 1' }]
    });

    expect(items).toEqual([]);
  });
});

describe('playback embedding policy', () => {
  it('marks Desustream playback as external instead of silently embedding it', () => {
    const episode = normalizeSourceEpisode('otakudesu', 'sd-p2-episode-10-sub-indo', {
      data: {
        title: 'Sakamoto Days Part 2 Episode 10',
        defaultStreamingUrl: 'https://desustream.com/dstream/otakuwatch5/new/index.php?id=redacted'
      }
    });

    expect(episode.playback[0]).toMatchObject({
      mode: 'external',
      reason: 'provider_frame_policy'
    });
  });

  it('marks known blocked and ad-heavy playback hosts unavailable', () => {
    expect(classifyPlaybackUrl('https://desustream.net/embed/known-bad')).toEqual({
      mode: 'unavailable',
      reason: 'provider_unavailable'
    });
    expect(classifyPlaybackUrl('https://filedon.example/watch/with-popups')).toEqual({
      mode: 'unavailable',
      reason: 'provider_ads'
    });
    expect(classifyPlaybackUrl('https://wibuu.info/stream/embed.php?url=https%3A%2F%2Fexample.invalid')).toEqual({
      mode: 'unavailable',
      reason: 'provider_unavailable'
    });
  });

  it('hides known bad server labels before resolving their URLs', () => {
    const episode = normalizeSourceEpisode('otakudesu', 'episode-1', {
      data: {
        title: 'Episode 1',
        server: {
          qualities: [{
            title: '720p',
            serverList: [
              { title: 'ondesuhd', serverId: 'ondesuhd-1' },
              { title: 'filedon', serverId: 'filedon-1' },
              { title: 'vidhide', serverId: 'vidhide-1' }
            ]
          }]
        }
      }
    });

    expect(episode.playback).toMatchObject([
      { label: 'ondesuhd', mode: 'unavailable', reason: 'provider_unavailable', url: null },
      { label: 'filedon', mode: 'unavailable', reason: 'provider_ads', url: null },
      { label: 'vidhide', mode: 'unknown', reason: 'not_verified', url: null }
    ]);
  });

  it('deduplicates playback entries by server identity or URL', () => {
    const episode = normalizeSourceEpisode('oploverz', 'one-piece-1015', {
      episode_title: 'One Piece Episode 1015',
      streams: [
        { name: 'Primary', url: 'https://embed.example/one-piece-1015' },
        { name: 'Mirror label', url: 'https://embed.example/one-piece-1015' }
      ]
    });

    expect(episode.playback).toHaveLength(1);
  });
});
