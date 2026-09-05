# Samehadaku API — Dokumentasi Lengkap untuk Pengembangan Website

> **Status:** API ini adalah unofficial REST API yang dibuat oleh komunitas SAMEHADAKU-CARE.
> Server Heroku demo saat ini **down (404)**. Cara terbaik adalah **self-host** dari source code GitHub.
>
> **Repo resmi:** https://github.com/SAMEHADAKU-CARE/samehadaku-rest-api
> **Repo alternatif (rizalord):** https://github.com/rizalord/samehadaku-api

---

## 1. Arsitektur & Cara Kerja

API ini menggunakan **web scraping** dengan library `scraperjs` untuk mengekstrak data dari website Samehadaku (`samehadaku.vip`). Setiap request ke endpoint akan memicu scraper yang mengunjungi halaman target, mem-parse HTML, dan mengembalikan JSON.

```
Request → Express Server → scraperjs → Scraping samehadaku.vip → Parse HTML → JSON Response
```

### Teknologi yang Digunakan
- **Runtime:** Node.js + Express
- **Scraping:** `scraperjs` (jQuery-like selector pada HTML response)
- **Base URL:** `https://samehadaku.vip/` (domain utama scraping)

---

## 2. Daftar Lengkap Endpoint API

### 2.1 Homepage (`GET /`)
Mengembalikan halaman utama dengan anime musim ini dan episode terbaru.

**Query Params:** `page` (optional, number)

**Response Schema:**
```json
{
  "season": [
    {
      "title": "Re:Zero kara Hajimeru Isekai Seikatsu Season 4",
      "status": "Ongoing",
      "link": "https://samehadaku.vip/anime/rezero-kara-hajimeru-isekai-seikatsu-season-4/",
      "linkId": "rezero-kara-hajimeru-isekai-seikatsu-season-4",
      "image": "https://i0.wp.com/.../image.jpg?quality=100",
      "rating": "8.79"
    }
  ],
  "latest": [
    {
      "title": "Episode 20",
      "episode": "Episode 20",
      "postedBy": "Azuki",
      "release_time": "7 hours ago",
      "link": "https://samehadaku.vip/tensei-shitara-slime-datta-ken-season-4-episode-20/",
      "image": "https://i0.wp.com/.../image.jpg?quality=100"
    }
  ]
}
```

**Catatan:** Field `season` dibatasi maksimal 5 item (`.slice(0, 5)`).

---

### 2.2 Blog (`GET /blog`, `GET /blog/{page}`, `GET /blog/read/{id}`)

**GET /blog** — Daftar postingan blog
```json
{
  "blog": [
    {
      "title": "Judul Post",
      "sub": "Ringkasan singkat...",
      "date": "August 25, 2026",
      "link": "https://samehadaku.vip/blog/judul-post/",
      "linkId": "judul-post",
      "image": "https://i0.wp.com/.../image.jpg"
    }
  ]
}
```

**GET /blog/read/{id}** — Isi lengkap postingan blog
```json
{
  "title": "Judul Post",
  "author": "Nama Author",
  "date_created": "August 25, 2026",
  "image_cover": "https://i0.wp.com/.../cover.jpg",
  "content": [
    {
      "text": "Paragraf konten...",
      "img": null
    },
    {
      "text": "",
      "img": "https://i0.wp.com/.../image-in-content.jpg"
    }
  ],
  "tags": [
    {
      "title": "Tag Name",
      "link": "https://samehadaku.vip/tag/tag-name/",
      "active": false
    }
  ]
}
```

---

### 2.3 Pencarian Anime (`GET /search/{title}`, `GET /search/{title}/{page}`)

**Query:** URL-encoded title, pagination optional.

**Response Schema:**
```json
{
  "results": [
    {
      "title": "Re:Zero kara Hajimeru Isekai Seikatsu Season 4",
      "score": "8.8",
      "view": "125000",
      "image": "https://i0.wp.com/.../poster.jpg?quality=100",
      "sinopsis": "Deskripsi singkat anime...",
      "genres": ["Action", "Fantasy", "Isekai"],
      "status": "Ongoing",
      "link": "https://samehadaku.vip/anime/rezero-kara-hajimeru-isekai-seikatsu-season-4/",
      "linkId": "rezero-kara-hajimeru-isekai-seikatsu-season-4"
    }
  ]
}
```

---

### 2.4 Detail Anime (`GET /anime/{id}`)

Mengambil halaman detail anime dengan semua informasi lengkap + daftar episode + rekomendasi.

