-- Consolidate only title variants that differ by the provider's trailing ongoing marker.
-- This deliberately does not perform fuzzy matching, so sequels, films, and similarly
-- named anime remain separate until an explicit identity signal is available.
CREATE OR REPLACE FUNCTION xing_anime_identity(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g'),
    '-?(on-?going)$',
    ''
  )
$$;

CREATE TEMP TABLE xing_anime_identity_merge ON COMMIT DROP AS
WITH ranked AS (
  SELECT a.id AS duplicate_id,
         FIRST_VALUE(a.id) OVER (
           PARTITION BY xing_anime_identity(a.title)
           ORDER BY (a.title !~* '(\s|-)on-?going$') DESC,
                    (a.poster_url IS NOT NULL) DESC,
                    a.updated_at DESC,
                    a.id ASC
         ) AS keeper_id,
         ROW_NUMBER() OVER (
           PARTITION BY xing_anime_identity(a.title)
           ORDER BY (a.title !~* '(\s|-)on-?going$') DESC,
                    (a.poster_url IS NOT NULL) DESC,
                    a.updated_at DESC,
                    a.id ASC
         ) AS identity_rank
  FROM anime AS a
  WHERE xing_anime_identity(a.title) <> ''
)
SELECT duplicate_id, keeper_id
FROM ranked
WHERE identity_rank > 1;

-- A provider may have been imported into both historical rows. Keep the newer source
-- identity and its episodes before moving the remaining sources to the canonical anime.
DELETE FROM episodes AS duplicate_episode
USING xing_anime_identity_merge AS merge, anime_sources AS duplicate_source
WHERE duplicate_source.anime_id = merge.duplicate_id
  AND duplicate_episode.source_id = duplicate_source.id
  AND EXISTS (
    SELECT 1 FROM episodes AS keeper_episode
    JOIN anime_sources AS keeper_source ON keeper_source.id = keeper_episode.source_id
    WHERE keeper_episode.source_id = keeper_source.id
      AND keeper_source.anime_id = merge.keeper_id
      AND keeper_source.provider_name = duplicate_source.provider_name
      AND keeper_episode.episode_number = duplicate_episode.episode_number
  );

DELETE FROM schedule_entries AS duplicate_schedule
USING xing_anime_identity_merge AS merge, anime_sources AS duplicate_source
WHERE duplicate_source.anime_id = merge.duplicate_id
  AND duplicate_schedule.source_id = duplicate_source.id
  AND EXISTS (
    SELECT 1 FROM anime_sources AS keeper_source
    WHERE keeper_source.anime_id = merge.keeper_id
      AND keeper_source.provider_name = duplicate_source.provider_name
  );

DELETE FROM anime_sources AS duplicate_source
USING xing_anime_identity_merge AS merge
WHERE duplicate_source.anime_id = merge.duplicate_id
  AND EXISTS (
    SELECT 1 FROM anime_sources AS keeper_source
    WHERE keeper_source.anime_id = merge.keeper_id
      AND keeper_source.provider_name = duplicate_source.provider_name
  );

UPDATE anime_sources AS source
SET anime_id = merge.keeper_id,
    updated_at = NOW()
FROM xing_anime_identity_merge AS merge
WHERE source.anime_id = merge.duplicate_id;

UPDATE episodes AS episode
SET anime_id = merge.keeper_id,
    updated_at = NOW()
FROM xing_anime_identity_merge AS merge
WHERE episode.anime_id = merge.duplicate_id;

UPDATE schedule_entries AS schedule
SET anime_id = merge.keeper_id,
    updated_at = NOW()
FROM xing_anime_identity_merge AS merge
WHERE schedule.anime_id = merge.duplicate_id;

UPDATE anime AS keeper
SET canonical_slug = xing_anime_identity(keeper.title),
    title = regexp_replace(keeper.title, '(?i)(\s|-)on-?going$', ''),
    updated_at = NOW()
WHERE keeper.id IN (SELECT DISTINCT keeper_id FROM xing_anime_identity_merge);

DELETE FROM anime AS duplicate
USING xing_anime_identity_merge AS merge
WHERE duplicate.id = merge.duplicate_id;
