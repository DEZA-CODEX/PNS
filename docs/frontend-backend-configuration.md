# Frontend and FastAPI configuration

The Next.js app uses `NEXT_PUBLIC_API_BASE_URL` for all browser requests to FastAPI, including
admin session verification. FastAPI reads its own `.env`; database credentials and other private
values must never be copied into the frontend environment.

## Environment variables

| Variable                   | Application  | Purpose                                                                                                  |
| -------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | Next.js      | Required at runtime for browser requests to FastAPI; not required to build. Use an absolute HTTP(S) URL. |
| `NEXT_PUBLIC_APP_URL`      | Next.js      | Optional canonical frontend origin for deployment metadata and integrations.                             |
| `APP_ENV`                  | FastAPI      | Environment name; `production` defaults session cookies to Secure.                                       |
| `FRONTEND_URL`             | FastAPI      | Canonical frontend origin for deployment documentation and configuration.                                |
| `CORS_ORIGINS`             | FastAPI      | Comma-separated exact browser origins allowed to call the API with credentials.                          |
| `PNS_ALLOWED_HOSTS`        | FastAPI      | Comma-separated API hostnames accepted by FastAPI's host validation.                                     |
| `DATABASE_URL`             | FastAPI only | PostgreSQL connection string for the existing Supabase database.                                         |
| `SUPABASE_URL`             | FastAPI only | Supabase project origin used by the backend Storage REST API.                                             |
| `SUPABASE_SECRET_KEY`      | FastAPI only | Secret/service-role key used only by FastAPI to manage bucket objects.                                    |
| `SUPABASE_STORAGE_BUCKET`  | FastAPI only | Existing Storage bucket name; the application does not create buckets.                                     |
| `SUPABASE_STORAGE_PUBLIC`  | FastAPI only | Set `true` only for a public bucket; defaults to `false` and serves bytes through FastAPI.                  |
| `PNS_SECURE_COOKIES`       | FastAPI      | Explicitly overrides the Secure cookie flag. Use `true` over HTTPS.                                      |
| `PNS_COOKIE_SAMESITE`      | FastAPI      | `lax` by default; use `none` only for cross-site HTTPS deployments.                                      |
| `PNS_COOKIE_DOMAIN`        | FastAPI      | Optional cookie domain, e.g. a shared parent domain for frontend/API subdomains.                         |
| `PNS_SESSION_DURATION_MINUTES` | FastAPI  | Admin session lifetime in minutes; defaults to `480` (8 hours).                                          |
| `PNS_REMEMBERED_SESSION_DURATION_MINUTES` | FastAPI | Admin “Remember me” lifetime in minutes; defaults to `43200` (30 days).                    |

`NEXT_PUBLIC_API_BASE_URL` is public and is compiled into the Next.js build. Do not put database
URLs, service-role keys, or any secret in a `NEXT_PUBLIC_*` variable.
When configured, its HTTP(S) origin is added to the frontend Content Security Policy.

## Development

Configure the ignored frontend root `.env` and `backend/.env` directly. Keep database connection
credentials only in `backend/.env`.

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Configure `backend/.env`:

```dotenv
APP_ENV=development
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
PNS_ALLOWED_HOSTS=localhost,127.0.0.1
DATABASE_URL=
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-backend-only-secret-key
SUPABASE_STORAGE_BUCKET=your-existing-image-bucket
SUPABASE_STORAGE_PUBLIC=false
```

Install backend dependencies with `python -m pip install -r requirements-dev.txt` from `backend/`.
Run the backend with `npm run backend:dev` and Next.js with `npm run dev`. These development
commands bind to `0.0.0.0`; use the actual Next.js frontend origin in `CORS_ORIGINS` and the
actual API hostname in `PNS_ALLOWED_HOSTS`. Origins must include scheme and port where applicable,
with no path. Do not use wildcard CORS with credentials.

## Production and changing API URLs

Set `NEXT_PUBLIC_API_BASE_URL` in the frontend Vercel project to the public FastAPI origin
reachable by browsers, for example `https://your-backend-domain.example`. Do not add a path;
the API client centrally adds `/api/v1`. Set `NEXT_PUBLIC_APP_URL` to the canonical frontend
origin when needed by metadata or integrations.

Set these variables in the backend Vercel project:

```dotenv
APP_ENV=production
FRONTEND_URL=https://your-frontend-domain.example
CORS_ORIGINS=https://your-frontend-domain.example
PNS_ALLOWED_HOSTS=your-backend-hostname.example
DATABASE_URL=your-database-url
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-backend-only-secret-key
SUPABASE_STORAGE_BUCKET=your-existing-image-bucket
SUPABASE_STORAGE_PUBLIC=false
PNS_SECURE_COOKIES=true
PNS_COOKIE_SAMESITE=none
PNS_SESSION_DURATION_MINUTES=480
PNS_REMEMBERED_SESSION_DURATION_MINUTES=43200
```

