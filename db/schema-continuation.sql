-- Continuation for a partially applied local schema. Review only.
--
-- Use only when `public.follow_ups` already exists in the local
-- `followthrough_test` database (CREATE TABLE succeeded, index creation did
-- not run). Fresh databases must use `db/schema.sql` instead.
-- Not executed; awaiting review.

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
