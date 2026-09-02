'use client';

import { useEffect, useMemo, useState } from 'react';
import { SiteHeader } from './site-header';
import { PosterImage } from './poster-image';

type Episode = { id: string; title: string; number: number | null; releaseDate: string | null };
type Detail = { source: string; slug: string; title: string; posterUrl: string | null; synopsis: string | null; status: string | null; type: string | null; studio: string | null; genres: string[]; episodes: Episode[]; availableSources?: Array<{ source: string; slug: string }> };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const providers = [
  { id: 'otakudesu', label: 'Otakudesu' },
  { id: 'samehadaku', label: 'Samehadaku' },
  { id: 'oploverz', label: 'Oploverz' }
];
const episodesPerPage = 50;

export function AnimeDetailClient({ source, slug }: { source: string; slug: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [episodeQuery, setEpisodeQuery] = useState('');
  const [episodePage, setEpisodePage] = useState(1);
  const activeSources = detail?.availableSources?.length ? detail.availableSources : detail ? [{ source: detail.source, slug: detail.slug }] : [];
  const firstEpisode = detail?.episodes[0] ?? null;
  const filteredEpisodes = useMemo(() => {
    const episodes = detail?.episodes ?? [];
    const query = episodeQuery.trim().toLowerCase();
    if (!query) return episodes;
    return episodes.filter((episode) => episode.title.toLowerCase().includes(query) || String(episode.number ?? '').includes(query));
  }, [detail?.episodes, episodeQuery]);
  const episodePageCount = Math.max(1, Math.ceil(filteredEpisodes.length / episodesPerPage));
  const visibleEpisodes = filteredEpisodes.slice((episodePage - 1) * episodesPerPage, episodePage * episodesPerPage);
  const firstVisibleEpisode = filteredEpisodes.length === 0 ? 0 : (episodePage - 1) * episodesPerPage + 1;
  const lastVisibleEpisode = Math.min(episodePage * episodesPerPage, filteredEpisodes.length);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/sources/${encodeURIComponent(source)}/anime/${encodeURIComponent(slug)}`);
        if (!response.ok) throw new Error('Detail anime tidak tersedia');
        const payload = await response.json() as { success: boolean; data: Detail; error?: { message?: string } };
        if (!payload.success) throw new Error(payload.error?.message ?? 'Gagal memuat detail');
        setDetail(payload.data);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Gagal memuat detail');
      }
    };
    void load();
  }, [source, slug]);

  useEffect(() => {
    setEpisodePage(1);
  }, [episodeQuery, source, slug]);

  useEffect(() => {
    setEpisodePage((current) => Math.min(current, episodePageCount));
  }, [episodePageCount]);

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
                  <div><strong>{detail.episodes.length}</strong><span>Episode</span></div>
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
              <div className="section-heading"><div><p className="eyebrow">WATCH LIST</p><h2>Daftar Episode <span className="count-label">{detail.episodes.length}</span></h2></div><span className="section-note">Pilih episode untuk mulai menonton</span></div>
              {detail.episodes.length === 0 ? <div className="status-card">Episode belum tersedia.</div> : <>
                <div className="episode-browser">
                  <label className="episode-search"><span className="sr-only">Cari episode</span><input type="search" value={episodeQuery} onChange={(event) => { setEpisodeQuery(event.target.value); setEpisodePage(1); }} placeholder="Cari nomor atau judul episode" /></label>
                  <div className="episode-browser-meta"><span>{filteredEpisodes.length === 0 ? 'Tidak ada episode yang cocok.' : `Menampilkan ${firstVisibleEpisode}–${lastVisibleEpisode} dari ${filteredEpisodes.length} episode`}</span><div className="episode-pagination"><button type="button" onClick={() => setEpisodePage(1)} disabled={episodePage === 1}>Awal</button><button type="button" onClick={() => setEpisodePage((current) => Math.max(1, current - 1))} disabled={episodePage === 1}>←</button><span>Halaman {episodePage} / {episodePageCount}</span><button type="button" onClick={() => setEpisodePage((current) => Math.min(episodePageCount, current + 1))} disabled={episodePage === episodePageCount}>→</button><button type="button" onClick={() => setEpisodePage(episodePageCount)} disabled={episodePage === episodePageCount}>Terbaru</button></div></div>
                </div>
                {filteredEpisodes.length > 0 && <div className="episode-list">{visibleEpisodes.map((episode) => <a className={episode.id === firstEpisode?.id ? 'episode-row featured-episode' : 'episode-row'} href={`/watch/${source}/${episode.id}`} key={episode.id}><PosterImage className="episode-poster" src={detail.posterUrl} alt="" /><span className="episode-number">{episode.number ?? '—'}</span><span className="episode-title"><b>{episode.title}</b><small>{episode.id === firstEpisode?.id ? 'Episode terbaru yang tersedia' : 'Subtitle Indonesia'}</small></span><span className="episode-date">{episode.releaseDate ?? ''}</span><span className="episode-play">▶</span></a>)}</div>}
              </>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
