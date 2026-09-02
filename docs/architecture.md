# Xing Anime Architecture

## Data flow

```text
Sanka API
  -> Sanka adapter
  -> Redis global limiter/cache
  -> Sync worker
  -> PostgreSQL
  -> Directus admin
  -> Xing API facade
  -> Next.js web / Android TV
```

## Initial collections

- `anime`
- `anime_sources`
- `episodes`
- `playback_sources`
- `sync_runs`
- `provider_health`
- `genres`
- `anime_genres`
- `users`
- `watch_history`
- `bookmarks`

## Boundary

Directus is an internal administration layer. Client applications must consume versioned Xing API endpoints such as `/api/v1/home`, `/api/v1/anime/:id`, `/api/v1/anime/:id/episodes`, and `/api/v1/episodes/:id/playback`.

## First vertical slice

1. Validate Sanka endpoint contracts.
2. Implement one Sanka client with schema validation.
3. Add Redis limiter/cache and a single sync operation.
4. Persist normalized home/detail/episode data.
5. Expose Xing API read endpoints.
6. Build homepage, detail, and watch page.
7. Verify Docker health and rate-limit tests.
