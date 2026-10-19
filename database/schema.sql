-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
create extension if not exists "pgcrypto";

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  phone text,
  role text not null default 'customer' check (role in ('customer','admin','delivery')),
  status text not null default 'active' check (status in ('active','suspended')),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null default 'Home',
  full_address text not null,
  latitude double precision, longitude double precision,
  created_at timestamptz not null default now()
);

create table restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  address text not null,
  latitude double precision, longitude double precision,
  phone text, image text,
  cuisine text[] not null default '{}',
  opening_time time, closing_time time,
  delivery_fee numeric(8,2) not null default 0 check (delivery_fee >= 0),
  rating numeric(2,1) not null default 0,
  is_veg boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

create table food_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  category text not null,
  image text,
  is_veg boolean not null default true,
  availability boolean not null default true,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  customizations jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index on food_items (restaurant_id);
create index on food_items (category);

create table carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references users(id) on delete cascade,
  restaurant_id uuid references restaurants(id),
  items jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

create table coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  minimum_order numeric(10,2) not null default 0,
  usage_limit int, used_count int not null default 0,
  expiry_date timestamptz,
  active boolean not null default true
);

create table delivery_partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  vehicle_type text not null check (vehicle_type in ('bike','scooter','bicycle')),
  vehicle_number text,
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected','suspended')),
  availability text not null default 'offline' check (availability in ('online','offline')),
  current_latitude double precision, current_longitude double precision,
  location_updated_at timestamptz
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references users(id),
  restaurant_id uuid not null references restaurants(id),
  delivery_partner_id uuid references delivery_partners(id),
  items jsonb not null,                      -- price snapshot, calculated server-side
  subtotal numeric(10,2) not null,
  delivery_fee numeric(10,2) not null default 0,
  taxes numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  coupon_id uuid references coupons(id),
  address jsonb not null,
  delivery_instructions text,
  payment_method text not null check (payment_method in ('cod','upi','razorpay')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  order_status text not null default 'placed' check (order_status in
    ('placed','accepted','preparing','ready','partner_assigned','picked_up','out_for_delivery','delivered','cancelled','rejected')),
  cancel_reason text,
  delivery_otp text,
  platform_commission numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index on orders (customer_id, created_at desc);
create index on orders (restaurant_id);
create index on orders (delivery_partner_id);
create index on orders (order_status);

create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status text not null,
  changed_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id),
  delivery_partner_id uuid not null references delivery_partners(id),
  pickup_time timestamptz, delivery_time timestamptz,
  status text not null default 'assigned',
  earnings numeric(10,2) not null default 0
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  amount numeric(10,2) not null,
  payment_method text not null,
  payment_gateway_reference text unique,
  payment_status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references users(id),
  restaurant_id uuid not null references restaurants(id),
  order_id uuid not null unique references orders(id),
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create table favorites (
  user_id uuid references users(id) on delete cascade,
  restaurant_id uuid references restaurants(id) on delete cascade,
  primary key (user_id, restaurant_id)
);

create table complaints (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references users(id),
  order_id uuid references orders(id),
  message text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null, message text not null,
  read_status boolean not null default false,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);

create table settings (
  key text primary key,
  value jsonb not null
);
insert into settings (key, value) values
 ('app', '{"name":"ChakHub","currency":"INR","tax_percent":5,"min_order":99,"platform_commission_percent":20,"base_delivery_fee":30,"support_phone":"","service_available":true}');

-- ---------- Row Level Security ----------
-- The backend uses the service role (bypasses RLS). These policies protect direct
-- browser access with the anon key, which Phase 6 uses for realtime subscriptions.
alter table users enable row level security;
alter table addresses enable row level security;
alter table carts enable row level security;
alter table orders enable row level security;
alter table order_status_history enable row level security;
alter table deliveries enable row level security;
alter table payments enable row level security;
alter table reviews enable row level security;
alter table favorites enable row level security;
alter table complaints enable row level security;
alter table notifications enable row level security;
alter table delivery_partners enable row level security;
alter table restaurants enable row level security;
alter table food_items enable row level security;
alter table coupons enable row level security;
alter table settings enable row level security;

create policy "own profile" on users for select using (id = auth.uid());
create policy "own addresses" on addresses for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own cart" on carts for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy "own favorites" on favorites for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notifications" on notifications for select using (user_id = auth.uid());
create policy "own complaints" on complaints for select using (customer_id = auth.uid());
create policy "customer reads own orders" on orders for select using (customer_id = auth.uid());
create policy "partner reads assigned orders" on orders for select
  using (delivery_partner_id in (select id from delivery_partners where user_id = auth.uid()));
create policy "own partner row" on delivery_partners for select using (user_id = auth.uid());
create policy "browse restaurants" on restaurants for select using (status = 'active');
create policy "browse food" on food_items for select using (true);
-- No write policies on orders, payments, coupons: only the backend writes them.
