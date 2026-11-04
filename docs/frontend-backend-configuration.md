# Frontend and FastAPI configuration

The Next.js app uses `NEXT_PUBLIC_API_BASE_URL` for all browser requests to FastAPI and its
server-rendered admin-session check. FastAPI reads its own `.env`; database credentials and other
private values must never be copied into the frontend environment.

## Environment variables

| Variable | Application | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Next.js | Absolute HTTP(S) URL to the API root, including `/api/v1`. Required at build and runtime. |
| `APP_ENV` | FastAPI | Environment name; `production` defaults session cookies to Secure. |
| `FRONTEND_URL` | FastAPI | Canonical frontend origin for deployment documentation and configuration. |
| `CORS_ORIGINS` | FastAPI | Comma-separated exact browser origins allowed to call the API with credentials. |
| `PNS_ALLOWED_HOSTS` | FastAPI | Comma-separated API hostnames accepted by FastAPI's host validation. |
| `DATABASE_URL` | FastAPI only | Existing Supabase PostgreSQL connection string. Leave empty until configured. |
| `SUPABASE_URL` | FastAPI only | Supabase project URL used for storage integration. |
| `SUPABASE_PUBLISHABLE_KEY` | FastAPI only | Supabase publishable API key; not a database credential. |
| `SUPABASE_SECRET_KEY` | FastAPI only | Server-only Supabase secret API key; never expose it to frontend code. |
| `SUPABASE_JWKS_URL` | FastAPI only | Supabase JWKS endpoint URL. |
| `PNS_SECURE_COOKIES` | FastAPI | Explicitly overrides the Secure cookie flag. Use `true` over HTTPS. |
| `PNS_COOKIE_SAMESITE` | FastAPI | `lax` by default; use `none` only for cross-site HTTPS deployments. |
| `PNS_COOKIE_DOMAIN` | FastAPI | Optional cookie domain, e.g. a shared parent domain for frontend/API subdomains. |

`NEXT_PUBLIC_API_BASE_URL` is public and is compiled into the Next.js build. Do not put database
URLs, service-role keys, or any secret in a `NEXT_PUBLIC_*` variable.

## Development

Create `.env` and `backend/.env` from their examples, preserving any existing private files.
Configure the frontend root `.env`:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
```

Configure `backend/.env`:

```dotenv
APP_ENV=development
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
DATABASE_URL=
```

Install backend dependencies with `python -m pip install -r requirements-dev.txt` from `backend/`.
Run FastAPI on port 8000 and Next.js on port 3000. Use the actual Next.js frontend origin in
`CORS_ORIGINS`; origins must include scheme and port where applicable, with no path.

## Production and changing API URLs

Set `NEXT_PUBLIC_API_BASE_URL` in the frontend build environment to the API root reachable by
browsers and by the Next.js server. For a same-origin Nginx deployment, use the public site URL
with `/api/v1`, for example `https://your-domain.example/api/v1`. For separate subdomains, use the
public API origin, e.g. `https://api.your-domain.example/api/v1`.

Set `APP_ENV=production`, `FRONTEND_URL`, and `CORS_ORIGINS` in `backend/.env`. Example for a
frontend at `https://www.your-domain.example`:

```dotenv
APP_ENV=production
FRONTEND_URL=https://www.your-domain.example
CORS_ORIGINS=https://www.your-domain.example
DATABASE_URL=your-existing-supabase-postgresql-connection
PNS_SECURE_COOKIES=true
```

Replace example values with the deployment's real URLs and the existing Supabase connection
string. Keep the database URL and server-only Supabase key only in `backend/.env`. Supabase
project/API keys are not a PostgreSQL `DATABASE_URL`; keep the existing database connection
string unless you have a replacement PostgreSQL connection URL. `CORS_ORIGINS` accepts a comma-separated
list for multiple exact origins. Wildcard origins are rejected because credentialed CORS cannot
safely use `*`.

Because `NEXT_PUBLIC_API_BASE_URL` is a public build-time variable, rebuild/redeploy Next.js after
changing it. Changing backend allowed origins requires restarting FastAPI, not changing source.

## Authentication cookies, CORS, and HTTPS

The existing `pns_admin_session` cookie remains HttpOnly and is sent by the centralized frontend
API client using `credentials: "include"`. Login, logout, session verification, and backend RBAC
are unchanged. CORS must list the precise frontend origin and keeps `allow_credentials=True`.

For same-site deployments (same hostname or subdomains under one registrable domain), keep
`PNS_COOKIE_SAMESITE=lax`, use HTTPS in production, and set `PNS_SECURE_COOKIES=true`. To share a
cookie across frontend/API subdomains, configure `PNS_COOKIE_DOMAIN` to the appropriate parent
domain only when needed.

For genuinely cross-site frontend and API origins, modern browsers require HTTPS and
`PNS_COOKIE_SAMESITE=none` together with `PNS_SECURE_COOKIES=true`. Do not disable Secure, widen
CORS to `*`, or remove credential checks to work around browser restrictions. Browser third-party
cookie policies may still block cross-site cookies; prefer a same-site reverse proxy/domain where
possible.

## Troubleshooting

- **API configuration error in the browser/server:** ensure `NEXT_PUBLIC_API_BASE_URL` is set to
  an absolute `http://` or `https://` URL ending in `/api/v1`; rebuild Next.js after changes.
- **CORS/preflight error:** check the request's exact `Origin` against comma-separated
  `CORS_ORIGINS`; include scheme and port, omit paths, then restart FastAPI.
- **Login works but later requests are unauthenticated:** confirm browser cookies are enabled,
  credentials are included, the API response sets `pns_admin_session`, and cookie SameSite/Secure/
  domain attributes suit the deployment. Use HTTPS for production.
- **HTTP 503 or `/health/ready` reports database unavailable:** verify `DATABASE_URL` in
  `backend/.env` refers to the existing Supabase database and restart FastAPI. `/health/live`
  checks process health only and does not require the database.
- **Network failure:** the shared frontend API client logs “Backend was not connected” and shows
  a notification when a request cannot reach FastAPI or times out. Verify
  `NEXT_PUBLIC_API_BASE_URL` points to the reachable API, the API hostname is included in
  `PNS_ALLOWED_HOSTS`, and the frontend origin is included in `CORS_ORIGINS`; restart FastAPI
  after backend environment changes.
- **404:** verify the API URL ends in `/api/v1` and that any reverse proxy forwards `/api/v1/`
  unchanged. HTTP responses, including 404s, are not treated as network disconnections.
