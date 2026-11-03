-- Local test-database schema for review only. Do not apply to production.
--
-- Target: local `followthrough_test` database.
-- Source: verified production Supabase `follow_ups` schema (11 columns),
-- including the `seq` identity column added during implementation.
-- Not executed; awaiting review.

create table public.follow_ups (
  seq           bigint generated always as identity,
  id            uuid primary key default gen_random_uuid(),
  enquiry_id    text not null check (char_length(enquiry_id) between 1 and 100),
  customer      text not null check (char_length(customer) between 1 and 200),
  subject       text not null check (char_length(subject) between 1 and 300),
  reason        text not null check (char_length(reason) between 1 and 2000),
  due_at        timestamptz not null,
  status        text not null check (status in ('pending', 'completed')),
  notes         text not null default '' check (char_length(notes) <= 4000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index follow_ups_enquiry_id_idx on public.follow_ups (enquiry_id);
create index follow_ups_status_idx on public.follow_ups (status);
create unique index follow_ups_seq_uidx on public.follow_ups (seq);

create or replace function public.touch_follow_ups_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger follow_ups_touch
  before update on public.follow_ups
  for each row execute function public.touch_follow_ups_updated_at();

-- Production parity: RLS enabled with deliberately no permissive policies.
-- The backend connects as the table owner, which bypasses RLS.
alter table public.follow_ups enable row level security;
