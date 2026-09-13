-- Canonical identity is explicit and stable. Provider slugs stay on anime_sources;
-- this table records the title identity used only when a provider source is first seen.
CREATE TABLE IF NOT EXISTS anime_identity_aliases (
  identity_key TEXT PRIMARY KEY,
  anime_id UUID NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anime_identity_aliases_anime
  ON anime_identity_aliases (anime_id);

-- Backfill aliases from canonical source-backed records only. Orphan rows must never
-- win identity resolution during a future provider sync.
INSERT INTO anime_identity_aliases (identity_key, anime_id)
SELECT DISTINCT ON (xing_anime_identity(anime.title))
       xing_anime_identity(anime.title), anime.id
FROM anime
WHERE xing_anime_identity(anime.title) <> ''
  AND EXISTS (SELECT 1 FROM anime_sources AS source WHERE source.anime_id = anime.id)
ORDER BY xing_anime_identity(anime.title),
         (anime.poster_url IS NOT NULL) DESC,
         anime.updated_at DESC,
         anime.id
ON CONFLICT (identity_key) DO UPDATE
SET anime_id = EXCLUDED.anime_id,
    updated_at = NOW();

-- Remove historical orphan duplicates only when a source-backed record has the exact
-- same title. This is deterministic cleanup, not title-fuzzy merging.
DELETE FROM anime AS orphan
WHERE NOT EXISTS (SELECT 1 FROM anime_sources AS source WHERE source.anime_id = orphan.id)
  AND EXISTS (
    SELECT 1
    FROM anime AS canonical
    WHERE canonical.id <> orphan.id
      AND lower(canonical.title) = lower(orphan.title)
      AND EXISTS (SELECT 1 FROM anime_sources AS source WHERE source.anime_id = canonical.id)
  );
