# Hotel PNS Nakshatra

The existing React 19 / Next.js 16 application remains the rendering and frontend layer. The
FastAPI service in `backend/` owns admin APIs, authentication, business logic, and every
PostgreSQL query. Supabase PostgreSQL remains the source of truth; no hotel-content tables or
records are created by this migration.

## Architecture

```text
Browser -> Next.js pages and assets (frontend deployment)
       -> FastAPI /api/v1 (independent backend deployment)
          -> Supabase PostgreSQL
```

The browser uses the absolute backend origin configured in `NEXT_PUBLIC_API_BASE_URL`; the shared
client adds the `/api/v1` prefix. Next.js server rendering verifies admin sessions by calling
FastAPI with the incoming HttpOnly session cookie. The Next.js app has no database client, API
route handlers, or private Supabase credentials. Image upload records are stored in PostgreSQL,
including uploaded image bytes.

## Local development

Configure ignored root `.env` and `backend/.env` directly. Put the PostgreSQL connection string in
`backend/.env` only; the root `.env` is consumed by Next.js and must contain no database credentials.
Do not overwrite an existing `.env` blindly, and do not share or commit either private file.

For local development, set `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` in the root
`.env` and `CORS_ORIGINS=http://localhost:3000` in `backend/.env`, then run FastAPI:

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

In another terminal, run `npm run dev`. Both commands bind to `0.0.0.0`; backend CORS and trusted
hosts must still be explicitly configured. For production deployment on Ubuntu with Nginx and
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

Apply the existing SQL migrations only if they have not already been applied. The image-content
migration adds nullable columns and does not reset or delete existing data. The checked-in schema provides admin users,
Super Admins, roles, groups, permissions, sessions, audit events, managed images, and image
manifest configuration. No backend table definitions exist for hotel inventory, bookings,
enquiries, banquet management, or general website content, so no replacement CRUD APIs are
invented for those areas.

After confirming the existing RBAC schema is present, create the initial Super Admin without
overwriting an existing account:

```sh
npm run bootstrap:superadmin
```

To copy existing uploaded images from the legacy `public/uploads` directory into the database,
after applying the new image-content migration:

```sh
npm run migrate:image-files
```

The migration is idempotent and keeps source files in place. Verify that all uploaded images load
from the API before removing any legacy files. Admin accounts, sessions, image metadata, and
uploaded image bytes are stored in PostgreSQL; externally hosted image URLs remain references.

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

`/health/live`, `/api/health`, and `/api/health/ready` provide liveness and readiness checks. API
docs are disabled by default. If enabled, Nginx restricts `/docs` and `/openapi.json` to loopback
requests.

### Connectivity diagnostics

The backend deployment serves a protected diagnostics page at `/test` and provides
`/api/v1/diagnostics/run`, `/api/v1/diagnostics/browser-result`, and
`/api/v1/diagnostics/results`. Set these backend environment variables in the deployment settings:

- `FRONTEND_URL`: frontend origin checked by a real backend HTTP request.
- `BACKEND_PUBLIC_URL`: backend public origin used by the browser health request.
- `PNS_DIAGNOSTICS_TOKEN`: a strong private token required by all detailed diagnostic endpoints.
- `CORS_ORIGINS` and `PNS_ALLOWED_HOSTS`: exact frontend origins and backend hostnames.
- `DATABASE_URL`: existing PostgreSQL connection. `REDIS_URL` is optional.
- `PNS_DIAGNOSTICS_TIMEOUT_SECONDS`: optional per-check timeout (default 3 seconds; maximum 5).

Do not put the diagnostics token in frontend configuration or commit it. The dashboard prompts for
the token and sends it only to the backend diagnostics API. Public health responses are minimal;
detailed results omit connection strings and exception traces. The in-memory rate limit and
correlation results are per serverless instance and may not be shared across Vercel requests.

The dashboard's browser check requests the configured absolute backend URL with credentials and a
custom header, which triggers a browser CORS preflight when the page and backend are cross-origin.
Because `/test` is hosted by the backend, a same-origin dashboard/backend pair cannot exercise
cross-origin CORS in that browser; that check is explicitly shown as skipped. The deployment
configuration check still verifies that the configured frontend origin is listed in `CORS_ORIGINS`.
For an actual frontend-origin browser test, run the browser probe from a page served by the frontend
origin.

Deploy through the existing `backend/vercel.json` configuration; no extra Vercel route or database
migration is needed. After setting environment variables, redeploy and open the backend deployment's
`/test` URL. Run backend tests with `cd backend && python -m pytest`.

## Image storage

Uploads preserve the existing room/dining categories and 8 MiB per-image limit. FastAPI validates
the image, rejects animated or oversized inputs, converts supported non-WebP formats, and stores
the resulting bytes in the PostgreSQL `managed_images` table. The image-content API serves these
bytes. External URLs remain references and are not fetched. Apply
`supabase/migrations/20261104_managed_image_database_content.sql` before starting the updated
backend. Do not use wildcard CORS with credentialed admin cookies; set exact frontend origins in
`CORS_ORIGINS`.
