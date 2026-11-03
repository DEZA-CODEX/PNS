# PNS backend migration inventory

## Audit scope and findings

The original repository contained 17 Next.js API route modules implementing 23 HTTP methods.
They covered admin authentication/RBAC, users and groups, audit events, room/dining image
management, and public room/dining image lists. No `pages/api` handlers or Server Actions were
found. `app/admin/page.tsx` was the only Server Component performing database-backed session
lookup.

No backend APIs or checked-in database tables were found for hotel inventory, room content,
dining content, banquet management, bookings, enquiries, or general website content. Some admin
dashboard panels display static presentation data for these concepts; those are not backed by a
database API and were not replaced with mock endpoints or new database entities.

## Existing endpoint inventory and migration mapping

All legacy Next.js route handlers below have been removed after their frontend consumers were
reconnected to FastAPI.

| Legacy route and methods | FastAPI route and methods | Frontend consumer |
|---|---|---|
| `POST /api/admin/auth/login` | `POST /api/v1/admin/auth/login` | `src/admin/auth/services/authService.ts` |
| `POST /api/admin/auth/logout` | `POST /api/v1/admin/auth/logout` | `src/admin/auth/services/authService.ts`, `src/site-pages/AdminPanel.tsx` |
| `GET /api/admin/auth/me` | `GET /api/v1/admin/auth/me` | `src/lib/admin-server.ts`, `app/admin/page.tsx` |
| `GET, POST /api/admin/users` | `GET, POST /api/v1/admin/users` | `src/admin/AdminAccessManagement.tsx` |
| `GET, PATCH /api/admin/users/{userId}` | `GET, PATCH /api/v1/admin/users/{user_id}` | `src/admin/AdminAccessManagement.tsx` |
| `POST /api/admin/super-admins` | `POST /api/v1/admin/super-admins` | `src/admin/AdminAccessManagement.tsx` |
| `GET, POST /api/admin/groups` | `GET, POST /api/v1/admin/groups` | `src/admin/AdminAccessManagement.tsx` |
| `PATCH, DELETE /api/admin/groups/{groupId}` | `PATCH, DELETE /api/v1/admin/groups/{group_id}` | `src/admin/AdminAccessManagement.tsx` |
| `PUT /api/admin/groups/{groupId}/members` | `PUT /api/v1/admin/groups/{group_id}/members` | `src/admin/AdminAccessManagement.tsx` |
| `PUT /api/admin/groups/{groupId}/permissions` | `PUT /api/v1/admin/groups/{group_id}/permissions` | `src/admin/AdminAccessManagement.tsx` |
| `GET /api/admin/audit` | `GET /api/v1/admin/audit` | No current UI call found |
| `GET, POST /api/admin/room-images` | `GET, POST /api/v1/admin/room-images` | `src/admin/ImageManagementControls.tsx` |
| `DELETE /api/admin/room-images/{imageId}` | `DELETE /api/v1/admin/room-images/{image_id}` | `src/admin/ImageManagementControls.tsx` |
| `GET, POST /api/admin/dining-images` | `GET, POST /api/v1/admin/dining-images` | `src/admin/ImageManagementControls.tsx` |
| `DELETE /api/admin/dining-images/{imageId}` | `DELETE /api/v1/admin/dining-images/{image_id}` | `src/admin/ImageManagementControls.tsx` |
| `PATCH /api/admin/images/{imageId}` | `PATCH /api/v1/admin/images/{image_id}` | `src/admin/ImageManagementControls.tsx` |
| `GET /api/images/{collection}` | `GET /api/v1/images/{collection}` | `src/services/roomImageRepository.ts` |

The admin API contracts retain the `pns_admin_session` cookie and JSON response conventions.
Public image collection queries retain the `type` and optional `location` query parameters.

## Old backend and data-access inventory

The following legacy Next.js backend files were removed after migration:

- All 17 `app/api/**/route.ts` modules listed above.
- `src/lib/admin-auth.ts`, which owned the Supabase database client, user/role/group/session/
  audit queries, password verification, and the dashboard's database-backed session lookup.
- `src/lib/admin-api.ts`, `src/lib/image-database.ts`, `src/lib/image-management.ts`,
  `src/lib/image-management-api.ts`, and `src/lib/image-processing.ts`.
- `scripts/bootstrap-superadmin.mjs` and `scripts/import-image-manifest.mjs`, which made direct
  Supabase calls. Their management functions now execute through `backend/app/cli.py`.
- The prior HTTP smoke tests that required a running Next.js API server.

The frontend now uses `src/lib/api-client.ts` for browser REST requests and
`src/lib/admin-server.ts` for the server-rendered admin session check. No Supabase JavaScript
client, database query, database credential, or database-dependent Next.js API route remains in
`app/`, `src/`, or `scripts/`.

## FastAPI implementation

The Python backend is under `backend/app/`:

- `main.py` configures HTTP error responses, host/CORS middleware, health checks, and optional
  local-upload serving.
- `api/v1/admin.py` implements login/logout/session verification, users, Super Admin creation,
  groups, memberships, permissions, audit events, and room/dining image administration.
