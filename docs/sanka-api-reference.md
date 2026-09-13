# Sanka API Reference

Dokumen ini adalah patokan endpoint Xing Anime untuk provider Sanka, berdasarkan dokumentasi resmi yang diberikan pemilik proyek pada 12 September 2026.

- Base URL: `https://www.sankavollerei.web.id`
- Semua endpoint memakai `GET` dan umumnya membalas `{ status, data }`.
- Batas upstream: **30 request/menit per IP**; tiga peringatan dapat diikuti ban permanen.
- Endpoint bertanda error oleh pemilik, termasuk Kuramanime, tidak boleh diaktifkan tanpa verifikasi terpisah.

## Sumber yang aktif

| Source ID | Home | Detail | Episode | Schedule | Server resolver | Catalog index |
| --- | --- | --- | --- | --- | --- | --- |
| `otakudesu` | `/anime/home` | `/anime/anime/:slug` | `/anime/episode/:slug` | `/anime/schedule` | `/anime/server/:serverId` | `/anime/unlimited` |
| `samehadaku` | `/anime/samehadaku/home` | `/anime/samehadaku/anime/:animeId` | `/anime/samehadaku/episode/:episodeId` | `/anime/samehadaku/schedule` | `/anime/samehadaku/server/:serverId` | `/anime/samehadaku/list` |
| `oploverz` | `/anime/oploverz/home` | `/anime/oploverz/anime/:slug` | `/anime/oploverz/episode/:slug` | `/anime/oploverz/schedule` | Tidak tersedia | Tidak tersedia |

`SourceId` dan path aktif berada di `apps/api/src/providers/source-types.ts` serta `apps/api/src/providers/sanka/source-provider.ts`. Tabel di atas adalah sumber kebenaran untuk menambah atau memperbaiki adapter tersebut.

Discovery yang sudah diterapkan: `ongoing`, `completed`, dan `search` untuk seluruh source aktif; `genre` dan daftar genre untuk Otakudesu serta Samehadaku. UI lokal tersedia di `/discover`.

## Endpoint yang didukung untuk ekspansi

Sanka juga mendokumentasikan adapter: Donghua/Anichin, Animasu, Kusonime, Anoboy, Animekuindo, Nimegami, Alqanime, Donghub, Winbu, Animekompi, dan lainnya. Setiap adapter baru harus:

1. ditambahkan sebagai `SourceId` terpisah dengan kontrak path dan normalizer yang terverifikasi;
2. memakai limiter Sanka global, cache-first, circuit breaker, dan single-flight yang sama;
3. diuji terhadap fixture respons aktual untuk home, detail, episode, schedule, serta resolver server jika tersedia;
4. tidak mengaktifkan sumber 18+ atau sumber yang ditandai error tanpa keputusan produk eksplisit.

## Batas playback

Endpoint episode/server hanya dipakai untuk metadata dan resolver on-demand. URL hasil resolver tidak boleh diproksi, diekstrak, diunduh, atau dipaksa menjadi iframe. Klasifikasi `embed`, `external`, `unknown`, dan `unavailable` tetap mengikuti [provider policy](provider-policy.md).
