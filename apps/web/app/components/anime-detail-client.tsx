'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SiteHeader } from './site-header';
import { PosterImage } from './poster-image';

type Episode = { id: string; title: string; number: number | null; releaseDate: string | null };
type Detail = { source: string; slug: string; title: string; posterUrl: string | null; synopsis: string | null; status: string | null; type: string | null; studio: string | null; genres: string[]; episodes: Episode[]; firstEpisodeId?: string | null; latestEpisodeId?: string | null; availableSources?: Array<{ source: string; slug: string }> };
type EpisodePageMeta = { page: number; limit: number; total: number; pageCount: number; hasNext: boolean; hasPrevious: boolean };
type EpisodePageResponse = { success: boolean; data: Episode[] | null; meta: EpisodePageMeta; error: { message?: string } | null };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const providers = [
  { id: 'otakudesu', label: 'Otakudesu' },
  { id: 'samehadaku', label: 'Samehadaku' },
  { id: 'oploverz', label: 'Oploverz' }
];
const episodesPerPage = 50;

export function AnimeDetailClient({ source, slug }: { source: string; slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPage = Number.parseInt(searchParams.get('episodePage') ?? '1', 10);
  const episodePage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episodeMeta, setEpisodeMeta] = useState<EpisodePageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [episodeError, setEpisodeError] = useState<string | null>(null);
  const [episodeLoading, setEpisodeLoading] = useState(false);
  const [episodeQuery, setEpisodeQuery] = useState('');
  const activeSources = detail?.availableSources?.length ? detail.availableSources : detail ? [{ source: detail.source, slug: detail.slug }] : [];
  const firstEpisode = detail?.firstEpisodeId ? { id: detail.firstEpisodeId } : episodes[0] ?? null;
  const episodeTotal = episodeMeta?.total ?? 0;
  const episodePageCount = episodeMeta?.pageCount ?? 0;
  const firstVisibleEpisode = episodeTotal === 0 ? 0 : ((episodeMeta?.page ?? episodePage) - 1) * (episodeMeta?.limit ?? episodesPerPage) + 1;
  const lastVisibleEpisode = episodeTotal === 0 ? 0 : firstVisibleEpisode + episodes.length - 1;

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setEpisodes([]);
    setEpisodeMeta(null);
    setError(null);
    setEpisodeError(null);
    const load = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/sources/${encodeURIComponent(source)}/anime/${encodeURIComponent(slug)}?includeEpisodes=false`, { signal: controller.signal });
        if (!response.ok) throw new Error('Detail anime tidak tersedia');
        const payload = await response.json() as { success: boolean; data: Detail; error?: { message?: string } };
        if (!payload.success) throw new Error(payload.error?.message ?? 'Gagal memuat detail');
        setDetail(payload.data);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Gagal memuat detail');
      }
    };
    void load();
    return () => controller.abort();
  }, [source, slug]);

  useEffect(() => {
    if (!detail) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(episodePage), limit: String(episodesPerPage) });
    if (episodeQuery.trim()) params.set('q', episodeQuery.trim());
    setEpisodeLoading(true);
    setEpisodeError(null);
    fetch(`${apiBaseUrl}/api/v1/sources/${encodeURIComponent(source)}/anime/${encodeURIComponent(slug)}/episodes?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as EpisodePageResponse;
        if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message ?? 'Daftar episode tidak tersedia');
        return payload;
      })
      .then((payload) => { setEpisodes(payload.data ?? []); setEpisodeMeta(payload.meta); })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setEpisodeError(cause instanceof Error ? cause.message : 'Daftar episode tidak tersedia'); })
      .finally(() => { if (!controller.signal.aborted) setEpisodeLoading(false); });
    return () => controller.abort();
  }, [detail, episodePage, episodeQuery, slug, source]);

  const currentEpisodePage = episodeMeta?.page ?? episodePage;

  return (
    <main className="app-page">
      <SiteHeader />
      <div className="page-shell detail-shell">
        <a className="back-link" href="/">← Kembali ke katalog</a>
        {error && <div className="status-card error-card">{error}</div>}
        {!detail && !error && <div className="status-card">Memuat detail anime...</div>}
        {detail && (
          <>
            <section className="detail-hero">
              <div className="detail-hero-orb" aria-hidden="true" />
              <div className="detail-poster-wrap">
                <PosterImage src={detail.posterUrl} alt={detail.title} loading="eager" />
              </div>
              <div className="detail-copy">
                <p className="eyebrow"><span className="live-dot" /> DETAIL ANIME · {detail.source.toUpperCase()}</p>
                <h1>{detail.title}</h1>
                <p className="detail-subtitle">Subtitle Indonesia <span>•</span> Xing Anime original catalog</p>
                <div className="meta-pills">
                  {detail.status && <span>{detail.status}</span>}
                  {detail.type && <span>{detail.type}</span>}
                  {detail.studio && <span>{detail.studio}</span>}
                </div>
                <p className="detail-synopsis">{detail.synopsis ?? 'Sinopsis belum tersedia.'}</p>
                <div className="detail-actions">
                  {firstEpisode ? <a className="primary-button" href={`/watch/${source}/${firstEpisode.id}`}>▶ Mulai Episode 1</a> : <span className="primary-button disabled">Episode belum tersedia</span>}
                  <a className="secondary-button" href="#episodes">↓ Lihat episode</a>
                </div>
                <div className="genre-list detail-genres">
                  {detail.genres.map((genre) => <span key={genre}>{genre}</span>)}
                </div>
                <div className="detail-stats">
                  <div><strong>{episodeTotal}</strong><span>Episode</span></div>
                  <div><strong>{detail.status ?? '—'}</strong><span>Status</span></div>
                  <div><strong>{activeSources.length}</strong><span>Sumber</span></div>
                </div>
                <div className="source-switcher" id="source-options">
                  <span className="muted-label">Sumber data:</span>
                  {activeSources.map((available) => { const provider = providers.find((candidate) => candidate.id === available.source); return provider ? <a className={provider.id === source ? 'source-chip selected' : 'source-chip'} href={`/anime/${provider.id}/${available.slug}`} key={provider.id}>{provider.label}</a> : null; })}
                </div>
              </div>
            </section>
            <section className="episodes-section" id="episodes">
              <div className="section-heading"><div><p className="eyebrow">WATCH LIST</p><h2>Daftar Episode <span className="count-label">{episodeTotal}</span></h2></div><span className="section-note">Pilih episode untuk mulai menonton</span></div>
              {episodeError ? <div className="status-card error-card">{episodeError}</div> : episodeLoading && !episodeMeta ? <div className="status-card">Memuat daftar episode...</div> : episodeTotal === 0 ? <div className="status-card">Episode belum tersedia.</div> : <>
                <div className="episode-browser">
                  <label className="episode-search"><span className="sr-only">Cari episode</span><input type="search" value={episodeQuery} onChange={(event) => { setEpisodeQuery(event.target.value); router.replace('?episodePage=1#episodes', { scroll: false }); }} placeholder="Cari nomor atau judul episode" /></label>
                  <div className="episode-browser-meta"><span>{episodes.length === 0 ? 'Tidak ada episode yang cocok.' : `Menampilkan ${firstVisibleEpisode}–${lastVisibleEpisode} dari ${episodeTotal} episode`}</span><div className="episode-pagination"><a id="episode-page-first" className={currentEpisodePage === 1 ? 'disabled' : ''} aria-label="Episode pertama" aria-disabled={currentEpisodePage === 1} href={currentEpisodePage === 1 ? undefined : '?episodePage=1#episodes'}>Awal</a><a id="episode-page-prev" className={currentEpisodePage === 1 ? 'disabled' : ''} aria-label="Halaman episode sebelumnya" aria-disabled={currentEpisodePage === 1} href={currentEpisodePage === 1 ? undefined : `?episodePage=${currentEpisodePage - 1}#episodes`}>←</a><span aria-live="polite">Halaman {currentEpisodePage} / {episodePageCount}</span><a id="episode-page-next" className={currentEpisodePage === episodePageCount ? 'disabled' : ''} aria-label="Halaman episode berikutnya" aria-disabled={currentEpisodePage === episodePageCount} href={currentEpisodePage === episodePageCount ? undefined : `?episodePage=${currentEpisodePage + 1}#episodes`}>→</a><a id="episode-page-latest" className={currentEpisodePage === episodePageCount ? 'disabled' : ''} aria-label="Episode terbaru" aria-disabled={currentEpisodePage === episodePageCount} href={currentEpisodePage === episodePageCount ? undefined : `?episodePage=${episodePageCount}#episodes`}>Terbaru</a></div></div>
                </div>
                {episodes.length > 0 && <div className="episode-list">{episodes.map((episode) => <a className={episode.id === detail.latestEpisodeId ? 'episode-row featured-episode' : 'episode-row'} href={`/watch/${source}/${episode.id}`} key={episode.id}><PosterImage className="episode-poster" src={detail.posterUrl} alt="" /><span className="episode-number">{episode.number ?? '—'}</span><span className="episode-title"><b>{episode.title}</b><small>{episode.id === firstEpisode?.id ? 'Episode terbaru yang tersedia' : 'Subtitle Indonesia'}</small></span><span className="episode-date">{episode.releaseDate ?? ''}</span><span className="episode-play">▶</span></a>)}</div>}
              </>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