- `api/v1/images.py` implements public managed-image listing.
- `core/` contains settings, PostgreSQL connection/session management, password/session security,
  RBAC dependencies, error types, and login rate limiting.
- `repositories/` contains parameterized PostgreSQL access for the existing schema.
- `services/` contains admin behavior and image validation/storage operations.
- `cli.py` provides idempotent Super Admin bootstrap and insert-only legacy JSON import commands.
- `tests/test_api.py` covers route contracts, authentication gating, password formats, image
  validation, PostgreSQL URL normalization, and storage adapter configuration.

The backend uses async SQLAlchemy with `asyncpg`, bounded connection pooling, and explicit
transaction commits. Redis can be configured through `REDIS_URL` for shared login throttling;
without it, the process-local limiter is used.

## Database schema evidence and integration

Only the checked-in migrations are available as schema evidence; a live schema export was not
available during the repository audit. Existing schema definitions are in
`supabase/migrations/20261021_admin_rbac.sql` and
`supabase/migrations/20261030_image_manifest_config.sql`. They define:

- `admin_user_status` (`active`, `disabled`) and `permission_effect` (`allow`, `deny`) enums.
- `super_admins`, `admin_roles`, `admin_users`, `admin_groups`, `admin_permissions`.
- `admin_group_permissions`, `admin_user_groups`, `admin_user_permissions`, `admin_sessions`.
- `admin_audit_events`, `managed_images`, and `image_manifest_config`.
- Existing foreign keys, uniqueness constraints, indexes, update function/triggers, and RLS
  configuration as specified by those migrations.

No additional application tables are created. The FastAPI backend uses `DATABASE_URL` (or
`SUPABASE_DB_URL`) as a private PostgreSQL connection and does not use Supabase's REST database
client. Database credentials belong only in `backend/.env`; the Next.js frontend does not receive
them.

**Live database connectivity was not verified:** the private backend environment contains the
existing Supabase URL/storage key but no `DATABASE_URL` or `SUPABASE_DB_URL`; neither the root
`.env` nor the current process provides either database variable. No credential value was read or
printed.
Backend route and validation tests therefore use a test database-dependency override; live SQL
queries, transactions, bootstrap, and legacy import still require operator-supplied runtime
configuration.

## Authentication and authorization

- Session cookie: `pns_admin_session`, HttpOnly, SameSite=Lax, path `/`, Secure controlled by
  `PNS_SECURE_COOKIES`; default lifetime 8 hours, remembered lifetime 30 days.
- Session values are opaque random tokens; PostgreSQL stores only a SHA-256 token hash.
- Existing bcrypt and legacy `scrypt$N$r$p$salt$derived-key` hashes are verified in Python.
  Existing passwords and user records are not rewritten as part of this migration.
- Super Admin, group, and direct permission behavior is implemented server-side. The old
  development test-token bypass was removed from Next.js proxy gating and is not accepted by
  FastAPI.
- Login attempts are limited to five per IP per 15-minute window. Use the same Redis service for
  all API instances when horizontally scaling.
- Password reset remains simulated and account self-registration remains disabled, matching the
  existing behavior; neither is represented as a working backend feature.

## Image/file storage

- Existing `managed_images` rows remain the metadata source; no migration changes rows.
- Existing bundled room/dining assets remain in the frontend and are combined with FastAPI
  managed-image results. Hidden bundled IDs remain represented in the existing managed-image
  table.
- Upload limits and validation match the existing workflow: 8 MiB per file, supported detected
  image formats, animation rejection, 64-million-pixel limit, and WebP output.
- Local files retain `/uploads/...` URLs and the `uploads/<collection>/<category>/` layout.
  FastAPI serves `/uploads` from the existing `public/uploads` directory for single-host
  persistence.
- Upload compensation restores storage if a database write or deletion transaction fails.
- A Supabase Storage adapter is implemented but not enabled by default. No bucket is created and
  no existing file is transferred. A pre-existing bucket and explicit operator configuration
  are required before switching to it. Local disk is not shared across hosts.

## Deployment and migration status

Native Ubuntu deployment uses systemd-managed Next.js and FastAPI services behind Nginx. Nginx
sends `/api/v1/` and `/uploads/` to FastAPI and other paths to Next.js. The HTTPS example requires
operator-provided certificates. FastAPI docs are disabled by default and Nginx restricts them to
loopback when enabled.

| Requirement | Status |
|---|---|
| Existing 23 API methods recreated in FastAPI | Implemented; route-contract test added |
| Existing frontend and admin image/RBAC consumers reconnected | Implemented |
| Next.js database routes, Supabase database helper, and direct-query Node scripts removed | Implemented |
| Password compatibility and database-backed session logic | Implemented; live DB verification blocked |
| Local upload preservation and optional Supabase Storage adapter | Implemented; bucket integration not configured |
| One-server Ubuntu/systemd/Nginx deployment | Documented in `docs/ubuntu-deployment.md`; runtime verification is environment-dependent |
| Existing PostgreSQL schema/data integrity | No schema or record changes made; live DB tests blocked |
| Public/admin browser workflows and actual image synchronization | Not end-to-end verified without the configured database and running deployment |

Do not treat the migration as production-verified until `DATABASE_URL` is configured and the
backend is exercised against the existing Supabase schema and records.
