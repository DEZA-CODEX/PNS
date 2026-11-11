# PNS PostgreSQL optimization

## What was observed

The current SQL-backed application schema is focused on admin RBAC and `public.managed_images`. Existing migrations already provide image category and admin-session indexes, plus destination-specific managed-image indexes. The homepage image endpoint batches active metadata and disabled bundled overrides into two queries, and room/dining section endpoints load all categories in two collection-level queries.

There are no booking/reservation, revenue, occupancy, report, or other aggregate source tables in the checked-in migrations. The admin dashboard's booking and revenue figures are currently static frontend data. Adding booking indexes or materialized views would therefore be speculative and would risk changing application behavior; none were added.

## Added schema

`202611110001_background_jobs.sql` adds the durable background-job/outbox table and indexes that support the implemented workload:

- `(created_at DESC)` supports paginated job history.
- `(status, created_at DESC)` supports filtered job history and pending dispatch selection.
- A partial `(completed_at)` index supports bounded terminal-record cleanup.

It also adds `jobs.read` / `jobs.create` RBAC permissions and grants them to the existing protected Super Admins group. It does not duplicate managed-image indexes or introduce materialized views.

## Migration and database connections

Apply migrations in filename order after confirming the Supabase project target:

```sh
supabase db push
```

Or, when applying a reviewed migration directly to an already-migrated project:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202611110001_background_jobs.sql
```

The worker receives the same `DATABASE_URL` as the backend, preserves its TLS query options, and uses SQLAlchemy's psycopg driver with a conservative one-connection pool. Confirm that the URL is reachable from Render, uses SSL, and is the existing backend endpoint before rollout. No production `EXPLAIN ANALYZE` or live Supabase migration was run.

## Future tuning

Before creating additional indexes or materialized views, capture the real query and schema, inspect existing indexes, and use representative `EXPLAIN` plans. Run `EXPLAIN ANALYZE` only on safe representative data/workloads. For future materialized views, add a migration with a documented freshness target and unique index before using concurrent refresh; no view-refresh schedule exists until a verified expensive aggregate exists.
