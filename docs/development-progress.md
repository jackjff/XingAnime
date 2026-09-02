# Xing Anime — Development Progress

_Last updated: 2026-09-03_

## Current state

Xing Anime is a dark orange-sunrise anime catalog and watch application in Indonesian. The project currently contains the web frontend, API/provider layer, PostgreSQL catalog integration, Redis caching/coordination, Directus infrastructure, and Docker Compose configuration.

The repository is in active development. Local source, tests, typechecks, and production web build are passing. Live-server deployment and final browser verification remain pending until the target SSH server and runtime container restart are authorized and available.

## Architecture

- **Next.js web**: home, anime detail, schedule, and watch/player routes.
- **Xing API**: stable application facade; the frontend does not call Sanka directly.
- **PostgreSQL**: primary read source for catalog metadata, anime sources, episodes, schedules, and sync records.
- **Redis**: cache, single-flight/deduplication, leases, and rate-limit coordination.
- **Directus**: CMS/admin foundation.
- **Sanka adapters**: Otakudesu, Samehadaku, and Oploverz normalization through a shared provider contract.

## Completed development

### Catalog and provider layer

- Added normalized multi-source contracts for anime summaries, details, episodes, schedules, playback sources, and source alternatives.
- Added provider routes:
  - `GET /api/v1/sources`
  - `GET /api/v1/sources/:source/home`
  - `GET /api/v1/sources/:source/anime/:slug`
  - `GET /api/v1/sources/:source/episode/:id`
  - `GET /api/v1/sources/:source/episode/:id/playback`
  - `GET /api/v1/sources/:source/server/:serverId`
  - `GET /api/v1/sources/:source/schedule`
- Added cache-first and single-flight provider access.
- PostgreSQL is used before provider fallback for persisted metadata.
- Added schedule synchronization and partial-failure handling.
- Added persisted episode navigation using SQL `LAG`/`LEAD`, partitioned by anime and source.

### Poster pipeline

- Added centralized poster URL validation.
- Trusted poster sources are limited to AniList CDN hosts:
  - `https://s<number>.anilist.co/...`
  - `https://img.anili.st/...`
- Provider hotlink/proxy URLs and known blocked hosts are rejected.
- Added AniList fallback lookup with bounded title candidates, including season aliases such as `S2` → `2nd Season`.
- Added database cleanup for unusable poster URLs.
- Added frontend `PosterImage` with local `/poster-fallback.svg` fallback and one-time error recovery.
- Added poster fallback rendering to episode list rows as well as home, detail, and schedule cards.

### Web UI

- Built responsive dark orange-sunrise layouts for:
  - Home
  - Anime detail
  - Schedule
  - Watch/player
- Added local episode pagination and search:
  - 50 episodes per page
  - Search by episode number or title
  - First/previous/next/latest controls
  - Verified with a 1,180-episode One Piece catalog case
- Added source switching links between provider detail pages.
- Added server selection with on-demand resolution.
- Added request cancellation when switching episodes or servers.
- Added graceful playback fallback instead of routing to an application error page.

### Playback safety and source policy

Playback URLs are treated as untrusted provider output. The project does not bypass CSP, X-Frame-Options, anti-bot controls, authentication, or provider access restrictions. It does not proxy or re-host third-party video.

Current capability handling:

- `embed`: may render in an iframe when permitted by the capability result.
- `external`: shown as a direct-open source and not forced into an iframe.
- `unavailable`: hidden from the initial source list when the host/label is known to fail or be ad-heavy.
- `unknown`: requires an explicit user action before attempting an iframe.

Known source policies:

- `ondesuhd` and `odstreamhd`: marked unavailable based on repeated provider failure evidence.
- `filedon`: marked unavailable because of intrusive, non-dismissible advertising behavior.
- `desustream.net`: marked unavailable based on prior 403/frame-policy evidence.
- `desustream.com`: treated as external-only; it is not forced into an iframe.
- Resolver failure attempts a bounded single alternative and reports an inline notice instead of showing a page-level error.

No mass probing or parallel playback prefetch is performed. Playback resolution remains on demand.

## Rate-limit safeguards

- Official provider limit observed: 30 requests/minute.
- Internal budget: 18 requests/minute.
- Minimum interval: approximately 3,500 ms.
- Target concurrency: 1.
- Maximum retry count: 1.
- No retry on HTTP 403 or 429.
- Cache and single-flight are retained.
- Sync uses a Redis lease to avoid duplicate workers.

## Verification results

Last local quality gate:

```text
npm run test       PASS — 15 test files, 38 tests
npm run typecheck  PASS
npm run lint       PASS
npm run build      PASS — Next.js 15.5.25
```

Focused regression coverage includes:

- provider normalization;
- playback capability classification;
- known blocked/ad-heavy sources;
- poster enrichment and cleanup;
- source routing;
- PostgreSQL episode previous/next navigation;
- cache and sync behavior.

## Remaining blockers

1. **Runtime API image refresh**: the running API container still uses an older image and does not yet expose the new playback capability fields. Docker rebuild currently hits a Docker Hub TLS timeout while resolving `node:22-alpine`.
2. **Browser verification**: the browser harness is waiting for Chrome remote-debugging approval. The latest build is verified, but the new runtime behavior still needs a real browser smoke test.
3. **SSH live-testing deployment**: target host, SSH user, port, and authorized key/config path have not yet been provided. The local `C:\Users\Jack\Documents\oracle` path is outside the allowed workspace and has not been read.
4. **Poster completeness**: home and schedule audits are complete, while a full catalog pass may still require bounded AniList alias/manual mappings for uncommon titles.
5. **Provider rights**: embed/distribution rights for third-party playback sources remain to be verified before production use.

## Next development sequence

1. Confirm SSH target and deploy the project to a dedicated live-testing folder.
2. Build/start the API and web containers on the test server.
3. Verify API capability fields, episode navigation IDs, poster responses, and web routes.
4. Run desktop and narrow-viewport browser smoke tests.
5. Record deployment evidence and remaining provider-specific failures.
6. Begin the next feature adjustment only after the live-testing baseline is green.

## Security and repository hygiene

- `.env`, credential files, tokens, keys, local database data, build output, and dependency directories are excluded from version control.
- No secret values are recorded in this document.
- No commit is pushed until the local contents and generated progress document have been reviewed.
