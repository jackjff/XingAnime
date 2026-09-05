-- Align historical source status with the canonical hydration state machine.
ALTER TABLE anime_sources
  DROP CONSTRAINT IF EXISTS anime_sources_source_status_check;

ALTER TABLE anime_sources
  ADD CONSTRAINT anime_sources_source_status_check
  CHECK (source_status IN ('unknown', 'discovered', 'verified', 'restricted', 'disabled'));

UPDATE anime_sources AS source
SET source_status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM episodes AS episode
        WHERE episode.source_id = source.id
          AND episode.visibility = 'published'
          AND episode.episode_number > 0
          AND episode.provider_episode_id NOT LIKE 'pembatas-%'
          AND COALESCE(episode.episode_title, '') NOT ILIKE '%dalam proses%'
      ) THEN 'verified'
      ELSE 'discovered'
    END,
    updated_at = NOW()
WHERE source.source_status <> 'disabled';
