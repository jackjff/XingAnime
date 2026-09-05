-- Track detail hydration independently from home discovery freshness.
ALTER TABLE anime_sources
  ADD COLUMN IF NOT EXISTS hydration_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_anime_sources_hydration_queue
  ON anime_sources (source_status, hydration_checked_at, updated_at);
