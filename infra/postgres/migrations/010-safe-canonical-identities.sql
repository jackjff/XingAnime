-- Title similarity is not an authoritative cross-provider identity. Existing title-derived
-- aliases are retained only for audit/history; future source attachment requires an explicit
-- mapping or an already-known provider identity.
ALTER TABLE anime_identity_aliases
  ADD COLUMN IF NOT EXISTS is_explicit BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE anime_identity_aliases
SET is_explicit = FALSE,
    updated_at = NOW()
WHERE is_explicit;

-- Keep the SQL normalizer aligned with the TypeScript NFKD Latin-diacritic handling.
CREATE OR REPLACE FUNCTION xing_anime_identity(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(
      translate(
        lower(coalesce(value, '')),
        'àáâãäåāăąçćčďèéêëēĕėęěìíîïīĭįłñńňòóôõöøōŏőřśšşťùúûüūŭůűųýÿžźż',
        'aaaaaaaaacccdeeeeeeeeeiiiiiiilnnnooooooooorssstuuuuuuuuyyzzz'
      ),
      '[^a-z0-9]+', '-', 'g'
    ),
    '-?(on-?going)$', ''
  )
$$;

-- A row without provenance cannot be rendered, hydrated, or repaired safely. Its dependent
-- rows are source-owned and cascade; removing it prevents orphan poster work and future alias
-- selection from reviving a phantom canonical record.
DELETE FROM anime AS orphan
WHERE NOT EXISTS (SELECT 1 FROM anime_sources AS source WHERE source.anime_id = orphan.id);
