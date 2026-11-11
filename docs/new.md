# MASTER IMPLEMENTATION PROMPT — PNS HOTEL
## Complete Background Processing, Redis Caching, Celery, Supabase PostgreSQL Optimization & Render Deployment

Act as a Senior Backend Architect, Python/FastAPI Engineer, Next.js Performance Engineer, PostgreSQL Database Engineer, Redis/Celery Specialist and DevOps Engineer.

Your task is to inspect, optimize and implement the complete background-processing and database-performance architecture for the existing **PNS Hotel application**.

This is an implementation task, NOT a planning-only task.

**Implement the complete solution in the existing repositories, integrate all components, configure deployment files, execute tests, resolve errors and prepare the application for deployment as quickly as possible.**

Do not stop after generating an architecture diagram, explaining the approach or providing example code.

---

# 1. EXISTING APPLICATION ARCHITECTURE

The application currently uses:

| Component | Technology | Hosting |
|---|---|---|
| Frontend | Next.js 16, TypeScript | Vercel |
| Backend | FastAPI, Python | Vercel |
| Database | Supabase PostgreSQL | Supabase |
| File Storage | Supabase Storage | Supabase |
| Redis | Upstash Redis | Upstash |
| Background Worker | Celery | To be deployed on Render |
| Task Scheduler | Celery Beat | To be deployed on Render |
| Database Optimization | PostgreSQL Indexes | Supabase PostgreSQL |
| Precomputed Data | PostgreSQL Materialized Views | Supabase PostgreSQL |
| Source Control | Existing Git repository | GitHub |

The existing Redis infrastructure is already configured.

Do not create another Redis instance unless there is a demonstrated technical limitation.

Do not migrate the database, storage or frontend hosting.

Do not introduce another database or external queueing platform.

## Target architecture

Next.js Frontend (Vercel)
        |
        v
FastAPI Backend (Vercel)
        |
        +----------------------+
        |                      |
        v                      v
Upstash Redis             Supabase PostgreSQL
        |                      |
        |                      +-- Existing tables
        |                      +-- Database indexes
        |                      +-- Materialized views
        |                      +-- Background job tracking
        |
        v
Celery Broker
        |
        v
Render Celery Worker
        |
        +-- Email and notifications
        +-- Image processing
        +-- Report generation
        +-- Scheduled operations
        +-- Materialized view refresh
        +-- Database maintenance

Render Celery Beat
        |
        +-- Periodic task scheduling
        +-- Materialized view refresh schedules
        +-- Cleanup schedules
        +-- Other scheduled operations

Supabase Storage remains the permanent file-storage system.

---

# 2. CRITICAL IMPLEMENTATION RULES

Before modifying anything:

1. Inspect the complete existing frontend and backend repositories.
2. Understand the existing directory structure.
3. Inspect all existing API endpoints, database models, migrations and SQL queries.
4. Inspect existing Redis configuration and connection handling.
5. Inspect the existing Supabase PostgreSQL connection strategy.
6. Inspect existing image-management and file-storage implementations.
7. Inspect authentication, authorization and admin RBAC.
8. Identify existing background tasks, schedulers or caching implementations.
9. Identify duplicate functionality and unnecessary database queries.
10. Identify the actual deployment configuration and environment-variable names.

Do not assume example paths, table names, model names or environment-variable names in this prompt exist in the repository.

Use the actual project structure.

### Non-negotiable rules

- Preserve all existing application functionality.
- Do not redesign the website or change its UI unnecessarily.
- Do not break existing API contracts.
- Do not create duplicate database tables, indexes, materialized views or Redis clients.
- Do not overwrite existing configuration without understanding its purpose.
- Do not replace Supabase PostgreSQL.
- Do not migrate Supabase Storage to another provider.
- Do not introduce unnecessary dependencies.
- Never expose Redis credentials, database credentials or Supabase service-role credentials to the browser.
- Never use `NEXT_PUBLIC_` for secrets.
- Do not use SQLite as a replacement for PostgreSQL.
- Do not disable SSL or database security to make a connection work.
- Do not use `--force` or unsafe dependency installation shortcuts.
- Do not add Celery to the Vercel request-serving process as a persistent worker.
- Do not run multiple Celery Beat schedulers for the same schedule.
- Do not make unverified assumptions about Render, Supabase or Upstash connectivity.

