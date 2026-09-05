-- Repair historical provider identities and enforce canonical source/episode invariants.

ALTER TABLE anime
  ADD COLUMN IF NOT EXISTS poster_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (poster_status IN ('pending', 'resolved', 'unresolved')),
  ADD COLUMN IF NOT EXISTS poster_checked_at TIMESTAMPTZ;

UPDATE anime
SET poster_status = CASE WHEN poster_url IS NULL THEN 'pending' ELSE 'resolved' END
WHERE poster_checked_at IS NULL;

-- Older Oploverz normalization truncated decimal episodes such as 1015.5 to 1015.
UPDATE episodes AS episode
SET episode_number = substring(episode.episode_title from '(?i)episode[[:space:]]+([0-9]+(?:[.][0-9]+)?)')::numeric,
    updated_at = NOW()
FROM anime_sources AS source
WHERE source.id = episode.source_id
  AND source.provider_name = 'oploverz'
  AND episode.episode_title ~* 'episode[[:space:]]+[0-9]+([.][0-9]+)?';

-- Placeholder and non-positive episodes are never playable catalog data.
DELETE FROM episodes
WHERE episode_number <= 0
   OR provider_episode_id LIKE 'pembatas-%'
   OR COALESCE(episode_title, '') ILIKE '%dalam proses%';

-- One anime may have only one source identity per provider. Move dependent rows to
-- the most recently successful source before removing historical duplicates.
CREATE TEMP TABLE xing_source_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT id AS source_id,
         FIRST_VALUE(id) OVER (
           PARTITION BY anime_id, provider_name
           ORDER BY last_success_at DESC NULLS LAST, updated_at DESC, id DESC
         ) AS keeper_id,
         ROW_NUMBER() OVER (
           PARTITION BY anime_id, provider_name
           ORDER BY last_success_at DESC NULLS LAST, updated_at DESC, id DESC
         ) AS source_rank
  FROM anime_sources
)
SELECT source_id AS duplicate_id, keeper_id
FROM ranked
WHERE source_rank > 1;

DELETE FROM episodes AS duplicate_episode
USING xing_source_merge AS merge
WHERE duplicate_episode.source_id = merge.duplicate_id
  AND EXISTS (
    SELECT 1
    FROM episodes AS keeper_episode
    WHERE keeper_episode.source_id = merge.keeper_id
      AND (
        keeper_episode.provider_episode_id = duplicate_episode.provider_episode_id
        OR keeper_episode.episode_number = duplicate_episode.episode_number
      )
  );

UPDATE episodes AS episode
SET source_id = merge.keeper_id,
    updated_at = NOW()
FROM xing_source_merge AS merge
WHERE episode.source_id = merge.duplicate_id;

DELETE FROM schedule_entries AS duplicate_schedule
USING xing_source_merge AS merge
WHERE duplicate_schedule.source_id = merge.duplicate_id
  AND EXISTS (
    SELECT 1
    FROM schedule_entries AS keeper_schedule
    WHERE keeper_schedule.source_id = merge.keeper_id
      AND keeper_schedule.anime_id = duplicate_schedule.anime_id
      AND keeper_schedule.day = duplicate_schedule.day
  );

UPDATE schedule_entries AS schedule
SET source_id = merge.keeper_id,
    updated_at = NOW()
FROM xing_source_merge AS merge
WHERE schedule.source_id = merge.duplicate_id;

DELETE FROM anime_sources AS source
USING xing_source_merge AS merge
WHERE source.id = merge.duplicate_id;

-- Keep the newest row when historical imports contain duplicate episode numbers
-- for the same source. The unique index below must be safe on existing data.
DELETE FROM episodes AS duplicate_episode
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY source_id, episode_number
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS episode_rank
  FROM episodes
) AS ranked_episode
WHERE duplicate_episode.id = ranked_episode.id
  AND ranked_episode.episode_rank > 1;

-- The documented detail slug is the stable provider anime identity. Episode slugs
-- remain episode identities and must never create additional anime source rows.
UPDATE anime_sources
SET provider_anime_id = provider_slug,
    updated_at = NOW()
WHERE provider_slug IS NOT NULL
  AND provider_anime_id IS DISTINCT FROM provider_slug;

CREATE UNIQUE INDEX IF NOT EXISTS uq_anime_sources_anime_provider
  ON anime_sources (anime_id, provider_name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_episodes_source_number
  ON episodes (source_id, episode_number);
