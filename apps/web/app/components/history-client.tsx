'use client';

import { useEffect, useState } from 'react';
import { PosterImage } from './poster-image';
import { SiteHeader } from './site-header';
import { WATCH_HISTORY_STORAGE_KEY, parseWatchHistory, removeWatchHistory, type WatchHistoryEntry } from '../lib/watch-history';

export function HistoryClient() {
  const [items, setItems] = useState<WatchHistoryEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setItems(parseWatchHistory(window.localStorage.getItem(WATCH_HISTORY_STORAGE_KEY)));
    setReady(true);
  }, []);

  const remove = (item: WatchHistoryEntry) => {
    const next = removeWatchHistory(items, item.source, item.episodeId);
    setItems(next);
    window.localStorage.setItem(WATCH_HISTORY_STORAGE_KEY, JSON.stringify(next));
  };

  return (
    <main className="app-page">
      <SiteHeader />
      <div className="page-shell history-shell">
        <div className="section-heading">
          <div><p className="eyebrow">XING ANIME COLLECTION</p><h1>Riwayat Menonton</h1></div>
          <span className="section-note">Tersimpan di browser ini · {items.length} episode</span>
        </div>
        {!ready && <div className="status-card">Memuat riwayat...</div>}
        {ready && items.length === 0 && <div className="status-card">Belum ada riwayat menonton. Pilih episode untuk mulai membangun daftar ini.</div>}
        {ready && items.length > 0 && <div className="history-grid">
          {items.map((item) => (
            <article className="history-card" key={`${item.source}:${item.episodeId}`}>
              <a className="history-card-link" href={`/watch/${item.source}/${item.episodeId}`}>
                <PosterImage className="history-poster" src={item.posterUrl} alt="" loading="lazy" />
                <div className="history-card-copy"><span className="history-source">{item.source}</span><strong>{item.title}</strong><small>{new Date(item.watchedAt).toLocaleString('id-ID')}</small></div>
              </a>
              <button className="history-remove" type="button" onClick={() => remove(item)}>Hapus</button>
            </article>
          ))}
        </div>}
      </div>
    </main>
  );
}