**Speed requirement:** Prioritize completing the core implementation in one focused execution. Avoid unnecessary architectural discussions, repeated confirmations and unrelated refactoring. Make reasonable implementation decisions after inspecting the repository. If an optional feature is not required for a working deployment, defer it and document it rather than delaying the core deployment.

---

# 3. CELERY IMPLEMENTATION

Implement Celery in the existing FastAPI backend.

The same backend codebase should support:

- FastAPI running on Vercel.
- Celery Worker running on Render.
- Celery Beat running on Render.

The worker must be independently executable without starting the FastAPI web server.

## 3.1 Create or integrate Celery configuration

Inspect the current project structure and create appropriate modules.

Suggested structure, to be adapted to the actual repository:

backend/
    app/
        core/
            config.py
            redis.py
            database.py

        celery_app.py

        tasks/
            __init__.py
            email_tasks.py
            image_tasks.py
            report_tasks.py
            maintenance_tasks.py
            materialized_view_tasks.py

        services/
            cache_service.py
            job_service.py
            materialized_view_service.py

        api/
            routes/
                admin_jobs.py

        models/
            background_job.py

    requirements.txt
    render.yaml

Do not duplicate existing modules if equivalent implementations already exist.

## 3.2 Celery configuration requirements

Configure:

- Redis as the Celery broker.
- JSON task serialization.
- JSON result serialization where applicable.
- Explicit accepted content types.
- Task time limits.
- Connection timeouts.
- Worker heartbeat and health monitoring.
- Task retry behavior.
- Exponential backoff for transient failures.
- Maximum retry limits.
- Task acknowledgement behavior appropriate to the task.
- Task result expiration if a result backend is used.
- Separate queues for different workload categories.
- Worker prefetch settings suitable for task execution.
- Graceful worker shutdown.
- Task idempotency.

Use the existing Upstash Redis connection configuration.

Use the correct Redis protocol connection URL.

Do not confuse the Upstash REST endpoint with the Redis protocol endpoint.

Check the existing Redis connection before implementing a new one.

If the same Redis instance supports both caching and Celery, use separate namespaces and queue names.

Example queue names:

- `pns-default`
- `pns-images`
- `pns-reports`
- `pns-maintenance`

Choose sensible defaults and avoid unnecessary queue fragmentation.

## 3.3 Celery task implementation

Implement the following task categories where the existing application has corresponding functionality.

### Email and notifications

- Booking confirmation emails.
- Booking reminders.
- Administrative notifications.
- Other existing email workflows.

Do not send duplicate emails when a task is retried.

### Image processing

Integrate with the existing Supabase Storage image architecture.

Support:

- Bulk image processing.
- Thumbnail generation where useful.
- Image optimization.
- Metadata processing.
- Safe cleanup of temporary files.
- Failure handling.

Preserve existing image paths, category mappings, display locations and image API contracts.

Do not change the existing hero-image requirement: homepage hero images must continue loading exclusively from the code-based image manifest, not from database-driven hero selection.

### Reports

- Generate reports asynchronously.
- Support larger report-generation workloads.
- Save generated report metadata and file locations.
- Expose job status to authorized admin users.

### Database maintenance

- Refresh eligible materialized views.
- Perform approved cleanup operations.
- Execute scheduled maintenance tasks.

Do not introduce destructive cleanup jobs without inspecting the actual retention requirements and data relationships.

---

# 4. RENDER DEPLOYMENT — WORKER AND BEAT

This is a major deliverable.

Configure Render to run the Celery Worker and Celery Beat independently.

## 4.1 Render Background Worker

Create the configuration required to deploy a persistent Celery Worker.

Expected behavior:

- Connect to Upstash Redis.
- Listen continuously for queued tasks.
- Connect to Supabase PostgreSQL when executing tasks.
- Connect to Supabase Storage when required.
- Update background job statuses.
- Retry transient failures.
- Log task execution and errors.
- Shut down gracefully.

Example command only; replace it with the real application path:

`celery -A app.celery_app:celery_app worker --loglevel=info`

Select a suitable concurrency level for the actual Render instance and task workload.

Do not assume that high concurrency is always better.

Use conservative resource consumption initially.

## 4.2 Render Celery Beat

Create a separate Render Background Worker for Celery Beat.

Expected behavior:

- Schedule periodic materialized-view refreshes.
- Schedule cleanup operations.
- Schedule booking reminders if applicable.
- Schedule other verified periodic tasks.

