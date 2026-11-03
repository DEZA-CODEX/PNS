# Hotel PNS Nakshatra

The existing React 19 / Next.js 16 application remains the rendering and frontend layer. The
FastAPI service in `backend/` owns admin APIs, authentication, business logic, and every
PostgreSQL query. Supabase PostgreSQL remains the source of truth; no hotel-content tables or
records are created by this migration.

## Architecture

```text
Browser -> Nginx -> Next.js pages and assets
                 -> FastAPI /api/v1 and /uploads
                    -> Supabase PostgreSQL
                    -> Supabase Storage (optional, must be configured)
```

The browser uses the same-origin `/api/v1` prefix in production. Next.js server rendering verifies
admin sessions by calling FastAPI with the incoming HttpOnly session cookie. The Next.js app has
no database client, API route handlers, or private Supabase credentials. Image upload records are
stored in PostgreSQL; uploaded files use the existing persistent `public/uploads` directory by
default. FastAPI serves those public files at the existing `/uploads/...` URLs.

## Local development

Create the root `.env` from `.env.example` if needed and create `backend/.env` from
`backend/.env.example`. Put the Supabase PostgreSQL connection string and any private Supabase
Storage key in `backend/.env` only; the root `.env` is consumed by Next.js and must contain no
database credentials or service-role secrets. Do not overwrite an existing `.env` blindly, and do
not share or commit either private file.

For local development, set `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1` in the root
`.env` and `CORS_ORIGINS=http://localhost:3000` in `backend/.env`, then run FastAPI:

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In another terminal, run `npm run dev`. For production deployment on Ubuntu with Nginx and
systemd-managed Next.js and FastAPI services, see
[docs/ubuntu-deployment.md](./docs/ubuntu-deployment.md).
For detailed frontend/backend URLs, CORS, cookies, and troubleshooting, see
[docs/frontend-backend-configuration.md](./docs/frontend-backend-configuration.md).

Run checks:

```sh
npm run typecheck
npm run lint
npm run test:backend
npm run build
```

Python development dependencies and tests are in `backend/requirements-dev.txt`; production
dependencies are in `backend/requirements.txt`.

## Database and admin setup

Apply the existing SQL migrations only if they have not already been applied. This migration
does not reset, reseed, or alter existing data. The checked-in schema provides admin users,
Super Admins, roles, groups, permissions, sessions, audit events, managed images, and image
manifest configuration. No backend table definitions exist for hotel inventory, bookings,
enquiries, banquet management, or general website content, so no replacement CRUD APIs are
invented for those areas.

After confirming the existing RBAC schema is present, create the initial Super Admin without
overwriting an existing account:

```sh
npm run bootstrap:superadmin
```

To import existing JSON backup data without replacing existing rows:

```sh
npm run import:legacy-data
```

The importer reads `data/admin-auth-store.json` and the path in `PNS_IMAGE_MANIFEST`. It performs
all database work through Python and inserts only missing records.

## API and authentication

FastAPI exposes `/api/v1/admin/auth/{login,logout,me}`, admin users, groups, Super Admin creation,
audit events, room/dining image management, and public room/dining image lists. The full endpoint
and consumer mapping is in [docs/backend-migration-inventory.md](./docs/backend-migration-inventory.md).

Admin sessions keep the existing `pns_admin_session` HttpOnly cookie; only a SHA-256 token hash is
stored in PostgreSQL. Existing bcrypt and legacy scrypt password hashes are verified without
changing user records. Role and permission checks are enforced server-side. Login throttling uses
Redis when `REDIS_URL` is configured; single-instance deployments can omit it and use the local
limiter. When running multiple backend instances, configure all instances to use the same Redis
service.

`/health/live` and `/health/ready` provide liveness and database readiness checks. API docs are
disabled by default. If enabled, Nginx restricts `/docs` and `/openapi.json` to loopback requests.

## Image storage

Uploads preserve the existing room/dining categories, folder layout, URL contract, and 8 MiB
per-image limit. FastAPI validates the actual image, rejects animated or oversized images, and
converts supported non-WebP formats. Local uploads persist under `public/uploads` and are served
through FastAPI; external URLs remain references and are not downloaded or remotely deleted.

The backend includes a Supabase Storage adapter, but no bucket is created or configured here. To
use an existing public bucket, configure `SUPABASE_URL`, the private
`SUPABASE_SERVICE_ROLE_KEY`, `PNS_IMAGE_STORAGE_BUCKET`, and `PNS_IMAGE_BACKEND=supabase` on the
backend only. Do not put database credentials or the service-role key in `NEXT_PUBLIC_*` variables.
Before scaling across hosts, use shared object storage rather than the single-host
`public/uploads` directory.
