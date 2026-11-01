create table if not exists public.image_manifest_config (
  id uuid primary key default gen_random_uuid(),
  config_key text not null unique,
  category text not null,
  destination_key text not null,
  folder_path text not null,
  public_url_prefix text,
  display_placement text not null default 'gallery',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists image_manifest_config_category_idx
  on public.image_manifest_config(category, destination_key, display_placement);

alter table public.image_manifest_config enable row level security;

drop trigger if exists image_manifest_config_updated_at on public.image_manifest_config;
create trigger image_manifest_config_updated_at
before update on public.image_manifest_config
for each row execute function public.admin_touch_updated_at();