Example command only:

`celery -A app.celery_app:celery_app beat --loglevel=info`

Ensure that only one active Beat scheduler manages a given schedule.

Use a persistent schedule file or another reliable scheduler configuration supported by the chosen deployment.

Do not store scheduler state in an ephemeral directory if it needs to survive service restarts.

## 4.3 Render deployment configuration

Create or update `render.yaml` if it is appropriate for the existing repository.

It should define separate services:

1. PNS Celery Worker.
2. PNS Celery Beat.

Configure:

- Correct repository and root directory.
- Python runtime.
- Build command.
- Start command.
- Required environment variables.
- Health/monitoring strategy where supported.
- Appropriate deployment settings.

If a single Render Blueprint cannot be safely configured without existing dashboard details, prepare the correct configuration and document the remaining dashboard steps.

Do not invent a Render service URL or claim that deployment has occurred.

## 4.4 Render environment variables

Use the backend's existing configuration names.

Required configuration categories:

- Redis broker connection.
- PostgreSQL connection.
- Supabase project URL.
- Supabase server-side Storage credentials, if required.
- Storage bucket configuration.
- Application secret.
- Environment name.
- Email configuration, if email tasks are enabled.

Keep all sensitive variables in Render's environment settings.

The worker must use the same intended PostgreSQL connection strategy as the backend unless compatibility testing identifies a concrete reason to configure a separate endpoint.

Check:

- IPv4/IPv6 connectivity.
- Supabase direct connection or pooler compatibility.
- SSL requirements.
- Database connection limits.
- Render regional latency.
- SQLAlchemy connection-pool settings.

Do not silently switch from direct connection to pooler.

Document any necessary change and its technical reason.

---

# 5. REDIS CACHE IMPLEMENTATION

Redis must be used for application caching as well as Celery broker functionality, provided the existing Upstash configuration supports both reliably.

Implement a centralized Redis cache service.

Do not create a new Redis connection for every request.

Reuse the Redis client appropriately in the FastAPI serverless environment.

Handle connection failures gracefully.

The application must remain functional if cache reads or writes temporarily fail.

## 5.1 Cache suitable public API responses

Inspect the existing API endpoints and identify repeated database queries.

Prioritize:

- Homepage data.
- Hotel details.
- Room listings.
- Room category data.
- Dining data.
- Banquet information.
- Gallery metadata.
- Public website configuration.
- Other frequently requested public data.

Suggested initial TTLs:

| Data | Suggested TTL |
|---|---:|
| Homepage data | 5 minutes |
| Room data | 5–10 minutes |
| Dining data | 5–10 minutes |
| Banquet data | 5–10 minutes |
| Hotel information | 30 minutes |
| Public configuration | 30 minutes |
| Admin dashboard summaries | 1–2 minutes |

These are initial values, not mandatory values. Adjust them based on data update frequency.

Do not cache private, user-specific or permission-sensitive responses in shared public cache keys.

## 5.2 Cache key naming

Use consistent namespacing.

Examples:

`pns:cache:homepage`

`pns:cache:rooms`

`pns:cache:dining`

`pns:cache:banquets`

`pns:cache:hotel`

`pns:cache:admin:dashboard`

Keep Celery queue names separate from cache keys.

## 5.3 Cache invalidation

This is essential.

Whenever an authorized admin modifies application data:

- Update the PostgreSQL source data.
- Commit the database transaction.
- Invalidate only the relevant cache keys.
- Ensure subsequent requests can retrieve fresh data.

Examples:

Room updated:
- Invalidate room listing and affected room details.

Dining updated:
- Invalidate dining data.

Banquet updated:
- Invalidate banquet data.

Hotel settings updated:
- Invalidate hotel information and relevant homepage data.

Image added or deleted:
- Invalidate the corresponding image metadata and page cache.

Do not delete all Redis keys after every update.

Use targeted invalidation.

Ensure cache invalidation happens only after a successful database commit.

For operations where DB commit and cache invalidation must be reliably coordinated, implement a retryable invalidation or outbox mechanism.

## 5.4 Cache failure behavior

If Redis is unavailable:

- Continue serving the request through PostgreSQL where possible.
- Do not crash the whole application merely because caching failed.
- Log cache failures.
- Avoid retry storms.
- Apply sensible timeouts.

