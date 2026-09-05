import { describe, expect, it, vi } from 'vitest';
import { PostgresCatalogRepository, type Queryable } from '../src/catalog/postgres-repository.js';

// A dead upstream link is a definitive 404/410 (Sanka wraps some as HTTP 500 with statusCode 404
// and message "data tidak ditemukan"); transient failures stay retriable and must NOT hide a title.
describe('dead link self-check', () => {
  it('excludes unavailable sources from the catalog even when they match the search', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    await repository.listCatalog({ query: 'amanchu', page: 1, limit: 24 });

    const sql = (query.mock.calls as unknown as Array<[string]>)[0]?.[0] ?? '';
    expect(sql).toContain("src.source_status <> 'disabled'");
  });

  it('marks a definitively dead link unavailable instead of leaving it rediscoverable', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    await repository.markSourceUnavailable('otakudesu', 'amanchu-subtitle-indonesia', 'Sanka 404: data tidak ditemukan');

    const sql = (query.mock.calls as unknown as Array<[string]>)[0]?.[0] ?? '';
    const params = (query.mock.calls as unknown as Array<[string, unknown[]]>)[0]?.[1] ?? [];
    expect(sql).toContain("SET source_status = 'disabled'");
    expect(sql).toContain("WHERE provider_name = $1 AND (provider_slug = $2 OR provider_anime_id = $2)");
    expect(sql).toContain("source_status IN ('discovered', 'unknown')");
    expect(params).toEqual(['otakudesu', 'amanchu-subtitle-indonesia', 'Sanka 404: data tidak ditemukan']);
  });

  it('never demotes a verified source to disabled by a dead-link marking', async () => {
    const query = vi.fn(async () => ({ rows: [{ preserve: true }] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    await repository.markSourceUnavailable('otakudesu', 'one-piece', '404');

    const sql = (query.mock.calls as unknown as Array<[string]>)[0]?.[0] ?? '';
    expect(sql).toContain("source_status IN ('discovered', 'unknown')");
  });

  it('keeps re-seeding from resurrecting a dead link as discovered', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'anime-1' }] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    await repository.upsertSourceHome('otakudesu', [{
      source: 'otakudesu', slug: 'amanchu', detailSlug: 'amanchu', title: 'Amanchu',
      posterUrl: null, latestEpisode: null, releaseDay: null
    }]);

    const sql = (query.mock.calls as unknown as Array<[string]>)[1]?.[0] ?? '';
    expect(sql).toContain("CASE WHEN source_status = 'verified' THEN 'verified' WHEN source_status = 'disabled' THEN 'disabled' ELSE 'discovered' END");
  });

  it('rechecks disabled links only after the weekly cooldown', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    await repository.listDeadLinkRecheckCandidates(5);

    const sql = (query.mock.calls as unknown as Array<[string]>)[0]?.[0] ?? '';
    expect(sql).toContain("source_status = 'disabled'");
    expect(sql).toContain("hydration_checked_at < NOW() - INTERVAL '7 days'");
  });

  it('restores a disabled source to discovered before a successful recheck re-verifies it', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const repository = new PostgresCatalogRepository({ query } as unknown as Queryable);

    await repository.markSourceRediscovered('otakudesu', 'amanchu');

    const sql = (query.mock.calls as unknown as Array<[string]>)[0]?.[0] ?? '';
    expect(sql).toContain("SET source_status = 'discovered'");
    expect(sql).toContain("source_status = 'disabled'");
  });
});

describe('definitive dead-link classification', () => {
  it('treats a Sanka 404 wrapper and a plain 404/410 as definitive, but not 500/429', async () => {
    const { isDefinitiveDeadLink } = await import('../src/providers/sanka/response.js');
    const dead404 = new (await import('../src/providers/sanka/response.js')).SankaUpstreamError('Sanka detail request failed with HTTP 404: data tidak ditemukan', 404);
    const wrapped = new (await import('../src/providers/sanka/response.js')).SankaUpstreamError('Sanka detail request failed with HTTP 500: data tidak ditemukan', 500);
    expect(isDefinitiveDeadLink(dead404)).toBe(true);
    expect(isDefinitiveDeadLink(wrapped)).toBe(true);
    expect(isDefinitiveDeadLink(new (await import('../src/providers/sanka/response.js')).SankaUpstreamError('boom', 429))).toBe(false);
    expect(isDefinitiveDeadLink(new (await import('../src/providers/sanka/response.js')).SankaUpstreamError('boom', 500))).toBe(false);
    expect(isDefinitiveDeadLink(new Error('plain'))).toBe(false);
    expect(isDefinitiveDeadLink(null)).toBe(false);
  });
});
