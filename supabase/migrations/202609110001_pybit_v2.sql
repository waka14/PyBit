-- PYBIT V2 schema and RPCs. Prepare in an isolated Supabase project first.
-- This migration keeps every V1 table intact for reconciliation and rollback.

create table if not exists public.v2_member_openings (
  member_id uuid primary key references public.members(id) on delete restrict,
  opening_asset_cents bigint not null check (opening_asset_cents >= 0),
  effective_at timestamptz not null,
  created_by uuid not null references public.members(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.v2_current_ratios (
  member_id uuid primary key references public.members(id) on delete restrict,
  ratio_bps integer not null check (ratio_bps between 0 and 10000),
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.members(id) on delete restrict
);

create table if not exists public.v2_rounds (
  id uuid primary key default gen_random_uuid(),
  scheduled_date date not null,
  occurred_at timestamptz not null,
  total_stake_cents bigint not null check (total_stake_cents > 0),
  gross_result_cents bigint not null check (gross_result_cents >= 0),
  game_type text not null check (game_type in ('texas','other')),
  mandate_type text not null check (mandate_type in ('regular','individual')),
  owner_member_id uuid references public.members(id) on delete restrict,
  locked_ratios_bps jsonb,
  revision bigint not null default 1,
  created_by uuid not null references public.members(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.members(id) on delete restrict,
  check ((mandate_type = 'individual') = (owner_member_id is not null)),
  check ((mandate_type = 'regular') = (locked_ratios_bps is not null))
);

create table if not exists public.v2_round_allocations (
  round_id uuid not null references public.v2_rounds(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  ratio_bps integer not null check (ratio_bps between 0 and 10000),
  stake_cents bigint not null check (stake_cents >= 0),
  gross_cents bigint not null check (gross_cents >= 0),
  rake_cents bigint not null check (rake_cents >= 0),
  settlement_cents bigint not null check (settlement_cents >= 0),
  net_profit_cents bigint not null,
  manager_rake_income_cents bigint not null default 0 check (manager_rake_income_cents >= 0),
  primary key (round_id, member_id)
);

create table if not exists public.v2_capital_events (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  delta_cents bigint not null check (delta_cents <> 0),
  before_cents bigint not null check (before_cents >= 0),
  target_cents bigint not null check (target_cents >= 0),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null references public.members(id) on delete restrict,
  idempotency_key uuid not null,
  unique (member_id, idempotency_key)
);

create table if not exists public.v2_ratio_changes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  before_bps integer not null check (before_bps between 0 and 10000),
  after_bps integer not null check (after_bps between 0 and 10000),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null references public.members(id) on delete restrict,
  idempotency_key uuid not null,
  unique (member_id, idempotency_key)
);

create table if not exists public.v2_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('ROUND_CREATED','ROUND_UPDATED','ROUND_DELETED','ASSET_ADJUSTED','RATIO_CHANGED','OPENINGS_CONFIGURED')),
  actor_id uuid references public.members(id) on delete set null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists v2_rounds_active_time_idx on public.v2_rounds (occurred_at, id) where deleted_at is null;
create index if not exists v2_allocations_member_idx on public.v2_round_allocations (member_id, round_id);
create index if not exists v2_capital_member_time_idx on public.v2_capital_events (member_id, occurred_at, id);

create or replace function public.app_v2_actor() returns uuid
language plpgsql stable security definer set search_path=public as $$
declare v_member uuid;
begin
  select member_id into v_member from public.profiles where auth_user_id=auth.uid();
  if v_member is null then raise exception 'PROFILE_NOT_BOUND' using errcode='P0001'; end if;
  return v_member;
end $$;

create or replace function public.app_v2_role() returns public.pybit_role
language plpgsql stable security definer set search_path=public as $$
declare v_role public.pybit_role;
begin
  select role into v_role from public.profiles where auth_user_id=auth.uid();
  if v_role is null then raise exception 'PROFILE_NOT_BOUND' using errcode='P0001'; end if;
  return v_role;
end $$;

create or replace function public.app_v2_current_asset(p_member_id uuid) returns bigint
language sql stable security definer set search_path=public as $$
  select o.opening_asset_cents
    + coalesce((select sum(c.delta_cents) from public.v2_capital_events c where c.member_id=o.member_id),0)
    + coalesce((select sum(a.net_profit_cents) from public.v2_round_allocations a join public.v2_rounds r on r.id=a.round_id where a.member_id=o.member_id and r.deleted_at is null),0)
  from public.v2_member_openings o where o.member_id=p_member_id
$$;

create or replace function public.app_v2_allocate(p_total bigint, p_weights jsonb)
returns table(member_id uuid, ratio_bps integer, cents bigint)
language sql immutable as $$
  with weights as (
    select key::uuid member_id, value::integer ratio_bps from jsonb_each_text(p_weights)
  ), raw as (
    select member_id, ratio_bps,
      (p_total * ratio_bps / sum(ratio_bps) over())::bigint base,
      (p_total * ratio_bps % sum(ratio_bps) over())::bigint remainder
    from weights
  ), ranked as (
    select *, row_number() over(order by remainder desc, member_id) rank,
      p_total - sum(base) over() missing
    from raw
  )
  select member_id, ratio_bps, base + case when rank <= missing then 1 else 0 end from ranked
$$;

create or replace function public.app_v2_rebuild_allocations(p_round_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_round public.v2_rounds%rowtype; v_czh uuid; v_rake bigint;
begin
  select * into v_round from public.v2_rounds where id=p_round_id for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode='P0001'; end if;
  delete from public.v2_round_allocations where round_id=p_round_id;
  select id into v_czh from public.members where is_czh and is_active;
  if v_czh is null then raise exception 'CZH_NOT_FOUND' using errcode='P0001'; end if;

  if v_round.mandate_type='individual' then
    insert into public.v2_round_allocations(round_id,member_id,ratio_bps,stake_cents,gross_cents,rake_cents,settlement_cents,net_profit_cents)
    values(p_round_id,v_round.owner_member_id,10000,v_round.total_stake_cents,v_round.gross_result_cents,
      ((greatest(v_round.gross_result_cents-v_round.total_stake_cents,0)*10+50)/100)::bigint,
      v_round.gross_result_cents-((greatest(v_round.gross_result_cents-v_round.total_stake_cents,0)*10+50)/100)::bigint,
      v_round.gross_result_cents-v_round.total_stake_cents-((greatest(v_round.gross_result_cents-v_round.total_stake_cents,0)*10+50)/100)::bigint);
    select rake_cents into v_rake from public.v2_round_allocations where round_id=p_round_id and member_id=v_round.owner_member_id;
    insert into public.v2_round_allocations(round_id,member_id,ratio_bps,stake_cents,gross_cents,rake_cents,settlement_cents,net_profit_cents,manager_rake_income_cents)
    values(p_round_id,v_czh,0,0,0,0,v_rake,v_rake,v_rake);
  else
    if (select coalesce(sum(value::integer),0) from jsonb_each_text(v_round.locked_ratios_bps)) <> 10000 then raise exception 'RATIO_MUST_EQUAL_100_PERCENT' using errcode='P0001'; end if;
    insert into public.v2_round_allocations(round_id,member_id,ratio_bps,stake_cents,gross_cents,rake_cents,settlement_cents,net_profit_cents)
    select p_round_id,s.member_id,s.ratio_bps,s.cents,g.cents,
      case when m.is_czh then 0 else ((greatest(g.cents-s.cents,0)*10+50)/100)::bigint end,
      g.cents-case when m.is_czh then 0 else ((greatest(g.cents-s.cents,0)*10+50)/100)::bigint end,
      g.cents-s.cents-case when m.is_czh then 0 else ((greatest(g.cents-s.cents,0)*10+50)/100)::bigint end
    from public.app_v2_allocate(v_round.total_stake_cents,v_round.locked_ratios_bps) s
    join public.app_v2_allocate(v_round.gross_result_cents,v_round.locked_ratios_bps) g using(member_id,ratio_bps)
    join public.members m on m.id=s.member_id;
    select coalesce(sum(rake_cents),0) into v_rake from public.v2_round_allocations where round_id=p_round_id;
    update public.v2_round_allocations set settlement_cents=settlement_cents+v_rake,net_profit_cents=net_profit_cents+v_rake,manager_rake_income_cents=v_rake where round_id=p_round_id and member_id=v_czh;
  end if;
end $$;

create or replace function public.app_v2_assert_nonnegative() returns void
language plpgsql security definer set search_path=public as $$
declare v_conflict record;
begin
  with effects as (
    select c.member_id,c.occurred_at,0 event_kind,c.id event_id,c.delta_cents delta,0::bigint stake from public.v2_capital_events c
    union all
    select a.member_id,r.occurred_at,1 event_kind,r.id,a.net_profit_cents,a.stake_cents from public.v2_round_allocations a join public.v2_rounds r on r.id=a.round_id where r.deleted_at is null
  ), balances as (
    select e.member_id,e.event_id,e.stake,
      o.opening_asset_cents+coalesce(sum(e.delta) over(partition by e.member_id order by e.occurred_at,e.event_kind,e.event_id rows between unbounded preceding and 1 preceding),0) pre_balance,
      o.opening_asset_cents+sum(e.delta) over(partition by e.member_id order by e.occurred_at,e.event_kind,e.event_id rows unbounded preceding) balance
    from effects e join public.v2_member_openings o on o.member_id=e.member_id
  ) select member_id,event_id,least(pre_balance-stake,balance) balance into v_conflict from balances where pre_balance<stake or balance<0 order by least(pre_balance-stake,balance) limit 1;
  if found then raise exception 'ASSET_INSUFFICIENT:%:%',v_conflict.member_id,v_conflict.event_id using errcode='P0001'; end if;
end $$;

create or replace function public.app_v2_configure_openings(p_entries jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_total integer; v_czh uuid;
begin
  if v_role<>'czh' then raise exception 'CZH_REQUIRED' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ledger',0));
  if exists(select 1 from public.v2_member_openings) or exists(select 1 from public.v2_rounds) then raise exception 'V2_ALREADY_CONFIGURED' using errcode='P0001'; end if;
  if (select count(*) from public.members where is_active and not is_czh)<>3 or (select count(*) from public.members where is_active and is_czh)<>1 then raise exception 'V2_REQUIRES_THREE_SHAREHOLDERS_AND_CZH' using errcode='P0001'; end if;
  select id into v_czh from public.members where is_czh and is_active;
  insert into public.v2_member_openings(member_id,opening_asset_cents,effective_at,created_by)
  select (row->>'memberId')::uuid,(row->>'openingAssetCents')::bigint,coalesce((row->>'effectiveAt')::timestamptz,now()),v_actor from jsonb_array_elements(p_entries) row;
  insert into public.v2_current_ratios(member_id,ratio_bps,updated_by)
  select (row->>'memberId')::uuid,(row->>'ratioBps')::integer,v_actor from jsonb_array_elements(p_entries) row where (row->>'memberId')::uuid<>v_czh;
  select coalesce(sum(ratio_bps),0) into v_total from public.v2_current_ratios;
  if v_total>10000 then raise exception 'RATIO_EXCEEDS_REMAINDER' using errcode='P0001'; end if;
  insert into public.v2_current_ratios(member_id,ratio_bps,updated_by) values(v_czh,10000-v_total,v_actor);
  if (select count(*) from public.v2_member_openings)<>(select count(*) from public.members where is_active) then raise exception 'OPENINGS_INCOMPLETE' using errcode='P0001'; end if;
  insert into public.v2_audit_logs(action,actor_id,target_id) values('OPENINGS_CONFIGURED',v_actor,v_czh);
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
    if p_scheduled_date is null or p_total_stake_cents is null or p_total_stake_cents<=0 or p_gross_result_cents is null or p_gross_result_cents<0 or p_game_type is null or p_game_type not in ('texas','other') or p_mandate_type is null or p_mandate_type not in ('regular','individual') then raise exception 'ROUND_INPUT_INVALID' using errcode='P0001'; end if;
    if p_mandate_type='regular' and v_role='member' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    v_owner:=case when p_mandate_type='individual' then coalesce(p_owner_member_id,case when v_role<>'czh' then v_actor end) end;
    if p_mandate_type='individual' and (v_owner is null or (v_role='member' and v_owner<>v_actor) or exists(select 1 from public.members where id=v_owner and is_czh)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    if p_mandate_type='regular' then select jsonb_object_agg(member_id::text,ratio_bps) into v_ratios from public.v2_current_ratios; end if;
    insert into public.v2_rounds(scheduled_date,occurred_at,total_stake_cents,gross_result_cents,game_type,mandate_type,owner_member_id,locked_ratios_bps,created_by)
    values(p_scheduled_date,coalesce(p_occurred_at,(p_scheduled_date::text||' 20:00:00 Asia/Shanghai')::timestamptz),p_total_stake_cents,p_gross_result_cents,p_game_type,p_mandate_type,v_owner,v_ratios,v_actor) returning * into v_round;
    perform public.app_v2_rebuild_allocations(v_round.id); perform public.app_v2_assert_nonnegative();
    insert into public.v2_audit_logs(action,actor_id,target_id) values('ROUND_CREATED',v_actor,v_round.id);
  else
    select * into v_round from public.v2_rounds where id=p_round_id and deleted_at is null for update;
    if not found then raise exception 'ROUND_NOT_FOUND' using errcode='P0001'; end if;
    if not (v_role in ('czh','waka') or (v_round.mandate_type='individual' and v_round.owner_member_id=v_actor)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    if p_expected_revision is not null and p_expected_revision<>v_round.revision then raise exception 'ROUND_VERSION_CONFLICT' using errcode='P0001'; end if;
    v_owner:=case when coalesce(p_mandate_type,v_round.mandate_type)='individual' then coalesce(p_owner_member_id,v_round.owner_member_id) end;
    if v_role='member' and (coalesce(p_mandate_type,v_round.mandate_type)<>'individual' or v_owner<>v_actor) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    if coalesce(p_mandate_type,v_round.mandate_type)='regular' then v_ratios:=case when v_round.mandate_type='regular' then v_round.locked_ratios_bps else (select jsonb_object_agg(member_id::text,ratio_bps) from public.v2_current_ratios) end; end if;
    update public.v2_rounds set scheduled_date=coalesce(p_scheduled_date,scheduled_date),occurred_at=coalesce(p_occurred_at,occurred_at),total_stake_cents=coalesce(p_total_stake_cents,total_stake_cents),gross_result_cents=coalesce(p_gross_result_cents,gross_result_cents),game_type=coalesce(p_game_type,game_type),mandate_type=coalesce(p_mandate_type,mandate_type),owner_member_id=v_owner,locked_ratios_bps=v_ratios,revision=revision+1,updated_at=now() where id=p_round_id returning * into v_round;
    perform public.app_v2_rebuild_allocations(v_round.id); perform public.app_v2_assert_nonnegative();
    insert into public.v2_audit_logs(action,actor_id,target_id) values('ROUND_UPDATED',v_actor,v_round.id);
  end if;
  v_response:=jsonb_build_object('id',v_round.id,'scheduledDate',v_round.scheduled_date,'occurredAt',to_char(v_round.occurred_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS'),'totalStakeCents',v_round.total_stake_cents,'grossResultCents',v_round.gross_result_cents,'gameType',v_round.game_type,'mandateType',v_round.mandate_type,'ownerMemberId',v_round.owner_member_id,'lockedRatiosBps',v_round.locked_ratios_bps,'createdBy',v_round.created_by,'revision',v_round.revision);
  insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_save_round',p_idempotency_key,v_response);
  return v_response;
end $$;

create or replace function public.app_v2_delete_round(p_round_id uuid,p_idempotency_key uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_round public.v2_rounds%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ledger',0));
  if exists(select 1 from public.app_idempotency where actor_member_id=v_actor and operation='app_v2_delete_round' and idempotency_key=p_idempotency_key) then return; end if;
  select * into v_round from public.v2_rounds where id=p_round_id and deleted_at is null for update;
  if not found then raise exception 'ROUND_NOT_FOUND' using errcode='P0001'; end if;
  if not (v_role in ('czh','waka') or (v_round.mandate_type='individual' and v_round.owner_member_id=v_actor)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  update public.v2_rounds set deleted_at=now(),deleted_by=v_actor,revision=revision+1,updated_at=now() where id=p_round_id;
  perform public.app_v2_assert_nonnegative();
  insert into public.v2_audit_logs(action,actor_id,target_id) values('ROUND_DELETED',v_actor,p_round_id);
  insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_delete_round',p_idempotency_key,'{}'::jsonb);
end $$;

create or replace function public.app_v2_adjust_own_asset(p_target_cents bigint,p_idempotency_key uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_before bigint; v_delta bigint; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ledger',0));
  if exists(select 1 from public.app_idempotency where actor_member_id=v_actor and operation='app_v2_adjust_own_asset' and idempotency_key=p_idempotency_key) then return; end if;
  if p_target_cents is null or p_target_cents<0 then raise exception 'ASSET_INVALID' using errcode='P0001'; end if;
  select public.app_v2_current_asset(v_actor) into v_before;
  if v_before is null then raise exception 'V2_OPENING_NOT_CONFIGURED' using errcode='P0001'; end if;
  v_delta:=p_target_cents-v_before; if v_delta=0 then return; end if;
  insert into public.v2_capital_events(member_id,delta_cents,before_cents,target_cents,actor_id,idempotency_key) values(v_actor,v_delta,v_before,p_target_cents,v_actor,p_idempotency_key) returning id into v_id;
  perform public.app_v2_assert_nonnegative();
  insert into public.v2_audit_logs(action,actor_id,target_id) values('ASSET_ADJUSTED',v_actor,v_id);
  insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_adjust_own_asset',p_idempotency_key,'{}'::jsonb);
end $$;

create or replace function public.app_v2_change_own_ratio(p_after_bps integer,p_idempotency_key uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_before integer; v_other integer; v_czh uuid; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('pybit-v2-ratios',0));
  if exists(select 1 from public.app_idempotency where actor_member_id=v_actor and operation='app_v2_change_own_ratio' and idempotency_key=p_idempotency_key) then return; end if;
  if p_after_bps is null or p_after_bps<0 or p_after_bps>10000 then raise exception 'RATIO_INVALID' using errcode='P0001'; end if;
  if exists(select 1 from public.members where id=v_actor and is_czh) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select ratio_bps into v_before from public.v2_current_ratios where member_id=v_actor for update;
  select coalesce(sum(ratio_bps),0) into v_other from public.v2_current_ratios r join public.members m on m.id=r.member_id where not m.is_czh and m.is_active and r.member_id<>v_actor;
  if v_other+p_after_bps>10000 then raise exception 'RATIO_EXCEEDS_REMAINDER' using errcode='P0001'; end if;
  select id into v_czh from public.members where is_czh and is_active;
  update public.v2_current_ratios set ratio_bps=p_after_bps,revision=revision+1,updated_at=now(),updated_by=v_actor where member_id=v_actor;
  update public.v2_current_ratios set ratio_bps=10000-v_other-p_after_bps,revision=revision+1,updated_at=now(),updated_by=v_actor where member_id=v_czh;
  insert into public.v2_ratio_changes(member_id,before_bps,after_bps,actor_id,idempotency_key) values(v_actor,v_before,p_after_bps,v_actor,p_idempotency_key) returning id into v_id;
  insert into public.v2_audit_logs(action,actor_id,target_id) values('RATIO_CHANGED',v_actor,v_id);
  insert into public.app_idempotency(actor_member_id,operation,idempotency_key,response) values(v_actor,'app_v2_change_own_ratio',p_idempotency_key,'{}'::jsonb);
end $$;

create or replace function public.app_v2_screen_state() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_actor uuid:=public.app_v2_actor(); v_role public.pybit_role:=public.app_v2_role(); v_workspace jsonb; v_market jsonb;
begin
  if not exists(select 1 from public.v2_member_openings) then raise exception 'V2_OPENING_NOT_CONFIGURED' using errcode='P0001'; end if;
  select jsonb_build_object(
    'schemaVersion',3,
    'members',(select jsonb_agg(jsonb_build_object('id',m.id,'name',m.display_name,'role',p.role,'isCzh',m.is_czh,'active',m.is_active,'ratioBps',r.ratio_bps,'initialAssetCents',o.opening_asset_cents) order by m.is_czh,m.created_at) from public.members m join public.profiles p on p.member_id=m.id join public.v2_current_ratios r on r.member_id=m.id join public.v2_member_openings o on o.member_id=m.id where m.is_active),
    'rounds',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'displaySequence',(select count(*) from public.v2_rounds numbered where numbered.deleted_at is null and numbered.scheduled_date=r.scheduled_date and (numbered.occurred_at,numbered.id)<=(r.occurred_at,r.id)),'scheduledDate',r.scheduled_date,'occurredAt',to_char(r.occurred_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS'),'totalStakeCents',r.total_stake_cents,'grossResultCents',r.gross_result_cents,'gameType',r.game_type,'mandateType',r.mandate_type,'ownerMemberId',r.owner_member_id,'lockedRatiosBps',r.locked_ratios_bps,'createdBy',r.created_by,'revision',r.revision) order by r.occurred_at,r.id),'[]'::jsonb) from public.v2_rounds r where r.deleted_at is null and (v_role in ('czh','waka') or r.mandate_type='regular' or r.owner_member_id=v_actor)),
    'capitalEvents',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'memberId',c.member_id,'deltaCents',c.delta_cents,'beforeCents',c.before_cents,'targetCents',c.target_cents,'occurredAt',to_char(c.occurred_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS'),'actorId',c.actor_id) order by c.occurred_at,c.id),'[]'::jsonb) from public.v2_capital_events c where v_role='czh' or c.member_id=v_actor),
    'ratioChanges','[]'::jsonb,'auditLogs','[]'::jsonb,'updatedAt',to_char(now() at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS')
  ) into v_workspace;

  with non_czh as (select m.id,m.display_name,o.opening_asset_cents from public.members m join public.v2_member_openings o on o.member_id=m.id where m.is_active and not m.is_czh),
  current_assets as (select n.id,n.display_name,public.app_v2_current_asset(n.id) asset from non_czh n),
  event_effects as (
    select c.id,c.occurred_at,0 event_kind,c.delta_cents delta,case when c.delta_cents>=0 then '资金增加' else '资金减少' end label from public.v2_capital_events c join non_czh n on n.id=c.member_id
    union all select r.id,r.occurred_at,1 event_kind,sum(a.net_profit_cents),'比赛' from public.v2_rounds r join public.v2_round_allocations a on a.round_id=r.id join non_czh n on n.id=a.member_id where r.deleted_at is null group by r.id,r.occurred_at
  ), ordered_effects as (select id,occurred_at,event_kind,sum(delta) delta,max(label) label from event_effects group by id,occurred_at,event_kind),
  market_events as (select e.id,e.occurred_at,e.event_kind,e.label,(select sum(opening_asset_cents) from non_czh)+sum(e.delta) over(order by e.occurred_at,e.event_kind,e.id) total from ordered_effects e)
  select jsonb_build_object('currentTotalCents',(select coalesce(sum(asset),0) from current_assets),'shares',(select coalesce(jsonb_agg(jsonb_build_object('memberId',id,'name',display_name,'assetCents',asset,'shareBps',case when sum(asset) over()=0 then null else round(asset*10000.0/sum(asset) over())::integer end) order by id),'[]'::jsonb) from current_assets),'assetEvents',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',to_char(occurred_at at time zone 'Asia/Shanghai','MM-DD')||'·'||label,'occurredAt',to_char(occurred_at at time zone 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS'),'totalAssetCents',total) order by occurred_at,event_kind,id),'[]'::jsonb) from market_events)) into v_market;
  return jsonb_build_object('actorId',v_actor,'workspace',v_workspace,'market',v_market);
end $$;

alter table public.v2_member_openings enable row level security;
alter table public.v2_current_ratios enable row level security;
alter table public.v2_rounds enable row level security;
alter table public.v2_round_allocations enable row level security;
alter table public.v2_capital_events enable row level security;
alter table public.v2_ratio_changes enable row level security;
alter table public.v2_audit_logs enable row level security;
revoke all on public.v2_member_openings,public.v2_current_ratios,public.v2_rounds,public.v2_round_allocations,public.v2_capital_events,public.v2_ratio_changes,public.v2_audit_logs from anon,authenticated;
revoke all on function public.app_v2_actor(),public.app_v2_role(),public.app_v2_current_asset(uuid),public.app_v2_allocate(bigint,jsonb),public.app_v2_rebuild_allocations(uuid),public.app_v2_assert_nonnegative(),public.app_v2_configure_openings(jsonb),public.app_v2_save_round(uuid,date,timestamptz,bigint,bigint,text,text,uuid,bigint,uuid),public.app_v2_delete_round(uuid,uuid),public.app_v2_adjust_own_asset(bigint,uuid),public.app_v2_change_own_ratio(integer,uuid),public.app_v2_screen_state() from public,anon;
grant execute on function public.app_v2_save_round(uuid,date,timestamptz,bigint,bigint,text,text,uuid,bigint,uuid),public.app_v2_delete_round(uuid,uuid),public.app_v2_adjust_own_asset(bigint,uuid),public.app_v2_change_own_ratio(integer,uuid),public.app_v2_screen_state() to authenticated;
-- app_v2_configure_openings is intentionally not granted to browser clients; run it in an isolated SQL session after reconciliation.
