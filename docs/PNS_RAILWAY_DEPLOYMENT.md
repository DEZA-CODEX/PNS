# PNS Railway Celery deployment

Railway Infrastructure as Code in `.railway/railway.ts` declares two independent, continuously running services from this repository's `backend/` directory:

- `pns-celery-worker` processes Celery tasks.
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

Review the plan to ensure it only adds/updates the two Celery services and Beat's volume; do not apply unexpected changes. Then apply the reviewed configuration:

```sh
railway config apply
```

The resulting service settings are:

| Railway service | IaC config | Build command | Start command |
| --- | --- | --- | --- |
| `pns-celery-worker` | `.railway/railway.ts` | `pip install -r requirements.txt` | `celery -A app.celery_app:celery_app worker --loglevel=INFO --concurrency=1 --queues=pns-default,pns-maintenance` |
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
| `PNS_CELERY_JOB_DISPATCH_INTERVAL_SECONDS` | `30` |
| `PNS_CELERY_JOB_CLEANUP_HOUR` | `3` |
| `PNS_CELERY_JOB_CLEANUP_MINUTE` | `15` |
| `PNS_BACKGROUND_JOB_RETENTION_DAYS` | `30` |

The shared variables must contain the existing Supabase PostgreSQL URL (with SSL settings) and Upstash Redis **protocol** endpoint (normally `rediss://...`), respectively. Do not use the Upstash HTTPS REST URL as the Celery broker.

Use the same `CELERY_BROKER_URL` in the FastAPI Vercel project's server-side environment so the API can publish jobs. Keep its existing `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for cache access; these are not Celery broker credentials. The frontend Vercel project does not need database or broker secrets.

The current worker tasks require no Supabase Storage credentials. Do not add them unless a future worker task actually uses Storage. Keep the existing database endpoint and TLS options; confirm it is reachable from Railway rather than changing the URL or creating a database.

## Deployment and verification

1. Confirm the background-jobs migration `supabase/migrations/202611110001_background_jobs.sql` has been applied to the intended Supabase project.
2. Deploy both Railway services. Check their build and runtime logs for successful Redis broker startup and database connectivity.
3. Confirm the worker subscribes to `pns-default` and `pns-maintenance`, and Beat registers `pns.tasks.dispatch_pending_jobs` and `pns.tasks.cleanup_background_jobs`.
4. From an authorized admin session, enqueue a cache invalidation job and verify it progresses from queued to completed in the Background Jobs admin view and worker logs.
5. Restart Beat and check that its service returns to running with its schedule volume still mounted. Confirm there is only one Beat service/schedule owner.
6. Confirm the Vercel API still has the same broker URL and the frontend/backend Vercel deployments remain unchanged.

Railway credentials and access to production resources are not available in this repository workspace, so live broker/database connectivity and an actual deployment must be verified in the Railway and Supabase dashboards.
