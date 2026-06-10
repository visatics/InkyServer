create table if not exists renders (
  cache_key   text primary key,
  image_url   text not null,
  sha1        text not null,
  state_out   jsonb not null,
  rendered_at timestamptz not null default now()
);
