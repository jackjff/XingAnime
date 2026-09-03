'use client';

type SiteHeaderProps = {
  active?: 'home' | 'schedule';
  searchValue?: string;
  onSearchChange?: (value: string) => void;
};

export function SiteHeader({ active = 'home', searchValue = '', onSearchChange }: SiteHeaderProps) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Xing Anime home">
        <span className="brand-mark">✦</span>
        <span>Xing<span className="brand-accent">Anime</span></span>
      </a>
      <nav className="nav-links" aria-label="Navigasi utama">
        <a className={active === 'home' ? 'active' : ''} href="/">Beranda</a>
        <a href="/catalog">Katalog</a>
        <a className={active === 'schedule' ? 'active' : ''} href="/schedule">Jadwal</a>
        <a href="/history">Riwayat</a>
      </nav>
      {onSearchChange && <label className="search-box">
        <span aria-hidden="true">⌕</span>
        <input value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder="Cari anime..." aria-label="Cari anime" />
        <kbd>/</kbd>
      </label>}
      {onSearchChange && <button className="profile-button" aria-label="Profil pengguna">◉</button>}
      <a className="header-schedule-link" href="/schedule">Jadwal Rilis <span>→</span></a>
    </header>
  );
}
