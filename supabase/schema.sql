-- Bin Duty: shared tables. Run once in the Supabase SQL editor.
-- There is no login: anyone holding the link can read, and can write the weekly
-- records. Changing the names and order needs the admin PIN, checked in here.

create table if not exists bd_config (
  id   int primary key check (id = 1),
  data jsonb not null
);

create table if not exists bd_weeks (
  key  text primary key,          -- "<list>:<monday>", e.g. "main:2026-11-16"
  data jsonb not null
);

create table if not exists bd_log (
  id   bigint generated always as identity primary key,
  at   timestamptz not null default now(),
  who  text not null check (char_length(who) <= 60),
  text text not null check (char_length(text) <= 300)
);

alter table bd_config enable row level security;
alter table bd_weeks  enable row level security;
alter table bd_log    enable row level security;

create policy "anyone reads config"  on bd_config for select to anon using (true);

create policy "anyone reads weeks"   on bd_weeks for select to anon using (true);
create policy "anyone adds weeks"    on bd_weeks for insert to anon with check (true);
create policy "anyone edits weeks"   on bd_weeks for update to anon using (true) with check (true);

create policy "anyone reads log"     on bd_log for select to anon using (true);
create policy "anyone adds log"      on bd_log for insert to anon with check (true);

-- Admin PIN. It starts as 0000 and is changed from the app by someone who knows
-- the current one. The hash sits in a table with no policies, so the page cannot
-- read it; only the functions below (which run as the table owner) can.
create extension if not exists pgcrypto with schema extensions;

create table if not exists bd_admin (
  id       int primary key check (id = 1),
  pin_hash text not null
);
alter table bd_admin enable row level security;

insert into bd_admin (id, pin_hash)
  values (1, extensions.crypt('0000', extensions.gen_salt('bf')))
  on conflict (id) do nothing;

create or replace function bd_check_pin(pin text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform pg_sleep(0.5); -- slows down guessing
  return exists (select 1 from bd_admin where pin_hash = crypt(pin, pin_hash));
end;
$$;

create or replace function bd_change_pin(old_pin text, new_pin text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new_pin !~ '^[0-9]{4,12}$' or not bd_check_pin(old_pin) then
    return false;
  end if;
  update bd_admin set pin_hash = crypt(new_pin, gen_salt('bf')) where id = 1;
  return true;
end;
$$;

create or replace function bd_save_config(pin text, new_data jsonb) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not bd_check_pin(pin) then
    return false;
  end if;
  insert into bd_config (id, data) values (1, new_data)
    on conflict (id) do update set data = excluded.data;
  return true;
end;
$$;
