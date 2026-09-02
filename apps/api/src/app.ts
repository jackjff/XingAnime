import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AnimeSummary } from './providers/sanka/mapper.js';
import type { HomeResult } from './providers/sanka/cached-client.js';
import type { AnimeSourceProvider, SourceAnimeDetail, SourceEpisodeDetail, SourceId, SourceScheduleDay } from './providers/source-types.js';
import { isBlockedPosterUrl } from './providers/poster-enricher.js';

type HomeClient = {
  getHome(): Promise<AnimeSummary[]>;
  getHomeWithMeta?(): Promise<HomeResult>;
};

type CatalogRepository = {
  listSourceHome?(source: SourceId, limit?: number): Promise<unknown[]>;
  findDetail?(source: SourceId, slug: string): Promise<SourceAnimeDetail | null>;
  upsertDetail?(source: SourceId, detail: SourceAnimeDetail): Promise<void>;
  findEpisode?(source: SourceId, episodeId: string): Promise<SourceEpisodeDetail | null>;
  upsertEpisode?(source: SourceId, animeSlug: string, episode: { id: string; title: string; number: number | null }): Promise<void>;
  listSchedule?(source?: SourceId): Promise<SourceScheduleDay[]>;
  upsertSchedule?(source: SourceId, schedule: SourceScheduleDay[]): Promise<void>;
};

type AppDependencies = {
  homeClient: HomeClient;
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

async function enrichDetailPoster(detail: SourceAnimeDetail, posterResolver?: (title: string) => Promise<string | null>): Promise<SourceAnimeDetail> {
  if (!posterResolver || !isBlockedPosterUrl(detail.posterUrl)) return detail;
  try {
    const posterUrl = await posterResolver(detail.title);
    return posterUrl ? { ...detail, posterUrl } : detail;
  } catch {
    return detail;
  }
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: true });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/v1/home', async (_request, reply) => {
    try {
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
        meta: { cached: false },
        error: {
          code: 'UPSTREAM_TEMPORARILY_UNAVAILABLE',
          message: 'Provider sedang tidak tersedia'
        }
      });
    }
  });

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
      const stored = await dependencies.catalogRepository?.findDetail?.(id, slug);
      if (stored) {
        const enriched = await enrichDetailPoster(stored, dependencies.posterResolver);
        return { success: true, data: enriched, meta: { source: id, storage: 'postgres', playback: 'on-demand' }, error: null };
      }
      const data = await provider.getDetail(slug);
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
      if (data.animeSlug) await dependencies.catalogRepository?.upsertEpisode?.(id, data.animeSlug, { id: data.id, title: data.title, number: null });
      return { success: true, data, meta: { source: id, storage: 'provider-fallback', persisted: Boolean(data.animeSlug) }, error: null };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ success: false, data: null, meta: { source: id }, error: { code: 'SOURCE_UNAVAILABLE', message: 'Sumber sedang tidak tersedia' } });
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
