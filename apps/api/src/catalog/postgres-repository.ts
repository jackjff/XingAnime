import type { SourceAnimeDetail, SourceAnimeSummary, SourceEpisodeDetail, SourceEpisodeSummary, SourceId, SourceScheduleDay, CatalogQuery, EpisodeQuery, PageResult } from '../providers/source-types.js';
import type { AnimeSummary } from '../providers/sanka/mapper.js';

type QueryResult<Row> = { rows: Row[] };
export type Queryable = { query<Row = unknown>(text: string, values?: unknown[]): Promise<QueryResult<Row>> };

export type SyncAuditResult = {
  status: 'success' | 'partial' | 'failed';
  requestsUsed: number;
  recordsFound: number;
  recordsFailed: number;
  errorMessage?: string;
};

type HomeRow = {
  provider_slug: string | null;
  canonical_slug: string;
  title: string;
  poster_url: string | null;
  release_day: string | null;
  latest_episode: string | null;
};

type DetailRow = {
  anime_id: string;
  title: string;
  poster_url: string | null;
  synopsis: string | null;
  status: string | null;
  provider_slug: string | null;
  first_episode_id: string | null;
  latest_episode_id: string | null;
};

type AlternativeRow = { provider_name: SourceId; provider_slug: string | null; provider_anime_id: string };

type EpisodeRow = {
  provider_episode_id: string;
  episode_title: string | null;
  episode_number: string;
  anime_slug: string | null;
  poster_url?: string | null;
  previous_episode_id?: string | null;
  next_episode_id?: string | null;
};

type ScheduleRow = {
  day: string;
  provider_name: SourceId;
  provider_slug: string | null;
  title: string;
  poster_url: string | null;
  episode_label: string | null;
};

type CatalogRow = {
  total_count: string;
  provider_name: SourceId;
  provider_slug: string | null;
  provider_anime_id: string;
  title: string;
  poster_url: string | null;
  release_day: string | null;
  latest_episode: string | null;
};

type EpisodePageRow = {
  total_count: string;
  provider_episode_id: string;
  episode_title: string | null;
  episode_number: string;
  release_date: string | null;
};

function pageResult<T>(items: T[], requestedPage: number, limit: number, total: number): PageResult<T> {
  const pageCount = total === 0 ? 0 : Math.ceil(total / limit);
  const page = pageCount === 0 ? 1 : Math.min(requestedPage, pageCount);
  return {
    items,
    page,
    limit,
    total,
    pageCount,
    hasNext: pageCount > 0 && page < pageCount,
    hasPrevious: page > 1
  };
}

export function canonicalSlug(title: string): string {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 160) || 'untitled';
}

export class PostgresCatalogRepository {
  constructor(private readonly database: Queryable) {}

