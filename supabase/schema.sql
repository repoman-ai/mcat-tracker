-- MCAT Momentum: one private state document per authenticated user.
-- Run this once in the Supabase SQL Editor. It is safe to re-run.
--
-- The browser only ever holds the project URL and the publishable key, neither
-- of which grants data access on its own. The policies below are what actually
-- keeps the tracker private, so do not skip the verification query at the end.

create table if not exists public.tracker_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null check (schema_version > 0),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tracker_state enable row level security;

revoke all on table public.tracker_state from anon;
revoke all on table public.tracker_state from authenticated;
grant select, insert, update on table public.tracker_state to authenticated;

drop policy if exists "Read own tracker state" on public.tracker_state;
create policy "Read own tracker state"
on public.tracker_state for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Create own tracker state" on public.tracker_state;
create policy "Create own tracker state"
on public.tracker_state for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Update own tracker state" on public.tracker_state;
create policy "Update own tracker state"
on public.tracker_state for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Deletion is intentionally not granted. The app removes individual mistakes
-- with synchronized tombstones inside the payload; nothing should ever drop the
-- whole state row out from under another device.

-- ---------------------------------------------------------------------------
-- Verification. Run this after the statements above and read the results.
--
-- Expect: rls_enabled = true
--         anon_privileges = 0 rows
--         policy_count = 3
-- ---------------------------------------------------------------------------
select relrowsecurity as rls_enabled
from pg_class
where oid = 'public.tracker_state'::regclass;

select grantee, privilege_type as anon_privileges
from information_schema.role_table_grants
where table_name = 'tracker_state' and grantee = 'anon';

select count(*) as policy_count
from pg_policies
where schemaname = 'public' and tablename = 'tracker_state';
