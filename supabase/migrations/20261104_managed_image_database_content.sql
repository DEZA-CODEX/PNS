alter table public.managed_images
  add column if not exists image_data bytea,
  add column if not exists content_type text;