Keep the real database URL only in the backend environment. Set `REDIS_URL` only when a shared
Redis service is configured. `CORS_ORIGINS` accepts comma-separated exact origins (scheme and
optional port, no path); `PNS_ALLOWED_HOSTS` accepts comma-separated hostnames only. Neither
setting accepts wildcards. Do not use `0.0.0.0` as an allowed public host.
Create or select the intended bucket in the Supabase project before enabling uploads; the backend
does not create buckets. Keep `SUPABASE_SECRET_KEY` in the backend Vercel project only and never
in a `NEXT_PUBLIC_*` variable. Private buckets are supported: FastAPI reads the object with the
backend key, while public buckets return verified Supabase public URLs. Objects retain the
existing `uploads/room/<category>/...` and `uploads/dining/<category>/...` paths. Check the bucket's
actual access setting before setting `SUPABASE_STORAGE_PUBLIC=true`; no bucket is declared by
this repository.

Because `NEXT_PUBLIC_API_BASE_URL` is a public build-time variable, rebuild/redeploy Next.js after
changing it. The frontend and backend Vercel projects deploy independently. After changing
backend environment variables, redeploy the backend. Changing domains requires updating the
frontend API URL and the backend's frontend origin/CORS list and backend hostname list; no source
changes are needed. Use `GET https://your-backend-domain.example/api/health` to verify API
availability.

For Vercel, set the frontend project's Root Directory to the repository root and its
`NEXT_PUBLIC_API_BASE_URL` to the backend origin. Set the backend project's Root Directory to
`backend/`, then add its backend-only variables above. The backend's `vercel.json` sends backend
requests to its FastAPI ASGI entry point; no frontend proxy or rewrite is needed.

## Authentication cookies, CORS, and HTTPS

The existing host-only `pns_admin_session` HttpOnly cookie remains database-backed. For separate
Vercel domains, configure HTTPS and `PNS_COOKIE_SAMESITE=none` with
`PNS_SECURE_COOKIES=true`; leave `PNS_COOKIE_DOMAIN` unset unless both hosts share a registrable
domain and deliberate cookie sharing is needed. The frontend sends credentials on every API
request. Cross-site tracking prevention can still block third-party cookies in some browsers;
verify login, `/admin/auth/me`, and logout in the browser Network/Application panels. If blocked,
use a same-site custom domain or reverse proxy rather than weakening CORS or authentication.
Because the API cookie is host-only, the frontend verifies `/admin` sessions in the browser
against FastAPI instead of trying to read the backend cookie on the frontend server.

## Troubleshooting

- **Requests go to the wrong API path:** verify `NEXT_PUBLIC_API_BASE_URL` contains only the API
  origin and redeploy Next.js after changing it. The API client adds exactly one `/api/v1` prefix.
- **CORS/preflight error:** check the request's exact `Origin` against comma-separated
  `CORS_ORIGINS`; include scheme and port, omit paths, then restart FastAPI.
- **Login works but later requests are unauthenticated:** confirm browser cookies are enabled,
  credentials are included, the API response sets `pns_admin_session`, and cookie SameSite/Secure/
  domain attributes suit the deployment. Use HTTPS for production.
- **HTTP 503 or `/health/ready` reports database unavailable:** verify `DATABASE_URL` in
  `backend/.env` refers to the existing Supabase database and restart FastAPI. FastAPI stays
  available in degraded mode if PostgreSQL cannot be reached; `/health/live` checks process
  health only, while `/health/ready` reports database readiness. In IPv4-only environments,
  Supabase's direct database hostname may resolve only to IPv6. Use the project's IPv4-compatible
  **Session pooler** connection string from Supabase **Project Settings → Database → Connection
  string** and update only the backend `DATABASE_URL`; do not guess the pooler host or expose its
  password in frontend variables.
- **Network failure:** the shared frontend API client logs “Backend was not connected” and shows
  a notification when a request cannot reach FastAPI or times out. Verify
  `NEXT_PUBLIC_API_BASE_URL` points to the reachable API, the API hostname is included in
  `PNS_ALLOWED_HOSTS`, and the frontend origin is included in `CORS_ORIGINS`; restart FastAPI
  after backend environment changes.
- **404:** verify `NEXT_PUBLIC_API_BASE_URL` contains only the API origin and the API client adds
  exactly one `/api/v1` prefix. HTTP responses, including 404s, are not network disconnections.