## 5.5 Homepage request optimization

Inspect the existing homepage API architecture.

If the homepage currently requires multiple independent API requests, consolidate suitable data into an optimized endpoint such as:

`GET /api/v1/homepage`

This endpoint should retrieve the required homepage content efficiently.

Use a small number of well-optimized SQL queries.

Do not include every website resource in one massive response.

Preserve the existing homepage content and response behavior.

Keep hero images exclusively sourced from the code-based manifest.

Do not introduce database lookups for hero-image selection.

---

# 6. SUPABASE POSTGRESQL OPTIMIZATION

PostgreSQL remains the source of truth.

Perform database optimization based on the actual schema and queries.

Do not blindly generate indexes or materialized views.

## 6.1 Query inspection

Inspect:

- SQLAlchemy models.
- Existing migrations.
- SQL queries.
- Frequently called endpoints.
- Dashboard aggregation queries.
- Joins.
- Filters.
- Sorting.
- Pagination.
- N+1 query patterns.
- Duplicate query execution.

Identify the slow and frequently repeated queries.

Use `EXPLAIN` and, where safe, `EXPLAIN ANALYZE` with representative queries.

Do not run expensive analysis on production workloads without considering its impact.

## 6.2 Index implementation

Identify indexes that materially improve existing query patterns.

Consider:

- Foreign-key lookup patterns.
- Frequently filtered columns.
- Composite filter and sort patterns.
- Date-based queries.
- Booking status and date.
- Room category.
- Image category and display location.
- Admin dashboard filtering.
- Frequently used joins.

For every proposed index:

1. Identify the query it supports.
2. Check whether an equivalent index already exists.
3. Check whether a composite index is more appropriate.
4. Consider write overhead.
5. Verify the migration is safe.
6. Confirm the query planner can use it.

Do not create redundant indexes.

Do not assume that every foreign key needs another index without checking existing indexes.

Use appropriate migration files and keep migrations reversible wherever practical.

## 6.3 Materialized view implementation

Inspect the current application and identify genuinely expensive, repeated aggregations.

Prioritize admin dashboard and reporting use cases such as:

- Total bookings.
- Booking status summaries.
- Revenue summaries.
- Monthly booking trends.
- Room occupancy summaries.
- Other expensive reporting queries that exist in the application.

Only create materialized views where they offer a meaningful performance improvement.

Do not create a materialized view for every table.

Do not move normal transactional data into materialized views.

The underlying PostgreSQL tables remain the source of truth.

Create suitable materialized views based on actual schema relationships.

For each materialized view:

- Define the query.
- Document its purpose.
- Identify its source tables.
- Create the appropriate unique index if concurrent refresh is needed.
- Integrate it with the correct FastAPI endpoint.
- Document its expected freshness.
- Provide a safe refresh mechanism.

Use migration SQL.

Use `REFRESH MATERIALIZED VIEW CONCURRENTLY` only where PostgreSQL's requirements are satisfied.

Otherwise, use a suitable refresh strategy that does not create unacceptable blocking.

## 6.4 Materialized view freshness

Implement Celery tasks for refreshing eligible materialized views.

Configure Celery Beat schedules based on actual business requirements.

Suggested starting point:

- Frequently changing dashboard summaries: every 5–15 minutes.
- Less frequently changing reports: hourly or daily.
- Monthly aggregates: daily or according to reporting needs.

These schedules must be configurable.

Do not refresh every view at the same interval without evaluating cost.

Track:

- Last successful refresh.
- Last refresh attempt.
- Refresh status.
- Refresh duration.
- Failure details.

If a refresh fails, keep serving the previous valid snapshot and record the error.

Avoid overlapping refresh operations for the same view.

Use PostgreSQL advisory locks or an appropriate application-level locking strategy if necessary.

Do not expose an admin endpoint that allows arbitrary SQL execution or arbitrary materialized-view refresh names.

Only allowlisted refresh operations.

---

# 7. BACKGROUND JOB TRACKING

Implement durable background-job tracking using Supabase PostgreSQL.

First inspect whether a suitable job table already exists.

Reuse it if possible.

Otherwise, create a migration for a suitable table.

Suggested fields:

- id
- task_id
- job_type
- queue_name
- status
- progress
- result_summary
- error_message
- retry_count
- created_at
- started_at
- completed_at
- updated_at

Suggested statuses:

