# Xing Anime API Contract

Version: `v1`

The API is the platform boundary for web and future Android TV clients. Clients must use source-qualified identifiers and must not call upstream providers directly.

## Common response envelope

Success:

```json
{
  "success": true,
  "data": [],
  "meta": {},
  "error": null
}
```

Error:

```json
{
  "success": false,
  "data": null,
  "meta": {},
  "error": {
    "code": "CATALOG_UNAVAILABLE",
    "message": "Katalog sedang tidak tersedia"
  }
}
```

`error.code` is stable for client behavior; `error.message` is display-safe Indonesian text.

## Source identity

Allowed sources:

```text
otakudesu
samehadaku
oploverz
```

A provider slug or episode ID is not globally unique. Clients must always retain `source` together with `slug` or `episodeId`.

## Pagination metadata

Catalog and episode list endpoints return:

```json
{
  "page": 1,
  "limit": 24,
  "total": 0,
  "pageCount": 0,
  "hasNext": false,
  "hasPrevious": false,
  "storage": "postgres"
}
```

Supported limits are bounded server-side. Clients should use `hasNext` and `hasPrevious`, not calculate navigation from item count.

## Catalog and search

### `GET /api/v1/catalog`

Query parameters:

- `q` — optional title, canonical slug, or provider slug query
- `letter` — optional single letter `A`–`Z`
- `source` — optional source ID
- `page` — 1-based page, default `1`
- `limit` — default `24`, maximum `100`

Use `letter` for A–Z browsing and `q` for search. The endpoint reads PostgreSQL and does not request providers per page.

### `GET /api/v1/catalog/search`

Same pagination and optional source parameters as catalog. `q` is required.

Error codes:

```text
MISSING_QUERY
INVALID_LETTER
INVALID_SOURCE
CATALOG_UNAVAILABLE
```

## Anime detail

## Provider discovery

### `GET /api/v1/sources/{source}/discover/{kind}`

Direct discovery is cache-backed and rate-limited by the Xing API; browser clients must never call Sanka directly.

- `kind`: `ongoing`, `completed`, `search`, atau `genre`
- `page`: opsional, default `1`
- `q`: wajib untuk `search` dan `genre`; isi judul atau ID genre provider

Respons `data` berisi `{ items, page, hasNext, hasPrevious, pageCount }`. `pageCount` bernilai `null` bila provider tidak memberi jumlah halaman.

### `GET /api/v1/sources/{source}/genres`

Mengembalikan genre provider `{ id, title }` yang tersedia. Saat ini Otakudesu dan Samehadaku menyediakan daftar genre; Oploverz menjawab array kosong karena endpoint genre tidak didokumentasikan.

### `GET /api/v1/sources/{source}/anime/{slug}`

By default returns the backwards-compatible full detail shape. For a lightweight detail request use:

```text
?includeEpisodes=false
```

The lightweight response keeps metadata and `availableSources` while returning an empty `episodes` array. Use the episode endpoint below for large episode lists.

## Episode pagination and search

### `GET /api/v1/sources/{source}/anime/{slug}/episodes`

Query parameters:

- `q` — optional episode number, title, or provider episode ID
- `page` — 1-based page, default `1`
- `limit` — default `50`, maximum `100`

The endpoint is PostgreSQL-backed and does not call the upstream provider for normal stored catalog reads.

Episode item:

```json
{
  "id": "provider-episode-id",
  "title": "Episode 1",
  "number": 1,
  "releaseDate": null
}
```

## Player episode metadata

### `GET /api/v1/sources/{source}/episode/{episodeId}`

Returns episode metadata and source-qualified navigation:

```json
{
  "source": "otakudesu",
  "id": "episode-id",
  "animeSlug": "anime-slug",
  "previousEpisodeId": "previous-id-or-null",
  "nextEpisodeId": "next-id-or-null",
  "playback": []
}
```

Previous/next values are derived from persisted ordering partitioned by anime and source. Clients must not generate episode IDs with string arithmetic.

## Playback

### `GET /api/v1/sources/{source}/episode/{episodeId}/playback`

Resolves playback only when the user opens the player. Playback URLs are short-lived integration data and must not be persisted as durable catalog records.

### `GET /api/v1/sources/{source}/server/{serverId}`

Resolves one selected server on demand. Do not prefetch every server or quality.

Playback modes:

```text
embed
external
unavailable
unknown
```

- `embed` — may be rendered in the player
- `external` — open as a top-level provider link
- `unavailable` — do not offer automatically
- `unknown` — requires explicit user action; do not auto-embed

## Home and partial provider status

### `GET /api/v1/home`

When multi-source providers are configured, `meta` includes:

```json
{
  "cached": true,
  "partial": false,
  "providers": {
    "otakudesu": "healthy",
    "samehadaku": "healthy",
    "oploverz": "unavailable"
  }
}
```

A partial success returns HTTP `200` with successful data and `partial: true`. HTTP `503` is reserved for the case where every configured source fails.

## Anonymous watch history

The current browser history is local-only and stores source-qualified metadata under:

```text
xing-anime:watch-history:v1
```

Maximum length: `50` entries.

The history record never stores playback URLs. A future authenticated sync API must preserve the same identity rule:

```text
(userId, source, episodeId)
```

## Android TV client guidance

Android TV should use the same API contracts and models:

- use a repository/data-source layer around `/api/v1`;
- keep `source` with every anime and episode ID;
- use `meta.hasNext`/`meta.hasPrevious` for paging;
- render `partial` provider status as a non-blocking notice;
- keep detail metadata and episode paging separate;
- resolve playback only after explicit episode/server selection;
- treat `external` and `unknown` playback differently from `embed`;
- never call Sanka/provider URLs directly from the TV app;
- never persist temporary playback URLs as catalog data.
