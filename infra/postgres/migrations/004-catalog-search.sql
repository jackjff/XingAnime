-- Search indexes for catalog and episode queries.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_anime_title_trgm
  ON anime USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_anime_canonical_slug_trgm
  ON anime USING gin (canonical_slug gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_anime_sources_provider_slug_trgm
  ON anime_sources USING gin (provider_slug gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_episodes_search_trgm
  ON episodes USING gin ((provider_episode_id || ' ' || COALESCE(episode_title, '')) gin_trgm_ops);
