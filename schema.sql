-- ============================================================
-- PAYPER TRAILS — Supabase schema
-- Run this once in Supabase: Project → SQL Editor → New query → paste → Run
-- ============================================================

-- 1. Profiles table (mirrors auth.users so we can email people without admin API access)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 2. Vehicles / assets table
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,                 -- e.g. "Hilux Bakkie", "Ski Boat"
  vehicle_type text not null default 'car', -- car, bakkie, boat, trailer, caravan, other
  licence_expiry date,                -- annual eNaTIS licence disc renewal
  service_due_date date,              -- next service, by date
  service_due_km numeric,             -- next service, by odometer
  current_km numeric,                 -- last known odometer reading
  notes text,
  created_at timestamptz default now()
);

alter table public.vehicles enable row level security;

create policy "Users can view own vehicles"
  on public.vehicles for select using (auth.uid() = user_id);
create policy "Users can insert own vehicles"
  on public.vehicles for insert with check (auth.uid() = user_id);
create policy "Users can update own vehicles"
  on public.vehicles for update using (auth.uid() = user_id);
create policy "Users can delete own vehicles"
  on public.vehicles for delete using (auth.uid() = user_id);


-- 3. Warranties / guarantees table (multiple per vehicle — e.g. full vehicle warranty, tyres, battery, new part)
create table if not exists public.warranties (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  item_name text not null,            -- e.g. "Full vehicle warranty", "New tyres", "Battery"
  expiry_date date,                   -- warranty/guarantee end date
  expiry_km numeric,                  -- some warranties are km-based instead of/as well as date-based
  notes text,
  created_at timestamptz default now()
);

alter table public.warranties enable row level security;

create policy "Users can view own warranties"
  on public.warranties for select using (auth.uid() = user_id);
create policy "Users can insert own warranties"
  on public.warranties for insert with check (auth.uid() = user_id);
create policy "Users can update own warranties"
  on public.warranties for update using (auth.uid() = user_id);
create policy "Users can delete own warranties"
  on public.warranties for delete using (auth.uid() = user_id);


-- 4. Reminder log — prevents sending the same reminder twice
create table if not exists public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  item_type text not null,      -- 'licence', 'service', 'warranty'
  item_id uuid not null,        -- vehicle id or warranty id
  threshold_days int not null,  -- 30, 14, 7, or 0 (overdue)
  sent_at timestamptz default now(),
  unique (item_type, item_id, threshold_days)
);

alter table public.reminder_log enable row level security;
-- reminder_log is only touched by the server-side function (service role), so no public policies needed.
