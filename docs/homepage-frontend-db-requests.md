# Homepage frontend requests and database queries

This document describes the requests made by the homepage at `/` and the database queries needed to support them.

## Homepage component tree

The homepage is assembled in [`src/home/Home.tsx`](../src/home/Home.tsx). Its sections use a mix of static data, bundled assets, and managed image data.

## Browser/API requests

### Managed room images

[`RoomsPreview`](../src/home/components/Rooms/RoomsPreview.tsx) calls `useRoomImages("homepage")`.

The repository requests one endpoint for each room type:

```text
GET /api/v1/images/room?type=vajra
GET /api/v1/images/room?type=garuda
GET /api/v1/images/room?type=arohana
GET /api/v1/images/room?type=madhurya
GET /api/v1/images/room?type=maayukha
```

[`GalleryPreview`](../src/home/components/Gallery/GalleryPreview.tsx) also calls `useRoomImages("gallery")`, which repeats the same five category requests. Therefore, the current initial homepage load makes **10 room image API requests**.

### Managed dining images

[`DiningPreview`](../src/home/components/Dining/DiningPreview.tsx) calls `useDiningImageLibrary`, and [`GalleryPreview`](../src/home/components/Gallery/GalleryPreview.tsx) calls `useDiningImages("gallery")`.

Each repository load requests all three dining types:

```text
GET /api/v1/images/dining?type=vrindavan
GET /api/v1/images/dining?type=cloud9
GET /api/v1/images/dining?type=clinq
```

Both homepage consumers load independently, so the current initial homepage load makes **6 dining image API requests**.

The request fan-out is implemented in [`src/services/roomImageRepository.ts`](../src/services/roomImageRepository.ts), and the shared HTTP client is [`src/lib/api-client.ts`](../src/lib/api-client.ts).

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

## Database queries per image API request

The endpoint is defined in [`backend/app/api/v1/images.py`](../backend/app/api/v1/images.py), and the SQL is in [`backend/app/repositories/image_repository.py`](../backend/app/repositories/image_repository.py).

For each request such as `GET /api/v1/images/room?type=vajra`, the backend executes two queries against `public.managed_images`.

### 1. Active images for the requested category

```sql
SELECT id,
       category_id,
       public_url,
       storage_path,
       source_type,
       image_data IS NOT NULL AS has_database_content,
       display_location,
       display_order,
       is_active,
       updated_at
FROM public.managed_images
WHERE category_type = :collection
  AND category_id = :category
  AND is_active
ORDER BY display_order, created_at;
```

Parameters:

```text
:collection = room or dining
:category  = vajra, garuda, arohana, madhurya, maayukha,
             vrindavan, cloud9, or clinq
```

The homepage currently does not pass the optional `location` query parameter, so this query is not filtered by `display_location`.

### 2. Disabled bundled-image overrides

```sql
SELECT legacy_id
FROM public.managed_images
WHERE category_type = :collection
  AND category_id = :category
  AND source_type = 'bundled'
  AND NOT is_active
  AND legacy_id IS NOT NULL;
```

The frontend uses these IDs to remove disabled bundled assets from its local image manifest.

## Current initial-load totals

| Resource | API requests | SQL queries |
|---|---:|---:|
| Room images for Rooms preview | 5 | 10 |
| Room images for Gallery preview | 5 | 10 |
| Dining images for Dining preview | 3 | 6 |
| Dining images for Gallery preview | 3 | 6 |
| **Total** | **16** | **32** |

These totals apply to one homepage mount before the 15-second refresh timer, window-focus refreshes, or managed-image change events trigger additional loads. The refresh behavior is defined in [`src/hooks/useRoomImages.ts`](../src/hooks/useRoomImages.ts) and [`src/hooks/useDiningImages.ts`](../src/hooks/useDiningImages.ts).

## Database schema and index

The relevant table is `public.managed_images`, created in [`supabase/migrations/20261021_admin_rbac.sql`](../supabase/migrations/20261021_admin_rbac.sql). It has an index on:

```text
(category_type, category_id, is_active, display_order)
```

That index supports the main homepage image query. The `ORDER BY created_at` portion may still require additional sorting when multiple rows have the same `display_order`.
