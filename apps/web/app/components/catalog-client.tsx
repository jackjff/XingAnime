'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PosterImage } from './poster-image';
import { SiteHeader } from './site-header';
import { buildAnimeDetailHref } from '../lib/catalog-view';
import { fetchCatalogPage, type CatalogItem, type CatalogMeta } from '../lib/catalog-request';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const letters = ['Semua', ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))];
const sources = ['Semua', 'otakudesu', 'samehadaku', 'oploverz'];
const pageLimit = 24;

type CatalogRequestOptions = { query: string; letter: string; source: string; page: number };

function catalogHref(query: string, letter: string, source: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (letter !== 'Semua') params.set('letter', letter);
  if (source !== 'Semua') params.set('source', source);
  if (page > 1) params.set('page', String(page));
  const value = params.toString();
  return value ? `/catalog?${value}` : '/catalog';
}

function requestKey(options: CatalogRequestOptions) {
  return `${options.query}\u0000${options.letter}\u0000${options.source}\u0000${options.page}`;
}

export function CatalogClient() {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q')?.trim() ?? '';
  const urlLetter = searchParams.get('letter')?.toUpperCase() ?? 'Semua';
  const urlSource = searchParams.get('source') ?? 'Semua';
  const urlPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(urlPage) && urlPage > 0 ? urlPage : 1;
  const letter = letters.includes(urlLetter) ? urlLetter : 'Semua';
  const source = sources.includes(urlSource) ? urlSource : 'Semua';

  const options: CatalogRequestOptions = { query: urlQuery, letter, source, page };
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [meta, setMeta] = useState<CatalogMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const key = requestKey(options);
    if (lastKey.current === key) return;
    lastKey.current = key;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchCatalogPage(apiBaseUrl, { query: urlQuery, letter: letter === 'Semua' ? undefined : letter, source: source === 'Semua' ? undefined : source, page, limit: pageLimit }, controller.signal)
      .then((result) => {
        if (lastKey.current !== key) return;
        setItems(result.items);
        setMeta(result.meta);
      })
      .catch((cause) => {
        if (lastKey.current !== key) return;
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Katalog tidak tersedia');
      })
      .finally(() => {
        if (lastKey.current === key) setLoading(false);
      });
    return () => controller.abort();
  }, [urlQuery, letter, source, page]);

  const retry = useCallback(() => {
    lastKey.current = null;
    setError(null);
    setLoading(true);
    setPageTick((tick) => tick + 1);
  }, []);
  const [, setPageTick] = useState(0);

  const title = urlQuery ? `Hasil pencarian untuk “${urlQuery}”` : letter === 'Semua' ? 'Semua Anime' : `Anime huruf ${letter}`;
  return (
    <main className="app-page">
      <SiteHeader active="catalog" searchValue={urlQuery} />
      <div className="page-shell catalog-shell">
        <div className="section-heading"><div><p className="eyebrow">XING ANIME CATALOG</p><h1>Jelajahi katalog</h1><p className="section-note">Pencarian, filter A–Z, dan sumber dari metadata PostgreSQL.</p></div><a className="secondary-button" href="/">← Beranda</a></div>
        <form className="catalog-search" action="/catalog" method="get"><label htmlFor="catalog-query">Cari anime</label><div><input id="catalog-query" name="q" defaultValue={urlQuery} placeholder="Judul, alias, atau slug" /><button className="primary-button" type="submit">Cari</button></div>{letter !== 'Semua' && <input type="hidden" name="letter" value={letter} />}{source !== 'Semua' && <input type="hidden" name="source" value={source} />}</form>
        <div className="catalog-filter-row"><div className="catalog-filter-group"><span className="filter-label">Huruf</span><div className="catalog-letter-list">{letters.map((value) => <a className={letter === value ? 'filter-pill active' : 'filter-pill'} aria-current={letter === value ? 'page' : undefined} href={catalogHref(urlQuery, value, source, 1)} key={value}>{value}</a>)}</div></div><div className="catalog-filter-group"><span className="filter-label">Sumber</span><div className="catalog-filter-pills">{sources.map((value) => <a className={source === value ? 'filter-pill active' : 'filter-pill'} aria-current={source === value ? 'page' : undefined} href={catalogHref(urlQuery, letter, value, 1)} key={value}>{value}</a>)}</div></div></div>
        <div className="section-heading catalog-heading"><div><p className="eyebrow">DATABASE ANIME</p><h2>{title}</h2></div><span className="section-note">{meta ? `${meta.total} judul · halaman ${meta.page}/${meta.pageCount || 1}` : 'Memuat...'}</span></div>
        {loading && <div className="status-card">Memuat katalog...</div>}
        {error && <div className="status-card error-card">{error}<button className="secondary-button" onClick={retry} type="button">Coba lagi</button></div>}
        {!loading && !error && items.length === 0 && <div className="status-card">Anime tidak ditemukan.</div>}
        {!loading && !error && items.length > 0 && <div className="anime-grid">{items.map((item) => <a className="catalog-card" href={buildAnimeDetailHref(item)} key={`${item.source}:${item.detailSlug ?? item.slug}`}><div className="poster-wrap"><PosterImage src={item.posterUrl} alt={item.title} loading="lazy" /><span className="quality-badge">{item.source}</span></div><div className="card-info"><h3 title={item.title}>{item.title}</h3><p><span className="card-episode">{item.latestEpisode ? `EP ${item.latestEpisode}` : 'BARU'}</span><span className="card-separator">•</span>{item.releaseDay ?? 'Segera'}</p></div></a>)}</div>}
        {!loading && !error && meta && meta.pageCount > 1 && <div className="catalog-pagination"><a className={meta.hasPrevious ? 'secondary-button' : 'secondary-button disabled'} href={meta.hasPrevious ? catalogHref(urlQuery, letter, source, meta.page - 1) : undefined}>← Sebelumnya</a><span aria-live="polite">Halaman {meta.page} / {meta.pageCount}</span><a className={meta.hasNext ? 'primary-button' : 'primary-button disabled'} href={meta.hasNext ? catalogHref(urlQuery, letter, source, meta.page + 1) : undefined}>Berikutnya →</a></div>}
      </div>
    </main>
  );
}
