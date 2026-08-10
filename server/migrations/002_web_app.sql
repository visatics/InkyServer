-- Phase 0.3a: the full data model (PRD §5).
--
-- Moves device/screen/button config out of hard-coded TypeScript constants and
-- into Postgres. Ownership links to Supabase Auth's auth.users; it is enforced
-- in the Fastify layer, because the service-role key bypasses RLS.
--
-- Idempotent: safe to re-run.

create table if not exists devices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  public_uuid    uuid not null unique default gen_random_uuid(),
  width_px       int  not null check (width_px  between 1 and 4096),
  height_px      int  not null check (height_px between 1 and 4096),
  button_count   int  not null default 5 check (button_count between 0 and 5),
  default_screen int  not null default 1,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists devices_public_uuid_idx on devices(public_uuid);
create index if not exists devices_user_id_idx     on devices(user_id);

create table if not exists screens (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid not null references devices(id) on delete cascade,
  ordinal          int  not null check (ordinal > 0),
  name             text not null,
  provider         text not null check (provider in ('slideshow','debug')),
  provider_config  jsonb not null default '{}',
  refresh_minutes  int,
  button_overrides jsonb not null default '{}',
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique(device_id, ordinal)
);
create index if not exists screens_device_id_idx on screens(device_id);

create table if not exists device_button_mappings (
  device_id uuid not null references devices(id) on delete cascade,
  button    text not null check (button in ('A','B','C','D','E')),
  action    jsonb not null,
  primary key (device_id, button)
);

create table if not exists slideshow_assets (
  id                uuid primary key default gen_random_uuid(),
  screen_id         uuid not null references screens(id) on delete cascade,
  storage_key       text not null,
  original_filename text,
  position          int not null,
  uploaded_at       timestamptz not null default now()
);
create index if not exists slideshow_assets_screen_pos_idx
  on slideshow_assets(screen_id, position);

-- Extend the Phase 0 render cache with screen linkage, so last-known-good and
-- invalidation can be scoped to a screen and survive a process restart.
alter table renders add column if not exists screen_id uuid
  references screens(id) on delete cascade;
create index if not exists renders_screen_id_idx on renders(screen_id);

-- updated_at maintenance ----------------------------------------------------
-- The render cache key folds in these timestamps, so they ARE the cache
-- invalidation mechanism (PRD §4.1). Triggers keep them correct no matter
-- which handler performed the write.

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end $$;

drop trigger if exists devices_touch on devices;
create trigger devices_touch before update on devices
  for each row execute function touch_updated_at();

drop trigger if exists screens_touch on screens;
create trigger screens_touch before update on screens
  for each row execute function touch_updated_at();

-- Uploading, reordering or deleting an asset must bust its screen's renders.
create or replace function touch_screen_from_asset() returns trigger
language plpgsql as $$
begin
  update screens set updated_at = clock_timestamp()
   where id = coalesce(new.screen_id, old.screen_id);
  return null;
end $$;

drop trigger if exists slideshow_assets_touch on slideshow_assets;
create trigger slideshow_assets_touch
  after insert or update or delete on slideshow_assets
  for each row execute function touch_screen_from_asset();

-- Editing a device-level button mapping must bust that device's renders.
create or replace function touch_device_from_mapping() returns trigger
language plpgsql as $$
begin
  update devices set updated_at = clock_timestamp()
   where id = coalesce(new.device_id, old.device_id);
  return null;
end $$;

drop trigger if exists device_button_mappings_touch on device_button_mappings;
create trigger device_button_mappings_touch
  after insert or update or delete on device_button_mappings
  for each row execute function touch_device_from_mapping();
