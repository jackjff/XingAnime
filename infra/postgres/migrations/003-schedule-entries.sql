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
