import { createClient } from 'redis';
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { MemoryCache } from './cache/memory-cache.js';
import { RedisCache, type RedisCacheClient } from './cache/redis-cache.js';
import { RedisLease, type RedisLeaseClient } from './cache/redis-lease.js';
import { RedisWindowRateLimiter, type RedisScriptClient } from './cache/redis-rate-limiter.js';
import { PostgresCatalogRepository } from './catalog/postgres-repository.js';
import { CatalogSyncWorker } from './catalog/sync-worker.js';
import { AniListPosterClient } from './providers/anilist/client.js';
import { CachedSankaClient } from './providers/sanka/cached-client.js';
import { CachedSourceProvider } from './providers/sanka/cached-source-provider.js';
import { SankaClient } from './providers/sanka/client.js';
import { CompositeRateLimiter, IntervalRateLimiter } from './providers/sanka/rate-limiter.js';
import { SankaSourceProvider } from './providers/sanka/source-provider.js';
import { enrichPosters } from './providers/poster-enricher.js';

const port = Number(process.env.API_PORT ?? 4000);
const baseUrl = process.env.SANKA_BASE_URL ?? 'https://www.sankavollerei.web.id';
const interval = Number(process.env.SANKA_MIN_REQUEST_INTERVAL_MS ?? 3500);
const budget = Number(process.env.SANKA_INTERNAL_BUDGET_PER_MINUTE ?? 18);
const cacheTtl = Number(process.env.SANKA_CACHE_TTL_HOME_SECONDS ?? 600) * 1000;
const syncLeaseTtl = Number(process.env.SANKA_SYNC_LEASE_TTL_SECONDS ?? 300) * 1000;
const redisUrl = process.env.REDIS_URL;
const databaseUrl = process.env.DATABASE_URL;

const redis = redisUrl ? createClient({ url: redisUrl }) : undefined;
if (redis) {
  redis.on('error', (error) => console.error('[redis]', error));
  await redis.connect();
}

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 5 }) : undefined;
if (pool) await pool.query('SELECT 1');
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

const posterClient = new AniListPosterClient();
const upstreamHome = new SankaClient({ baseUrl, limiter });
const enrichedProvider = {
  async getHome() {
    const items = await upstreamHome.getHome();
    return enrichPosters(items, (title) => posterClient.resolve(title));
  }
};
const homeSource = pool
  ? {
      async getHome() {
        const stored = await repository!.listHome();
        return stored.length ? enrichPosters(stored, (title) => posterClient.resolve(title)) : enrichedProvider.getHome();
      }
    }
  : enrichedProvider;
const homeClient = new CachedSankaClient(homeSource, cache, cacheTtl);

const sourceProviders = {
  otakudesu: new CachedSourceProvider(new SankaSourceProvider({ source: 'otakudesu', baseUrl, limiter, posterResolver: (title) => posterClient.resolve(title) }), cache, {}),
  samehadaku: new CachedSourceProvider(new SankaSourceProvider({ source: 'samehadaku', baseUrl, limiter, posterResolver: (title) => posterClient.resolve(title) }), cache, {}),
  oploverz: new CachedSourceProvider(new SankaSourceProvider({ source: 'oploverz', baseUrl, limiter, posterResolver: (title) => posterClient.resolve(title) }), cache, {})
};

let syncTimer: NodeJS.Timeout | undefined;
if (repository) {
  const worker = new CatalogSyncWorker(Object.values(sourceProviders), repository, (title) => posterClient.resolve(title));
  const syncLease = redis ? new RedisLease(redis as unknown as RedisLeaseClient, 'xing:sanka:sync-lease', syncLeaseTtl) : undefined;
  let activeSync: Promise<void> | undefined;
  const runSync = async () => {
    if (activeSync) return activeSync;
    const leaseToken = syncLease ? await syncLease.acquire() : null;
    if (syncLease && !leaseToken) {
      console.log('[catalog-sync] skipped: another worker owns the lease');
      return;
    }
    activeSync = worker.runOnce()
      .then(async (result) => {
        console.log('[catalog-sync]', result);
        const scheduleResult = await worker.runSchedulesOnce();
        console.log('[schedule-sync]', scheduleResult);
        if (result.succeeded > 0 || scheduleResult.succeeded > 0) {
          await cache.delete('sanka:home');
          await Promise.all(Object.keys(sourceProviders).flatMap((source) => [
            cache.delete(`sanka:${source}:home`),
            cache.delete(`sanka:${source}:schedule`)
          ]));
        }
      })
      .finally(async () => {
        await syncLease?.release(leaseToken);
        activeSync = undefined;
      });
    return activeSync;
  };
  void runSync().catch((error) => console.error('[catalog-sync]', error));
  const syncInterval = Number(process.env.SANKA_SYNC_INTERVAL_SECONDS ?? 1800) * 1000;
  syncTimer = setInterval(() => void runSync().catch((error) => console.error('[catalog-sync]', error)), syncInterval);
  syncTimer.unref();
}

const app = buildApp({ homeClient, sourceProviders, catalogRepository: repository, posterResolver: (title) => posterClient.resolve(title) });
app.addHook('onClose', async () => {
  if (syncTimer) clearInterval(syncTimer);
  await pool?.end();
  if (redis?.isOpen) await redis.quit();
});

try {
  await app.listen({ host: '0.0.0.0', port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
