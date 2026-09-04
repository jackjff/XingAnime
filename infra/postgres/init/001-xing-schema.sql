CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS anime (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_original TEXT,
  title_alternative TEXT,
  synopsis TEXT,
  poster_url TEXT,
  banner_url TEXT,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('ongoing', 'completed', 'upcoming', 'unknown')),
  release_day TEXT,
  release_year INTEGER,
  visibility TEXT NOT NULL DEFAULT 'draft' CHECK (visibility IN ('draft', 'published', 'hidden')),
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS genres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS anime_genres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id UUID NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  genre_id UUID NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  UNIQUE (anime_id, genre_id)
);

CREATE TABLE IF NOT EXISTS anime_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id UUID NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  provider_anime_id TEXT NOT NULL,
  provider_slug TEXT,
  source_url TEXT,
  source_status TEXT NOT NULL DEFAULT 'unknown' CHECK (source_status IN ('unknown', 'verified', 'restricted', 'disabled')),
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_name, provider_anime_id)
);

CREATE TABLE IF NOT EXISTS schedule_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id UUID NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES anime_sources(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  episode_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, anime_id, day)
);

CREATE INDEX IF NOT EXISTS idx_schedule_entries_day ON schedule_entries (day, updated_at DESC);

CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id UUID NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES anime_sources(id) ON DELETE CASCADE,
  episode_number NUMERIC(6, 2) NOT NULL,
  episode_title TEXT,
  provider_episode_id TEXT NOT NULL,
  provider_slug TEXT,
  episode_url TEXT,
  visibility TEXT NOT NULL DEFAULT 'published' CHECK (visibility IN ('draft', 'published', 'hidden')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, provider_episode_id)
);

CREATE TABLE IF NOT EXISTS playback_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  playback_type TEXT NOT NULL CHECK (playback_type IN ('embed', 'hls', 'redirect', 'unknown')),
  playback_url TEXT NOT NULL,
  quality TEXT,
  language TEXT,
  subtitle_language TEXT,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  requests_used INTEGER NOT NULL DEFAULT 0,
  records_found INTEGER NOT NULL DEFAULT 0,
  records_created INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'failed')),
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS provider_health (
  provider_name TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'degraded', 'paused', 'disabled')),
  requests_last_minute INTEGER NOT NULL DEFAULT 0,
  last_http_status INTEGER,
  last_success_at TIMESTAMPTZ,
  last_403_at TIMESTAMPTZ,
  last_429_at TIMESTAMPTZ,
  circuit_state TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed', 'open', 'half_open')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anime_visibility_updated ON anime (visibility, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_anime_featured ON anime (featured) WHERE featured = TRUE;
CREATE INDEX IF NOT EXISTS idx_anime_sources_anime ON anime_sources (anime_id);
CREATE INDEX IF NOT EXISTS idx_episodes_anime_number ON episodes (anime_id, episode_number);
CREATE INDEX IF NOT EXISTS idx_playback_episode_active ON playback_sources (episode_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sync_runs_provider_started ON sync_runs (provider_name, started_at DESC);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_anime_title_trgm ON anime USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_anime_canonical_slug_trgm ON anime USING gin (canonical_slug gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_anime_sources_provider_slug_trgm ON anime_sources USING gin (provider_slug gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_episodes_search_trgm ON episodes USING gin ((provider_episode_id || ' ' || COALESCE(episode_title, '')) gin_trgm_ops);
