'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PosterImage } from './poster-image';
import { SiteHeader } from './site-header';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const letters = ['Semua', ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))];
const sources = ['Semua', 'otakudesu', 'samehadaku', 'oploverz'];

type CatalogItem = { source: string; slug: string; detailSlug: string | null; title: string; posterUrl: string | null; latestEpisode: number | null; releaseDay: string | null };
type CatalogMeta = { page: number; limit: number; total: number; pageCount: number; hasNext: boolean; hasPrevious: boolean; storage: string };
type CatalogResponse = { success: boolean; data: CatalogItem[] | null; meta: CatalogMeta; error: { message?: string } | null };

function catalogHref(query: string, letter: string, source: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (letter !== 'Semua') params.set('letter', letter);
  if (source !== 'Semua') params.set('source', source);
  if (page > 1) params.set('page', String(page));
  const value = params.toString();
  return value ? `/catalog?${value}` : '/catalog';
}

export function CatalogClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q')?.trim() ?? '';
  const urlLetter = searchParams.get('letter')?.toUpperCase() ?? 'Semua';
  const urlSource = searchParams.get('source') ?? 'Semua';
  const urlPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(urlPage) && urlPage > 0 ? urlPage : 1;
  const letter = letters.includes(urlLetter) ? urlLetter : 'Semua';
  const source = sources.includes(urlSource) ? urlSource : 'Semua';
  const [input, setInput] = useState(urlQuery);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [meta, setMeta] = useState<CatalogMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setInput(urlQuery), [urlQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: '24' });
    if (urlQuery) params.set('q', urlQuery);
    if (letter !== 'Semua') params.set('letter', letter);
    if (source !== 'Semua') params.set('source', source);
    setLoading(true);
    setError(null);
    fetch(`${apiBaseUrl}/api/v1/catalog?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as CatalogResponse;
        if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message ?? 'Katalog tidak tersedia');
        return payload;
      })
      .then((payload) => { setItems(payload.data ?? []); setMeta(payload.meta); })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Katalog tidak tersedia'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [letter, page, source, urlQuery]);

  const title = useMemo(() => urlQuery ? `Hasil pencarian untuk “${urlQuery}”` : letter === 'Semua' ? 'Semua Anime' : `Anime huruf ${letter}`, [letter, urlQuery]);
  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push(catalogHref(input.trim(), letter, source, 1));
  };

  return (
    <main className="app-page">
      <SiteHeader />
      <div className="page-shell catalog-shell">
        <div className="section-heading"><div><p className="eyebrow">XING ANIME CATALOG</p><h1>Jelajahi katalog</h1><p className="section-note">Pencarian dan daftar A–Z dari metadata PostgreSQL.</p></div><a className="secondary-button" href="/">← Beranda</a></div>
        <form className="catalog-search" onSubmit={submitSearch}><label htmlFor="catalog-query">Cari anime</label><div><input id="catalog-query" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Judul, alias, atau slug" /><button className="primary-button" type="submit">Cari</button></div></form>
        <div className="catalog-filter-row"><div className="catalog-filter-group"><span className="filter-label">Huruf</span><div className="catalog-letter-list">{letters.map((value) => <a className={letter === value ? 'filter-pill active' : 'filter-pill'} aria-current={letter === value ? 'page' : undefined} href={catalogHref(urlQuery, value, source, 1)} key={value}>{value}</a>)}</div></div><div className="catalog-filter-group"><span className="filter-label">Sumber</span><div className="filter-pills">{sources.map((value) => <a className={source === value ? 'filter-pill active' : 'filter-pill'} aria-current={source === value ? 'page' : undefined} href={catalogHref(urlQuery, letter, value, 1)} key={value}>{value}</a>)}</div></div></div>
        <div className="section-heading catalog-heading"><div><p className="eyebrow">DATABASE ANIME</p><h2>{title}</h2></div><span className="section-note">{meta ? `${meta.total} judul · halaman ${meta.page}/${meta.pageCount || 1}` : 'Memuat...'}</span></div>
        {loading && <div className="status-card">Memuat katalog...</div>}
        {error && <div className="status-card error-card">{error}</div>}
        {!loading && !error && items.length === 0 && <div className="status-card">Anime tidak ditemukan.</div>}
        {!loading && !error && items.length > 0 && <div className="anime-grid">{items.map((item) => <a className="catalog-card" href={`/anime/${item.source}/${item.slug}`} key={`${item.source}:${item.slug}`}><div className="poster-wrap"><PosterImage src={item.posterUrl} alt={item.title} loading="lazy" /><span className="quality-badge">{item.source}</span></div><div className="card-info"><h3 title={item.title}>{item.title}</h3><p><span className="card-episode">{item.latestEpisode ? `EP ${item.latestEpisode}` : 'BARU'}</span><span className="card-separator">•</span>{item.releaseDay ?? 'Segera'}</p></div></a>)}</div>}
        {!loading && !error && meta && meta.pageCount > 1 && <div className="catalog-pagination"><a className={meta.hasPrevious ? 'secondary-button' : 'secondary-button disabled'} href={meta.hasPrevious ? catalogHref(urlQuery, letter, source, meta.page - 1) : undefined}>← Sebelumnya</a><span aria-live="polite">Halaman {meta.page} / {meta.pageCount}</span><a className={meta.hasNext ? 'primary-button' : 'primary-button disabled'} href={meta.hasNext ? catalogHref(urlQuery, letter, source, meta.page + 1) : undefined}>Berikutnya →</a></div>}
      </div>
    </main>
  );
}
