# Cara Kerja Load Anime - Xing Anime

## Arsitektar Data Pipeline

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Sanka API     │────▶│   Backend API    │────▶│   PostgreSQL    │
│  (sankavollerei)│     │  (Fastify)       │     │   (Catalog)     │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                │                       │
                    ┌───────────▼───────────┐    ┌──────▼───────┐
                    │   Sync Worker         │    │   Next.js Web │
                    │  - Seed /anime/unlimited│    │   /catalog    │
                    │  - Hydrate detail     │    │   /anime/{id} │
                    │  - Update schedule    │    │   Search      │
                    └───────────────────────┘    └──────────────┘
```

## Flow Load Anime Terbaru

### 1. Initial Startup (Saat API dimulai)
```
server.ts
└── runFullSyncCycle()  ← Dipanggil sekali saat startup
    ├── runSeedCycle(hydrationLimit=12)
    │   ├── Step 1: runSeedAllAnime()
    │   │   └── GET /anime/unlimited (Sanka API)
    │   │       └── Insert ~1,856 anime → PostgreSQL (status: discovered)
    │   │
    │   ├── Step 2: hydrateDiscoveredSources(12)
    │   │   └── Ambil 12 anime dari pool discovered
    │   │       └── GET /anime/{slug} untuk tiap source
    │   │           └── Simpan detail + episodes → PostgreSQL
    │   │               └── Jika ada episode valid → status: verified
    │   │
    │   └── Step 3: runSchedulesOnce()
    │       └── Update jadwal rilis anime
    │
    └── Run Catalog Sync
        └── GET /home (Sanka API)
            └── Update home entries
```

### 2. Periodic Sync (Berjalan otomatis)
```
Timer: Setiap 3600 detik (1 jam)
└── runFullSyncCycle()  ← Sama seperti startup
    └── Re-seed + Hydrate 12 more + Schedule update

Timer: Setiap 1800 detik (30 menit)
└── runCatalogCycle()
    └── Catalog sync (home only)
    └── Poster backfill
```

### 3. User Request Flow (Read Path)
```
User membuka halaman Katalog
    └── GET /api/v1/catalog
        └── PostgreSQL query (FIRST)
            └── SELECT * FROM anime
                JOIN anime_sources ON source_id
                LEFT JOIN episodes ON episode.source_id
                WHERE source_status = 'verified'
                AND episode EXISTS
                ORDER BY updated_at DESC
                LIMIT 20 OFFSET 0
            └── Return JSON
                └── Frontend render catalog cards
```

## Status Source

| Status | Deskripsi |
|--------|-----------|
| `discovered` | Anime ditemukan dari `/anime/unlimited`, belum diverifikasi |
| `verified` | Sudah di-hydrate, punya episode valid |
| `hydration_error` | Gagal di-hydrate (rate limit/403/error) |

## Metadata yang Disimpan

**Tabel `anime`:**
- `id` - UUID
- `title` - Judul utama
- `slug` - URL-friendly slug
- `visibility` - 'published' | 'draft'
- `poster_url` - URL poster (allowlist: anilist.co, anili.st)
- `poster_status` - 'resolved' | 'unresolved'
- `created_at`, `updated_at`

**Tabel `anime_sources`:**
- `id` - UUID
- `anime_id` - FK ke anime
- `source` - 'otakudesu' | 'samehadaku' | 'oploverz'
- `provider_slug` - Slug dari provider
- `provider_anime_id` - ID dari provider
- `source_status` - 'discovered' | 'verified' | 'hydration_error'
- `home_rank` - Urutan dari home endpoint
- `details_fetched_at` - Waktu terakhir detail di-fetch
- `hydration_checked_at` - Waktu terakhir diverifikasi episode

**Tabel `episodes`:**
- `id` - UUID
- `source_id` - FK ke anime_sources
- `provider_episode_id` - ID episode dari provider
- `episode_number` - Angka episode (bisa decimal: 1015.5)
- `episode_title` - Judul episode
- `slug` - URL-friendly slug
- `visibility` - 'published' | 'draft'
- `servers` - JSONB: array server playback
- `created_at`, `updated_at`

## Rate Limit & Concurrency

| Parameter | Value |
|-----------|-------|
| Official limit | 30 requests/menit |
| Internal budget | **18 requests/menit** (conservative) |
| Min interval | 3500 ms antar request |
| Concurrency | **1** (sequential, tidak paralel) |
| Max retries | 1x untuk timeout/5xx |
| 403/429 | **Tidak di-retry**, pause circuit |

## Error Handling

| Status | Behavior |
|--------|----------|
| `200` | Normal, simpan data |
| `403` | Pause shared circuit, no retry |
| `429` | Bounded Retry-After (min 1s, max 15 menit), stop queue |
| `5xx` / Timeout | 1x bounded retry |

## Query Catalog (Client-Side Search)

```typescript
// apps/web/app/components/catalog-client.tsx
// Load semua item sekali dari API
const response = await fetch('/api/v1/catalog?limit=1000');
const data = await response.json();

// Filter lokal oleh query/huruf/source
const filtered = useMemo(() => {
  return data.items.filter(anime => {
    const matchQuery = !query ||
      anime.title.toLowerCase().includes(query.toLowerCase()) ||
      anime.slug.includes(slug);
    const matchLetter = !letter || anime.title[0].toUpperCase() === letter;
    const matchSource = !source || anime.source === source;
    return matchQuery && matchLetter && matchSource;
  });
}, [data.items, query, letter, source]);
```

## Database Stats (Update Real-time)

```sql
-- Total anime di database
SELECT COUNT(*) FROM anime WHERE visibility = 'published';

-- Verified sources dengan episode valid (yang tampil di katalog)
SELECT COUNT(DISTINCT a.id)
FROM anime a
JOIN anime_sources s ON s.anime_id = a.id
WHERE a.visibility = 'published'
AND s.source_status = 'verified'
AND EXISTS (
  SELECT 1 FROM episodes e
  WHERE e.source_id = s.id
  AND e.visibility = 'published'
  AND e.episode_number > 0
);

-- Breakdown per source
SELECT source, source_status, COUNT(*)
FROM anime_sources
GROUP BY source, source_status;
```

## Monitoring Logs

```bash
# Lihat log sync
docker compose logs -f api | grep -E "seed|hydrate|sync"

# Check status
curl http://localhost:4000/api/v1/health

# Database stats
docker compose exec postgres psql -U xing_anime -d xing_anime -c \
  "SELECT COUNT(*) FROM anime WHERE visibility='published';"
```
