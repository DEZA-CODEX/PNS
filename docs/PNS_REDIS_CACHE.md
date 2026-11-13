# PNS Redis cache

The backend's existing `app.core.cache` singleton uses the Upstash Redis REST API. It is reused by FastAPI requests, applies `REDIS_KEY_PREFIX` (default `pns:backend:`), and degrades to PostgreSQL reads when cache access fails. Cache operations use the existing bounded REST retry behavior; cache failures are logged and do not fail public reads.

The REST URL/token accept either the `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` names or Vercel integration names `REDIS_KV_REST_API_URL` / `REDIS_KV_REST_API_TOKEN` (also `KV_REST_API_URL` / `KV_REST_API_TOKEN`). Use a writable token; the read-only token cannot create or update converter data.

The Celery broker uses a separate Redis-protocol setting, `CELERY_BROKER_URL` (or `REDIS_URL` / `REDIS_KV_URL`). Do not use the HTTPS REST URL as the broker URL. Cache and Celery use distinct key/queue namespaces.

## Current cached resources

Managed image data is cached for 300 seconds by default (`PNS_IMAGE_CACHE_TTL_SECONDS`):

- `images:homepage` — consolidated managed room/dining metadata; hero images remain exclusively in the code manifest.
- `images:rooms` and `images:dining` — section data for the existing site endpoints.
- `images:about` — managed About-page image metadata.
- `images:room:{category}:{location}` and `images:dining:{category}:{location}` — category endpoint responses.

The cache contains public response data only. Admin and user-specific data are not stored in these shared keys.

## Invalidation

Successful admin image mutations commit PostgreSQL first and then invalidate relevant image cache patterns. Room changes invalidate homepage, room-section, and room-category entries; dining changes invalidate homepage, dining, About, and dining-category entries. A read-only admin image listing does not invalidate caches.

The cache invalidation operation is best-effort after the database commit; its short TTL bounds staleness if Redis is unavailable. An authorized administrator can also submit a durable `cache.invalidate_images` job, which uses the same key prefix and is retried by Celery.

The current homepage-managed-image endpoint already batches image and disabled-bundled-image reads into two SQL queries and serves both room and dining image data. The homepage hero manifest remains bundled code and is never selected from PostgreSQL.

## Environment and diagnosis

FastAPI cache settings:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- Vercel aliases: `REDIS_KV_REST_API_URL` and `REDIS_KV_REST_API_TOKEN`
- Celery broker: `CELERY_BROKER_URL` (or `REDIS_URL` / `REDIS_KV_URL`)
- `REDIS_KEY_PREFIX` (default `pns:backend:`)
- `REDIS_ENABLED` (default `true`)
- `PNS_REDIS_TIMEOUT_SECONDS` (default `2.5`)
- `PNS_IMAGE_CACHE_TTL_SECONDS` (default `300`)

Check the health endpoint and backend logs for Redis degradation. A miss or Redis outage must still reach PostgreSQL. Verify the protocol broker URL separately for Celery; the broker's command compatibility was not externally tested.