**Response Schema:**
```json
{
  "title": "Re:Zero kara Hajimeru Isekai Seikatsu Season 4",
  "sinopsis": "Deskripsi lengkap anime...",
  "image": "https://i0.wp.com/.../poster.jpg?quality=100",
  "genre": [
    {
      "text": "Action",
      "link": "https://samehadaku.vip/genre/action/"
    },
    {
      "text": "Fantasy",
      "link": "https://samehadaku.vip/genre/fantasy/"
    }
  ],
  "ratingValue": "8.8",
  "ratingCount": "1250",
  "detail": {
    "Total Episode": "24",
    "Studio": "White Fox",
    "Rilis": "2025",
    "Status": "Ongoing",
    "Durasi": "24 min/ep",
    "Sumber": "Light Novel"
    // ... field lain tergantung metadata anime
  },
  "youtube": {
    "link": "https://www.youtube.com/embed/VIDEO_ID",
    "id": "VIDEO_ID"
  },
  "list_episode": [
    {
      "episode": "Episode 20",
      "title": "Episode 20 Sub Indo",
      "date_uploaded": "September 1, 2026",
      "link": "https://samehadaku.vip/rezero-s4-episode-20/",
      "id": "rezero-s4-episode-20"
    }
  ],
  "recommend": [
    {
      "link": "https://samehadaku.vip/anime/other-anime/",
      "image": "https://i0.wp.com/.../poster.jpg",
      "title": "Anime Lain",
      "genre": ["Action", "Fantasy"]
    }
  ],
  "latest": [
    // 5 episode terbaru dari anime lain
  ]
}
```

**Cara kerja:**
1. Fetch halaman detail anime
2. Parse semua metadata (title, sinopsis, genre, rating, detail)
3. Extract semua episode dari `.lstepsiode.listeps ul li`
4. Scraping halaman episode terakhir untuk mengambil daftar **rekomendasi anime**
5. Scraping homepage untuk mengambil **5 episode terbaru**

---

### 2.5 Detail Episode + Streaming (`GET /anime/eps/{link}`)

Mengambil halaman episode spesifik dengan link streaming dan download.

**Response Schema:**
```json
{
  "title": "Re:Zero S4 Episode 20 Sub Indo",
  "eps": "20",
  "uploader": "Azuki",
  "date_uploaded": "September 1, 2026",
  "detail_anime": {
    "title": "Re:Zero kara Hajimeru Isekai Seikatsu Season 4",
    "image": "https://i0.wp.com/.../poster.jpg",
    "sinopsis": "...",
    "genres": ["Action", "Fantasy", "Isekai"]
  },
  "downloadEps": [
    {
      "format": "MP4",
      "data": [
        {
          "quality": "1080p",
          "link": {
            "zippyshare": "https://zippyshare.com/v/xxxxx/file.html",
            "gdrive": "https://drive.google.com/file/d/xxxxx/view",
            "reupload": "https://reupload.example.com/xxxxx"
          }
        },
        {
          "quality": "720p",
          "link": { ... }
        },
        {
          "quality": "480p",
          "link": { ... }
        }
      ]
    }
  ],
  "recommend": [
    {
      "link": "https://samehadaku.vip/anime/other-anime/",
      "image": "https://i0.wp.com/.../poster.jpg",
      "title": "Anime Lain"
    }
  ]
}
```

**Penting untuk Player:**
- Halaman episode berisi **iframe embed** yang tidak terekstrak oleh API ini.
- Untuk mendapatkan URL embed/video, perlu scraping manual atau inspect HTML halaman episode.
- Format iframe biasanya dari provider seperti: Vidhide, Nakama, Premium, OK.mp, dll.

**Struktur iframe di HTML episode:**
```html
<div class="video-container">
  <iframe src="https://vidhide.com/embed-xxxxx.php" ...></iframe>
</div>
```

---

### 2.6 Daftar Semua Anime (`GET /list-anime`, `GET /list-anime/{page}`)

**GET /list-anime** — Tanpa pagination (single page)
**GET /list-anime/{page}** — Dengan pagination

**Response Schema:**
```json
{
  "title": "Daftar Anime",
  "results": [
    {
      "title": "One Piece",
      "score": "8.73",
      "view": "500000",
      "image": "https://i0.wp.com/.../one-piece.jpg?quality=100",
      "sinopsis": "Petualangan Luffy...",
      "genres": ["Action", "Adventure", "Fantasy"],
      "status": "Ongoing",
      "link": "https://samehadaku.vip/anime/one-piece/",
      "linkId": "one-piece"
    }
  ]
}
```

---

### 2.7 Genre (`GET /daftar-genre`, `GET /genre/{id}`)

**GET /daftar-genre** — List semua genre
```json
{
  "daftar_genere": [
    {
      "nama_genre": "Action",
      "link": "https://samehadaku.vip/genre/action/",
      "linkid": "action",
      "total": "1234"
    },
    {
      "nama_genre": "Fantasy",
      "link": "https://samehadaku.vip/genre/fantasy/",
      "linkid": "fantasy",
      "total": "987"
    }
  ]
}
```

