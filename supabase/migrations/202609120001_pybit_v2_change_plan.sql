-- PYBIT V2 change-plan overlay, 2026-09-12.
-- Prepare only. Do not run against production in this iteration.
-- This overlay preserves V1 and the previous V2 migration for rollback.

alter table public.v2_rounds drop constraint if exists v2_rounds_gross_result_cents_check;
alter table public.v2_rounds alter column gross_result_cents drop not null;
alter table public.v2_rounds add column if not exists status text not null default 'settled';
alter table public.v2_rounds add column if not exists requested_at timestamptz;
alter table public.v2_rounds add column if not exists started_at timestamptz;
alter table public.v2_rounds add column if not exists settled_at timestamptz;
alter table public.v2_rounds add column if not exists cancelled_at timestamptz;
update public.v2_rounds set requested_at=coalesce(requested_at,occurred_at), settled_at=coalesce(settled_at,occurred_at) where requested_at is null or settled_at is null;
alter table public.v2_rounds alter column requested_at set not null;
alter table public.v2_rounds drop constraint if exists v2_rounds_status_check;
alter table public.v2_rounds add constraint v2_rounds_status_check check (status in ('pending','executing','settled','cancelled'));
alter table public.v2_rounds drop constraint if exists v2_rounds_settled_result_check;
alter table public.v2_rounds add constraint v2_rounds_settled_result_check check ((status='settled') = (gross_result_cents is not null));
alter table public.v2_rounds drop constraint if exists v2_rounds_regular_status_check;
alter table public.v2_rounds add constraint v2_rounds_regular_status_check check (mandate_type='individual' or status='settled');
create index if not exists v2_rounds_status_time_idx on public.v2_rounds (status, occurred_at, id) where deleted_at is null;

