-- Existing local volume migration: make the M2M collection manageable by Directus.
ALTER TABLE anime_genres ADD COLUMN IF NOT EXISTS id UUID;
UPDATE anime_genres SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE anime_genres ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE anime_genres ALTER COLUMN id SET NOT NULL;
DO $$
DECLARE
  existing_primary_key TEXT;
BEGIN
  SELECT conname INTO existing_primary_key
  FROM pg_constraint
  WHERE conrelid = 'anime_genres'::regclass AND contype = 'p';

  IF existing_primary_key IS NOT NULL THEN
    EXECUTE format('ALTER TABLE anime_genres DROP CONSTRAINT %I', existing_primary_key);
  END IF;

  ALTER TABLE anime_genres ADD PRIMARY KEY (id);
END $$;