**GET /genre/{id}** — Anime berdasarkan genre
```json
{
  "genre": "Action",
  "results": [
    {
      "title": "One Piece",
      "score": "8.73",
      "view": "500000",
      "image": "...",
      "sinopsis": "...",
      "genres": ["Action", "Adventure"],
      "status": "Ongoing",
      "link": "...",
      "linkId": "one-piece"
    }
  ]
}
```

---

### 2.8 Tag (`GET /tag/{tag}`)

**Response Schema:**
```json
{
  "tag": "Shounen",
  "results": [
    {
      "title": "One Piece",
      "view": "500000",
      "image": "...",
      "sinopsis": "...",
      "status": "Ongoing",
      "link": "...",
      "linkId": "one-piece"
    }
  ]
}
```

---

### 2.9 Season (`GET /season`)

Mengambil daftar anime musim ini (hardcoded ke Spring 2020 di kode lama).

```json
{
  "title": "Spring 2020 Anime",
  "results": [
    {
      "title": "Re:Zero S4",
      "score": "8.8",
      "view": "125000",
      "image": "...",
      "sinopsis": "...",
      "genres": ["Action", "Fantasy"],
      "status": "Ongoing",
      "link": "...",
      "linkId": "rezero-s4"
    }
  ]
}
```

---

### 2.10 Jadwal Rilis (`GET /date-release`)

```json
{
  "title": "Jadwal Rilis",
  "results": [
    {
      "day": "Senin",
      "list": [
        {
          "title": "One Piece",
          "image": "...",
          "score": "8.73",
          "genres": ["Action", "Adventure"],
          "link": "...",
          "linkId": "one-piece"
        }
      ]
    },
    {
      "day": "Selasa",
      "list": [...]
    }
  ]
}
```

---

### 2.11 Blog Category (`GET /blog-category/{category}`, `GET /blog-category/{category}/{page}`)

Sama struktur dengan `/blog` tapi difilter berdasarkan kategori.

---

## 3. Panduan Implementasi Fitur Website

### 3.1 Fitur Search

**Flow:**
1. User mengetik query → panggil `GET /search/{query}`
2. Tampilkan hasil dalam grid/list dengan: image, title, score, genres, status
3. Klik item → panggil `GET /anime/{linkId}` untuk detail

**Tip:** Cache hasil search selama 5-10 menit untuk mengurangi rate limit.

---

### 3.2 Fitur Daftar Anime + Sort by Huruf Abjad

**Flow:**
1. Panggil `GET /list-anime` (atau `/daftar-genre` untuk grouping)
2. Hasilkan daftar abjad A-Z untuk navigation
3. Implementasikan client-side sort/filter berdasarkan `title`

**Struktur Sort Abjad:**
```javascript
// Group anime by first letter
const grouped = {};
data.results.forEach(anime => {
  const letter = anime.title.charAt(0).toUpperCase();
  if (!grouped[letter]) grouped[letter] = [];
  grouped[letter].push(anime);
});

// Filter by selected letter
const filtered = grouped[selectedLetter] || [];
```

**Alternatif:** Gunakan `GET /genre/{id}` untuk filtering berdasarkan genre.

---

### 3.3 Fitur Tampil Daftar Sumber Video

**PENTING:** API ini **TIDAK** mengembalikan URL streaming/embed secara langsung.

**Cara mendapatkan embed URL:**

**Opsi A — Scraping Manual (Recommended):**
```javascript
async function getEpisodeEmbed(episodeLink) {
  // Fetch halaman episode
  const html = await fetch(episodeLink).then(r => r.text());

  // Extract iframe src
  const match = html.match(/<iframe[^>]+src="([^"]+)"/);
  if (match) return match[1];

  return null;
}
```

**Opsi B — Modifikasi API Controller:**
Tambahkan scrape iframe di `readanime()` controller:
```javascript
data.embed = $('iframe').map(function() {
  return {
    src: $(this).attr('src'),
    provider: extractProvider($(this).attr('src'))
  };
}).get();
```

**Opsi C — Direct Scraping ke Provider:**
Identifikasi provider dari URL (Vidhide, Nakama, OK.mp, dll) dan akses langsung jika ada API publik.

---

### 3.4 Fitur Detail Video Lengkap

**Flow:**
1. `GET /anime/{linkId}` → dapat semua metadata + daftar episode
2. `GET /anime/eps/{episodeLink}` → dapat info episode + download links
3. Tampilkan player dengan iframe dari scraping tambahan

**Struktur Data yang Tersedia:**

