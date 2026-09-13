'use client';

import { useEffect, useMemo, useState } from 'react';
import { SiteHeader } from './components/site-header';
import { PosterImage } from './components/poster-image';

type Anime = {
  slug: string;
  title: string;
  posterUrl: string | null;
  latestEpisode: number | null;
  releaseDay: string | null;
  source: string;
};

type HomeResponse = {
  success: boolean;
  data: Anime[];
  meta: { cached: boolean };
  error: { message: string } | null;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export default function HomePage() {
  const [anime, setAnime] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const loadHome = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/home`);
        if (!response.ok) throw new Error('API tidak tersedia');
        const payload = (await response.json()) as HomeResponse;
        if (!payload.success) throw new Error(payload.error?.message ?? 'Gagal memuat katalog');
        setAnime(payload.data);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Gagal memuat katalog');
      } finally {
        setLoading(false);
      }
    };

    void loadHome();
  }, []);

  const filteredAnime = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return anime;
    return anime.filter((item) => item.title.toLowerCase().includes(normalizedQuery));
  }, [anime, query]);

  const featured = anime[0];

  return (
    <main>
      <SiteHeader searchValue={query} onSearchChange={setQuery} />

      <section className="hero" id="top">
        <div className="hero-glow" />
        <div className="hero-copy">
          <p className="eyebrow"><span className="live-dot" /> PILIHAN HARI INI</p>
          <h1>{featured?.title ?? 'Anime favoritmu, dalam satu tempat.'}</h1>
          <p className="hero-description">
            Temukan rilisan anime terbaru dengan pengalaman menonton yang bersih, cepat, dan nyaman.
          </p>
          <div className="hero-actions">
            <a className="primary-button" href={featured ? `/anime/${featured.source}/${featured.slug}` : '#catalog'}>▶ Mulai Menonton</a>
            <a className="secondary-button" href="/history">＋ Daftar Saya</a>
          </div>
          <div className="hero-meta">
            <span>● Subtitle Indonesia</span>
            <span>HD</span>
            <span>{featured?.latestEpisode ? `Episode ${featured.latestEpisode}` : 'Update rutin'}</span>
          </div>
          <div className="hero-trust"><span>↗</span> Katalog diperbarui berkala dari sumber pilihan</div>
        </div>
        <div className="hero-poster-wrap" aria-hidden="true">
          <PosterImage className="hero-poster" src={featured?.posterUrl ?? null} alt="" loading="eager" />
        </div>
        <div className="hero-fade" />
      </section>

      <section className="content" id="catalog">
        <div className="section-heading catalog-heading">
          <div>
            <p className="eyebrow">XING ANIME COLLECTION</p>
            <h2>{query ? `Hasil pencarian untuk “${query}”` : 'Sedang Tayang'}</h2>
          </div>
          <div className="catalog-heading-side"><span className="catalog-count">{loading ? '—' : `${filteredAnime.length} judul`}</span><a href="/catalog" className="view-all">Lihat katalog <span>→</span></a></div>
        </div>

        {loading && <div className="status-card">Memuat katalog anime...</div>}
        {error && <div className="status-card error-card">{error}. Pastikan API Xing berjalan di port 4000.</div>}
        {!loading && !error && filteredAnime.length === 0 && (
          <div className="status-card">Anime tidak ditemukan.</div>
        )}
        {!loading && !error && filteredAnime.length > 0 && (
          <div className="anime-grid">
            {filteredAnime.map((item, index) => (
              <article className="anime-card" id={`${item.source}-${item.slug}`} key={`${item.source}:${item.slug}`}>
                <a className="card-link" href={`/anime/${item.source}/${item.slug}`}>
                <div className="poster-wrap">
                  <PosterImage src={item.posterUrl} alt={item.title} loading={index > 5 ? 'lazy' : 'eager'} />
                  <span className="quality-badge">HD</span>
                  <span className="quick-play" aria-label={`Buka ${item.title}`}>▶</span>
                </div>
                <div className="card-info">
                  <h3 title={item.title}>{item.title}</h3>
                  <p><span className="card-episode">{item.latestEpisode ? `EP ${item.latestEpisode}` : 'BARU'}</span><span className="card-separator">•</span>{item.releaseDay ?? 'Segera'}</p>
                </div>
                </a>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="genre-strip" id="genres">
        <div><p className="eyebrow">TEMUKAN CERITA BARU</p><h2>Jelajahi berdasarkan genre</h2></div>
        <div className="genre-list">
          {['Action', 'Romance', 'Fantasy', 'Comedy', 'Drama'].map((genre) => <a href="#catalog" key={genre}>{genre}<span>→</span></a>)}
        </div>
      </section>

      <footer><span>© 2026 Xing Anime</span><span>Dibuat untuk penikmat anime Indonesia.</span></footer>
    </main>
  );
}
