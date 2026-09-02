import { describe, expect, it } from 'vitest';
import { classifyPlaybackUrl, normalizeSourceDetail, normalizeSourceEpisode, normalizeSourceHome } from '../src/providers/sanka/source-provider.js';
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
});
