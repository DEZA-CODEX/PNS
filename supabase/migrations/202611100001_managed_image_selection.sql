ALTER TABLE public.managed_images
  ADD COLUMN IF NOT EXISTS selected_homepage boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_rooms_page boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_gallery boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_dining_page boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_dining_hero boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_about_page boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_hero_background boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selected_hero_container boolean NOT NULL DEFAULT false;

ALTER TABLE public.managed_images
  DROP CONSTRAINT IF EXISTS managed_images_category_type_check;

ALTER TABLE public.managed_images
  ADD CONSTRAINT managed_images_category_type_check
  CHECK (category_type IN ('room', 'dining', 'hero'));

UPDATE public.managed_images
   SET selected_homepage = true,
       selected_rooms_page = true,
       selected_gallery = true
 WHERE category_type = 'room'
  AND is_active;

UPDATE public.managed_images
   SET selected_homepage = true,
       selected_dining_page = true,
       selected_dining_hero = true,
       selected_about_page = true,
       selected_gallery = true
 WHERE category_type = 'dining'
   AND is_active;

CREATE INDEX IF NOT EXISTS managed_images_homepage_idx
  ON public.managed_images(category_type, category_id, display_order)
  WHERE is_active AND selected_homepage;

CREATE INDEX IF NOT EXISTS managed_images_rooms_page_idx
  ON public.managed_images(category_id, display_order)
  WHERE category_type = 'room' AND is_active AND selected_rooms_page;

CREATE INDEX IF NOT EXISTS managed_images_gallery_idx
  ON public.managed_images(category_type, category_id, display_order)
  WHERE is_active AND selected_gallery;
