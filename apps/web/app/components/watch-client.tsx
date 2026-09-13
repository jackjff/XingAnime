'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SiteHeader } from './site-header';
import { PosterImage } from './poster-image';
import { WATCH_HISTORY_STORAGE_KEY, parseWatchHistory, upsertWatchHistory } from '../lib/watch-history';

type Playback = { label: string; quality: string | null; kind: 'embed' | 'server'; mode: 'embed' | 'external' | 'unavailable' | 'unknown'; reason: string | null; url: string | null; serverId: string | null };
type Episode = { source: string; id: string; title: string; animeSlug: string | null; posterUrl?: string | null; releaseTime: string | null; previousEpisodeId: string | null; nextEpisodeId: string | null; playback: Playback[]; availableSources?: Array<{ source: string; slug: string }>; episodeSources?: Array<{ source: string; id: string; slug: string }> };
type EpisodeSource = { source: string; id: string; slug: string };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

function mergeEpisodeSources(...groups: EpisodeSource[][]): EpisodeSource[] {
  const sources = new Map<string, EpisodeSource>();
  groups.flat().forEach((alternative) => sources.set(`${alternative.source}:${alternative.id}`, alternative));
  return [...sources.values()];
}

export function WatchClient({ source, episode }: { source: string; episode: string }) {
  const router = useRouter();
  const [data, setData] = useState<Episode | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resolvingServerId, setResolvingServerId] = useState<string | null>(null);
  const [playerBlocked, setPlayerBlocked] = useState(false);
  const [allowUnknownEmbed, setAllowUnknownEmbed] = useState(false);
  const [playerNotice, setPlayerNotice] = useState<string | null>(null);
  const [activeEpisode, setActiveEpisode] = useState<EpisodeSource>({ source, id: episode, slug: '' });
  const [episodeSources, setEpisodeSources] = useState<EpisodeSource[]>([]);
  const serverController = useRef<AbortController | null>(null);
  const activeData = data?.source === activeEpisode.source && data.id === activeEpisode.id ? data : null;

  useEffect(() => {
    setActiveEpisode({ source, id: episode, slug: '' });
    setEpisodeSources([]);
  }, [source, episode]);

  useEffect(() => {
    const controller = new AbortController();
    serverController.current?.abort();
    serverController.current = null;
    setData(null);
    setError(null);
    setResolvingServerId(null);
    setSelectedIndex(0);
    setPlayerBlocked(false);
    setAllowUnknownEmbed(false);
    setPlayerNotice(null);
    const load = async () => {
      try {
        const episodeUrl = `${apiBaseUrl}/api/v1/sources/${encodeURIComponent(activeEpisode.source)}/episode/${encodeURIComponent(activeEpisode.id)}`;
        const response = await fetch(episodeUrl, { signal: controller.signal });
        if (!response.ok) throw new Error('Episode tidak tersedia');
        const payload = await response.json() as { success: boolean; data: Episode; error?: { message?: string } };
        if (!payload.success) throw new Error(payload.error?.message ?? 'Gagal memuat episode');
        let nextData = payload.data;
        if (nextData.playback.length === 0) {
          const playbackResponse = await fetch(`${episodeUrl}/playback`, { signal: controller.signal });
          const playbackPayload = await playbackResponse.json() as { success: boolean; data?: { playback: Playback[] }; error?: { message?: string } };
          if (!playbackResponse.ok || !playbackPayload.success) throw new Error(playbackPayload.error?.message ?? 'Playback sedang tidak tersedia');
          nextData = { ...nextData, playback: playbackPayload.data?.playback ?? [] };
        }
        if (controller.signal.aborted) return;
        setData(nextData);
        setEpisodeSources((current) => mergeEpisodeSources(current, [activeEpisode], nextData.episodeSources ?? []));
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Gagal memuat episode');
      }
    };
    void load();
    return () => {
      controller.abort();
      serverController.current?.abort();
      serverController.current = null;
    };
  }, [activeEpisode]);

  useEffect(() => {
    if (!activeData?.animeSlug) return;
    const current = parseWatchHistory(window.localStorage.getItem(WATCH_HISTORY_STORAGE_KEY));
    const next = upsertWatchHistory(current, {
      source: activeEpisode.source as 'otakudesu' | 'samehadaku' | 'oploverz',
      animeSlug: activeData.animeSlug,
      episodeId: activeData.id,
      title: activeData.title,
      posterUrl: activeData.posterUrl ?? null,
      watchedAt: new Date().toISOString()
    });
    window.localStorage.setItem(WATCH_HISTORY_STORAGE_KEY, JSON.stringify(next));
  }, [activeEpisode.source, activeData?.animeSlug, activeData?.id, activeData?.posterUrl, activeData?.title]);
  const playable = useMemo(() => (activeData?.playback ?? [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.mode !== 'unavailable'), [activeData]);
  const selected = useMemo(() => playable.find(({ index }) => index === selectedIndex)?.item ?? null, [playable, selectedIndex]);
  const selectedMode = selected?.mode ?? 'unknown';
  const canRenderEmbed = Boolean(selected?.url && (selectedMode === 'embed' || allowUnknownEmbed));

  useEffect(() => {
    if (playable.length > 0 && !selected) setSelectedIndex(playable[0].index);
  }, [playable, selected]);

  const selectPlayback = async (item: Playback, index: number, allowFallback = true) => {
    if (item.url) {
      setSelectedIndex(index);
      setPlayerBlocked(false);
      setAllowUnknownEmbed(false);
      setPlayerNotice(null);
      return;
    }
    if (!item.serverId || (resolvingServerId && allowFallback)) return;
    const controller = new AbortController();
    serverController.current = controller;
    setResolvingServerId(item.serverId);
    setError(null);
    setPlayerNotice(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/sources/${encodeURIComponent(activeEpisode.source)}/server/${encodeURIComponent(item.serverId)}`, { signal: controller.signal });
      const payload = await response.json() as { success: boolean; data?: Playback; error?: { message?: string } };
      if (!response.ok || !payload.success || !payload.data?.url) throw new Error(payload.error?.message ?? 'Server tidak menyediakan embed');
      setData((current) => current ? { ...current, playback: current.playback.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, url: payload.data?.url ?? null, kind: 'embed', mode: payload.data?.mode ?? 'unknown', reason: payload.data?.reason ?? 'not_verified' } : candidate) } : current);
      setSelectedIndex(index);
      setPlayerBlocked(false);
      setAllowUnknownEmbed(false);
      setPlayerNotice(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      const fallback = allowFallback ? playable.find(({ item: candidate, index: candidateIndex }) => candidateIndex !== index && candidate.mode !== 'unavailable') : null;
      if (fallback) {
        setPlayerNotice(`${item.label} gagal dimuat. Mencoba ${fallback.item.label}…`);
        await selectPlayback(fallback.item, fallback.index, false);
      } else {
        setPlayerNotice(`${item.label} tidak tersedia. Pilih sumber video lain.`);
      }
    } finally {
      if (serverController.current === controller) {
        serverController.current = null;
        setResolvingServerId(null);
      }
    }
  };

  return (
    <main className="app-page">
      <SiteHeader />
      <div className="page-shell watch-shell">
        <a className="back-link" href={activeData?.animeSlug ? `/anime/${activeEpisode.source}/${activeData.animeSlug}` : '/'}>← Kembali ke detail</a>
        {error && <div className="status-card error-card">{error}</div>}
        {!activeData && !error && <div className="status-card">Menyiapkan player...</div>}
        {episodeSources.length > 1 && <div className="playback-toolbar"><div className="playback-heading"><span className="muted-label">SUMBER EPISODE INI</span><small>Pilih endpoint lain untuk episode yang sama.</small></div><div className="playback-list">{episodeSources.map((alternative) => <button type="button" aria-pressed={alternative.source === activeEpisode.source && alternative.id === activeEpisode.id} className={alternative.source === activeEpisode.source && alternative.id === activeEpisode.id ? 'playback-chip selected' : 'playback-chip'} onClick={() => setActiveEpisode(alternative)} key={`${alternative.source}-${alternative.id}`}>{alternative.source}</button>)}</div></div>}
        {activeData && (
          <>
            <div className="watch-heading"><div><p className="eyebrow"><span className="live-dot" /> NOW PLAYING · {activeEpisode.source.toUpperCase()}</p><h1>{activeData.title}</h1><p className="watch-subtitle">Subtitle Indonesia <span>•</span> Pilih server yang tersedia untuk mulai menonton.</p></div><span className="watch-episode-badge">EPISODE AKTIF</span></div>
            <section className="player-panel">
              <div className="player-chrome"><span className="player-live-dot" /> XING PLAYER <span>•</span> {selected?.label ?? 'Pilih server'}</div>
              {canRenderEmbed && selected?.url ? <iframe className="video-frame" src={selected.url} title={activeData.title} allowFullScreen referrerPolicy="no-referrer" onLoad={() => { setPlayerBlocked(false); setPlayerNotice(null); }} onError={() => { const fallback = playable.find(({ item, index }) => index !== selectedIndex && item.url && item.mode === 'embed'); setPlayerBlocked(true); if (fallback) { setPlayerNotice(`Player menolak ${selected.label}. Mencoba ${fallback.item.label}…`); setSelectedIndex(fallback.index); } else { setPlayerNotice('Provider menolak pemuatan. Pilih sumber video lain atau buka sumber langsung.'); } }} /> : selected?.url ? <div className="player-empty player-external"><span className="player-empty-icon">↗</span><strong>{selectedMode === 'external' ? 'Server ini tidak mendukung embed' : 'Embed belum terverifikasi'}</strong><span>{selectedMode === 'external' ? 'Provider mengizinkan akses langsung, tetapi membatasi pemuatan dari website lain.' : 'Untuk keamanan, server ini tidak dimuat otomatis di dalam player.'}</span><div className="player-external-actions"><a className="primary-button" href={selected.url} target="_blank" rel="noopener noreferrer">Buka sumber langsung ↗</a>{selectedMode === 'unknown' && <button className="secondary-button" type="button" onClick={() => setAllowUnknownEmbed(true)}>Coba muat di player</button>}</div></div> : <div className="player-empty"><span className="player-empty-icon">▶</span><strong>Siap untuk menonton?</strong><span>Pilih server di bawah untuk membuka sumber playback.</span></div>}
            </section>
            {canRenderEmbed && selected?.url && <div className={playerBlocked ? 'player-fallback blocked' : 'player-fallback'}><span>{playerBlocked ? 'Provider menolak pemuatan di dalam frame.' : 'Jika frame tidak tampil, buka sumber langsung di tab baru.'}</span><a href={selected.url} target="_blank" rel="noopener noreferrer">Buka sumber langsung ↗</a></div>}
            {playerNotice && <div className="player-fallback blocked"><span>{playerNotice}</span></div>}
            <div className="playback-toolbar"><div className="playback-heading"><span className="muted-label">PILIH SUMBER VIDEO</span><strong>{playable.length} opsi tersedia</strong><small>Sumber yang diketahui gagal/beriklan disembunyikan</small></div><div className="playback-list">{playable.map(({ item, index }) => { const loading = Boolean(resolvingServerId && item.serverId === resolvingServerId); return <button type="button" aria-pressed={index === selectedIndex} className={index === selectedIndex ? 'playback-chip selected' : 'playback-chip'} key={`${item.label}-${item.quality}-${item.serverId}`} onClick={() => void selectPlayback(item, index)} disabled={Boolean(resolvingServerId)}>{item.quality && <b>{item.quality}</b>} {loading ? 'Memuat…' : item.label}</button>; })}</div></div>
            <div className="watch-context"><div className="watch-context-poster"><PosterImage className="watch-poster" src={activeData.posterUrl ?? null} alt="" /></div><div className="watch-context-copy"><span className="context-label">XING ANIME</span><strong>{activeData.title}</strong><small>Streaming subtitle Bahasa Indonesia</small></div><div className="context-source"><span>SOURCE</span><b>{activeEpisode.source}</b>{activeData.animeSlug && <a className="context-source-link" href={`/anime/${activeEpisode.source}/${activeData.animeSlug}#source-options`}>Ganti sumber</a>}</div></div>
            <div className="watch-navigation"><a id="watch-episode-previous" className={activeData.previousEpisodeId ? 'secondary-button' : 'secondary-button disabled'} href={activeData.previousEpisodeId ? `/watch/${activeEpisode.source}/${activeData.previousEpisodeId}` : undefined} aria-label="Episode sebelumnya" onClick={(event) => { if (!activeData.previousEpisodeId) { event.preventDefault(); return; } event.preventDefault(); router.push(`/watch/${activeEpisode.source}/${activeData.previousEpisodeId}`); }}>← Episode sebelumnya</a><a id="watch-episode-next" className={activeData.nextEpisodeId ? 'primary-button' : 'primary-button disabled'} href={activeData.nextEpisodeId ? `/watch/${activeEpisode.source}/${activeData.nextEpisodeId}` : undefined} aria-label="Episode berikutnya" onClick={(event) => { if (!activeData.nextEpisodeId) { event.preventDefault(); return; } event.preventDefault(); router.push(`/watch/${activeEpisode.source}/${activeData.nextEpisodeId}`); }}>Episode berikutnya →</a></div>
            <p className="provider-note">Link playback berasal dari provider pihak ketiga dan dapat berubah. Xing Anime tidak mem-proxy atau mengubah media.</p>
          </>
        )}
      </div>
    </main>
  );
}
