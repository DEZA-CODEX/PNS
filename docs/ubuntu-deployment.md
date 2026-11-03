# Ubuntu deployment

This deployment runs Next.js and FastAPI as separate systemd services behind Nginx. It keeps
Supabase PostgreSQL as the database; it does not install or create a local PostgreSQL server.
The examples use a checkout at `/opt/pns`, the `pns` service account, Next.js at
`127.0.0.1:3000`, FastAPI at `127.0.0.1:8000`, and public HTTP/HTTPS through Nginx.

## Install system packages

```sh
sudo apt update
sudo apt install -y ca-certificates curl gnupg nginx python3 python3-pip python3-venv
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
rm /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node --version
npm --version
```

The project requires a supported Node.js release (use Node.js 22 LTS or newer). If `npm` is not
at `/usr/bin/npm`, update `ExecStart` in `deploy/systemd/pns-frontend.service` to the path reported
by `command -v npm`.

## Prepare the checkout and environment

Place the project checkout at `/opt/pns`, then create a service account and make the checkout
writable by it:

```sh
sudo adduser --system --group --home /opt/pns pns
sudo chown -R pns:pns /opt/pns
sudo -u pns install -d /opt/pns/public/uploads
```

Create each private environment file only if it does not already exist. Edit them on the server
and keep them out of source control:

```sh
cd /opt/pns
if [ ! -f .env ]; then sudo -u pns cp .env.example .env; fi
if [ ! -f backend/.env ]; then sudo -u pns cp backend/.env.example backend/.env; fi
sudo chmod 600 .env backend/.env
```

Set these values in the root `.env`:

```dotenv
SITE_URL=https://your-domain.example
NEXT_PUBLIC_API_BASE_URL=https://your-domain.example/api/v1
```

In `backend/.env`, set `APP_ENV=production`, `FRONTEND_URL=https://your-domain.example`,
`CORS_ORIGINS=https://your-domain.example`, `DATABASE_URL` to the existing Supabase PostgreSQL
connection string, `PNS_IMAGE_STORAGE_DIR=/opt/pns/public/uploads`, and
`PNS_ALLOWED_HOSTS=localhost,127.0.0.1,your-domain.example`. Set
`PNS_SECURE_COOKIES=true` when serving HTTPS. Keep `SUPABASE_SERVICE_ROLE_KEY` and all database
credentials in the backend environment file only. Redis is optional for a single backend instance;
set `REDIS_URL` only when a shared Redis service is available. Do not configure or create a local
database.

## Install Python dependencies and build Next.js

The backend runs in its own virtual environment. The Next.js production build reads the root
`.env`, including its same-origin API URL:

```sh
cd /opt/pns
sudo -u pns python3 -m venv backend/.venv
sudo -u pns backend/.venv/bin/pip install -r backend/requirements.txt
sudo -u pns npm ci
sudo -u pns npm run build
```

## Install and start the systemd services

The included unit files assume `/opt/pns` and the `pns` account. Adjust those paths/user values
first if your installation differs.

```sh
sudo install -m 0644 deploy/systemd/pns-backend.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/pns-frontend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pns-backend pns-frontend
```

FastAPI binds only to loopback port 8000. Next.js binds only to loopback port 3000. Use the
following commands to manage the services and inspect their logs:

```sh
sudo systemctl status pns-backend pns-frontend
sudo systemctl restart pns-backend
sudo systemctl restart pns-frontend
sudo journalctl -u pns-backend -f
sudo journalctl -u pns-frontend -f
```

After deploying code updates, rebuild Next.js when frontend code or build-time configuration
changes, then restart the affected service:

```sh
cd /opt/pns
sudo -u pns npm ci
sudo -u pns npm run build
sudo systemctl restart pns-frontend
sudo systemctl restart pns-backend
```

## Configure Nginx

The supplied config routes `/api/v1/` and `/uploads/` to FastAPI and all other requests to
Next.js. It preserves the incoming host, forwarded protocol, and browser cookies.

```sh
sudo install -D -m 0644 deploy/nginx/proxy-locations.conf /etc/nginx/snippets/pns-locations.conf
sudo install -D -m 0644 deploy/nginx/default.conf /etc/nginx/sites-available/pns
sudo ln -sfn /etc/nginx/sites-available/pns /etc/nginx/sites-enabled/pns
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

The default site serves HTTP on port 80. For HTTPS, provision certificates, update
`deploy/nginx/https.conf.example` with the correct certificate paths and domain, install it in
place of `default.conf`, set `PNS_SECURE_COOKIES=true`, then run `sudo nginx -t` and reload Nginx.

## Verify the deployment

```sh
curl --fail http://127.0.0.1:8000/health/live
curl --fail --head http://127.0.0.1/
curl -i http://127.0.0.1/api/v1/images/invalid?type=room
```

With `DATABASE_URL` configured, the final request should return FastAPI's JSON
`invalid_collection` error with HTTP 400, confirming that Nginx forwards `/api/v1/` to FastAPI.
Without that setting, FastAPI returns a JSON 503 for its unavailable database dependency. A
browser request to the site root is routed to Next.js. The backend readiness endpoint at
`/health/ready` also checks the configured external PostgreSQL connection.
