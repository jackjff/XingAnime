'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SiteHeader } from '../components/site-header';
import { PosterImage } from '../components/poster-image';
import { filterScheduleGroups } from '../lib/catalog-view';

type ScheduleItem = { source: string; slug: string; title: string; posterUrl: string | null; episodeLabel: string | null };
type ScheduleDay = { day: string; items: ScheduleItem[] };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const dayOrder = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

function scheduleHref(day: string, source: string) {
  const params = new URLSearchParams();
  if (day !== 'Semua') params.set('day', day);
  if (source !== 'Semua') params.set('source', source);
  const query = params.toString();
  return query ? `/schedule?${query}` : '/schedule';
}

export default function SchedulePage() {
  return <Suspense fallback={<main className="app-page"><SiteHeader active="schedule" /><div className="page-shell schedule-shell"><div className="status-card">Memuat jadwal...</div></div></main>}><ScheduleContent /></Suspense>;
}

function ScheduleContent() {
  const searchParams = useSearchParams();
  const [groups, setGroups] = useState<ScheduleDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeDay = searchParams.get('day') ?? 'Semua';
  const activeSource = 'Semua';

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/schedule`);
        const payload = await response.json() as { success: boolean; data: ScheduleDay[]; error?: { message?: string } };
        if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? 'Jadwal tidak tersedia');
        setGroups([...payload.data].sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day)));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Jadwal tidak tersedia');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const total = useMemo(() => groups.reduce((sum, group) => sum + group.items.length, 0), [groups]);
  const availableDays = useMemo(() => ['Semua', ...new Set(groups.map((group) => group.day))], [groups]);
  const filteredGroups = useMemo(() => filterScheduleGroups(groups, activeDay, activeSource), [activeDay, activeSource, groups]);


  return (
    <main className="app-page">
      <SiteHeader active="schedule" />
      <div className="page-shell schedule-shell">
        <section className="schedule-intro">
          <div className="schedule-intro-copy"><p className="eyebrow"><span className="live-dot" /> XING ANIME CALENDAR</p><h1>Jadwal rilis, <em>tanpa terlewat.</em></h1><p>Gabungan jadwal dari Otakudesu, Samehadaku, dan Oploverz dalam satu kalender yang mudah dipindai.</p></div>
          <div className="schedule-summary"><strong>{loading ? '—' : total}</strong><span>judul terjadwal</span><small>Perbarui otomatis dari katalog tersimpan</small></div>
        </section>
        {!loading && !error && groups.length > 0 && <section className="schedule-controls" aria-label="Filter jadwal">
          <div className="filter-group"><span className="filter-label">Hari</span><div className="filter-pills">{availableDays.map((day) => <a id={`schedule-day-${day.toLowerCase()}`} aria-current={activeDay === day ? 'page' : undefined} className={activeDay === day ? 'filter-pill active' : 'filter-pill'} href={scheduleHref(day, activeSource)} key={day}>{day}</a>)}</div></div>

        </section>}
        {error && <div className="status-card error-card">{error}</div>}
        {loading && <div className="status-card">Menyusun kalender dari katalog tersimpan...</div>}

        {!loading && !error && groups.length === 0 && <div className="status-card">Jadwal belum tersedia.</div>}
        {!loading && !error && groups.length > 0 && filteredGroups.length === 0 && <div className="status-card">Tidak ada jadwal untuk filter ini.</div>}
        <div className="schedule-grid">{filteredGroups.map((group) => <section className="schedule-day" key={group.day}><div className="day-heading"><div><span className="day-kicker">RELEASE DAY</span><h2>{group.day}</h2></div><span>{group.items.length} judul</span></div><div className="schedule-items">{group.items.map((item) => <a className="schedule-item" href={`/anime/${item.source}/${item.slug}`} key={`${item.source}:${item.slug}`}><PosterImage className="schedule-poster" src={item.posterUrl} alt="" loading="lazy" /><span className="schedule-time">{item.episodeLabel ?? 'Update'}</span><span className="schedule-title">{item.title}</span><span className="episode-play">→</span></a>)}</div></section>)}</div>
      </div>
    </main>
  );
}
