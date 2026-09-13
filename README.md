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
3. Jalankan seluruh stack dengan `docker compose up -d --build`.
4. Buka web di `http://localhost:3000`, API di `http://localhost:4000`, dan Directus di `http://localhost:8055`.
5. Web mem-proxy `/api/*` ke service API internal. Jangan set `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000` pada server publik, karena `localhost` akan merujuk ke browser pengguna.

## Provider policy

Xing Anime hanya mengakses provider melalui adapter backend. Tidak ada crawling massal, bypass detector, retry agresif, proxy video, atau penyimpanan ulang video pihak ketiga. Detailnya ada di [`docs/provider-policy.md`](docs/provider-policy.md).

Dokumentasi endpoint Sanka yang diberikan pemilik proyek menjadi patokan teknis adapter; sumber aktif dan aturan ekspansinya dicatat di [`docs/sanka-api-reference.md`](docs/sanka-api-reference.md).

## Development tracking

Branch utama: `main`.
Rencana dan keputusan arsitektur disimpan di `docs/` dan akan dilanjutkan dengan GitHub Issues/Projects setelah autentikasi GitHub tersedia.
