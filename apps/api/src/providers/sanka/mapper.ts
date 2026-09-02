export type SankaHomeResponse = {
  data?: {
    ongoing?: {
      animeList?: Array<{
        title?: string;
        poster?: string | null;
        episodes?: number | null;
        releaseDay?: string | null;
        animeId?: string;
        latestReleaseDate?: string | null;
        href?: string;
      }>;
    };
  };
};

export type AnimeSummary = {
  slug: string;
  title: string;
  posterUrl: string | null;
  latestEpisode: number | null;
  releaseDay: string | null;
  source: 'sanka';
};

export function normalizeHome(response: SankaHomeResponse): AnimeSummary[] {
  return (response.data?.ongoing?.animeList ?? [])
    .filter((anime) => anime.animeId && anime.title)
    .map((anime) => ({
      slug: anime.animeId as string,
      title: anime.title as string,
      posterUrl: anime.poster ?? null,
      latestEpisode: anime.episodes ?? null,
      releaseDay: anime.releaseDay ?? null,
      source: 'sanka' as const
    }));
}
