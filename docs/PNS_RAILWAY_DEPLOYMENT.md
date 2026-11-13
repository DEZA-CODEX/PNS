# PNS Railway Celery deployment

Railway Infrastructure as Code in `.railway/railway.ts` declares three independent, continuously running services from this repository's `backend/` directory:

- `pns-celery-worker` processes Celery tasks.
- `pns-converter-worker` consumes only the dedicated `pns-converter` queue with one process.
- `pns-celery-beat` publishes the existing periodic tasks.

The Next.js frontend and FastAPI API remain on Vercel. Both Railway services use the existing Upstash Redis database and Supabase PostgreSQL database; do not provision replacement databases. Do not deploy the legacy `render.yaml` services at the same time as these Railway services, especially a second Beat scheduler.

## Apply the Railway configuration

The configuration sources both services from `DEZA-CODEX/PNS` with `backend/` as their root directory. It uses the repository's default branch; change the `github()` source options if Railway should deploy a different branch. Install the IaC package and [Railway CLI](https://docs.railway.com/cli) (Node.js 22 or newer is required for the IaC package), then link the CLI to the intended Railway project/environment:

Before planning, create the shared `DATABASE_URL` and `CELERY_BROKER_URL` values in that Railway environment. The IaC file references these existing shared values; it intentionally contains no secret values.

```sh
npm ci --prefix .railway
railway login
railway link
railway config plan
```

Review the plan to ensure it only adds/updates the three Celery services and Beat's volume; do not
apply unexpected changes. Then apply the reviewed configuration:

```sh
railway config apply
```

The worker's concurrency comes from `PNS_CELERY_WORKER_CONCURRENCY` (default `1`, permitted range `1`–`16`); the Railway IaC sets its initial value to `1`. Its Celery `worker_prefetch_multiplier` is `1`. Do not add a second worker process to the start command.

The resulting service settings are:

| Railway service | IaC config | Build command | Start command |
| --- | --- | --- | --- |
| `pns-celery-worker` | `.railway/railway.ts` | `pip install -r requirements.txt` | `celery -A app.celery_app:celery_app worker --loglevel=INFO --queues=pns-default,pns-maintenance` |
| `pns-converter-worker` | `.railway/railway.ts` | `pip install -r requirements.txt` | `celery -A app.celery_app:celery_app worker --loglevel=INFO --queues=pns-converter --concurrency=1 --prefetch-multiplier=1` |
| `pns-celery-beat` | `.railway/railway.ts` | `pip install -r requirements.txt` | `celery -A app.celery_app:celery_app beat --loglevel=INFO --schedule=/data/celerybeat-schedule` |

Both services install the existing `backend/requirements.txt` dependencies and use the actual Celery application at `app.celery_app:celery_app`; neither command starts FastAPI. Each uses Railway's `ON_FAILURE` restart policy with up to 10 retries and one replica. The Beat service has a 1 GB persistent volume mounted at `/data`, so Celery's schedule file survives restarts.

Do not use a Railway Cron Job for Beat; Beat must remain a continuously running service. The worker does not need a volume.

## Environment variables

Create the two sensitive values below as Railway **shared environment variables** named `DATABASE_URL` and `CELERY_BROKER_URL`. The IaC config references them into both services without writing their values to source control. Enter secrets directly in Railway's dashboard and do not paste them into config files, logs, or `NEXT_PUBLIC_` variables.

