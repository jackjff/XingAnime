import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const events: string[] = [];
  let finishListen!: () => void;
  let finishSeed!: () => void;
  const listening = new Promise<void>((resolve) => { finishListen = resolve; });
  const seeding = new Promise<void>((resolve) => { finishSeed = resolve; });
  const hooks: Record<string, () => Promise<void>> = {};
  const result = { succeeded: 1, failed: 0, items: 1 };
  return { events, finishListen, finishSeed, listening, seeding, hooks, result };
});

vi.mock('redis', () => ({ createClient: () => ({ on() {}, connect: async () => {}, isOpen: true, quit: async () => { state.events.push('redis-close'); }, set: async () => 'OK', eval: async () => { state.events.push('lease-release'); }, del: async () => {} }) }));
vi.mock('pg', () => ({ Pool: class { query = async () => ({}); end = async () => { state.events.push('db-close'); }; } }));
vi.mock('../src/catalog/migrations.js', () => ({ runMigrations: async () => ({}) }));
vi.mock('../src/catalog/sync-worker.js', () => ({ CatalogSyncWorker: class {
  runSeedAllAnime = async () => { state.events.push('seed'); await state.seeding; return state.result; };
  runOnce = async () => { state.events.push('home'); return state.result; };
  hydrateDiscoveredSources = async (limit: number) => { state.events.push(`hydrate:${limit}`); return state.result; };
  runSchedulesOnce = async () => { state.events.push('schedule'); return state.result; };
  backfillPosters = async () => { state.events.push('posters'); return {}; };
} }));
vi.mock('../src/app.js', () => ({ buildApp: () => ({
  addHook: (name: string, fn: () => Promise<void>) => { state.hooks[name] = fn; },
  listen: async () => { state.events.push('listen'); await state.listening; state.events.push('listened'); },
  close: async () => { state.events.push('http-close'); await state.hooks.onClose(); },
  log: { error: vi.fn(), warn: vi.fn() }
}) }));

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('listens before seeding and drains jobs on termination before closing stores', async () => {
  vi.stubEnv('DATABASE_URL', 'postgres://unused');
  vi.stubEnv('REDIS_URL', 'redis://unused');
  vi.stubEnv('SANKA_HYDRATION_BATCH_SIZE', '7');
  const signals = new Map<string, () => void>();
  vi.spyOn(process, 'once').mockImplementation(((name: string, fn: () => void) => { signals.set(name, fn); return process; }) as typeof process.once);
  const starting = import('../src/server.js');
  await vi.waitFor(() => expect(state.events).toContain('listen'));
  expect(state.events).not.toContain('seed');
  state.finishListen();
  await starting;
  await vi.waitFor(() => expect(state.events).toContain('seed'));
  expect(state.events.indexOf('listened')).toBeLessThan(state.events.indexOf('seed'));
  expect(signals.has('SIGTERM')).toBe(true);
  expect(signals.has('SIGINT')).toBe(true);
  signals.get('SIGTERM')!();
  expect(state.events).not.toContain('db-close');
  state.finishSeed();
  await vi.waitFor(() => expect(state.events).toContain('redis-close'));
  expect(state.events.filter((event) => event === 'seed')).toHaveLength(1);
  expect(state.events).toContain('hydrate:7');
  expect(state.events.indexOf('schedule')).toBeLessThan(state.events.indexOf('db-close'));
  expect(state.events.lastIndexOf('lease-release')).toBeLessThan(state.events.indexOf('db-close'));
  expect(state.events.indexOf('db-close')).toBeLessThan(state.events.indexOf('redis-close'));
});
