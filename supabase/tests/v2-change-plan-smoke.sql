-- PYBIT V2 change-plan smoke checks.
-- Run only in a disposable/staging Supabase project after migrations.
-- This file is intentionally read-only; role-transition cases are listed below
-- for manual execution with three real invited sessions.

begin;

do $$
declare
  v_missing text[];
begin
  select array_agg(required_name order by required_name)
    into v_missing
  from (values
    ('app_v2_create_mandate'),('app_v2_update_pending_mandate'),('app_v2_cancel_mandate'),
    ('app_v2_start_mandate'),('app_v2_update_executing_mandate'),('app_v2_settle_mandate'),('app_v2_screen_state')
  ) required(required_name)
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=required.required_name
  );
  if v_missing is not null then raise exception 'MISSING_V2_CHANGE_PLAN_RPC:%',v_missing; end if;
end $$;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='v2_rounds' and column_name='status')
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='v2_rounds' and column_name='requested_at')
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='v2_rounds' and column_name='settled_at')
  then raise exception 'V2_LIFECYCLE_COLUMNS_MISSING'; end if;
end $$;

-- Static allocation assertion: the new rebuild function must not contain the
-- old regular-rake expression. The individual mandate branch still contains
-- the 10% calculation.
do $$
declare v_source text;
begin
  select pg_get_functiondef(p.oid) into v_source
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='app_v2_rebuild_allocations';
  if v_source is null or position('case when m.is_czh then 0 else' in v_source) > 0 then
    raise exception 'REGULAR_RAKE_LOGIC_STILL_PRESENT';
  end if;
end $$;

-- Manual role smoke sequence (run separately with transaction rollback):
-- 1. member lf: app_v2_create_mandate(date, 70000, 'texas', null, uuid)
--    -> status=pending, grossResultCents is null; screen_state exposes only lf.
-- 2. member lbs: attempt update/cancel/start on lf's id -> FORBIDDEN.
-- 3. czh or waka: start with the pending revision -> executing.
-- 4. czh or waka: update executing amount within available funds; a larger
--    amount than available must fail ASSET_INSUFFICIENT.
-- 5. lf: attempt update-executing/settle/delete after start -> FORBIDDEN.
-- 6. czh or waka: settle with 0 -> settled, no rake, lock released.
-- 7. czh or waka: settle the same stale revision again -> ROUND_VERSION_CONFLICT/FORBIDDEN.
-- 8. create regular B1,000 -> B5,000 with 30/30/30/10 ratios and verify:
--    shareholder net profit B1,200 each, czh net profit B400, rake B0.

rollback;