| Variable | Value |
| --- | --- |
| `APP_ENV` | `production` |
| `RAILPACK_PYTHON_VERSION` | `3.12.8` (matches the existing Render runtime). |
| `REDIS_KEY_PREFIX` | `pns:backend:` (must match the FastAPI backend's value). |
| `PNS_CELERY_TASK_TIME_LIMIT_SECONDS` | `900` |
| `PNS_CELERY_WORKER_CONCURRENCY` | `1` initially; the backend accepts `1`–`16`. Increase only after checking memory and database capacity. |
| `PNS_CELERY_JOB_DISPATCH_INTERVAL_SECONDS` | `30` |
| `PNS_CELERY_JOB_CLEANUP_HOUR` | `3` |
| `PNS_CELERY_JOB_CLEANUP_MINUTE` | `15` |
| `PNS_BACKGROUND_JOB_RETENTION_DAYS` | `30` |
| `PNS_CONVERTER_BATCH_TTL_SECONDS` | `7200` |
| `PNS_CONVERTER_MAX_REQUEST_BYTES` | `67108864` |
| `PNS_CONVERTER_MAX_FILE_BYTES` | `8388608` |
| `PNS_CONVERTER_MAX_FILES` | `50` |
| `PNS_CONVERTER_MAX_BATCH_MEMORY_BYTES` | `50331648` |
| `PNS_CONVERTER_MAX_ACTIVE_BATCHES` | `4` |
| `PNS_CONVERTER_CLEANUP_INTERVAL_SECONDS` | `900` |

The shared variables must contain the existing Supabase PostgreSQL URL (with SSL settings) and Upstash Redis **protocol** endpoint (normally `rediss://...`), respectively. Do not use the Upstash HTTPS REST URL as the Celery broker.

Use the same `CELERY_BROKER_URL` in the FastAPI Vercel project's server-side environment so the API can publish jobs. Keep its existing `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for cache access; these are not Celery broker credentials. The frontend Vercel project does not need database or broker secrets.

The current worker tasks require no Supabase Storage credentials. Do not add them unless a future worker task actually uses Storage. Keep the existing database endpoint and TLS options; confirm it is reachable from Railway rather than changing the URL or creating a database.

## Deployment and verification

1. Confirm the background-jobs migration `supabase/migrations/202611110001_background_jobs.sql` has been applied to the intended Supabase project.
2. Deploy both Railway services. Check their build and runtime logs for successful Redis broker startup and database connectivity.
3. Confirm the worker subscribes to `pns-default` and `pns-maintenance`, and Beat registers `pns.tasks.dispatch_pending_jobs` and `pns.tasks.cleanup_background_jobs`.
4. Confirm the converter worker subscribes only to `pns-converter`; its startup log must show concurrency 1 and prefetch 1.
5. From the `/convert` page, submit a small batch, verify the API returns 202, then verify queued, processing, completed, individual download, ZIP download, and cancellation behavior.
6. From an authorized admin session, enqueue a cache invalidation job and verify it progresses from queued to completed in the Background Jobs admin view and worker logs.
7. Restart Beat and check that its service returns to running with its schedule volume still mounted. Confirm there is only one Beat service/schedule owner.
8. Confirm the Vercel API still has the same broker URL and the frontend/backend Vercel deployments remain unchanged.

## Vercel deployment

1. In the FastAPI Vercel project, keep the existing Upstash REST URL/token (the backend accepts
   either `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` or Vercel's
   `REDIS_KV_REST_API_URL` / `REDIS_KV_REST_API_TOKEN`, set `REDIS_ENABLED=true`, and use the same
   `CELERY_BROKER_URL` and `REDIS_KEY_PREFIX=pns:backend:` as Railway. Add the converter limits
   from the table above if they differ from the defaults.
2. Deploy the backend and confirm `POST /convert/` returns `202` for a small multipart batch.
   The API must be able to reach both the Upstash REST endpoint and the Celery broker; Vercel
   does not run conversions or retain local files.
3. In the Next.js Vercel project, set `NEXT_PUBLIC_API_BASE_URL` to the deployed FastAPI origin,
   redeploy, and open `/convert`. Do not add database, Redis, broker, or Supabase secrets to
   `NEXT_PUBLIC_*` variables.
4. Verify the browser can poll `/convert/{batch_id}/status` and download both an individual WebP
   and `/download-all`. Check CORS and cookie policy using the existing frontend origin settings.

Vercel request-body and function-duration limits are deployment-plan dependent. The checked-in
defaults cap a batch at 64 MiB and a file at 8 MiB; confirm the selected Vercel plan accepts
those limits before increasing them. No production Railway, Redis, Supabase, or Vercel check was
run from this workspace.

## Production log follow-up

The checked-in IaC defines one worker replica, one Beat replica, one worker command, and separate services; the worker command does not start Beat or launch a second worker. Both services use the same shared broker and database settings, and both import the same `app.celery_app:celery_app` application. The worker's `ON_FAILURE` policy can restart it up to 10 times. A repeated startup banner is therefore consistent with restarts, but the repository cannot establish whether the deployed service has dashboard overrides, another replica, a duplicate Render worker, or a crashing process. Compare Railway deployment/restart events and service settings with this IaC; ensure only one active worker service and one Beat service. The reported concurrency of 48 does not match the repository configuration and likely comes from an active dashboard/start-command override or another deployment.

The Redis URL and credentials are passed through unchanged. For a `rediss://` broker, Celery is configured with `ssl.CERT_REQUIRED`; this verifies the server certificate. The Railway build uses Railpack and has no Dockerfile or configured runtime user. No non-root user is introduced because the current build has no explicit user creation/ownership setup, so its safe runtime permissions cannot be established from this repository. The root warning remains until a deliberate, tested non-root image/build setup is adopted.

The tasks currently use a separate synchronous SQLAlchemy engine with psycopg (`backend/app/services/worker_database.py`); they do not use async SQLAlchemy sessions or asyncpg. The FastAPI application uses async SQLAlchemy/asyncpg independently. Redis connectivity does not verify Supabase connectivity; confirm database access and migrations independently in Railway/Supabase. No production Railway, Redis, or Supabase test has been run from this workspace.

The worker's psycopg connection disables automatic prepared statements (`prepare_threshold=None`) to prevent duplicate prepared statement names with transaction-mode poolers. FastAPI's asyncpg connection separately disables its statement cache. The deployed Supabase connection mode cannot be established from source because the actual `DATABASE_URL` is a Railway shared secret; verify the endpoint's mode in Supabase/Railway without exposing its value. This does not require changing environment variable names or credentials.

The repository has no Dockerfile or explicit runtime user configuration, and Railpack currently builds the services. A safe non-root runtime change cannot be verified without establishing user ownership/permissions for the generated image and Beat's persistent volume. The existing root warning therefore remains; do not add `--uid` until an existing user and writable paths have been verified in the deployed image.
