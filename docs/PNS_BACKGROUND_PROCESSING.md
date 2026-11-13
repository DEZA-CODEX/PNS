# PNS background processing

## Architecture and current task scope

FastAPI and Celery use the same `backend/` Python application. FastAPI runs on Vercel; Railway runs Celery independently as a worker service and a separate, single Celery Beat service. Supabase PostgreSQL remains the source of truth. Upstash is used through its existing REST client for API cache reads/writes and a Redis-protocol URL for Celery.

The current verified background task is `cache.invalidate_images`. The application has managed-image data and image cache entries, but no booking, email, report, or other operational data models. Those tasks and materialized-view refreshes are intentionally not scheduled until the corresponding application workflows exist.

`public.background_jobs` is both the durable job record and dispatch outbox. The API commits the job before publishing to Redis. If publishing fails, the record remains `pending`; Beat retries pending dispatches. A stable task ID and idempotent cache deletion make duplicate delivery safe. This is at-least-once delivery, not exactly-once execution.

## Run locally

Install backend dependencies from `backend/requirements.txt`, apply the migration, and set:

```text
DATABASE_URL=<the backend's PostgreSQL URL, with SSL enabled>
CELERY_BROKER_URL=<Upstash Redis protocol URL, usually rediss://...>
UPSTASH_REDIS_REST_URL=<existing Upstash HTTPS REST URL>
UPSTASH_REDIS_REST_TOKEN=<existing Upstash REST token>
REDIS_KEY_PREFIX=pns:backend:
PNS_ALLOWED_HOSTS=localhost,testserver
```

`UPSTASH_REDIS_REST_URL` is an HTTPS REST endpoint and is not a Celery broker URL. Never copy a token into source control or expose it through a `NEXT_PUBLIC_` variable.

From `backend/`:

```sh
celery -A app.celery_app:celery_app worker --loglevel=INFO --queues=pns-default,pns-maintenance
celery -A app.celery_app:celery_app beat --loglevel=INFO --schedule=/tmp/pns-celerybeat-schedule
```

The worker concurrency is configured by `PNS_CELERY_WORKER_CONCURRENCY` (default `1`, permitted range `1`–`16`); its prefetch multiplier is `1`. Only one Beat process should own this schedule. Celery uses JSON serialization, late acknowledgements, one-message worker prefetch, bounded retries, task time limits, and stable job/task IDs. The synchronous worker database engine uses a separate one-connection pool and the same `DATABASE_URL` (converted to the psycopg driver); its SSL query parameters are preserved.

The FastAPI deployment also needs the same `CELERY_BROKER_URL` to publish an admin-requested job immediately. Configure it as a server-side Vercel environment variable; do not use a `NEXT_PUBLIC_` prefix. If the broker publish fails, FastAPI keeps the PostgreSQL outbox row pending and the Beat dispatcher retries it.

## Jobs API

All endpoints are under `/api/v1/admin/jobs` and use the existing admin session cookie and RBAC:

- `POST /api/v1/admin/jobs` with `{"type":"cache.invalidate_images"}` requires `jobs.create`. An optional `Idempotency-Key` header deduplicates submissions.
- `GET /api/v1/admin/jobs` requires `jobs.read`; supports `page`, `page_size` (maximum 100), `status`, and `type`.
- `GET /api/v1/admin/jobs/{job_id}` and `GET /api/v1/admin/jobs/{job_id}/status` require `jobs.read`.

The admin UI displays job state and polls every 10 seconds only while there are active jobs. A failed publish remains visible as pending and is retried by Beat.

## Operations and troubleshooting

- Check Railway worker and Beat logs for broker or PostgreSQL connectivity errors.
- Confirm `CELERY_BROKER_URL` is a Redis-protocol endpoint; the REST URL/token are only for FastAPI's Upstash REST client.
- Upstash documents native Redis TCP and `BRPOP` support ([command reference](https://upstash.com/docs/redis/commands/list/brpop)), but the complete Celery transport was not tested against this project's Upstash database. Verify the actual broker connection and queue delivery before relying on production dispatch.
- Confirm the Railway service and Supabase project regions and the configured PostgreSQL endpoint. Keep the existing backend endpoint and SSL settings; do not silently substitute a pooler.
- `pending` jobs indicate that the database record is durable but broker dispatch has not succeeded. Beat retries the outbox at the configured interval.
- `retrying` and `failed` records expose a sanitized error class, not exception messages, stack traces, credentials, or SQL.
- Terminal jobs older than `PNS_BACKGROUND_JOB_RETENTION_DAYS` are removed by the daily cleanup task.
- Dispatch runs every `PNS_CELERY_JOB_DISPATCH_INTERVAL_SECONDS` (default 30 seconds). Terminal cleanup runs daily at `PNS_CELERY_JOB_CLEANUP_HOUR` / `PNS_CELERY_JOB_CLEANUP_MINUTE` UTC (defaults 03:15).

No email, image transformation, or report task is configured because no matching workflow currently exists. Image uploads continue using the existing request flow and Supabase Storage behavior.
