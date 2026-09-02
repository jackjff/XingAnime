# Data Layer

## Purpose

Xing Anime menyimpan metadata katalog dan referensi playback di PostgreSQL. Video pihak ketiga tidak di-host ulang oleh layer ini.

## PostgreSQL collections

- `anime`: canonical catalog record.
- `genres` dan `anime_genres`: taxonomy.
- `anime_sources`: external provider identity and health metadata.
- `episodes`: episode records per source.
- `schedule_entries`: persisted release calendar per anime/source/day.
- `playback_sources`: short-lived/embed/playback references.
- `sync_runs`: audit of provider synchronization.
- `provider_health`: circuit-breaker and rate-limit state.

Schema bootstrap ada di:

```text
infra/postgres/init/001-xing-schema.sql
```

## Cache boundary

`CacheStore` adalah interface yang dapat diimplementasikan oleh:

- `MemoryCache` untuk test/local isolated execution.
- `RedisCache` untuk Docker/production.

- `CachedSankaClient` dan `CachedSourceProvider` menerapkan cache-first dan single-flight agar permintaan yang sama hanya menghasilkan satu upstream request.

## Global rate limiter

`RedisWindowRateLimiter` menggunakan Lua fixed-window atomic counter untuk mengatur budget lintas instance/container. Budget provider Sanka tetap dikonfigurasi di bawah batas resmi provider.

## Runtime integration

Di Docker, API memakai:

- `RedisCache` untuk cache home dan operasi provider ketika `REDIS_URL` tersedia;
- limiter budget Redis global dengan interval serial per proses;
- `RedisLease` untuk mencegah dua instance menjalankan sync bersamaan;
- `PostgresCatalogRepository` untuk menyimpan identity, detail, episode, dan schedule;
- `CatalogSyncWorker` yang menjalankan home dan schedule sync saat startup lalu periodik melalui `SANKA_SYNC_INTERVAL_SECONDS`;
- audit `sync_runs` dan `provider_health` untuk setiap operasi provider.

## Read path

Route katalog menggunakan PostgreSQL terlebih dahulu:

```text
/api/v1/home                         → PostgreSQL
/api/v1/sources/:source/home         → PostgreSQL
/api/v1/sources/:source/anime/:slug  → PostgreSQL jika detail hydrated
/api/v1/sources/:source/episode/:id  → PostgreSQL jika episode tersedia
/api/v1/sources/:source/schedule     → PostgreSQL
```

Cache/database miss melakukan satu fallback provider dan langsung melakukan persist. Detail dianggap hydrated setelah episode tersedia; data home summary saja tidak menyamarkan detail kosong.

Playback dipisahkan dan tidak dipersist permanen:

```text
GET /api/v1/sources/:source/episode/:id/playback
GET /api/v1/sources/:source/server/:serverId
```

Keduanya tetap on-demand dengan TTL pendek melalui cache provider.

## Poster reliability

Poster provider yang known-blocked (termasuk variasi `i<number>.wp.com`) tidak dikirim langsung ke browser. Sync mencoba fallback metadata AniList dan menyimpan URL CDN metadata yang valid. Jika fallback tidak ditemukan, URL provider stale dibersihkan menjadi `NULL`; frontend memakai `/poster-fallback.svg` melalui `PosterImage` dan tidak menjalankan retry loop.

Jika `REDIS_URL` atau `DATABASE_URL` tidak tersedia pada local isolated execution, API memakai fallback memory dan tetap dapat diuji. Production wajib menyediakan kedua connection string tersebut.
