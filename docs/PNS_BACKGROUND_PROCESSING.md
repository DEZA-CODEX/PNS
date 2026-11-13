# PNS background processing

## Architecture and current task scope

FastAPI and Celery use the same `backend/` Python application. FastAPI runs on Vercel; Railway runs Celery independently as a worker service and a separate, single Celery Beat service. Supabase PostgreSQL remains the source of truth. Upstash is used through its existing REST client for API cache reads/writes and a Redis-protocol URL for Celery.

The current verified background task is `cache.invalidate_images`. The application has managed-image data and image cache entries, but no booking, email, report, or other operational data models. Those tasks and materialized-view refreshes are intentionally not scheduled until the corresponding application workflows exist.

`public.background_jobs` is both the durable job record and dispatch outbox. The API commits the job before publishing to Redis. If publishing fails, the record remains `pending`; Beat retries pending dispatches. A stable task ID and idempotent cache deletion make duplicate delivery safe. Task status updates do not reopen terminal jobs. This is at-least-once delivery, not exactly-once execution.

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

Psycopg automatic prepared statements are disabled on the worker engine with `prepare_threshold=None` to avoid prepared-statement name collisions when the configured PostgreSQL endpoint uses transaction pooling. FastAPI has a separate asyncpg engine with its statement cache disabled. The repository does not contain the deployed database URL, so verify the selected Supabase connection mode in the deployment dashboard; do not replace the endpoint as part of this fix.

The FastAPI deployment also needs the same `CELERY_BROKER_URL` to publish an admin-requested job immediately. Configure it as a server-side Vercel environment variable; do not use a `NEXT_PUBLIC_` prefix. If the broker publish fails, FastAPI keeps the PostgreSQL outbox row pending and the Beat dispatcher retries it.

## Jobs API

All endpoints are under `/api/v1/admin/jobs` and use the existing admin session cookie and RBAC:

- `POST /api/v1/admin/jobs` with `{"type":"cache.invalidate_images"}` requires `jobs.create`. An optional `Idempotency-Key` header deduplicates submissions.
- `GET /api/v1/admin/jobs` requires `jobs.read`; supports `page`, `page_size` (maximum 100), `status`, and `type`.
- `GET /api/v1/admin/jobs/{job_id}` and `GET /api/v1/admin/jobs/{job_id}/status` require `jobs.read`.
- `POST /api/v1/admin/jobs/diagnostics/celery` requires `jobs.read` and intentionally publishes the lightweight `pns.tasks.celery_connectivity_test` task to `pns-maintenance`. It does not create a business job or modify PostgreSQL data; the task ID is returned and completion is visible in worker logs. Celery result storage is disabled.

The admin UI displays job state and polls every 10 seconds only while there are active jobs. A failed publish remains visible as pending and is retried by Beat.

Admin login remains synchronous: the frontend calls `/api/v1/admin/auth/login`, FastAPI verifies credentials, writes the session and audit event to PostgreSQL, and returns the session cookie. Login does not enqueue a Celery task; this is intentional.

## Operations and troubleshooting

- Check Railway worker and Beat logs for broker or PostgreSQL connectivity errors.
- For a durable job, correlate the API `background_job_created` / `background_job_published` log and its response `job.id` with the worker's `background_task_started` and `background_task_finished` events. For a broker-only probe, an admin with `jobs.read` can invoke `POST /api/v1/admin/jobs/diagnostics/celery`; correlate the returned `taskId` with worker logs. The endpoint only confirms publication; a worker completion event confirms consumption and execution.
- Task logs are JSON records with task/job IDs, type, queue, UTC start time, duration, retry count, final status, and a sanitized failure class. They do not include exception messages or credentials. Dispatcher summary events include eligible/published/failed counts and job IDs.
- Confirm `CELERY_BROKER_URL` is a Redis-protocol endpoint; the REST URL/token are only for FastAPI's Upstash REST client.
- Upstash documents native Redis TCP and `BRPOP` support ([command reference](https://upstash.com/docs/redis/commands/list/brpop)), but the complete Celery transport was not tested against this project's Upstash database. Verify the actual broker connection and queue delivery before relying on production dispatch.
- Confirm the Railway service and Supabase project regions and the configured PostgreSQL endpoint. Keep the existing backend endpoint and SSL settings; do not silently substitute a pooler.
- `pending` jobs indicate that the database record is durable but broker dispatch has not succeeded. Beat retries the outbox at the configured interval.
- `retrying` and `failed` records expose a sanitized error class, not exception messages, stack traces, credentials, or SQL.
- Terminal jobs older than `PNS_BACKGROUND_JOB_RETENTION_DAYS` are removed by the daily cleanup task.
- Dispatch runs every `PNS_CELERY_JOB_DISPATCH_INTERVAL_SECONDS` (default 30 seconds). Terminal cleanup runs daily at `PNS_CELERY_JOB_CLEANUP_HOUR` / `PNS_CELERY_JOB_CLEANUP_MINUTE` UTC (defaults 03:15).
- The checked-in Railway configuration sets dispatch to 30 seconds, routes maintenance tasks to `pns-maintenance`, runs one Beat replica, and mounts its schedule at `/data/celerybeat-schedule`. The worker listens to both configured queues. Confirm these remain the active deployment settings.

No email, image transformation, or report task is configured because no matching workflow currently exists. Image uploads continue using the existing request flow and Supabase Storage behavior.