| Field | Sumber | Keterangan |
|-------|--------|------------|
| Title | `/anime/{id}` | Judul anime |
| Sinopsis | `/anime/{id}` | Deskripsi lengkap |
| Image | `/anime/{id}` | Poster anime |
| Genre | `/anime/{id}` | Array genre objects |
| Rating | `/anime/{id}` | ratingValue + ratingCount |
| Detail | `/anime/{id}` | Studio, tahun, episode count, dll |
| YouTube Trailer | `/anime/{id}` | iframe YouTube (jika ada) |
| List Episode | `/anime/{id}` | Array episode dengan link |
| Download Links | `/anime/eps/{link}` | Zippyshare, Google Drive, Reupload |
| Embed URL | **Not in API** | Perlu scraping tambahan |

---

## 4. Contoh Penggunaan API (Code Snippets)

### JavaScript/Node.js

```javascript
const axios = require('axios');
const BASE_URL = 'http://localhost:3000'; // Self-hosted

// Search anime
async function searchAnime(query) {
  const res = await axios.get(`${BASE_URL}/search/${encodeURIComponent(query)}`);
  return res.data.results;
}

// Get anime detail
async function getAnimeDetail(linkId) {
  const res = await axios.get(`${BASE_URL}/anime/${linkId}`);
  return res.data;
}

// Get episode + download links
async function getEpisodeDetail(episodeLink) {
  const res = await axios.get(`${BASE_URL}/anime/eps/${episodeLink}`);
  return res.data;
}

// Get all genres
async function getGenres() {
  const res = await axios.get(`${BASE_URL}/daftar-genre`);
  return res.data.daftar_genere;
}
```

### Python

```python
import httpx

BASE = "http://localhost:3000"

async def search_anime(query: str) -> list:
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{BASE}/search/{query}")
        return r.json()["results"]

async def get_anime_detail(link_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{BASE}/anime/{link_id}")
        return r.json()
```

---

## 5. Catatan Penting & Limitasi

### ⚠️ Rate Limiting
- API melakukan scraping real-time ke samehadaku.vip
- Setiap request = 1+ HTTP call ke website source
- **Tidak ada rate limiting built-in**, tapi website target bisa memblokir IP jika terlalu sering
- **Saran:** Implementasikan cache lokal dengan TTL 5-15 menit

### ⚠️ Domain Change
- Base URL hardcoded ke `samehadaku.vip`
- Website original sekarang di `v2.samehadaku.how` dan `samehadaku.care`
- Jika scraping gagal, update base URL di controller

### ⚠️ Embed URL Tidak Tersedia
- API tidak mengekstrak URL iframe streaming
- Harus dilakukan scraping tambahan atau modifikasi controller

### ⚠️ Heroku Demo Down
- `samehadaku-rest-api.herokuapp.com` sudah tidak aktif
- **Harus self-host** untuk penggunaan production

---

## 6. Self-Host Setup

```bash
# Clone repo
git clone https://github.com/SAMEHADAKU-CARE/samehadaku-rest-api.git
cd samehadaku-rest-api

# Install dependencies
npm install

# Start server
npm start
# Atau dengan auto-reload
npm run nodemon
```

Server akan berjalan di `http://localhost:3000`

---

## 7. Alternatif API Lain

| Project | Bahasa | Status | Notes |
|---------|--------|--------|-------|
| `rizalord/samehadaku-api` | Node.js | Active | Mirip dengan official |
| `elevenime-api` (npm) | TypeScript | Active | Wrapper npm package |
| `samehadaku-scraper-api` | Python | Active | Versi Python |

---

## 8. Rekomendasi Arsitektur untuk Website Baru

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND (Next.js)                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  Home    │  │  Search  │  │  Detail  │          │
│  │  Genre   │  │  List    │  │  Player  │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │             │             │                  │
│       └─────────────┴─────────────┘                  │
│                    │                                 │
│              ┌─────▼─────┐                           │
│              │  Xing API │ ◄── PostgreSQL + Redis    │
│              │  (Your)   │    Scheduled sync worker  │
│              └─────┬─────┘                           │
│                    │                                 │
│              ┌─────▼─────┐                           │
│              │Sanka API  │   (Original scraper)      │
│              │ Samehada  │                           │
│              └───────────┘                           │
└─────────────────────────────────────────────────────┘
```

**Langkah implementasi:**
1. Self-host Samehadaku REST API sebagai source data
2. Buat scheduled worker yang sync metadata ke PostgreSQL secara berkala
3. Bangun Xing API layer di atas database untuk caching & rate limiting
4. Frontend hanya menghubungi Xing API, tidak langsung ke scraper
5. Untuk embed URL, lakukan scraping on-demand dengan cache singkat

---

*Dokumen ini dibuat berdasarkan analisis source code GitHub repository SAMEHADAKU-CARE/samehadaku-rest-api dan Rizalord/samehadaku-api.*
