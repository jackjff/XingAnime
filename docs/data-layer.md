# Data Layer

## Purpose

Xing Anime menyimpan metadata katalog di PostgreSQL. URL playback bersifat sementara, di-resolve on-demand, dan tidak menjadi data katalog permanen. Video pihak ketiga tidak di-host ulang oleh layer ini.

## Bagaimana website memperoleh anime terbaru

```text
Sanka upstream (Otakudesu, Samehadaku, Oploverz)
  → shared Redis rate budget + single-flight + circuit breaker
  → validasi HTTP, response envelope, dan shape source-specific
  → normalisasi identity anime/source/episode
  → CatalogSyncWorker home discovery
  → bounded detail hydration (maks. 12 item/siklus)
  → transaction/upsert PostgreSQL
  → canonical read model `/api/v1/home` dan `/api/v1/catalog`
  → Next.js web / Android TV client
```

Browser **tidak** mengambil daftar anime langsung dari Sanka. Data terbaru masuk lewat background sync yang dibatasi, kemudian halaman membaca snapshot PostgreSQL. Karena itu provider lambat/403/429 tidak membuat halaman katalog ikut lambat atau menggandakan request upstream.

Setiap siklus memiliki batas deterministik: maksimal 3 request home + 12 request detail hydration + 3 request schedule = 18 request. Detail hydration memproses source `discovered` secara oldest-first; kegagalan diberi cooldown enam jam. `403`/`429` menghentikan sisa hydration/schedule pada siklus tersebut. Dengan model ini katalog bertambah lengkap secara bertahap tanpa crawling paralel atau request provider dari browser.

Playback memiliki jalur terpisah:

```text
user memilih episode/server
  → Xing API meminta provider melalui limiter/circuit/cache
  → response playback dinormalisasi dan dideduplikasi
  → URL dikirim untuk sesi tersebut dengan cache pendek
```

Tidak ada mass-prefetch playback dan URL sementara tidak ditulis sebagai metadata permanen.

## PostgreSQL collections

- `anime`: canonical catalog record.
- `genres` dan `anime_genres`: taxonomy.
- `anime_sources`: external provider identity and health metadata.
- `episodes`: episode records per source.
- `schedule_entries`: persisted release calendar per anime/source/day.
- `playback_sources`: reserved legacy schema; runtime saat ini tidak menulis URL playback sementara ke tabel ini.
- `sync_runs`: audit of provider synchronization.
- `provider_health`: circuit-breaker and rate-limit state.

Schema bootstrap ada di:

```text
infra/postgres/init/001-xing-schema.sql
```

Migration berurutan ada di `infra/postgres/migrations`. API menjalankannya sebelum membuka HTTP listener, di bawah PostgreSQL advisory lock dan transaction, lalu mencatat hasil di `schema_migrations`. Dengan demikian volume Docker lama dan database baru memakai invariant schema yang sama.

## Canonical invariants

- Satu row `anime` mewakili satu judul canonical.
- Maksimal satu `anime_sources` aktif untuk `(anime_id, provider_name)`.
- Home/schedule discovery memakai status `discovered`; hanya detail dengan episode valid yang dipromosikan menjadi `verified` dan boleh tampil sebagai source playback.
- `provider_anime_id` memakai slug detail stabil, bukan slug latest episode.
- Episode unik berdasarkan `(source_id, episode_number)` dan tetap mempertahankan nomor desimal seperti `1015.5`.
- Episode `<= 0`, placeholder, dan `dalam proses` tidak masuk read model.
- `/home` dan `/catalog` menghasilkan satu card per `anime.id`; source filter memilih representasi source terbaik yang valid.
- `availableSources` hanya memuat source aktif yang memiliki minimal satu episode valid.
- Playback dideduplikasi berdasarkan `serverId`, lalu URL, bukan label tampilan.

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
- detail hydration queue yang mengubah source `discovered` menjadi `verified` setelah episode valid dipersist;
- poster backfill independen yang membaca anime tanpa poster dan mencoba AniList secara serial, dengan lease Redis terpisah;
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

`/home` dan `/catalog` memakai canonical PostgreSQL read model. Provider fallback hanya digunakan pada boundary yang memang perlu bootstrap/detail; detail dianggap hydrated setelah episode tersedia. Request detail yang sudah tersimpan tidak menunggu AniList.

Playback dipisahkan dan tidak dipersist permanen:

```text
GET /api/v1/sources/:source/episode/:id/playback
GET /api/v1/sources/:source/server/:serverId
```

Keduanya tetap on-demand dengan TTL pendek melalui cache provider.

## Poster reliability

Poster provider yang known-blocked (termasuk variasi `i<number>.wp.com`) tidak dikirim langsung ke browser. Poster memiliki dua jalur ingest: enrichment saat catalog sync berhasil dan background backfill independen untuk row lama/NULL. Hanya CDN AniList tepercaya yang dipersist. Hasil unresolved diberi `poster_checked_at` agar retry dibatasi dan item lain tidak starvation. Jika poster belum ditemukan, frontend memakai `/poster-fallback.svg` melalui `PosterImage` dan tidak menjalankan retry loop.

Jika `REDIS_URL` atau `DATABASE_URL` tidak tersedia pada local isolated execution, API memakai fallback memory dan tetap dapat diuji. Production wajib menyediakan kedua connection string tersebut.
