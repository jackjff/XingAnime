import { createClient } from 'redis';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { MemoryCache } from './cache/memory-cache.js';
import { RedisCache, type RedisCacheClient } from './cache/redis-cache.js';
import { RedisLease, type RedisLeaseClient } from './cache/redis-lease.js';
import { RedisWindowRateLimiter, type RedisScriptClient } from './cache/redis-rate-limiter.js';
import { PostgresCatalogRepository } from './catalog/postgres-repository.js';
import { CatalogSyncWorker } from './catalog/sync-worker.js';
import { BackgroundScheduler, runMetadataCycle } from './catalog/background-scheduler.js';
import { runMigrations } from './catalog/migrations.js';
import { AniListPosterClient } from './providers/anilist/client.js';
import { CachedSourceProvider } from './providers/sanka/cached-source-provider.js';
import { CompositeRateLimiter, IntervalRateLimiter } from './providers/sanka/rate-limiter.js';
import { SankaCircuitBreaker } from './providers/sanka/response.js';
import { SankaSourceProvider } from './providers/sanka/source-provider.js';

const port = Number(process.env.API_PORT ?? 4000);
const baseUrl = process.env.SANKA_BASE_URL ?? 'https://www.sankavollerei.web.id';
const interval = Number(process.env.SANKA_MIN_REQUEST_INTERVAL_MS ?? 3500);
const budget = Number(process.env.SANKA_INTERNAL_BUDGET_PER_MINUTE ?? 18);
const syncLeaseTtl = Number(process.env.SANKA_SYNC_LEASE_TTL_SECONDS ?? 300) * 1000;
const posterBackfillBatchSize = Number(process.env.POSTER_BACKFILL_BATCH_SIZE ?? 48);
const posterBackfillInterval = Number(process.env.POSTER_BACKFILL_INTERVAL_SECONDS ?? 60) * 1000;
const posterBackfillLeaseTtl = Number(process.env.POSTER_BACKFILL_LEASE_TTL_SECONDS ?? 900) * 1000;
const hydrationBatchSize = Number(process.env.SANKA_HYDRATION_BATCH_SIZE ?? 12);
const redisUrl = process.env.REDIS_URL;
const databaseUrl = process.env.DATABASE_URL;
const migrationsDirectory = process.env.DATABASE_MIGRATIONS_DIR ?? resolve(process.cwd(), '../../infra/postgres/migrations');

const redis = redisUrl ? createClient({ url: redisUrl }) : undefined;
if (redis) {
  redis.on('error', (error) => console.error('[redis]', error));
  await redis.connect();
}

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5 }) : undefined;
if (pool) {
  await pool.query('SELECT 1');
  const migrationResult = await runMigrations(pool, migrationsDirectory);
  console.log('[database-migrations]', migrationResult);
}
const repository = pool ? new PostgresCatalogRepository(pool) : undefined;

const cache = redis
  ? new RedisCache(redis as unknown as RedisCacheClient)
  : new MemoryCache();
const intervalLimiter = new IntervalRateLimiter(interval);
const limiter = redis
  ? new CompositeRateLimiter(
      new RedisWindowRateLimiter(redis as unknown as RedisScriptClient, budget, 60_000, 'xing:sanka:budget'),
      intervalLimiter
    )
  : intervalLimiter;
const sankaCircuit = new SankaCircuitBreaker();

const posterClient = new AniListPosterClient();

const sourceProviders = {
  otakudesu: new CachedSourceProvider(new SankaSourceProvider({ source: 'otakudesu', baseUrl, limiter, circuit: sankaCircuit, posterResolver: (title) => posterClient.resolve(title) }), cache, {}),
  samehadaku: new CachedSourceProvider(new SankaSourceProvider({ source: 'samehadaku', baseUrl, limiter, circuit: sankaCircuit, posterResolver: (title) => posterClient.resolve(title) }), cache, {}),
  oploverz: new CachedSourceProvider(new SankaSourceProvider({ source: 'oploverz', baseUrl, limiter, circuit: sankaCircuit, posterResolver: (title) => posterClient.resolve(title) }), cache, {})
};

let scheduler: BackgroundScheduler | undefined;
if (repository) {
  const worker = new CatalogSyncWorker(Object.values(sourceProviders), repository, (title) => posterClient.resolve(title));
  const syncLease = redis ? new RedisLease(redis as unknown as RedisLeaseClient, 'xing:sanka:sync-lease', syncLeaseTtl) : undefined;
  const posterLease = redis ? new RedisLease(redis as unknown as RedisLeaseClient, 'xing:poster:backfill-lease', posterBackfillLeaseTtl) : undefined;
  const syncInterval = Number(process.env.SANKA_SYNC_INTERVAL_SECONDS ?? 1800) * 1000;
  const seedInterval = Number(process.env.SANKA_SEED_INTERVAL_SECONDS ?? 3600) * 1000;
  let seedDue = true;
  const logged = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    const result = await operation();
    console.log(`[${name}]`, result);
    return result;
  };
  scheduler = new BackgroundScheduler([
    {
      name: 'catalog-sync',
      lease: syncLease,
      intervals: [
        { milliseconds: syncInterval },
        // A seed tick during an active cycle stays due for the next cycle.
        { milliseconds: seedInterval, beforeRun: () => { seedDue = true; } }
      ],
      run: async () => {
        const shouldSeed = seedDue;
        seedDue = false;
        await runMetadataCycle({
          seed: shouldSeed ? () => logged('seed-all-anime', () => worker.runSeedAllAnime()) : undefined,
          home: () => logged('catalog-sync', () => worker.runOnce()),
          hydrate: () => logged('detail-hydration', () => worker.hydrateDiscoveredSources(hydrationBatchSize)),
          deadLinks: worker.recheckDeadLinks
            ? () => logged('dead-link-recheck', () => worker.recheckDeadLinks(5))
            : undefined,
          schedule: () => logged('schedule-sync', () => worker.runSchedulesOnce()),
          invalidate: async () => {
            await cache.delete('sanka:home');
            await Promise.all(Object.keys(sourceProviders).flatMap((source) => [
              cache.delete(`sanka:${source}:home`),
              cache.delete(`sanka:${source}:schedule`)
            ]));
          }
        });
      }
    },
    {
      name: 'poster-backfill',
      lease: posterLease,
      intervals: [{ milliseconds: posterBackfillInterval }],
      run: async () => { await logged('poster-backfill', () => worker.backfillPosters(posterBackfillBatchSize)); }
    }
  ], (name, error) => console.error(`[${name}]`, error));
}

const app = buildApp({ sourceProviders, catalogRepository: repository });
let closing: Promise<void> | undefined;
const shutdown = () => {
  closing ??= app.close().catch((error) => {
    app.log.error(error);
    process.exitCode = 1;
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
app.addHook('onClose', async () => {
  process.removeListener('SIGINT', shutdown);
  process.removeListener('SIGTERM', shutdown);
  await scheduler?.stop();
  await pool?.end();
  if (redis?.isOpen) await redis.quit();
});

try {
  await app.listen({ host: '0.0.0.0', port });
  scheduler?.start();
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