- pending
- queued
- processing
- completed
- failed
- retrying
- cancelled

Requirements:

1. FastAPI creates a durable job record.
2. FastAPI enqueues the Celery task.
3. The task ID is associated with the job.
4. Celery updates the job status.
5. The worker records failures.
6. Retry attempts are visible.
7. Completed jobs record their completion time.
8. Old job records can be cleaned up according to a configurable retention policy.

Handle the critical case where PostgreSQL commits a job record but Redis enqueueing fails.

Use a transactional outbox or another reliable dispatch-recovery mechanism where appropriate.

Do not claim that writing a job record and publishing a Redis message is one atomic transaction.

Make task execution idempotent.

Do not assume Celery provides exactly-once execution.

## 7.1 Job management API

Integrate with existing FastAPI authentication and admin RBAC.

Example endpoints:

POST /api/v1/admin/jobs

GET /api/v1/admin/jobs

GET /api/v1/admin/jobs/{job_id}

GET /api/v1/admin/jobs/{job_id}/status

These are examples. Adapt to the existing API conventions and avoid duplicate routes.

The endpoints must:

- Require appropriate authorization.
- Return consistent response schemas.
- Avoid exposing internal stack traces or secrets.
- Support pagination.
- Filter by status and task type where useful.

## 7.2 Frontend integration

Inspect the existing admin dashboard.

Integrate background-job visibility without unnecessarily redesigning the current UI.

Display:

- Job name.
- Job ID.
- Current status.
- Progress where available.
- Created time.
- Started time.
- Completion time.
- Failure information appropriate for administrators.

Use polling initially with a sensible interval and stop polling after completion or failure.

Avoid excessive polling.

Do not allow an unauthenticated user to inspect internal background jobs.

---

# 8. CELERY BEAT SCHEDULES

Implement a centralized schedule configuration.

Possible schedules, only where applicable:

- Materialized-view refresh.
- Booking reminders.
- Temporary data cleanup.
- Expired job cleanup.
- Other verified scheduled application workflows.

Requirements:

- One authoritative Beat scheduler per schedule.
- Configurable intervals.
- Timezone-aware scheduling.
- No overlapping executions for the same task.
- Retry and failure handling.
- Logging.
- Job execution history.

Do not schedule a task that has not been implemented.

Do not create duplicate reminders or notifications.

Use idempotency keys and unique constraints where appropriate.

---

# 9. DATABASE SESSION AND CONNECTION MANAGEMENT

This is particularly important because the FastAPI application is on Vercel and Celery is on Render.

Inspect the existing SQLAlchemy implementation.

The Celery worker must have its own database session lifecycle.

Requirements:

- Create a session for each task or unit of work.
- Never share an `AsyncSession` across concurrent tasks.
- Close sessions reliably.
- Roll back failed transactions.
- Reuse the worker's database engine where appropriate.
- Configure conservative connection pools.
- Prevent connection leaks.
- Avoid opening unnecessary connections.
- Respect Supabase connection limits.

If the existing backend uses SQLAlchemy AsyncSession:

- Either implement a properly managed async Celery task execution strategy.
- Or use an appropriate synchronous database implementation if the project architecture justifies it.

Do not mix sync and async database code incorrectly.

Keep the existing database models and transaction rules consistent.

---

# 10. IMAGE STORAGE INTEGRATION

Preserve the current Supabase Storage architecture.

Do not move images to local Render disk because it is ephemeral.

Do not break the existing room-image and dining-image management APIs.

Preserve:

- Existing storage bucket.
- Existing folder structure.
- Category mappings.
- Image metadata.
- Display location.
- Image ordering.
- Existing public image URL behavior.
- Existing admin permissions.

If Celery handles image processing:

1. Validate task ownership and image record.
2. Process the object using a safe temporary location.
3. Upload the processed result to the correct Storage location.
4. Update metadata in PostgreSQL.
5. Clean temporary files.
6. Record job completion.
7. Handle failures without deleting valid original images.

Ensure that deleting a storage object and its database mapping is handled safely.

Do not remove the database record if the required storage deletion fails.

Do not use Celery for trivial image operations that are already fast enough synchronously.

---

# 11. SECURITY AND RELIABILITY

Implement appropriate security throughout.

### Redis

