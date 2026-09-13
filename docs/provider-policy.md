# Sanka Provider Policy

## Constraint resmi

Sanka menyatakan batas **30 request per menit**, dengan tiga peringatan sebelum ban permanen.

Dokumentasi endpoint resmi yang diberikan pemilik proyek adalah sumber kebenaran untuk path dan parameter provider. Lihat [`sanka-api-reference.md`](sanka-api-reference.md). Kontrak publik Xing tetap dinormalisasi oleh adapter, bukan meneruskan respons Sanka mentah.

## Budget Xing Anime

- Internal hard budget: 18 request/menit.
- Minimum interval target: 3500 ms.
- Concurrency: 1.
- Retry maksimal: 1 untuk timeout/5xx tertentu.
- Tidak retry untuk 403 atau 429.
- 403 mengaktifkan provider pause/circuit breaker.
- 429 menghentikan queue dan mengikuti `Retry-After` jika tersedia.

## Wajib

1. Semua request Sanka melalui backend/worker.
2. Cache sebelum upstream request.
3. Redis sebagai limiter global lintas container.
4. Single-flight untuk request yang sama.
5. Playback hanya diminta ketika user menekan Play.
6. Simpan cache stale jika provider sedang gagal.
7. Catat status, waktu, dan error provider.

## Playback dan kebijakan iframe

Response episode `200` hanya membuktikan metadata dan `serverId` berhasil dibaca. URL hasil resolver harus dipisahkan menjadi:

- `embed`: sudah diverifikasi mengizinkan origin Xing Anime.
- `external`: dapat dibuka langsung, tetapi provider membatasi iframe.
- `unknown`: belum diverifikasi; jangan dimuat otomatis sebagai iframe.

Untuk Desustream, Xing menandai URL sebagai `external` karena `Content-Security-Policy: frame-ancestors` hanya mengizinkan origin provider/Otakudesu. UI menampilkan tombol buka langsung dan tidak memaksa iframe.

Klasifikasi tersebut dilakukan secara lokal dari URL yang sudah diterima; tidak ada probe playback tambahan pada setiap page load. Resolver tetap on-demand, cache TTL pendek, dan seluruh request Sanka tetap melewati limiter.

## Dilarang

- Request langsung dari browser ke Sanka.
- `Promise.all` untuk crawling detail/episode massal.
- Prefetch seluruh playback.
- Bypass detector atau proteksi provider.
- Proxy atau host ulang video tanpa izin yang jelas.
- Menganggap lisensi kode API sebagai lisensi konten anime.
