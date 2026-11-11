# Homepage frontend requests and database queries

This document describes the requests made by the homepage at `/` and the database queries needed to support them.

## Homepage component tree

The homepage is assembled in [`src/home/Home.tsx`](../src/home/Home.tsx). Its sections use a mix of static data, bundled assets, and managed image data.

## Browser/API requests

### Managed room images

[`RoomsPreview`](../src/home/components/Rooms/RoomsPreview.tsx) calls `useRoomImages("homepage")`.

It requests the consolidated homepage endpoint:

```text
GET /api/v1/images/homepage
```

[`GalleryPreview`](../src/home/components/Gallery/GalleryPreview.tsx) calls `useRoomImages("gallery")` and requests the consolidated room-section endpoint:

```text
GET /api/v1/images/rooms
```

The repository coalesces concurrent calls to the same endpoint and caches the result in memory for up to 14 seconds.

### Managed dining images

[`DiningPreview`](../src/home/components/Dining/DiningPreview.tsx) calls `useDiningImageLibrary`, and [`GalleryPreview`](../src/home/components/Gallery/GalleryPreview.tsx) calls `useDiningImages("gallery")`.

Both consumers use one consolidated endpoint:

```text
GET /api/v1/images/dining
```

Concurrent calls share one in-flight request. Successful responses for each endpoint are cached in memory for up to 14 seconds. Cache invalidation on focus and managed-image changes remains in the hooks.

### Image content requests

If an API response identifies an uploaded image stored in the database, its image URL is:

```text
GET /api/v1/images/content/{image_id}
```

This request happens when the corresponding `<img>` loads. Bundled and external images use their returned public URL instead, so this request count is dynamic.

### Requests that are not currently made

The homepage does not currently send database/API requests for:

- Room names, descriptions, amenities, or prices. These come from [`src/data/rooms.ts`](../src/data/rooms.ts).
- Dining names and descriptions. These come from [`src/data/hotel.ts`](../src/data/hotel.ts).
- Hero images. Homepage hero background and container slides come exclusively from the code-based
  [`src/data/imageManifest.ts`](../src/data/imageManifest.ts); they do not call the managed-image
  homepage endpoint. Hotel, banquet, and experience content are also bundled assets/static data.
- Booking availability. The booking form only opens the client-side [`BookingPanel`](../src/components/BookingPanel.tsx); it does not submit to an API.
- Contact/map content. Phone, email, address, and links are static; the map iframe loads only after the user clicks “Load interactive map.”

## Database queries

The homepage and room/dining section endpoints are defined in [`backend/app/api/v1/API/homepage.py`](../backend/app/api/v1/API/homepage.py), [`backend/app/api/v1/rooms.py`](../backend/app/api/v1/rooms.py), and [`backend/app/api/v1/dining.py`](../backend/app/api/v1/dining.py). The SQL is in [`backend/app/repositories/image_repository.py`](../backend/app/repositories/image_repository.py).

Each consolidated endpoint loads active image metadata and disabled bundled-image overrides using two SQL queries on a Redis cache miss. Room and dining section endpoints batch all of their categories instead of querying each category separately. The homepage endpoint batches room and dining metadata together; hero selection is still not database-driven.

The category-specific API in [`backend/app/api/v1/images.py`](../backend/app/api/v1/images.py) remains available for clients that need it. Its responses are cached by collection, category, and display location; each cold key uses two queries.

## Current initial-load totals

| Resource | API requests | SQL queries |
|---|---:|---:|
| Room preview (`/images/homepage`) | 1 | 2 on a cold Redis key |
| Room gallery (`/images/rooms`) | 1 | 2 on a cold Redis key |
| Dining preview and gallery (`/images/dining`) | 1 shared | 2 on a cold Redis key |
| **Total** | **3** | **6 on cold keys; 0 on Redis hits** |

These are request/query counts from the current client and backend code, not latency measurements. The browser-side response cache lasts up to 14 seconds; the Redis cache defaults to 300 seconds. Hooks refresh every 15 seconds and invalidate their endpoint cache on focus or managed-image changes. The hooks are [`src/hooks/useRoomImages.ts`](../src/hooks/useRoomImages.ts) and [`src/hooks/useDiningImages.ts`](../src/hooks/useDiningImages.ts).

## Database schema and index

The relevant table is `public.managed_images`, created in [`supabase/migrations/20261021_admin_rbac.sql`](../supabase/migrations/20261021_admin_rbac.sql). It has an index on:

```text
(category_type, category_id, is_active, display_order)
```

That index supports the main homepage image query. The `ORDER BY created_at` portion may still require additional sorting when multiple rows have the same `display_order`.