- Use secure Redis protocol connections.
- Set connection timeouts.
- Do not expose Redis credentials.
- Use separate prefixes for application cache and Celery.
- Avoid caching sensitive user information in shared keys.

### Database

- Keep credentials server-side.
- Use SSL.
- Validate database inputs.
- Use parameterized queries.
- Apply database constraints where needed.
- Restrict job-management APIs.
- Do not allow arbitrary SQL execution.

### Celery

- Accept JSON serialization.
- Avoid unsafe pickle serialization.
- Validate task arguments.
- Implement idempotency.
- Configure retries.
- Prevent duplicate task side effects.
- Handle worker crashes.
- Avoid unbounded retries.

### Logging

Use structured logs.

Record:

- Task ID.
- Job ID.
- Task name.
- Queue.
- Execution duration.
- Status.
- Retry count.
- Exception details.

Never log passwords, tokens, private credentials or complete secret-bearing environment variables.

Separate application errors from task-execution errors where practical.

---

# 12. PERFORMANCE OPTIMIZATION

The goal is to improve the performance of the entire PNS Hotel application, not merely add Celery.

Inspect the existing request flow and optimize it.

Priorities:

1. Reduce unnecessary frontend-to-backend requests.
2. Avoid duplicate API requests.
3. Consolidate suitable homepage requests.
4. Implement Redis caching.
5. Implement targeted cache invalidation.
6. Optimize SQL queries.
7. Add evidence-based PostgreSQL indexes.
8. Use materialized views for expensive repeated aggregations.
9. Use Celery for long-running operations.
10. Optimize connection reuse.
11. Avoid N+1 queries.
12. Use pagination for large datasets.
13. Keep API payloads reasonable.
14. Avoid loading unused data.
15. Preserve Next.js 16 rendering and caching behavior.

Do not blindly add `force-dynamic`, legacy Next.js cache settings or arbitrary cache durations.

Inspect the actual Next.js 16 implementation and select the correct caching strategy.

## Performance measurements

Where possible, record a baseline and post-implementation comparison:

- Homepage HTTP request count.
- Homepage API latency.
- FastAPI p50 and p95 latency.
- PostgreSQL query duration.
- Number of SQL queries per endpoint.
- Redis cache hit ratio.
- Response payload size.
- Celery queue depth.
- Task execution duration.
- Materialized-view refresh duration.
- Core Web Vitals where available.

Do not invent performance improvements or claim measurements that were not performed.

---

# 13. TESTING REQUIREMENTS

Do not consider the implementation complete until the relevant tests have been run.

### Backend

- FastAPI application starts.
- Celery application imports independently.
- Celery worker starts.
- Celery Beat starts.
- Redis connection succeeds.
- PostgreSQL connection succeeds.
- Task dispatch works.
- Worker receives a task.
- Task completes successfully.
- Job status updates correctly.
- Retry behavior works.
- Idempotency is verified.

### Redis cache

- Cache miss fetches PostgreSQL data.
- Cache hit avoids unnecessary database queries.
- TTL expiration works.
- Cache invalidation works.
- Redis failure does not unnecessarily crash normal API requests.

### PostgreSQL

- Migrations execute successfully.
- Existing data is preserved.
- Indexes are created as intended.
- Materialized views return correct data.
- Refresh jobs work.
- Concurrent refresh requirements are satisfied.
- API endpoints read the correct materialized-view results.

### Render

- Worker start command is correct.
- Beat start command is correct.
- Environment variables are documented.
- Worker can connect to Upstash.
- Worker can connect to Supabase.
- Logs show successful task execution.
- Scheduler does not run duplicate schedules.

### Frontend

- Existing pages still load.
- Existing API contracts remain intact.
- Admin dashboard remains functional.
- Job-status UI respects authentication.
- Existing image management continues working.

Run the available test suite and relevant checks.

At minimum, execute the appropriate versions of:

- Python compilation/import checks.
- Backend tests.
- Type checking.
- Frontend linting.
- Frontend production build.
- Database migration checks.

Do not report a successful test if it was not actually executed.

If an external service is unavailable, perform the available local tests and clearly identify the remaining deployment verification.

---

# 14. IMPLEMENTATION DELIVERABLES

Complete and provide the following:

### Backend

- Celery application configuration.
- Redis broker configuration.
- Central Redis cache service.
- Task modules.
- Worker configuration.
- Beat schedule configuration.
- Database session integration.
- Job tracking model and migration if required.
- Materialized-view service.
- Materialized-view refresh tasks.
- Relevant API integration.
- Retry and idempotency handling.

