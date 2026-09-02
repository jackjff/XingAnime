export type SourceId = 'otakudesu' | 'samehadaku' | 'oploverz';

export type SourceAnimeSummary = {
  source: SourceId;
  slug: string;
  detailSlug: string | null;
  title: string;
  posterUrl: string | null;
  latestEpisode: number | null;
  releaseDay: string | null;
};

export type SourceEpisodeSummary = {
  id: string;
  title: string;
  number: number | null;
  releaseDate: string | null;
};

export type SourceAnimeDetail = {
  source: SourceId;
  slug: string;
  title: string;
  posterUrl: string | null;
  synopsis: string | null;
  status: string | null;
  type: string | null;
  studio: string | null;
  genres: string[];
  episodes: SourceEpisodeSummary[];
  availableSources?: Array<{ source: SourceId; slug: string }>;
};

export type SourceScheduleItem = {
  source: SourceId;
  slug: string;
  title: string;
  posterUrl: string | null;
  episodeLabel: string | null;
};

export type SourceScheduleDay = {
  day: string;
  items: SourceScheduleItem[];
};

export type PlaybackMode = 'embed' | 'external' | 'unavailable' | 'unknown';
export type PlaybackReason = 'provider_frame_policy' | 'provider_unavailable' | 'provider_ads' | 'not_verified' | null;

export type PlaybackSource = {
  label: string;
  quality: string | null;
  kind: 'embed' | 'server';
  mode: PlaybackMode;
  reason: PlaybackReason;
  url: string | null;
  serverId: string | null;
};

export type SourceEpisodeDetail = {
  source: SourceId;
  id: string;
  title: string;
  animeSlug: string | null;
  releaseTime: string | null;
  previousEpisodeId: string | null;
  nextEpisodeId: string | null;
  playback: PlaybackSource[];
};

export type AnimeSourceProvider = {
  source: SourceId;
  getHome(): Promise<SourceAnimeSummary[]>;
  getDetail(slug: string): Promise<SourceAnimeDetail>;
  getEpisode(id: string): Promise<SourceEpisodeDetail>;
  resolveServer(serverId: string): Promise<PlaybackSource>;
  getSchedule(): Promise<SourceScheduleDay[]>;
};
