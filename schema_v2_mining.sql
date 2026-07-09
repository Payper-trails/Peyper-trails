-- ============================================================
-- PEYPER-TRAILS — Mining Fleet extension
-- Run this AFTER schema.sql, in the same Supabase SQL Editor.
-- Adds hour-meter tracking + a full reading audit trail
-- (the "independent paper trail" that protects warranty claims
-- even if a physical meter fails or a reading gets mis-transcribed).
-- ============================================================

-- Extend vehicles with meter-based (not just km/date) service tracking
alter table public.vehicles
  add column if not exists meter_unit text not null default 'km',  -- 'km' or 'hours'
  add column if not exists current_hours numeric,                  -- last known hour-meter reading
  add column if not exists service_due_hours numeric;              -- next service due at this many hours

-- Reading log: every reading ever captured for an asset, manual or (later) telematics-fed.
-- This table IS the audit trail / "paper trail" — never edit or delete a row, only add new ones.
create table if not exists public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  reading_value numeric not null,
  reading_unit text not null default 'km',      -- 'km' or 'hours', matches vehicle.meter_unit at time of capture
  reading_date date not null,
  source text not null default 'manual',        -- 'manual' or 'telematics' (future: device-fed readings)
  recorded_by text,                             -- e.g. "Night shift — J. Dlamini"
  flagged boolean not null default false,        -- true if this reading looks anomalous (set by app logic)
  flag_reason text,                             -- e.g. "Reading lower than previous", "Jump of 4200 in 1 day"
  notes text,
  created_at timestamptz default now()
);

alter table public.meter_readings enable row level security;

create policy "Users can view own readings"
  on public.meter_readings for select using (auth.uid() = user_id);
create policy "Users can insert own readings"
  on public.meter_readings for insert with check (auth.uid() = user_id);
create policy "Users can update own readings"
  on public.meter_readings for update using (auth.uid() = user_id);
create policy "Users can delete own readings"
  on public.meter_readings for delete using (auth.uid() = user_id);

create index if not exists meter_readings_vehicle_date_idx
  on public.meter_readings (vehicle_id, reading_date desc);
