import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AnimeSummary } from './providers/sanka/mapper.js';
import type { HomeResult } from './providers/sanka/cached-client.js';
import type { AnimeSourceProvider, CatalogQuery, EpisodeQuery, PageResult, SourceAnimeDetail, SourceAnimeSummary, SourceEpisodeDetail, SourceEpisodeSummary, SourceId, SourceScheduleDay } from './providers/source-types.js';
import { isDefinitiveDeadLink } from './providers/sanka/response.js';


type HomeClient = {
  getHome(): Promise<AnimeSummary[]>;
  getHomeWithMeta?(): Promise<HomeResult>;
};

type CatalogRepository = {
  listCatalog?(options: CatalogQuery): Promise<PageResult<SourceAnimeSummary>>;
  listEpisodes?(source: SourceId, slug: string, options: EpisodeQuery): Promise<PageResult<SourceEpisodeSummary>>;
  listSourceHome?(source: SourceId, limit?: number): Promise<unknown[]>;
  findDetail?(source: SourceId, slug: string, options?: { includeEpisodes?: boolean }): Promise<SourceAnimeDetail | null>;
  upsertDetail?(source: SourceId, detail: SourceAnimeDetail): Promise<void>;
  findEpisode?(source: SourceId, episodeId: string): Promise<SourceEpisodeDetail | null>;
  upsertEpisode?(source: SourceId, animeSlug: string, episode: { id: string; title: string; number: number | null }): Promise<void>;
  listSchedule?(source?: SourceId): Promise<SourceScheduleDay[]>;
  upsertSchedule?(source: SourceId, schedule: SourceScheduleDay[]): Promise<void>;
  markSourceUnavailable?(source: SourceId, slug: string, errorMessage: string): Promise<void>;
};

type AppDependencies = {
  homeClient?: HomeClient;
  sourceProviders?: Partial<Record<SourceId, AnimeSourceProvider>>;
  catalogRepository?: CatalogRepository;
  posterResolver?: (title: string) => Promise<string | null>;
};

const prioritizedSources: Array<{ id: SourceId; label: string }> = [
  { id: 'otakudesu', label: 'Otakudesu' },
  { id: 'samehadaku', label: 'Samehadaku' },
  { id: 'oploverz', label: 'Oploverz' }
];

function sourceId(value: string): SourceId | null {
  return prioritizedSources.some((item) => item.id === value) ? value as SourceId : null;
}

function positiveQueryNumber(value: unknown, fallback: number, maximum: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, parsed);
}

function catalogQuery(requestQuery: unknown): CatalogQuery {
  const query = requestQuery as { q?: string; letter?: string; source?: string; page?: string; limit?: string };
  return {
    query: query.q?.trim() || undefined,
    letter: query.letter?.trim().toUpperCase() || undefined,
    source: query.source ? sourceId(query.source) ?? undefined : undefined,
    page: positiveQueryNumber(query.page, 1, 10_000),
    limit: positiveQueryNumber(query.limit, 24, 100)
  };
}

function catalogQueryError(requestQuery: unknown): { code: string; message: string } | null {
  const query = requestQuery as Record<string, unknown>;
  for (const key of ['q', 'letter', 'source', 'page', 'limit']) {
    if (query[key] !== undefined && typeof query[key] !== 'string') {
      return { code: 'INVALID_QUERY', message: 'Parameter katalog tidak boleh berulang' };
    }
  }
  for (const key of ['page', 'limit']) {
    const value = query[key];
    if (typeof value === 'string' && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
      return { code: 'INVALID_QUERY', message: 'Halaman dan limit harus bilangan bulat positif' };
    }
  }
  if (typeof query.q === 'string' && query.q.trim().length > 200) {
    return { code: 'INVALID_QUERY', message: 'Pencarian maksimal 200 karakter' };
  }
  if (typeof query.letter === 'string' && query.letter.trim() && !/^[A-Z]$/i.test(query.letter.trim())) {
    return { code: 'INVALID_LETTER', message: 'Filter huruf harus A-Z' };
  }
  if (typeof query.source === 'string' && !sourceId(query.source)) {
    return { code: 'INVALID_SOURCE', message: 'Sumber tidak dikenal' };
  }
  return null;
}

