# PNS Render worker deployment

`render.yaml` defines two independent Render Background Workers. The Celery worker runs with concurrency 1; Celery Beat has its own persistent disk at `/var/data`, so its schedule file survives service restarts. Deploy exactly one Beat service for this schedule. No Render URL or completed deployment is implied.

## Required Render environment

Set these secrets in Render's environment settings for both services:

| Name | Source |
| --- | --- |
| `DATABASE_URL` | Same PostgreSQL connection URL used by the backend, including its SSL settings. Confirm Render network reachability and region before deploy. |
| `CELERY_BROKER_URL` | Upstash Redis-protocol endpoint (normally `rediss://...`), not the `https://` REST URL. |

The Blueprint also sets `APP_ENV=production`, `REDIS_KEY_PREFIX=pns:backend:`, `PNS_CELERY_TASK_TIME_LIMIT_SECONDS=900`, `PNS_CELERY_JOB_DISPATCH_INTERVAL_SECONDS=30`, and `PNS_BACKGROUND_JOB_RETENTION_DAYS=30`. If the Vercel backend uses a non-default `REDIS_KEY_PREFIX`, use the same value in both Render services.

Set the same `CELERY_BROKER_URL` as a server-side Vercel environment variable as well; FastAPI uses it to publish admin-created jobs. Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on Vercel for its existing REST cache client.

No Supabase Storage service key is needed for the currently implemented worker tasks. Add `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_STORAGE_BUCKET` only when a verified worker task needs server-side Storage access. Never put secrets in `render.yaml`, documentation, logs, or `NEXT_PUBLIC_` variables.

`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` remain on the FastAPI service for cache access. They are not substitutes for `CELERY_BROKER_URL`.

## Deployment steps

1. Review and apply `supabase/migrations/202611110001_background_jobs.sql` to the intended Supabase project.
2. Verify that the Upstash database and account support Celery's Redis transport commands and persistent connection behavior. The endpoint credentials alone do not prove broker compatibility; test the actual worker connection before relying on dispatch.
3. Confirm the same existing PostgreSQL endpoint is reachable from Render over TLS. Check whether it is direct IPv6/IPv4 reachable from Render; do not switch to a pooler without confirming its compatibility and documenting the reason.
4. In Render, create a Blueprint from the existing repository and review both proposed services. The Beat service uses a persistent disk and a paid `starter` plan.
5. Add the required secret values in each service's environment settings, then deploy.
6. Confirm the worker becomes ready and that Beat schedules `pns.tasks.dispatch_pending_jobs` and `pns.tasks.cleanup_background_jobs` once.
7. From an authorized admin session, submit an image-cache invalidation job and verify it progresses from queued to completed in the Background Jobs admin view and Render worker logs.
8. Confirm the single Beat service and its persistent schedule file remain active after a restart.

## Commands

The worker command is:

```sh
celery -A app.celery_app:celery_app worker --loglevel=INFO --concurrency=1 --queues=pns-default,pns-maintenance
```

The Beat command is:

```sh
celery -A app.celery_app:celery_app beat --loglevel=INFO --schedule=/var/data/celerybeat-schedule
```

The Render build command is `pip install -r requirements.txt` from `backend/`.

## External verification not performed

No credentials were available to test Upstash protocol behavior, Supabase PostgreSQL connectivity, Render region/plan selection, actual Render Blueprint acceptance, or a live deployment. Confirm each item above in the target accounts before enabling production jobs.
