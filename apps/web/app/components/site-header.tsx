'use client';

type SiteHeaderProps = {
  active?: 'home' | 'catalog' | 'schedule';
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
        <a className={active === 'catalog' ? 'active' : ''} href="/catalog">Katalog</a>
        <a className={active === 'schedule' ? 'active' : ''} href="/schedule">Jadwal</a>
        <a href="/history">Riwayat</a>
      </nav>
      <form className="search-box" action="/catalog" method="get">
        <span aria-hidden="true">⌕</span>
        {onSearchChange
          ? <input name="q" value={searchValue} onChange={(event) => onSearchChange(event.target.value)} placeholder="Cari anime..." aria-label="Cari anime" />
          : <input name="q" defaultValue={searchValue} placeholder="Cari anime..." aria-label="Cari anime" />}
        <kbd>/</kbd>
      </form>
      {onSearchChange && <button className="profile-button" aria-label="Profil pengguna">◉</button>}
      <a className="header-schedule-link" href="/schedule">Jadwal Rilis <span>→</span></a>
    </header>
  );
}
