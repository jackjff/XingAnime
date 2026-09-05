import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../src/catalog/migrations.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('runMigrations', () => {
  it('applies pending SQL migrations in one locked transaction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xing-migrations-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, '002-second.sql'), 'SELECT 2;');
    await writeFile(join(directory, '001-first.sql'), 'SELECT 1;');

    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('SELECT name FROM schema_migrations')) return { rows: [{ name: '001-first.sql' }] };
      return { rows: [], parameters };
    });
    const release = vi.fn();
    const database = { connect: vi.fn(async () => ({ query, release })) };

    const result = await runMigrations(database, directory);

    expect(result).toEqual({ applied: ['002-second.sql'], skipped: ['001-first.sql'] });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([
      'BEGIN',
      expect.stringContaining('pg_advisory_xact_lock'),
      'SELECT 2;',
      'COMMIT'
    ]));
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO schema_migrations'), ['002-second.sql']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the connection when a migration fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'xing-migrations-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, '001-broken.sql'), 'BROKEN;');

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT name FROM schema_migrations')) return { rows: [] };
      if (sql === 'BROKEN;') throw new Error('migration failed');
      return { rows: [] };
    });
    const release = vi.fn();
    const database = { connect: vi.fn(async () => ({ query, release })) };

    await expect(runMigrations(database, directory)).rejects.toThrow('migration failed');

    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('deduplicates historical episode numbers before adding the unique index', async () => {
    const migration = await readFile(join(process.cwd(), '../../infra/postgres/migrations/005-canonical-data-quality.sql'), 'utf8');
    const dedupePosition = migration.indexOf('PARTITION BY source_id, episode_number');
    const indexPosition = migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_episodes_source_number');

    expect(dedupePosition).toBeGreaterThan(-1);
    expect(indexPosition).toBeGreaterThan(dedupePosition);
  });
});
