# Hotel PNS Nakshatra

Hotel PNS Nakshatra is a React 19 and Next.js App Router website styled with Tailwind CSS 4.
The existing page components, design system, images, transitions, and browser-side interactions
are retained in `src/`; Next.js route entries live in `app/`.

## Development

Use Node.js 20.9 or later.

```sh
npm install
npm run dev
```

Available checks and production commands:

```sh
npm run lint
npm run typecheck
npm run build
npm start
```

The production build runs on the Next.js server. Do not configure this application as a static
export: its App Router runtime, metadata routes, and Vercel analytics integration require Next.js
deployment support.

## Routes

| URL                           | Page                                  |
| ----------------------------- | ------------------------------------- |
| `/`                           | Home                                  |
| `/about-us`                   | About                                 |
| `/rooms`                      | Rooms                                 |
| `/dining`                     | Dining                                |
| `/gallery`                    | Gallery                               |
| `/contact`                    | Home page with the contact panel open |
| `/privacy-policy`             | Privacy policy                        |
| `/terms-and-conditions`       | Terms                                 |
| `/refund-cancellation-policy` | Refund and cancellation policy        |
| `/admin`                      | Redirects to the public homepage      |
| `/admin/login`                | Redirects to the public homepage      |
| `/admin/forgot-password`      | Redirects to the public homepage      |

The admin dashboard requires a server-managed session. Public website routes remain accessible
without authentication. User, group, permission, session, audit, and managed-image records are
stored in Supabase PostgreSQL after applying `supabase/migrations/20261021_admin_rbac.sql`.

## Room and dining image libraries

The public room and dining pages, homepage previews, galleries, and admin selectors read from
`src/services/roomImageRepository.ts`. Existing image binaries remain in `src/assets/rooms/` and
`src/assets/dining/`; `src/lib/asset-manifest.ts` statically maps these assets for Next.js builds.

When adding a supported room or dining photograph, place it in its existing category folder and
add its static import and path entry to `src/lib/asset-manifest.ts`. Image selection, display order,
and dining display-count settings are versioned in browser `localStorage`; images are bundled into
the website and are not uploaded or synchronized. Local storage is not shared between visitors or
browsers.

Hero slide images are also statically listed in `src/lib/asset-manifest.ts`. Preserve their source
files and update the corresponding manifest entries when changing those collections.

## Environment and deployment

`SITE_URL` is an optional server-only environment variable used for canonical URLs, the sitemap,
and `robots.txt`. It defaults to `https://hotelpnsnakshatra.com`; set it to the canonical HTTPS
origin for a different production domain before building. These metadata routes are generated at
build time. The variable is read only by server-side code and is not exposed to browser code.

Public pages include page-specific titles, descriptions, canonical URLs, Open Graph and Twitter
metadata. The root layout also emits Hotel structured data using the existing site name, address,
and contact number. Admin URLs are marked `noindex` and excluded from the sitemap.

Image uploads are centrally processed with `sharp` before being written to disk. Uploads are
validated against the actual file content, converted to `.webp` when needed, and stored in the
existing `uploads/<collection>/<category>/` structure without changing the public site layout.
The legacy JSON files remain a migration source for the original app data, while the runtime source
of truth for active uploaded records is the Supabase `managed_images` table and the
`image_manifest_config` table used for destination metadata. Import the current backup values from
`data/admin-auth-store.json` and `data/uploads/image-manifest.json` with
`npm run import:legacy-data` (or `npm run import:image-manifest`) after applying the migration.

Vercel should use its Next.js framework detection and the normal `npm run build` command. The
custom `vercel.json` security headers remain in place; the old Vite SPA rewrite has been removed.
Keep environment values in the deployment platform rather than committing private `.env` files.

The admin image controls use the Next.js server runtime and RBAC. Room image routes are
`/api/admin/room-images` and `/api/admin/room-images/:imageId`; dining image routes are
`/api/admin/dining-images` and `/api/admin/dining-images/:imageId`. Both collections support
authenticated `GET`, multipart `POST` uploads, JSON URL `POST` requests, and `DELETE`. Public
website consumers read `/api/images/room?type=...` and `/api/images/dining?type=...`, while bundled
assets remain the fallback. Managed records also support `PATCH /api/admin/images/:imageId` for
display location, order, and active-state metadata.

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or the legacy `SUPABASE_SECRET_KEY` alias)
with `PNS_IMAGE_BACKEND=supabase` in production. Run `INITIAL_SUPERADMIN_EMAIL` and
`INITIAL_SUPERADMIN_PASSWORD` through the server-only `npm run bootstrap:superadmin` command after
applying the migration. The bootstrap is idempotent and never overwrites an existing account.
Never commit `.env`; use `.env.example` as the variable template and rotate any credential that
has been exposed.

For local image smoke tests, set `PNS_IMAGE_BACKEND=file`, `PNS_IMAGE_MANIFEST`, and
`PNS_IMAGE_STORAGE_DIR` to temporary paths. Production uploads require a persistent mounted
volume or an object-storage implementation; external URLs are stored as references and are never
downloaded or deleted remotely.