  async startSyncRun(provider: SourceId, operation: string): Promise<string | null> {
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO sync_runs (provider_name, operation) VALUES ($1, $2) RETURNING id`,
      [provider, operation]
    );
    return result.rows[0]?.id ?? null;
  }

  async finishSyncRun(runId: string | null, result: SyncAuditResult): Promise<void> {
    if (!runId) return;
    await this.database.query(
      `UPDATE sync_runs
       SET finished_at = NOW(), requests_used = $2, records_found = $3, records_failed = $4, status = $5, error_message = $6
       WHERE id = $1`,
      [runId, result.requestsUsed, result.recordsFound, result.recordsFailed, result.status, result.errorMessage ?? null]
    );
  }

  async updateProviderHealth(provider: SourceId, status: 'healthy' | 'degraded' | 'paused', httpStatus: number | null): Promise<void> {
    await this.database.query(
      `INSERT INTO provider_health (provider_name, status, last_http_status, last_success_at, last_403_at, last_429_at, updated_at)
       VALUES ($1, $2, $3::integer, CASE WHEN $2 = 'healthy' THEN NOW() ELSE NULL END, CASE WHEN $3::integer = 403 THEN NOW() ELSE NULL END, CASE WHEN $3::integer = 429 THEN NOW() ELSE NULL END, NOW())
       ON CONFLICT (provider_name) DO UPDATE SET
         status = EXCLUDED.status,
         last_http_status = EXCLUDED.last_http_status,
         last_success_at = COALESCE(EXCLUDED.last_success_at, provider_health.last_success_at),
         last_403_at = COALESCE(EXCLUDED.last_403_at, provider_health.last_403_at),
         last_429_at = COALESCE(EXCLUDED.last_429_at, provider_health.last_429_at),
         updated_at = NOW()`,
      [provider, status, httpStatus]
    );
  }

  async clearUnusablePosters(): Promise<void> {
    await this.database.query(
      `UPDATE anime
       SET poster_url = NULL, poster_status = 'pending', poster_checked_at = NULL, updated_at = NOW()
       WHERE poster_url IS NOT NULL
         AND poster_url !~ '^https://s[0-9]+\\.anilist\\.co/'
         AND poster_url !~ '^https://img\\.anili\\.st/'`
    );
  }

  async listMissingPosters(limit: number): Promise<Array<{ id: string; title: string }>> {
    const result = await this.database.query<{ id: string; title: string }>(
      `SELECT anime.id, anime.title
       FROM anime
       WHERE anime.visibility = 'published'
         AND anime.poster_url IS NULL
         AND (anime.poster_checked_at IS NULL OR anime.poster_checked_at < NOW() - INTERVAL '24 hours')
       ORDER BY EXISTS (
         SELECT 1 FROM anime_sources AS source
         WHERE source.anime_id = anime.id AND source.source_status = 'verified'
       ) DESC, poster_checked_at ASC NULLS FIRST, anime.updated_at DESC
       LIMIT $1`,
      [Math.min(100, Math.max(1, limit))]
    );
    return result.rows;
  }

  async updatePoster(animeId: string, posterUrl: string): Promise<void> {
    await this.database.query(
      `UPDATE anime
       SET poster_url = $2, poster_status = 'resolved', poster_checked_at = NOW(), updated_at = NOW()
       WHERE id = $1
         AND ($2 ~ '^https://s[0-9]+\\.anilist\\.co/' OR $2 ~ '^https://img\\.anili\\.st/')`,
      [animeId, posterUrl]
    );
  }

  async markPosterUnresolved(animeId: string): Promise<void> {
    await this.database.query(
      `UPDATE anime
       SET poster_status = 'unresolved', poster_checked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND poster_url IS NULL`,
      [animeId]
    );
  }

  async listDiscoveredSources(limit = 12): Promise<Array<{ source: SourceId; slug: string }>> {
    const result = await this.database.query<{ source: SourceId; slug: string }>(
      `SELECT provider_name AS source, COALESCE(provider_slug, provider_anime_id) AS slug
       FROM anime_sources
       WHERE source_status = 'discovered'
         AND (hydration_checked_at IS NULL OR hydration_checked_at < NOW() - INTERVAL '6 hours')
       ORDER BY hydration_checked_at ASC NULLS FIRST, updated_at ASC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async markSourceHydrationAttempt(source: SourceId, slug: string, errorMessage: string): Promise<void> {
    await this.database.query(
      `UPDATE anime_sources
       SET hydration_checked_at = NOW(), last_error = $3, updated_at = NOW()
       WHERE provider_name = $1 AND (provider_slug = $2 OR provider_anime_id = $2)`,
      [source, slug, errorMessage]
    );
  }

  async markSourceUnavailable(source: SourceId, slug: string, errorMessage: string): Promise<void> {
    // Only unverified rows may go dark: a verified source has real episodes and must stay visible
    // even if a later provider hiccup returns 404 for a while.
    await this.database.query(
      `UPDATE anime_sources
       SET source_status = 'disabled', hydration_checked_at = NOW(), last_error = $3, updated_at = NOW()
       WHERE provider_name = $1 AND (provider_slug = $2 OR provider_anime_id = $2)
         AND source_status IN ('discovered', 'unknown')`,
      [source, slug, errorMessage]
    );
  }

  async markSourceRediscovered(source: SourceId, slug: string): Promise<void> {
    // A dead link the provider serves again becomes hydratable once more.
    await this.database.query(
      `UPDATE anime_sources
       SET source_status = 'discovered', hydration_checked_at = NULL, updated_at = NOW()
       WHERE provider_name = $1 AND (provider_slug = $2 OR provider_anime_id = $2)
         AND source_status = 'disabled'`,
      [source, slug]
    );
  }

  async listDeadLinkRecheckCandidates(limit: number): Promise<Array<{ source: SourceId; slug: string }>> {
    const result = await this.database.query<{ source: SourceId; slug: string }>(
      `SELECT provider_name AS source, COALESCE(provider_slug, provider_anime_id) AS slug
       FROM anime_sources
       WHERE source_status = 'disabled'
         AND (hydration_checked_at IS NULL OR hydration_checked_at < NOW() - INTERVAL '7 days')
       ORDER BY hydration_checked_at ASC NULLS FIRST, updated_at ASC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async upsertSourceHome(source: SourceId, items: SourceAnimeSummary[]): Promise<void> {
    for (const item of items) {
      const anime = await this.database.query<{ id: string }>(
        `INSERT INTO anime (canonical_slug, title, poster_url, poster_status, poster_checked_at, release_day, visibility, published_at)
         VALUES ($1, $2, CASE
           WHEN $3::text IS NOT NULL
            AND ($3::text ~ '^https://s[0-9]+\\.anilist\\.co/' OR $3::text ~ '^https://img\\.anili\\.st/') THEN $3::text
           ELSE NULL
         END, CASE
           WHEN $3::text IS NOT NULL
            AND ($3::text ~ '^https://s[0-9]+\\.anilist\\.co/' OR $3::text ~ '^https://img\\.anili\\.st/') THEN 'resolved'
           ELSE 'pending'
         END, CASE
           WHEN $3::text IS NOT NULL
            AND ($3::text ~ '^https://s[0-9]+\\.anilist\\.co/' OR $3::text ~ '^https://img\\.anili\\.st/') THEN NOW()
           ELSE NULL
         END, $4, 'published', NOW())
         ON CONFLICT (canonical_slug) DO UPDATE SET
           title = EXCLUDED.title,
           poster_url = CASE
             WHEN EXCLUDED.poster_url IS NOT NULL
              AND (EXCLUDED.poster_url ~ '^https://s[0-9]+\\.anilist\\.co/' OR EXCLUDED.poster_url ~ '^https://img\\.anili\\.st/') THEN EXCLUDED.poster_url
             WHEN anime.poster_url IS NOT NULL
                AND anime.poster_url !~ '^https://s[0-9]+\\.anilist\\.co/'
                AND anime.poster_url !~ '^https://img\\.anili\\.st/' THEN NULL
             ELSE anime.poster_url
           END,
           poster_status = CASE
             WHEN EXCLUDED.poster_url IS NOT NULL THEN 'resolved'
             WHEN anime.poster_url IS NOT NULL
              AND anime.poster_url !~ '^https://s[0-9]+\\.anilist\\.co/'
              AND anime.poster_url !~ '^https://img\\.anili\\.st/' THEN 'pending'
             ELSE anime.poster_status
           END,
           poster_checked_at = CASE
             WHEN EXCLUDED.poster_url IS NOT NULL THEN NOW()
             WHEN anime.poster_url IS NOT NULL
              AND anime.poster_url !~ '^https://s[0-9]+\\.anilist\\.co/'
              AND anime.poster_url !~ '^https://img\\.anili\\.st/' THEN NULL
             ELSE anime.poster_checked_at
           END,
           release_day = COALESCE(EXCLUDED.release_day, anime.release_day),
           updated_at = NOW()
         RETURNING id`,
        [canonicalSlug(item.title), item.title, item.posterUrl, item.releaseDay]
      );
      const animeId = anime.rows[0]?.id;
      if (!animeId) throw new Error(`Failed to upsert anime ${item.title}`);

      await this.database.query(
        `WITH updated_source AS (
           UPDATE anime_sources
           SET provider_anime_id = $3,
               provider_slug = $4,
               source_status = CASE WHEN source_status = 'verified' THEN 'verified' WHEN source_status = 'disabled' THEN 'disabled' ELSE 'discovered' END,
               last_checked_at = NOW(),
               last_success_at = NOW(),
               last_error = NULL,
               updated_at = NOW()
           WHERE anime_id = $1 AND provider_name = $2
           RETURNING id
         )
         INSERT INTO anime_sources (anime_id, provider_name, provider_anime_id, provider_slug, source_status, last_checked_at, last_success_at)
         SELECT $1, $2, $3, $4, 'discovered', NOW(), NOW()
         WHERE NOT EXISTS (SELECT 1 FROM updated_source)
         ON CONFLICT (provider_name, provider_anime_id) DO UPDATE SET
           anime_id = EXCLUDED.anime_id,
           provider_slug = EXCLUDED.provider_slug,
           source_status = CASE WHEN anime_sources.source_status = 'verified' THEN 'verified' WHEN anime_sources.source_status = 'disabled' THEN 'disabled' ELSE 'discovered' END,
           last_checked_at = NOW(),
           last_success_at = NOW(),
           last_error = NULL,
           updated_at = NOW()`,
        [animeId, source, item.detailSlug, item.detailSlug]
      );
    }
  }

  async listSourceHome(source: SourceId, limit = 50): Promise<SourceAnimeSummary[]> {
    const result = await this.database.query<HomeRow & { provider_anime_id: string }>(
      `SELECT src.provider_slug, src.provider_anime_id, a.canonical_slug, a.title, a.poster_url, a.release_day,
              MAX(e.episode_number) AS latest_episode
       FROM anime AS a
       JOIN anime_sources AS src ON src.anime_id = a.id AND src.provider_name = $1 AND src.source_status = 'verified'
       JOIN episodes AS e ON e.source_id = src.id
         AND e.visibility = 'published'
         AND e.episode_number > 0
         AND e.provider_episode_id NOT LIKE 'pembatas-%'
         AND COALESCE(e.episode_title, '') NOT ILIKE '%dalam proses%'
       WHERE a.visibility = 'published'
       GROUP BY src.provider_slug, src.provider_anime_id, a.canonical_slug, a.title, a.poster_url, a.release_day, a.featured, a.updated_at
       ORDER BY a.featured DESC, a.updated_at DESC
       LIMIT $2`,
      [source, limit]
    );
    return result.rows.map((row) => ({
      source,
      slug: row.provider_slug ?? row.provider_anime_id,
      detailSlug: row.provider_slug ?? row.provider_anime_id,
      title: row.title,
      posterUrl: row.poster_url,
      latestEpisode: row.latest_episode === null ? null : Number(row.latest_episode),
      releaseDay: row.release_day
    }));
  }

  async listCatalog(options: CatalogQuery = {}): Promise<PageResult<SourceAnimeSummary>> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 24));
    const query = options.query?.trim().replace(/[\\%_]/g, '\\$&') || null;
    const letter = options.letter?.trim().toUpperCase() || null;
    const source = options.source ?? null;
    const result = await this.database.query<CatalogRow | { total_count: string; provider_name: null }>(
      `WITH ranked_catalog AS (
         SELECT src.provider_name, src.provider_slug, src.provider_anime_id,
                a.canonical_slug, a.title, a.featured, a.poster_url, a.release_day,
                MAX(e.episode_number) AS latest_episode,
                ROW_NUMBER() OVER (
                  PARTITION BY a.id
                  ORDER BY (MAX(e.episode_number) IS NOT NULL) DESC,
                  CASE src.provider_name
                    WHEN 'otakudesu' THEN 1
                    WHEN 'samehadaku' THEN 2
                    WHEN 'oploverz' THEN 3
                    ELSE 4
                  END,
                  MAX(e.episode_number) DESC,
                  src.updated_at DESC, src.id ASC
                ) AS source_rank
         FROM anime AS a
         JOIN anime_sources AS src ON src.anime_id = a.id
         LEFT JOIN episodes AS e ON e.source_id = src.id
           AND e.visibility = 'published'
           AND e.episode_number > 0
           AND e.provider_episode_id NOT LIKE 'pembatas-%'
           AND COALESCE(e.episode_title, '') NOT ILIKE '%dalam proses%'
         WHERE a.visibility = 'published'
           AND src.source_status <> 'disabled'
           AND ($1::text IS NULL OR a.title ILIKE '%' || $1 || '%' OR a.canonical_slug ILIKE '%' || $1 || '%')
           AND ($2::text IS NULL OR UPPER(LEFT(a.title, 1)) = $2)
           AND ($3::text IS NULL OR src.provider_name = $3)
         GROUP BY a.id, src.id, src.provider_name, src.provider_slug, src.provider_anime_id,
                  a.title, a.featured, a.poster_url, a.release_day, src.updated_at
         HAVING COUNT(e.id) > 0
       ), catalog AS (
         SELECT * FROM ranked_catalog WHERE source_rank = 1
       ), totals AS (
         SELECT COUNT(*) AS total_count FROM catalog
       )
       SELECT totals.total_count, page_rows.*
       FROM totals
       LEFT JOIN LATERAL (
         SELECT canonical_slug, provider_name, provider_slug, provider_anime_id,
                title, featured, poster_url, release_day, latest_episode
         FROM catalog
         ORDER BY featured DESC, title ASC, provider_name ASC, canonical_slug ASC
         LIMIT $4 OFFSET LEAST($5::bigint, (GREATEST(totals.total_count, 1) - 1) / $4::bigint * $4::bigint)
       ) AS page_rows ON TRUE
       ORDER BY page_rows.featured DESC, page_rows.title ASC, page_rows.provider_name ASC, page_rows.canonical_slug ASC`,
      [query, letter, source, limit, (page - 1) * limit]
    );
    const total = Number(result.rows[0]?.total_count ?? 0);
    // Count and rows share one statement snapshot; the LEFT JOIN retains zero-result metadata.
    return pageResult(result.rows.filter((row) => row.provider_name !== null).map((row) => ({
      source: row.provider_name,
      slug: row.provider_slug ?? row.provider_anime_id,
      detailSlug: row.provider_slug ?? row.provider_anime_id,
      title: row.title,
      posterUrl: row.poster_url,
      latestEpisode: row.latest_episode === null ? null : Number(row.latest_episode),
      releaseDay: row.release_day
    })), page, limit, total);
  }

  async listEpisodes(source: SourceId, slug: string, options: EpisodeQuery = {}): Promise<PageResult<SourceEpisodeSummary>> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const query = options.query?.trim() || null;
    const result = await this.database.query<EpisodePageRow>(
      `SELECT COUNT(*) OVER () AS total_count, e.provider_episode_id, e.episode_title, e.episode_number, NULL::text AS release_date
       FROM episodes AS e
       JOIN anime_sources AS src ON src.id = e.source_id
       WHERE src.provider_name = $1
         AND (src.provider_slug = $2 OR src.provider_anime_id = $2)
         AND e.visibility = 'published'
         AND e.episode_number > 0
         AND e.provider_episode_id NOT LIKE 'pembatas-%'
         AND COALESCE(e.episode_title, '') NOT ILIKE '%dalam proses%'
         AND ($3::text IS NULL OR e.provider_episode_id ILIKE '%' || $3 || '%' OR e.episode_title ILIKE '%' || $3 || '%' OR e.episode_number::text ILIKE '%' || $3 || '%')
       ORDER BY e.episode_number ASC, e.provider_episode_id ASC
       LIMIT $4 OFFSET $5`,
      [source, slug, query, limit, (page - 1) * limit]
    );
    const total = Number(result.rows[0]?.total_count ?? 0);
    return pageResult(result.rows.map((row) => ({
      id: row.provider_episode_id,
      title: row.episode_title ?? row.provider_episode_id,
      number: Number(row.episode_number),
      releaseDate: row.release_date
    })), page, limit, total);
  }

  async findDetail(source: SourceId, slug: string, options: { includeEpisodes?: boolean } = {}): Promise<SourceAnimeDetail | null> {
    const includeEpisodes = options.includeEpisodes !== false;
    const result = await this.database.query<DetailRow>(
      `SELECT a.id AS anime_id, a.title, a.poster_url, a.synopsis, a.status, s.provider_slug,
              (SELECT e_first.provider_episode_id FROM episodes AS e_first WHERE e_first.source_id = s.id AND e_first.visibility = 'published' AND e_first.episode_number > 0 AND e_first.provider_episode_id NOT LIKE 'pembatas-%' AND COALESCE(e_first.episode_title, '') NOT ILIKE '%dalam proses%' ORDER BY e_first.episode_number ASC, e_first.provider_episode_id ASC LIMIT 1) AS first_episode_id,
              (SELECT e_latest.provider_episode_id FROM episodes AS e_latest WHERE e_latest.source_id = s.id AND e_latest.visibility = 'published' AND e_latest.episode_number > 0 AND e_latest.provider_episode_id NOT LIKE 'pembatas-%' AND COALESCE(e_latest.episode_title, '') NOT ILIKE '%dalam proses%' ORDER BY e_latest.episode_number DESC, e_latest.provider_episode_id DESC LIMIT 1) AS latest_episode_id
       FROM anime AS a
       JOIN anime_sources AS s ON s.anime_id = a.id
       WHERE s.provider_name = $1 AND (s.provider_slug = $2 OR s.provider_anime_id = $3)
       LIMIT 1`,
      [source, slug, slug]
    );
    const row = result.rows[0];
    if (!row) return null;

    const episodes = includeEpisodes
      ? await this.database.query<EpisodeRow>(
        `SELECT e.provider_episode_id, e.episode_title, e.episode_number, s.provider_slug AS anime_slug
         FROM episodes AS e
         JOIN anime_sources AS s ON s.id = e.source_id
         WHERE s.provider_name = $1 AND (s.provider_slug = $2 OR s.provider_anime_id = $3)
           AND e.visibility = 'published'
           AND e.episode_number > 0
           AND e.provider_episode_id NOT LIKE 'pembatas-%'
           AND COALESCE(e.episode_title, '') NOT ILIKE '%dalam proses%'
         ORDER BY e.episode_number ASC`,
        [source, slug, slug]
      )
      : { rows: [] as EpisodeRow[] };
    if (includeEpisodes && !episodes.rows.length) return null;
    const alternatives = await this.database.query<AlternativeRow>(
      `SELECT DISTINCT ON (src.provider_name) src.provider_name, src.provider_slug, src.provider_anime_id
       FROM anime_sources AS src
       WHERE src.anime_id = $1
         AND src.source_status = 'verified'
         AND EXISTS (
           SELECT 1
           FROM episodes AS e
           WHERE e.source_id = src.id
             AND e.visibility = 'published'
             AND e.episode_number > 0
             AND e.provider_episode_id NOT LIKE 'pembatas-%'
             AND COALESCE(e.episode_title, '') NOT ILIKE '%dalam proses%'
         )
       ORDER BY src.provider_name, src.last_success_at DESC NULLS LAST, src.updated_at DESC`,
      [row.anime_id]
    );
    return {
      source,
      slug: row.provider_slug ?? slug,
      title: row.title,
      posterUrl: row.poster_url,
      synopsis: row.synopsis,
      status: row.status ? row.status.charAt(0).toUpperCase() + row.status.slice(1) : null,
      type: null,
      studio: null,
      genres: [],
      episodes: episodes.rows.map((episode) => ({
        id: episode.provider_episode_id,
        title: episode.episode_title ?? episode.provider_episode_id,
        number: Number(episode.episode_number),
        releaseDate: null
      })),
      firstEpisodeId: row.first_episode_id,
      latestEpisodeId: row.latest_episode_id,
      availableSources: alternatives.rows.map((alternative) => ({ source: alternative.provider_name, slug: alternative.provider_slug ?? alternative.provider_anime_id }))
    };
  }

  async upsertDetail(source: SourceId, detail: SourceAnimeDetail): Promise<void> {
    const latestEpisode = detail.episodes.reduce((max, episode) => Math.max(max, episode.number ?? 0), 0);
    await this.upsertSourceHome(source, [{
      source,
      slug: detail.slug,
      detailSlug: detail.slug,
      title: detail.title,
      posterUrl: detail.posterUrl,
      latestEpisode,
      releaseDay: null
    }]);
    const status = detail.status?.toLowerCase();
    const catalogStatus = status === 'ongoing' || status === 'completed' || status === 'upcoming' ? status : 'unknown';
    await this.database.query(
      `UPDATE anime SET synopsis = $2, status = $3, updated_at = NOW() WHERE canonical_slug = $1`,
      [canonicalSlug(detail.title), detail.synopsis, catalogStatus]
    );
    const validEpisodes = detail.episodes.filter((episode) => episode.number !== null && Number.isFinite(episode.number) && episode.number > 0);
    for (const episode of validEpisodes) {
      await this.upsertEpisode(source, detail.slug, episode);
    }
    if (validEpisodes.length > 0) {
      await this.database.query(
        `UPDATE anime_sources
         SET source_status = 'verified', hydration_checked_at = NOW(), last_checked_at = NOW(), last_success_at = NOW(), last_error = NULL, updated_at = NOW()
         WHERE provider_name = $1 AND (provider_slug = $2 OR provider_anime_id = $2)`,
        [source, detail.slug]
      );
    }
  }

  async findEpisode(source: SourceId, episodeId: string): Promise<SourceEpisodeDetail | null> {
    const result = await this.database.query<EpisodeRow>(
      `WITH ordered_episodes AS (
         SELECT e.provider_episode_id, e.episode_title, e.episode_number, s.provider_slug AS anime_slug, a.poster_url,
                LAG(e.provider_episode_id) OVER (PARTITION BY e.anime_id, e.source_id ORDER BY e.episode_number, e.provider_episode_id) AS previous_episode_id,
                LEAD(e.provider_episode_id) OVER (PARTITION BY e.anime_id, e.source_id ORDER BY e.episode_number, e.provider_episode_id) AS next_episode_id
         FROM episodes AS e
         JOIN anime_sources AS s ON s.id = e.source_id
         JOIN anime AS a ON a.id = e.anime_id
         WHERE s.provider_name = $1
           AND e.visibility = 'published'
           AND e.episode_number > 0
           AND e.provider_episode_id NOT LIKE 'pembatas-%'
           AND COALESCE(e.episode_title, '') NOT ILIKE '%dalam proses%'
       )
       SELECT provider_episode_id, episode_title, episode_number, anime_slug, poster_url, previous_episode_id, next_episode_id
       FROM ordered_episodes
       WHERE provider_episode_id = $2
       LIMIT 1`,
      [source, episodeId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      source,
      id: row.provider_episode_id,
      title: row.episode_title ?? row.provider_episode_id,
      animeSlug: row.anime_slug,
      releaseTime: null,
      previousEpisodeId: row.previous_episode_id ?? null,
      nextEpisodeId: row.next_episode_id ?? null,
      playback: []
    };
  }

  async upsertEpisode(source: SourceId, animeSlug: string, episode: { id: string; title: string; number: number | null }): Promise<void> {
    if (episode.number === null || !Number.isFinite(episode.number) || episode.number <= 0) return;
    await this.database.query(
      `WITH target_source AS (
         SELECT a.id AS anime_id, s.id AS source_id
         FROM anime AS a
         JOIN anime_sources AS s ON s.anime_id = a.id
         WHERE s.provider_name = $1 AND (s.provider_slug = $2 OR s.provider_anime_id = $2)
         ORDER BY s.last_success_at DESC NULLS LAST, s.updated_at DESC
         LIMIT 1
       ), removed_duplicate AS (
         DELETE FROM episodes AS existing
         USING target_source
         WHERE existing.source_id = target_source.source_id
           AND existing.episode_number = $4
           AND existing.provider_episode_id <> $3
       )
       INSERT INTO episodes (anime_id, source_id, episode_number, episode_title, provider_episode_id, provider_slug, visibility, published_at)
       SELECT anime_id, source_id, $4, $5, $3, $3, 'published', NOW()
       FROM target_source
       ON CONFLICT (source_id, provider_episode_id) DO UPDATE SET
         episode_number = EXCLUDED.episode_number,
         episode_title = EXCLUDED.episode_title,
         updated_at = NOW()`,
      [source, animeSlug, episode.id, episode.number ?? 0, episode.title]
    );
  }

  async upsertSchedule(source: SourceId, groups: SourceScheduleDay[]): Promise<void> {
    for (const group of groups) {
      for (const item of group.items) {
        await this.upsertSourceHome(source, [{
          source,
          slug: item.slug,
          detailSlug: item.slug,
          title: item.title,
          posterUrl: item.posterUrl,
          latestEpisode: null,
          releaseDay: group.day
        }]);
        await this.database.query(
          `INSERT INTO schedule_entries (anime_id, source_id, day, episode_label)
           SELECT a.id, s.id, $3, $4
           FROM anime AS a
           JOIN anime_sources AS s ON s.anime_id = a.id
           WHERE s.provider_name = $1 AND (s.provider_slug = $2 OR s.provider_anime_id = $2)
           LIMIT 1
           ON CONFLICT (source_id, anime_id, day) DO UPDATE SET episode_label = EXCLUDED.episode_label, updated_at = NOW()`,
          [source, item.slug, group.day, item.episodeLabel]
        );
      }
    }
  }

  async listSchedule(source?: SourceId): Promise<SourceScheduleDay[]> {
    const result = await this.database.query<ScheduleRow>(
      `SELECT se.day, s.provider_name, s.provider_slug, a.title, a.poster_url, se.episode_label
       FROM schedule_entries AS se
       JOIN anime AS a ON a.id = se.anime_id
       JOIN anime_sources AS s ON s.id = se.source_id
       WHERE a.visibility = 'published' AND ($1::text IS NULL OR s.provider_name = $1)
       ORDER BY se.day, a.title`,
      [source ?? null]
    );
    const groups = new Map<string, SourceScheduleDay['items']>();
    for (const row of result.rows) {
      const items = groups.get(row.day) ?? [];
      items.push({ source: row.provider_name, slug: row.provider_slug ?? canonicalSlug(row.title), title: row.title, posterUrl: row.poster_url, episodeLabel: row.episode_label });
      groups.set(row.day, items);
    }
    return [...groups.entries()].map(([day, items]) => ({ day, items }));
  }

  async listHome(limit = 15): Promise<AnimeSummary[]> {
    const result = await this.database.query<HomeRow>(
      `SELECT src.provider_slug, a.canonical_slug, a.title, a.poster_url, a.release_day,
              MAX(e.episode_number) AS latest_episode
       FROM anime AS a
       JOIN anime_sources AS src ON src.anime_id = a.id AND src.provider_name = 'otakudesu' AND src.source_status = 'verified'
       JOIN episodes AS e ON e.source_id = src.id
         AND e.visibility = 'published'
         AND e.episode_number > 0
         AND e.provider_episode_id NOT LIKE 'pembatas-%'
         AND COALESCE(e.episode_title, '') NOT ILIKE '%dalam proses%'
       WHERE a.visibility = 'published'
       GROUP BY src.provider_slug, a.canonical_slug, a.title, a.poster_url, a.release_day, a.featured, a.updated_at
       ORDER BY a.featured DESC, a.updated_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => ({
      slug: row.provider_slug ?? row.canonical_slug,
      title: row.title,
      posterUrl: row.poster_url,
      latestEpisode: row.latest_episode === null ? null : Number(row.latest_episode),
      releaseDay: row.release_day,
      source: 'otakudesu'
    }));
  }
}
