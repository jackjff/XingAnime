'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PosterImage } from './poster-image';
import { SiteHeader } from './site-header';
import { buildAnimeDetailHref } from '../lib/catalog-view';

type DiscoveryItem = {
  source: string;
  slug: string;
  detailSlug: string | null;
  title: string;
  posterUrl: string | null;
  latestEpisode: number | null;
  releaseDay: string | null;
};

type DiscoveryResult = {
  items: DiscoveryItem[];
  page: number;
  hasNext: boolean;
  hasPrevious: boolean;
  pageCount: number | null;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const sources = ['otakudesu', 'samehadaku', 'oploverz'];
const kinds = ['ongoing', 'completed', 'search'] as const;

function discoveryHref(source: string, kind: string, query: string, page: number): string {
  const params = new URLSearchParams({ source, kind });
  if (query) params.set('q', query);
  if (page > 1) params.set('page', String(page));
  return `/discover?${params.toString()}`;
}

export function DiscoveryClient() {
  const searchParams = useSearchParams();
  const source = sources.includes(searchParams.get('source') ?? '') ? searchParams.get('source')! : 'otakudesu';
  const rawKind = searchParams.get('kind');
  const kind = kinds.includes(rawKind as typeof kinds[number]) ? rawKind as typeof kinds[number] : 'ongoing';
  const query = searchParams.get('q')?.trim() ?? '';
  const rawPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind === 'search' && !query) {
      setResult(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set('q', query);
    setError(null);
    setResult(null);
    fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/sources/${source}/discover/${kind}?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Discovery tidak tersedia (HTTP ${response.status})`);
        return response.json() as Promise<{ success: boolean; data?: DiscoveryResult }>;
      })
      .then((payload) => {
        if (!payload.success || !payload.data || !Array.isArray(payload.data.items)) throw new Error('Respons discovery tidak valid');
        setResult(payload.data);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Discovery tidak tersedia');
      });
    return () => controller.abort();
  }, [source, kind, query, page]);

  return <main className="app-page">
    <SiteHeader active="catalog" />
    <div className="page-shell catalog-shell">
      <div className="section-heading"><div><p className="eyebrow">PROVIDER DISCOVERY</p><h1>Jelajahi rilisan sumber</h1><p className="section-note">Data diminta melalui API Xing, dibatasi cache dan limiter Sanka.</p></div><a className="secondary-button" href="/catalog">Katalog tersimpan</a></div>
      <form className="catalog-search" action="/discover" method="get">
        <label htmlFor="discovery-query">Filter source</label>
        <div><select aria-label="Sumber" defaultValue={source} name="source">{sources.map((value) => <option key={value} value={value}>{value}</option>)}</select><select aria-label="Jenis discovery" defaultValue={kind} name="kind">{kinds.map((value) => <option key={value} value={value}>{value}</option>)}</select><input defaultValue={query} id="discovery-query" name="q" placeholder="Wajib untuk pencarian" /><button className="primary-button" type="submit">Tampilkan</button></div>
      </form>
      {kind === 'search' && !query && <div className="status-card">Masukkan judul untuk mencari dari source yang dipilih.</div>}
      {!result && !error && !(kind === 'search' && !query) && <div className="status-card">Memuat discovery...</div>}
      {error && <div className="status-card error-card">{error}</div>}
      {result && result.items.length === 0 && <div className="status-card">Tidak ada anime dari filter ini.</div>}
      {result && result.items.length > 0 && <div className="anime-grid">{result.items.map((item) => <a className="catalog-card" href={buildAnimeDetailHref(item)} key={`${item.source}:${item.detailSlug ?? item.slug}`}><div className="poster-wrap"><PosterImage src={item.posterUrl} alt={item.title} loading="lazy" /><span className="quality-badge">{item.source}</span></div><div className="card-info"><h3 title={item.title}>{item.title}</h3><p><span className="card-episode">{item.latestEpisode ? `EP ${item.latestEpisode}` : 'INFO'}</span><span className="card-separator">•</span>{item.releaseDay ?? 'Segera'}</p></div></a>)}</div>}
      {result && (result.hasPrevious || result.hasNext) && <div className="catalog-pagination"><a className={result.hasPrevious ? 'secondary-button' : 'secondary-button disabled'} href={result.hasPrevious ? discoveryHref(source, kind, query, result.page - 1) : undefined}>← Sebelumnya</a><span>Halaman {result.page}{result.pageCount ? ` / ${result.pageCount}` : ''}</span><a className={result.hasNext ? 'primary-button' : 'primary-button disabled'} href={result.hasNext ? discoveryHref(source, kind, query, result.page + 1) : undefined}>Berikutnya →</a></div>}
    </div>
  </main>;
}