### Database

- Safe migrations.
- Necessary indexes.
- Materialized views.
- Unique indexes required for concurrent refresh.
- Background-job tracking table if required.
- Refresh history or status tracking if appropriate.

### Render

- `render.yaml`, if appropriate.
- Worker start command.
- Beat start command.
- Build command.
- Environment-variable documentation.
- Deployment instructions.

### Frontend

- Redis-backed API caching through the backend.
- Existing page integrations.
- Admin job-status integration if appropriate.
- No direct frontend connection to Redis or PostgreSQL.

### Documentation

Create or update:

`docs/PNS_BACKGROUND_PROCESSING.md`

`docs/PNS_REDIS_CACHE.md`

`docs/PNS_DATABASE_OPTIMIZATION.md`

`docs/PNS_RENDER_DEPLOYMENT.md`

Document:

- Architecture.
- Environment variables.
- Local execution.
- Worker startup.
- Beat startup.
- Render deployment.
- Task creation.
- Job monitoring.
- Cache invalidation.
- Materialized-view refresh.
- Database migration procedure.
- Troubleshooting.

Never put actual credentials in documentation.

---

# 15. FINAL EXECUTION STRATEGY — COMPLETE THIS FAST

Work in the following order.

**Phase 1 – Inspect**

Quickly inspect the repositories, existing configuration, database schema and deployment architecture.

Do not spend excessive time writing a long analysis.

**Phase 2 – Core infrastructure**

Implement Celery, Redis broker integration, worker configuration, Beat configuration and Render deployment files.

**Phase 3 – Database**

Inspect the actual SQL workload, add necessary indexes, create useful materialized views and implement scheduled refresh tasks.

**Phase 4 – Caching**

Implement the centralized Redis cache service and integrate it with high-value public endpoints. Implement targeted cache invalidation.

**Phase 5 – Job management**

Add durable job tracking, retries, idempotency and authorized status endpoints.

**Phase 6 – Application integration**

Integrate actual background tasks into suitable existing workflows without changing their external behavior.

**Phase 7 – Validation**

Run tests, imports, migrations, builds and connection checks that are available.

Fix issues immediately.

**Phase 8 – Deployment readiness**

Prepare Render services, commands, environment-variable lists and deployment documentation.

## Work efficiently

- Do not ask me to approve every individual file modification.
- Do not repeatedly explain what you plan to do.
- Do not stop after creating Celery configuration.
- Do not leave placeholder tasks where actual existing application functionality can be integrated.
- Do not create unnecessary files or duplicate services.
- Do not refactor unrelated application modules.
- Prioritize working code over lengthy explanations.
- Reuse the existing application architecture.
- Make changes in small, logically organized steps.
- Run tests as you implement, not only at the end.
- If a task is blocked by unavailable credentials or external service access, implement everything else and document the exact remaining action.
- Never fabricate deployment success.

**Target: Complete the core implementation in one focused pass, as fast as reasonably possible. Prioritize a working Render Worker + Beat, Redis caching, Supabase PostgreSQL optimization and end-to-end application integration.**

---

# 16. FINAL REPORT REQUIRED

After implementation, provide a concise but complete report containing:

1. Existing architecture discovered.
2. Files created.
3. Files modified.
4. Celery implementation details.
5. Render Worker configuration.
6. Render Beat configuration.
7. Redis cache implementation.
8. PostgreSQL indexes created.
9. Materialized views created.
10. Celery refresh schedules.
11. Job tracking implementation.
12. API endpoints added or modified.
13. Frontend integration completed.
14. Tests executed and actual results.
15. Performance changes measured, if any.
16. Environment variables required in Render.
17. Database migration commands.
18. Exact Render deployment steps.
19. Any remaining blockers.

Clearly separate:

- Implemented and tested.
- Implemented but not externally verified.
- Requires manual deployment or credentials.
- Deferred because it was not necessary for the core implementation.

**FINAL OBJECTIVE:**

Make PNS Hotel operate with Next.js and FastAPI on Vercel, Upstash Redis for cache and task brokering, Celery Worker and Celery Beat on Render, and Supabase PostgreSQL as the source of truth with optimized indexes and useful materialized views.

The entire architecture must work together without breaking existing application functionality.