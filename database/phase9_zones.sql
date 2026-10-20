-- Delivery zones. Run once in Supabase -> SQL Editor.
create table if not exists zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
alter table restaurants add column if not exists zone_id uuid references zones(id) on delete set null;
create table if not exists rider_zones (
  partner_id uuid not null references delivery_partners(id) on delete cascade,
  zone_id uuid not null references zones(id) on delete cascade,
  primary key (partner_id, zone_id)
);
create index if not exists restaurants_zone_idx on restaurants (zone_id);
-- Only the server (service role) reads and writes these.
alter table zones enable row level security;
alter table rider_zones enable row level security;
