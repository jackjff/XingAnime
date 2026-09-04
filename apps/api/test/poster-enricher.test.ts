import { describe, expect, it } from 'vitest';
import { enrichPosters, isBlockedPosterUrl } from '../src/providers/poster-enricher.js';
import type { AnimeSummary } from '../src/providers/sanka/mapper.js';

const item: AnimeSummary = {
  slug: 'example',
  title: 'Example Anime',
  posterUrl: 'https://otakudesu.blog/wp-content/uploads/example.jpg',
  latestEpisode: 1,
  releaseDay: 'Senin',
  source: 'sanka'
};

describe('enrichPosters', () => {
  it('recognizes every WordPress image proxy variant used by Oploverz and rejects unknown hosts', () => {
    expect(isBlockedPosterUrl('https://i0.wp.com/oploverz.am/wp-content/uploads/poster.jpg')).toBe(true);
    expect(isBlockedPosterUrl('https://i1.wp.com/oploverz.am/wp-content/uploads/poster.jpg')).toBe(true);
    expect(isBlockedPosterUrl('https://cdn.example/poster.jpg')).toBe(true);
  });

  it('replaces known hotlink-blocked poster URLs with a resolver result', async () => {
    const result = await enrichPosters([item], async (title) => {
      expect(title).toBe('Example Anime');
      return 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/example.jpg';
    });

    expect(result[0].posterUrl).toBe('https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/example.jpg');
  });

  it('serializes and deduplicates poster resolution for repeated titles', async () => {
    const items = [item, { ...item, slug: 'example-2' }];
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    const result = await enrichPosters(items, async () => {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/example.jpg';
    });

    expect(calls).toBe(1);
    expect(maximumActive).toBe(1);
    expect(result[0].posterUrl).toBe(result[1].posterUrl);
  });

  it('keeps a trusted AniList poster URL without resolving it', async () => {
    const usable = { ...item, posterUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/example.jpg' };
    let called = false;
    const result = await enrichPosters([usable], async () => {
      called = true;
      return null;
    });

    expect(result[0]).toEqual(usable);
    expect(called).toBe(false);
  });
});
