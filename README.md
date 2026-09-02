# Xing Anime

Xing Anime adalah platform katalog dan streaming anime berbahasa Indonesia dengan tema orange matahari terbit.

## Status

**Bootstrap / foundation** — belum ada fitur streaming produksi.

## Arsitektur awal

- `Directus`: admin CMS dan data management.
- `PostgreSQL`: sumber data katalog, episode, provider, dan status sinkronisasi.
- `Redis`: cache, distributed rate limiter, queue, dan request deduplication.
- `Xing API`: API publik untuk website dan Android TV; tidak mengekspos schema Directus secara langsung.
- `Sync Worker`: adapter Sanka dengan cache-first, concurrency 1, dan budget internal 18 request/menit.
- `Next.js`: frontend web pada fase berikutnya.

## Run foundation

1. Salin `.env.example` menjadi `.env`.
2. Ganti seluruh password/secret development sebelum deployment.
3. Jalankan infrastructure saja dengan `docker compose up -d`.
4. Jalankan seluruh MVP dengan `docker compose --profile app up -d --build`.
5. Buka web di `http://localhost:3000`, API di `http://localhost:4000`, dan Directus di `http://localhost:8055`.

## Provider policy

Xing Anime hanya mengakses provider melalui adapter backend. Tidak ada crawling massal, bypass detector, retry agresif, proxy video, atau penyimpanan ulang video pihak ketiga. Detailnya ada di [`docs/provider-policy.md`](docs/provider-policy.md).

## Development tracking

Branch utama: `main`.
Rencana dan keputusan arsitektur disimpan di `docs/` dan akan dilanjutkan dengan GitHub Issues/Projects setelah autentikasi GitHub tersedia.
