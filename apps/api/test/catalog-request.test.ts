import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCatalogPage } from '../../web/app/lib/catalog-request.js';

const item = { source: 'otakudesu', slug: 'one-piece', detailSlug: 'one-piece', title: 'One Piece', posterUrl: null, latestEpisode: 10, releaseDay: null };
const payload = { success: true, data: [item], meta: { page: 2, limit: 24, total: 1856, pageCount: 78, hasNext: true, hasPrevious: true, storage: 'postgres' }, error: null };

afterEach(() => vi.unstubAllGlobals());

describe('catalog page acquisition', () => {
  it('discards a cancelled response even if the transport finishes anyway', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort();
      return Response.json(payload);
    }));
    await expect(fetchCatalogPage('http://localhost:4000', { page: 1, limit: 24 }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    { ...payload, meta: {} },
    { ...payload, data: [{ title: 'Missing identity' }] },
    { ...payload, data: {} },
    { ...payload, meta: { ...payload.meta, total: -1 } }
  ])('rejects malformed successful responses instead of showing false totals', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)));
    await expect(fetchCatalogPage('http://localhost:4000', { page: 1, limit: 24 }, new AbortController().signal)).rejects.toThrow('Respons katalog tidak valid');
  });

  it('reports HTTP failures without leaking an HTML error document', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Proxy error</html>', { status: 502 })));
    await expect(fetchCatalogPage('http://localhost:4000', { page: 1, limit: 24 }, new AbortController().signal)).rejects.toThrow('Katalog tidak tersedia (HTTP 502)');
  });

  it('requests only the filtered page and keeps server totals beyond the old client cap', async () => {
    const fetcher = vi.fn(async () => Response.json(payload));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const result = await fetchCatalogPage('http://localhost:4000', { query: 'one', source: 'otakudesu', page: 2, limit: 24 }, controller.signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('http://localhost:4000/api/v1/catalog/search?q=one&source=otakudesu&page=2&limit=24', expect.objectContaining({ signal: controller.signal }));
    expect(result).toEqual({ items: [item], meta: payload.meta });
  });
});