function episodeQuery(requestQuery: unknown): EpisodeQuery {
  const query = requestQuery as { q?: string; page?: string; limit?: string };
  return {
    query: query.q?.trim() || undefined,
    page: positiveQueryNumber(query.page, 1, 10_000),
    limit: positiveQueryNumber(query.limit, 50, 100)
  };
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: true });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/v1/home', async (_request, reply) => {
    try {
      const configuredSources = prioritizedSources.filter(({ id }) => dependencies.sourceProviders?.[id]);
      const storedCatalog = await dependencies.catalogRepository?.listCatalog?.({ page: 1, limit: 15 });
      if (storedCatalog?.items.length) {
        return {
          success: true,
          data: storedCatalog.items,
          meta: {
            cached: true,
            partial: false,
            storage: 'postgres',
            providers: Object.fromEntries(configuredSources.map(({ id }) => [id, 'healthy']))
          },
          error: null
        };
      }
      if (configuredSources.length > 0) {
        const results = await Promise.allSettled(configuredSources.map(async ({ id }) => {
          const stored = await dependencies.catalogRepository?.listSourceHome?.(id, 15);
          if (stored?.length) {
            return { source: id, data: stored as SourceAnimeSummary[], storage: 'postgres' as const };
          }
          return { source: id, data: await dependencies.sourceProviders?.[id]?.getHome() ?? [], storage: 'provider-fallback' as const };
        }));
        const providers = Object.fromEntries(results.map((result, index) => [
          configuredSources[index].id,
          result.status === 'fulfilled' ? 'healthy' : 'unavailable'
        ]));
        const successful = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
        if (successful.length === 0) throw new Error('All configured sources failed');
        return {
          success: true,
          data: successful.flatMap((result) => result.data),
          meta: {
            cached: successful.every((result) => result.storage === 'postgres'),
            partial: successful.length !== results.length,
            providers
          },
          error: null
        };
      }

      if (!dependencies.homeClient) throw new Error('Home backend unavailable');
      const result = dependencies.homeClient.getHomeWithMeta
        ? await dependencies.homeClient.getHomeWithMeta()
        : { items: await dependencies.homeClient.getHome(), cached: false };
      return {
        success: true,
        data: result.items,
        meta: { cached: result.cached },
        error: null
      };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({
        success: false,
        data: null,
        meta: { cached: false, partial: false, providers: {} },
        error: {
          code: 'UPSTREAM_TEMPORARILY_UNAVAILABLE',
          message: 'Provider sedang tidak tersedia'
        }
      });
    }
  });

  for (const path of ['/api/v1/catalog', '/api/v1/catalog/search']) {
    app.get(path, async (request, reply) => {
    const validationError = catalogQueryError(request.query);
    if (validationError) return reply.code(400).send({ success: false, data: null, meta: {}, error: validationError });
    const query = catalogQuery(request.query);
    if (path.endsWith('/search') && !query.query) return reply.code(400).send({ success: false, data: null, meta: {}, error: { code: 'MISSING_QUERY', message: 'Parameter q wajib diisi' } });
    try {
      if (!dependencies.catalogRepository?.listCatalog) throw new Error('Catalog repository unavailable');
      const result = await dependencies.catalogRepository.listCatalog(query);
      return { success: true, data: result.items, meta: { ...result, items: undefined, storage: 'postgres' }, error: null };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ success: false, data: null, meta: {}, error: { code: 'CATALOG_UNAVAILABLE', message: 'Katalog sedang tidak tersedia' } });
    }
  });

  }

  app.get('/api/v1/sources', async () => ({
    success: true,
    data: prioritizedSources,
    error: null
  }));

  app.get('/api/v1/sources/:source/home', async (request, reply) => {
    const { source } = request.params as { source: string };
    const id = sourceId(source);
    const provider = id ? dependencies.sourceProviders?.[id] : undefined;
    if (!id || !provider) return reply.code(404).send({ success: false, data: null, error: { code: 'SOURCE_NOT_FOUND', message: 'Sumber tidak ditemukan' } });
    try {
      const stored = await dependencies.catalogRepository?.listSourceHome?.(id);
      const data = stored?.length ? stored : await provider.getHome();
      return { success: true, data, meta: { source: id, storage: stored?.length ? 'postgres' : 'provider-fallback' }, error: null };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ success: false, data: null, meta: { source: id }, error: { code: 'SOURCE_UNAVAILABLE', message: 'Sumber sedang tidak tersedia' } });
    }
  });

  app.get('/api/v1/sources/:source/anime/:slug', async (request, reply) => {
    const { source, slug } = request.params as { source: string; slug: string };
    const id = sourceId(source);
    const provider = id ? dependencies.sourceProviders?.[id] : undefined;
    if (!id || !provider) return reply.code(404).send({ success: false, data: null, error: { code: 'SOURCE_NOT_FOUND', message: 'Sumber tidak ditemukan' } });
    try {
      const stored = await dependencies.catalogRepository?.findDetail?.(id, slug, { includeEpisodes: (request.query as { includeEpisodes?: string } | undefined)?.includeEpisodes !== 'false' });
      // A seeded row without episodes is not hydrated yet: resolve it from the provider on demand so the
      // user's first detail visit fills episodes instead of waiting for the bounded background cycle.
      if (stored && stored.firstEpisodeId) {
        return { success: true, data: stored, meta: { source: id, storage: 'postgres', playback: 'on-demand' }, error: null };
      }
      if (stored && stored.episodes.length > 0) {
        return { success: true, data: stored, meta: { source: id, storage: 'postgres', playback: 'on-demand' }, error: null };
      }
      let data;
      try {
        data = await provider.getDetail(slug);
      } catch (cause) {
        // Keep serving the stale stored row when on-demand hydration fails (rate limit, 5xx, circuit open).
        app.log.warn(cause);
        // A definitive 404 hides the unhydrated title so other users stop reaching a dead page.
        if (isDefinitiveDeadLink(cause)) {
          await dependencies.catalogRepository?.markSourceUnavailable?.(id, slug, cause instanceof Error ? cause.message : String(cause));
          if (stored && stored.episodes.length === 0) {
            return reply.code(404).send({
              success: false,
              data: null,
              meta: { source: id },
              error: { code: 'SOURCE_NOT_FOUND', message: 'Anime tidak ditemukan di sumber' }
            });
          }
        }
        if (stored) return { success: true, data: stored, meta: { source: id, storage: 'postgres', playback: 'on-demand' }, error: null };
        throw cause;
      }
      const persisted = { ...data, availableSources: data.availableSources ?? [{ source: id, slug: data.slug }] };
      await dependencies.catalogRepository?.upsertDetail?.(id, persisted);
      return { success: true, data: persisted, meta: { source: id, storage: 'provider-fallback', persisted: true }, error: null };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ success: false, data: null, meta: { source: id }, error: { code: 'SOURCE_UNAVAILABLE', message: 'Sumber sedang tidak tersedia' } });
    }
  });

  app.get('/api/v1/sources/:source/episode/:id', async (request, reply) => {
    const { source, id: episodeId } = request.params as { source: string; id: string };
    const id = sourceId(source);
    const provider = id ? dependencies.sourceProviders?.[id] : undefined;
    if (!id || !provider) return reply.code(404).send({ success: false, data: null, error: { code: 'SOURCE_NOT_FOUND', message: 'Sumber tidak ditemukan' } });
    try {
      const stored = await dependencies.catalogRepository?.findEpisode?.(id, episodeId);
      if (stored) return { success: true, data: stored, meta: { source: id, storage: 'postgres', playback: 'on-demand' }, error: null };
      const data = await provider.getEpisode(episodeId);
      return { success: true, data, meta: { source: id, storage: 'provider-fallback', persisted: false }, error: null };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ success: false, data: null, meta: { source: id }, error: { code: 'SOURCE_UNAVAILABLE', message: 'Sumber sedang tidak tersedia' } });
    }
  });

  app.get('/api/v1/sources/:source/anime/:slug/episodes', async (request, reply) => {
    const { source, slug } = request.params as { source: string; slug: string };
    const id = sourceId(source);
    if (!id) return reply.code(404).send({ success: false, data: null, meta: {}, error: { code: 'SOURCE_NOT_FOUND', message: 'Sumber tidak ditemukan' } });
    try {
      if (!dependencies.catalogRepository?.listEpisodes) throw new Error('Episode repository unavailable');
      const result = await dependencies.catalogRepository.listEpisodes(id, slug, episodeQuery(request.query));
      return { success: true, data: result.items, meta: { ...result, items: undefined, source: id, storage: 'postgres' }, error: null };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ success: false, data: null, meta: { source: id }, error: { code: 'EPISODES_UNAVAILABLE', message: 'Daftar episode sedang tidak tersedia' } });
    }
  });

  app.get('/api/v1/sources/:source/episode/:id/playback', async (request, reply) => {
    const { source, id: episodeId } = request.params as { source: string; id: string };
    const id = sourceId(source);
    const provider = id ? dependencies.sourceProviders?.[id] : undefined;
    if (!id || !provider) return reply.code(404).send({ success: false, data: null, error: { code: 'SOURCE_NOT_FOUND', message: 'Sumber tidak ditemukan' } });
    try {
      const episode = await provider.getEpisode(episodeId);
      return { success: true, data: { episodeId, playback: episode.playback }, meta: { source: id, storage: 'provider-on-demand' }, error: null };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ success: false, data: null, meta: { source: id }, error: { code: 'SOURCE_UNAVAILABLE', message: 'Playback sedang tidak tersedia' } });
    }
  });

  app.get('/api/v1/sources/:source/server/:serverId', async (request, reply) => {
    const { source, serverId } = request.params as { source: string; serverId: string };
    const id = sourceId(source);
    const provider = id ? dependencies.sourceProviders?.[id] : undefined;
    if (!id || !provider) return reply.code(404).send({ success: false, data: null, error: { code: 'SOURCE_NOT_FOUND', message: 'Sumber tidak ditemukan' } });
    try {
      return { success: true, data: await provider.resolveServer(serverId), meta: { source: id }, error: null };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ success: false, data: null, meta: { source: id }, error: { code: 'SOURCE_UNAVAILABLE', message: 'Server sedang tidak tersedia' } });
    }
  });

  app.get('/api/v1/sources/:source/schedule', async (request, reply) => {
    const { source } = request.params as { source: string };
    const id = sourceId(source);
    const provider = id ? dependencies.sourceProviders?.[id] : undefined;
    if (!id || !provider) return reply.code(404).send({ success: false, data: null, error: { code: 'SOURCE_NOT_FOUND', message: 'Sumber tidak ditemukan' } });
    try {
      const stored = await dependencies.catalogRepository?.listSchedule?.(id);
      if (stored?.length) return { success: true, data: stored, meta: { source: id, storage: 'postgres' }, error: null };
      const data = await provider.getSchedule();
      await dependencies.catalogRepository?.upsertSchedule?.(id, data);
      return { success: true, data, meta: { source: id, storage: 'provider-fallback', persisted: true }, error: null };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ success: false, data: null, meta: { source: id }, error: { code: 'SOURCE_UNAVAILABLE', message: 'Sumber sedang tidak tersedia' } });
    }
  });

  return app;
}