create or replace function public.app_v2_round_json(p_round_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id',r.id,
    'displaySequence',(select count(*) from public.v2_rounds n where n.deleted_at is null and n.status='settled' and n.scheduled_date=r.scheduled_date and (n.occurred_at,n.id)<=(r.occurred_at,r.id)),
    'status',r.status,
    'scheduledDate',r.scheduled_date,
    'occurredAt',to_char(r.occurred_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS'),
    'requestedAt',to_char(r.requested_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS'),
    'startedAt',case when r.started_at is null then null else to_char(r.started_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') end,
    'settledAt',case when r.settled_at is null then null else to_char(r.settled_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') end,
    'cancelledAt',case when r.cancelled_at is null then null else to_char(r.cancelled_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') end,
    'totalStakeCents',r.total_stake_cents,'grossResultCents',r.gross_result_cents,
    'gameType',r.game_type,'mandateType',r.mandate_type,'ownerMemberId',r.owner_member_id,
    'lockedRatiosBps',r.locked_ratios_bps,'createdBy',r.created_by,'revision',r.revision
  ) from public.v2_rounds r where r.id=p_round_id;
$$;

create or replace function public.app_v2_rebuild_allocations(p_round_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_round public.v2_rounds%rowtype; v_czh uuid; v_rake bigint;
begin
  select * into v_round from public.v2_rounds where id=p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode='P0001'; end if;
  delete from public.v2_round_allocations where round_id=p_round_id;
  if v_round.status<>'settled' then return; end if;
  if v_round.gross_result_cents is null then raise exception 'RESULT_REQUIRED' using errcode='P0001'; end if;
  select id into v_czh from public.members where is_czh and is_active;
  if v_czh is null then raise exception 'CZH_NOT_FOUND' using errcode='P0001'; end if;

  if v_round.mandate_type='individual' then
    v_rake:=((greatest(v_round.gross_result_cents-v_round.total_stake_cents,0)*10+50)/100)::bigint;
    insert into public.v2_round_allocations(round_id,member_id,ratio_bps,stake_cents,gross_cents,rake_cents,settlement_cents,net_profit_cents,manager_rake_income_cents)
    values(v_round.id,v_round.owner_member_id,10000,v_round.total_stake_cents,v_round.gross_result_cents,v_rake,v_round.gross_result_cents-v_rake,v_round.gross_result_cents-v_round.total_stake_cents-v_rake,0);
    insert into public.v2_round_allocations(round_id,member_id,ratio_bps,stake_cents,gross_cents,rake_cents,settlement_cents,net_profit_cents,manager_rake_income_cents)
    values(v_round.id,v_czh,0,0,0,0,v_rake,v_rake,v_rake);
  else
    if (select coalesce(sum(value::integer),0) from jsonb_each_text(v_round.locked_ratios_bps))<>10000 then raise exception 'RATIO_MUST_EQUAL_100_PERCENT' using errcode='P0001'; end if;
    insert into public.v2_round_allocations(round_id,member_id,ratio_bps,stake_cents,gross_cents,rake_cents,settlement_cents,net_profit_cents,manager_rake_income_cents)
    select v_round.id,s.member_id,s.ratio_bps,s.cents,g.cents,0,g.cents,g.cents-s.cents,0
    from public.app_v2_allocate(v_round.total_stake_cents,v_round.locked_ratios_bps) s
    join public.app_v2_allocate(v_round.gross_result_cents,v_round.locked_ratios_bps) g using(member_id,ratio_bps);
  end if;
end $$;

create or replace function public.app_v2_assert_nonnegative() returns void
language plpgsql security definer set search_path=public as $$
declare v_conflict record;
begin
  with effects as (
    select c.member_id,c.occurred_at,0 event_kind,c.id event_id,c.delta_cents delta,0::bigint stake from public.v2_capital_events c
    union all
    select a.member_id,r.occurred_at,1 event_kind,r.id,a.net_profit_cents,a.stake_cents from public.v2_round_allocations a join public.v2_rounds r on r.id=a.round_id where r.deleted_at is null and r.status='settled'
  ), balances as (
    select e.member_id,e.event_id,e.stake,
      o.opening_asset_cents+coalesce(sum(e.delta) over(partition by e.member_id order by e.occurred_at,e.event_kind,e.event_id rows between unbounded preceding and 1 preceding),0) pre_balance,
      o.opening_asset_cents+sum(e.delta) over(partition by e.member_id order by e.occurred_at,e.event_kind,e.event_id rows unbounded preceding) balance
    from effects e join public.v2_member_openings o on o.member_id=e.member_id
  ) select member_id,event_id,least(pre_balance-stake,balance) balance into v_conflict from balances where pre_balance<stake or balance<0 order by least(pre_balance-stake,balance) limit 1;
  if found then raise exception 'ASSET_INSUFFICIENT:%:%',v_conflict.member_id,v_conflict.event_id using errcode='P0001'; end if;
  if exists (
    select 1 from (
      select r.owner_member_id,sum(r.total_stake_cents) locked
      from public.v2_rounds r
      where r.deleted_at is null and r.mandate_type='individual' and r.status in ('pending','executing')
      group by r.owner_member_id
    ) locks
    where coalesce(public.app_v2_current_asset(locks.owner_member_id),0)<locks.locked
  ) then raise exception 'ASSET_BELOW_LOCKED' using errcode='P0001'; end if;
end $$;

create or replace function public.app_v2_save_round(
  p_round_id uuid,p_scheduled_date date,p_occurred_at timestamptz,p_total_stake_cents bigint,p_gross_result_cents bigint,
  p_game_type text,p_mandate_type text,p_owner_member_id uuid,p_expected_revision bigint,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_round public.v2_rounds%rowtype; v_ratios jsonb; v_owner uuid; v_response jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ledger',0));
  select response into v_response from public.app_idempotency where actor_member_id=v_actor and operation='app_v2_save_round' and idempotency_key=p_idempotency_key;
  if found then return v_response; end if;
  if not exists(select 1 from public.v2_member_openings) then raise exception 'V2_OPENING_NOT_CONFIGURED' using errcode='P0001'; end if;
  if p_round_id is null then
    if p_scheduled_date is null or p_total_stake_cents is null or p_total_stake_cents<=0 or p_gross_result_cents is null or p_gross_result_cents<0 or p_game_type is null or p_game_type not in ('texas','other') or p_mandate_type is distinct from 'regular' then raise exception 'ROUND_INPUT_INVALID' using errcode='P0001'; end if;
    if v_role not in ('czh','waka') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    select jsonb_object_agg(member_id::text,ratio_bps) into v_ratios from public.v2_current_ratios;
    insert into public.v2_rounds(status,scheduled_date,occurred_at,requested_at,settled_at,total_stake_cents,gross_result_cents,game_type,mandate_type,owner_member_id,locked_ratios_bps,created_by)
    values('settled',p_scheduled_date,coalesce(p_occurred_at,(p_scheduled_date::text||' 20:00:00 Asia/Shanghai')::timestamptz),coalesce(p_occurred_at,(p_scheduled_date::text||' 20:00:00 Asia/Shanghai')::timestamptz),coalesce(p_occurred_at,(p_scheduled_date::text||' 20:00:00 Asia/Shanghai')::timestamptz),p_total_stake_cents,p_gross_result_cents,p_game_type,'regular',null,v_ratios,v_actor) returning * into v_round;
  else
    select * into v_round from public.v2_rounds where id=p_round_id and deleted_at is null for update;
    if not found then raise exception 'ROUND_NOT_FOUND' using errcode='P0001'; end if;
    if v_role not in ('czh','waka') or v_round.status<>'settled' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    if p_expected_revision is null or p_expected_revision<>v_round.revision then raise exception 'ROUND_VERSION_CONFLICT' using errcode='P0001'; end if;
    v_owner:=case when coalesce(p_mandate_type,v_round.mandate_type)='individual' then coalesce(p_owner_member_id,v_round.owner_member_id) end;
    if coalesce(p_mandate_type,v_round.mandate_type)='individual' and v_owner is null then raise exception 'MANDATE_OWNER_REQUIRED' using errcode='P0001'; end if;
    if coalesce(p_mandate_type,v_round.mandate_type)='regular' then v_ratios:=case when v_round.mandate_type='regular' then v_round.locked_ratios_bps else (select jsonb_object_agg(member_id::text,ratio_bps) from public.v2_current_ratios) end; end if;
    update public.v2_rounds set scheduled_date=coalesce(p_scheduled_date,scheduled_date),occurred_at=coalesce(p_occurred_at,occurred_at),total_stake_cents=coalesce(p_total_stake_cents,total_stake_cents),gross_result_cents=coalesce(p_gross_result_cents,gross_result_cents),game_type=coalesce(p_game_type,game_type),mandate_type=coalesce(p_mandate_type,mandate_type),owner_member_id=v_owner,locked_ratios_bps=v_ratios,revision=revision+1,updated_at=now() where id=p_round_id returning * into v_round;
  end if;
  perform public.app_v2_rebuild_allocations(v_round.id); perform public.app_v2_assert_nonnegative();
  insert into public.v2_audit_logs(action,actor_id,target_id) values(case when p_round_id is null then 'ROUND_CREATED' else 'ROUND_UPDATED' end,v_actor,v_round.id);
  v_response:=public.app_v2_round_json(v_round.id);
  insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_save_round',p_idempotency_key,v_response);
  return v_response;
end $$;

create or replace function public.app_v2_create_mandate(p_scheduled_date date,p_total_stake_cents bigint,p_game_type text,p_owner_member_id uuid,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_owner uuid; v_available bigint; v_round uuid; v_response jsonb; v_now timestamptz:=now();
begin
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ledger',0));
  select response into v_response from public.app_idempotency where actor_member_id=v_actor and operation='app_v2_create_mandate' and idempotency_key=p_idempotency_key; if found then return v_response; end if;
  if p_scheduled_date is null or p_total_stake_cents is null or p_total_stake_cents<=0 or p_game_type not in ('texas','other') then raise exception 'MANDATE_INPUT_INVALID' using errcode='P0001'; end if;
  v_owner:=coalesce(p_owner_member_id,v_actor);
  if v_role='member' and v_owner<>v_actor then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from public.members where id=v_owner and is_active and not is_czh) then raise exception 'MANDATE_OWNER_INVALID' using errcode='P0001'; end if;
  v_available:=public.app_v2_current_asset(v_owner)-coalesce((select sum(total_stake_cents) from public.v2_rounds where owner_member_id=v_owner and deleted_at is null and status in ('pending','executing')),0);
  if v_available<p_total_stake_cents then raise exception 'ASSET_INSUFFICIENT' using errcode='P0001'; end if;
  insert into public.v2_rounds(status,scheduled_date,occurred_at,requested_at,total_stake_cents,gross_result_cents,game_type,mandate_type,owner_member_id,created_by)
  values('pending',p_scheduled_date,v_now,v_now,p_total_stake_cents,null,p_game_type,'individual',v_owner,v_actor) returning id into v_round;
  insert into public.v2_audit_logs(action,actor_id,target_id,metadata) values('ROUND_CREATED',v_actor,v_round,jsonb_build_object('status','pending'));
  v_response:=public.app_v2_round_json(v_round); insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_create_mandate',p_idempotency_key,v_response); return v_response;
end $$;

create or replace function public.app_v2_update_pending_mandate(p_round_id uuid,p_scheduled_date date,p_total_stake_cents bigint,p_game_type text,p_owner_member_id uuid,p_expected_revision bigint,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_round public.v2_rounds%rowtype; v_owner uuid; v_available bigint; v_response jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ledger',0));
  select response into v_response from public.app_idempotency where actor_member_id=v_actor and operation='app_v2_update_pending_mandate' and idempotency_key=p_idempotency_key; if found then return v_response; end if;
  select * into v_round from public.v2_rounds where id=p_round_id and deleted_at is null for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode='P0001'; end if;
  if v_round.status<>'pending' or v_round.mandate_type<>'individual' or (v_role='member' and v_round.owner_member_id<>v_actor) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<>v_round.revision then raise exception 'ROUND_VERSION_CONFLICT' using errcode='P0001'; end if;
  v_owner:=coalesce(p_owner_member_id,v_round.owner_member_id);
  if v_role='member' and v_owner<>v_actor then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_scheduled_date is null or p_total_stake_cents is null or p_total_stake_cents<=0 or p_game_type not in ('texas','other') then raise exception 'MANDATE_INPUT_INVALID' using errcode='P0001'; end if;
  v_available:=public.app_v2_current_asset(v_owner)-coalesce((select sum(total_stake_cents) from public.v2_rounds where owner_member_id=v_owner and id<>p_round_id and deleted_at is null and status in ('pending','executing')),0);
  if v_available<p_total_stake_cents then raise exception 'ASSET_INSUFFICIENT' using errcode='P0001'; end if;
  update public.v2_rounds set scheduled_date=p_scheduled_date,total_stake_cents=p_total_stake_cents,game_type=p_game_type,owner_member_id=v_owner,revision=revision+1,updated_at=now() where id=p_round_id;
  insert into public.v2_audit_logs(action,actor_id,target_id) values('ROUND_UPDATED',v_actor,p_round_id);
  v_response:=public.app_v2_round_json(p_round_id); insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_update_pending_mandate',p_idempotency_key,v_response); return v_response;
end $$;

create or replace function public.app_v2_cancel_mandate(p_round_id uuid,p_expected_revision bigint,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_round public.v2_rounds%rowtype; v_response jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ledger',0));
  select response into v_response from public.app_idempotency where actor_member_id=v_actor and operation='app_v2_cancel_mandate' and idempotency_key=p_idempotency_key; if found then return v_response; end if;
  select * into v_round from public.v2_rounds where id=p_round_id and deleted_at is null for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode='P0001'; end if;
  if v_role not in ('czh','waka') and not (v_round.mandate_type='individual' and v_round.owner_member_id=v_actor) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if v_round.status<>'pending' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<>v_round.revision then raise exception 'ROUND_VERSION_CONFLICT' using errcode='P0001'; end if;
  update public.v2_rounds set status='cancelled',cancelled_at=now(),occurred_at=now(),revision=revision+1,updated_at=now() where id=p_round_id;
  insert into public.v2_audit_logs(action,actor_id,target_id,metadata) values('ROUND_UPDATED',v_actor,p_round_id,jsonb_build_object('status','cancelled'));
  v_response:=public.app_v2_round_json(p_round_id); insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_cancel_mandate',p_idempotency_key,v_response); return v_response;
end $$;

create or replace function public.app_v2_update_executing_mandate(p_round_id uuid,p_scheduled_date date,p_total_stake_cents bigint,p_game_type text,p_owner_member_id uuid,p_expected_revision bigint,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_round public.v2_rounds%rowtype; v_available bigint; v_response jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ledger',0));
  select response into v_response from public.app_idempotency where actor_member_id=v_actor and operation='app_v2_update_executing_mandate' and idempotency_key=p_idempotency_key; if found then return v_response; end if;
  select * into v_round from public.v2_rounds where id=p_round_id and deleted_at is null for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode='P0001'; end if;
  if v_role not in ('czh','waka') or v_round.status<>'executing' or v_round.mandate_type<>'individual' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<>v_round.revision then raise exception 'ROUND_VERSION_CONFLICT' using errcode='P0001'; end if;
  if p_owner_member_id is not null and p_owner_member_id<>v_round.owner_member_id then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_scheduled_date is null or p_total_stake_cents is null or p_total_stake_cents<=0 or p_game_type not in ('texas','other') then raise exception 'MANDATE_INPUT_INVALID' using errcode='P0001'; end if;
  v_available:=public.app_v2_current_asset(v_round.owner_member_id)-coalesce((select sum(total_stake_cents) from public.v2_rounds where owner_member_id=v_round.owner_member_id and id<>p_round_id and deleted_at is null and status in ('pending','executing')),0);
  if v_available<p_total_stake_cents then raise exception 'ASSET_INSUFFICIENT' using errcode='P0001'; end if;
  update public.v2_rounds set scheduled_date=p_scheduled_date,total_stake_cents=p_total_stake_cents,game_type=p_game_type,revision=revision+1,updated_at=now() where id=p_round_id;
  insert into public.v2_audit_logs(action,actor_id,target_id,metadata) values('ROUND_UPDATED',v_actor,p_round_id,jsonb_build_object('status','executing'));
  v_response:=public.app_v2_round_json(p_round_id); insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_update_executing_mandate',p_idempotency_key,v_response); return v_response;
end $$;

create or replace function public.app_v2_start_mandate(p_round_id uuid,p_expected_revision bigint,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_round public.v2_rounds%rowtype; v_response jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ledger',0));
  select response into v_response from public.app_idempotency where actor_member_id=v_actor and operation='app_v2_start_mandate' and idempotency_key=p_idempotency_key; if found then return v_response; end if;
  select * into v_round from public.v2_rounds where id=p_round_id and deleted_at is null for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode='P0001'; end if;
  if v_role not in ('czh','waka') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if v_round.mandate_type<>'individual' or v_round.status<>'pending' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<>v_round.revision then raise exception 'ROUND_VERSION_CONFLICT' using errcode='P0001'; end if;
  update public.v2_rounds set status='executing',started_at=now(),revision=revision+1,updated_at=now() where id=p_round_id;
  insert into public.v2_audit_logs(action,actor_id,target_id,metadata) values('ROUND_UPDATED',v_actor,p_round_id,jsonb_build_object('status','executing'));
  v_response:=public.app_v2_round_json(p_round_id); insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_start_mandate',p_idempotency_key,v_response); return v_response;
end $$;

create or replace function public.app_v2_settle_mandate(p_round_id uuid,p_gross_result_cents bigint,p_expected_revision bigint,p_idempotency_key uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_round public.v2_rounds%rowtype; v_response jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ledger',0));
  select response into v_response from public.app_idempotency where actor_member_id=v_actor and operation='app_v2_settle_mandate' and idempotency_key=p_idempotency_key; if found then return v_response; end if;
  select * into v_round from public.v2_rounds where id=p_round_id and deleted_at is null for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode='P0001'; end if;
  if v_role not in ('czh','waka') or v_round.mandate_type<>'individual' or v_round.status<>'executing' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<>v_round.revision then raise exception 'ROUND_VERSION_CONFLICT' using errcode='P0001'; end if;
  if p_gross_result_cents is null or p_gross_result_cents<0 then raise exception 'RESULT_INVALID' using errcode='P0001'; end if;
  update public.v2_rounds set status='settled',gross_result_cents=p_gross_result_cents,settled_at=now(),occurred_at=now(),revision=revision+1,updated_at=now() where id=p_round_id;
  perform public.app_v2_rebuild_allocations(p_round_id); perform public.app_v2_assert_nonnegative();
  insert into public.v2_audit_logs(action,actor_id,target_id,metadata) values('ROUND_UPDATED',v_actor,p_round_id,jsonb_build_object('status','settled'));
  v_response:=public.app_v2_round_json(p_round_id); insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_settle_mandate',p_idempotency_key,v_response); return v_response;
end $$;

drop function if exists public.app_v2_delete_round(uuid,uuid);
create or replace function public.app_v2_delete_round(p_round_id uuid,p_expected_revision bigint,p_idempotency_key uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_round public.v2_rounds%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ledger',0));
  if exists(select 1 from public.app_idempotency where actor_member_id=v_actor and operation='app_v2_delete_round' and idempotency_key=p_idempotency_key) then return; end if;
  select * into v_round from public.v2_rounds where id=p_round_id and deleted_at is null for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode='P0001'; end if;
  if v_role not in ('czh','waka') and not (v_round.mandate_type='individual' and v_round.owner_member_id=v_actor and v_round.status='pending') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<>v_round.revision then raise exception 'ROUND_VERSION_CONFLICT' using errcode='P0001'; end if;
  if v_round.status in ('pending','executing') then
    update public.v2_rounds set status='cancelled',cancelled_at=now(),occurred_at=now(),revision=revision+1,updated_at=now() where id=p_round_id;
  else
    update public.v2_rounds set deleted_at=now(),deleted_by=v_actor,revision=revision+1,updated_at=now() where id=p_round_id;
    perform public.app_v2_assert_nonnegative();
  end if;
  insert into public.v2_audit_logs(action,actor_id,target_id) values('ROUND_DELETED',v_actor,p_round_id);
  insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_delete_round',p_idempotency_key,'{}'::jsonb);
end $$;

create or replace function public.app_v2_screen_state() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_workspace jsonb; v_market jsonb;
begin
  if not exists(select 1 from public.v2_member_openings) then raise exception 'V2_OPENING_NOT_CONFIGURED' using errcode='P0001'; end if;
  select jsonb_build_object(
    'schemaVersion',3,
    'members',(select jsonb_agg(jsonb_build_object('id',m.id,'name',m.display_name,'role',p.role,'isCzh',m.is_czh,'active',m.is_active,'ratioBps',r.ratio_bps,'initialAssetCents',o.opening_asset_cents) order by m.is_czh,m.created_at) from public.members m join public.profiles p on p.member_id=m.id join public.v2_current_ratios r on r.member_id=m.id join public.v2_member_openings o on o.member_id=m.id where m.is_active),
    'rounds',(select coalesce(jsonb_agg(public.app_v2_round_json(r.id) order by r.occurred_at,r.id),'[]'::jsonb) from public.v2_rounds r where r.deleted_at is null and (v_role in ('czh','waka') or r.mandate_type='regular' or r.owner_member_id=v_actor)),
    'capitalEvents',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'memberId',c.member_id,'deltaCents',c.delta_cents,'beforeCents',c.before_cents,'targetCents',c.target_cents,'occurredAt',to_char(c.occurred_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS'),'actorId',c.actor_id) order by c.occurred_at,c.id),'[]'::jsonb) from public.v2_capital_events c where v_role='czh' or c.member_id=v_actor),
    'ratioChanges','[]'::jsonb,'auditLogs','[]'::jsonb,'updatedAt',to_char(now() at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS')
  ) into v_workspace;
  -- Market history is intentionally computed separately from the private
  -- workspace rows. Ordinary members can see the three-member market curve
  -- without receiving another member's individual mandate details.
  with non_czh as (
    select m.id,m.display_name,o.opening_asset_cents
    from public.members m join public.v2_member_openings o on o.member_id=m.id
    where m.is_active and not m.is_czh
  ), current_assets as (
    select n.id,n.display_name,public.app_v2_current_asset(n.id) asset
    from non_czh n
  ), current_total as (
    select coalesce(sum(asset),0)::bigint total from current_assets
  ), event_effects as (
    select c.id,c.member_id,c.occurred_at,0 event_kind,c.delta_cents delta,
      case when c.delta_cents>=0 then '资金增加' else '资金减少' end label,'capital' source
    from public.v2_capital_events c join non_czh n on n.id=c.member_id
    union all
    select r.id,a.member_id,r.occurred_at,1 event_kind,a.net_profit_cents,
      case when r.mandate_type='individual' then '单独委托' else '常规比赛' end label,r.mandate_type source
    from public.v2_rounds r join public.v2_round_allocations a on a.round_id=r.id
    join non_czh n on n.id=a.member_id
    where r.deleted_at is null and r.status='settled'
  ), ordered_effects as (
    select id,occurred_at,event_kind,sum(delta)::bigint delta,max(label) label,max(source) source
    from event_effects group by id,occurred_at,event_kind
  ), event_balances as (
    select e.id,e.occurred_at,e.event_kind,e.delta,e.label,e.source,n.id member_id,n.display_name,
      n.opening_asset_cents+coalesce((
        select sum(x.delta)::bigint from event_effects x
        where x.member_id=n.id and (x.occurred_at,x.event_kind,x.id)<=(e.occurred_at,e.event_kind,e.id)
      ),0)::bigint asset
    from ordered_effects e cross join non_czh n
  ), market_events as (
    select id,occurred_at,event_kind,delta,label,source,
      sum(asset)::bigint total_asset,
      (sum(asset)-delta)::bigint pre_total_asset,
      jsonb_agg(jsonb_build_object('memberId',member_id,'name',display_name,'assetCents',asset) order by member_id) balances
    from event_balances group by id,occurred_at,event_kind,delta,label,source
  )
  select jsonb_build_object(
    'currentTotalCents',(select total from current_total),
    'shares',(select coalesce(jsonb_agg(jsonb_build_object('memberId',id,'name',display_name,'assetCents',asset,'shareBps',case when current_total.total=0 then null else round(asset*10000.0/current_total.total)::integer end) order by id),'[]'::jsonb) from current_assets cross join current_total),
    'assetEvents',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',to_char(occurred_at at time zone 'Asia/Shanghai','MM-DD')||'·'||label,'occurredAt',to_char(occurred_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS'),'totalAssetCents',total_asset,'preTotalAssetCents',pre_total_asset,'balances',balances,'source',source) order by occurred_at,event_kind,id),'[]'::jsonb) from market_events)
  ) into v_market;
  return jsonb_build_object('actorId',v_actor,'workspace',v_workspace,'market',v_market);
end $$;

alter table public.v2_rounds validate constraint v2_rounds_status_check;
alter table public.v2_rounds validate constraint v2_rounds_settled_result_check;
alter table public.v2_rounds validate constraint v2_rounds_regular_status_check;

revoke all on function public.app_v2_round_json(uuid),public.app_v2_create_mandate(date,bigint,text,uuid,uuid),public.app_v2_update_pending_mandate(uuid,date,bigint,text,uuid,bigint,uuid),public.app_v2_update_executing_mandate(uuid,date,bigint,text,uuid,bigint,uuid),public.app_v2_cancel_mandate(uuid,bigint,uuid),public.app_v2_start_mandate(uuid,bigint,uuid),public.app_v2_settle_mandate(uuid,bigint,bigint,uuid),public.app_v2_delete_round(uuid,bigint,uuid) from public,anon;
grant execute on function public.app_v2_save_round(uuid,date,timestamptz,bigint,bigint,text,text,uuid,bigint,uuid),public.app_v2_create_mandate(date,bigint,text,uuid,uuid),public.app_v2_update_pending_mandate(uuid,date,bigint,text,uuid,bigint,uuid),public.app_v2_update_executing_mandate(uuid,date,bigint,text,uuid,bigint,uuid),public.app_v2_cancel_mandate(uuid,bigint,uuid),public.app_v2_start_mandate(uuid,bigint,uuid),public.app_v2_settle_mandate(uuid,bigint,bigint,uuid),public.app_v2_delete_round(uuid,bigint,uuid),public.app_v2_adjust_own_asset(bigint,uuid),public.app_v2_change_own_ratio(integer,uuid),public.app_v2_screen_state() to authenticated;
