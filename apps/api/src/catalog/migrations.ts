import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

type MigrationClient = {
  query(sql: string, parameters?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};

type MigrationDatabase = {
  connect(): Promise<MigrationClient>;
};

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

export async function runMigrations(database: MigrationDatabase, directory: string): Promise<MigrationResult> {
  const files = (await readdir(directory))
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort((left, right) => left.localeCompare(right));
  const client = await database.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('xing-anime-schema-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const history = await client.query('SELECT name FROM schema_migrations ORDER BY name');
    const completed = new Set(history.rows.map(({ name }) => String(name)));
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const name of files) {
      if (completed.has(name)) {
        result.skipped.push(name);
        continue;
      }
      const sql = await readFile(join(directory, name), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      result.applied.push(name);
    }

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
