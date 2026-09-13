-- Security and transactional API for the PyBit production ledger.
-- This migration is deliberately self-contained and may be re-run with CREATE OR REPLACE.
set check_function_bodies = off;

create or replace function public.app_profile() returns public.profiles language sql stable security definer set search_path = public as $$
  select p from public.profiles p where p.auth_user_id = auth.uid()
$$;
create or replace function public.app_member_id() returns uuid language sql stable security definer set search_path = public as $$
  select (public.app_profile()).member_id
$$;
create or replace function public.app_role() returns public.pybit_role language sql stable security definer set search_path = public as $$
  select (public.app_profile()).role
$$;
create or replace function public.app_is_czh() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'czh', false)
$$;
create or replace function public.app_is_round_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('czh', 'waka'), false)
$$;
create or replace function public.require_profile() returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_member uuid;
begin v_member := public.app_member_id(); if v_member is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if; return v_member; end $$;
create or replace function public.require_czh() returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_member uuid;
begin v_member := public.require_profile(); if not public.app_is_czh() then raise exception 'CZH_REQUIRED' using errcode = '42501'; end if; return v_member; end $$;
create or replace function public.require_round_admin() returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_member uuid;
begin v_member := public.require_profile(); if not public.app_is_round_admin() then raise exception 'ROUND_ADMIN_REQUIRED' using errcode = '42501'; end if; return v_member; end $$;

create or replace function public.app_chinese_number(p_value integer) returns text language plpgsql immutable as $$
declare digits text[] := array['零','一','二','三','四','五','六','七','八','九','十'];
begin
  if p_value between 0 and 10 then return digits[p_value + 1]; end if;
  if p_value between 11 and 19 then return '十' || case when p_value % 10 = 0 then '' else digits[(p_value % 10) + 1] end; end if;
  if p_value between 20 and 99 then return digits[(p_value / 10) + 1] || '十' || case when p_value % 10 = 0 then '' else digits[(p_value % 10) + 1] end; end if;
  raise exception 'ROUND_SEQUENCE_OUT_OF_RANGE' using errcode = '22003';
end $$;
create or replace function public.app_round_name(p_date date, p_sequence integer) returns text language sql immutable as $$
  select public.app_chinese_number(extract(month from p_date)::integer) || '月' || public.app_chinese_number(extract(day from p_date)::integer) || '日第' || public.app_chinese_number(p_sequence) || '场'
$$;

create or replace function public.app_effective_ratio(p_member uuid, p_at timestamptz default now()) returns integer language plpgsql stable security definer set search_path = public as $$
declare v_is_czh boolean; v_ratio integer;
begin
  select is_czh, base_ratio_bps into v_is_czh, v_ratio from members where id = p_member;
  if v_is_czh is null then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_is_czh then
    select 10000 - coalesce(sum(public.app_effective_ratio(id, p_at)), 0) into v_ratio from members where not is_czh and is_active;
    return v_ratio;
  end if;
  select sc.after_bps into v_ratio from stake_changes sc where sc.member_id = p_member and sc.effective_at <= p_at order by sc.effective_at desc, sc.created_at desc, sc.id desc limit 1;
  return coalesce(v_ratio, (select base_ratio_bps from members where id = p_member));
end $$;
create or replace function public.app_member_pending_cents(p_member uuid, p_at timestamptz default now()) returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(pending_return_delta_cents), 0) from capital_entries where member_id = p_member and effective_at <= p_at
$$;
create or replace function public.app_member_investment_cents(p_member uuid, p_at timestamptz default now()) returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select sum(investment_delta_cents) from capital_entries where member_id = p_member and effective_at <= p_at), 0)
       + coalesce((select sum(a.settlement_cents + a.manager_rake_income_cents - a.stake_cents) from round_allocations a join rounds r on r.id = a.round_id where a.member_id = p_member and r.status = 'settled' and r.settled_at <= p_at), 0)
$$;
create or replace function public.app_member_available_cents(p_member uuid, p_at timestamptz default now()) returns bigint language sql stable security definer set search_path = public as $$
  select public.app_member_investment_cents(p_member, p_at)
       - coalesce((select sum(a.stake_cents) from round_allocations a join rounds r on r.id = a.round_id where a.member_id = p_member and r.status = 'open'), 0)
$$;
create or replace function public.app_member_principal_cents(p_member uuid, p_at timestamptz default now()) returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(principal_delta_cents), 0) from capital_entries where member_id = p_member and effective_at <= p_at
$$;

alter table public.members enable row level security;
alter table public.profiles enable row level security;
alter table public.capital_entries enable row level security;
alter table public.stake_changes enable row level security;
alter table public.rounds enable row level security;
alter table public.round_allocations enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.cash_returns enable row level security;
alter table public.audit_logs enable row level security;
alter table public.daily_round_sequences enable row level security;
alter table public.app_idempotency enable row level security;

drop policy if exists members_read_scope on public.members;
create policy members_read_scope on public.members for select to authenticated using (id = public.app_member_id() or is_czh or public.app_is_round_admin());
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated using (auth_user_id = auth.uid());
drop policy if exists capital_read_scope on public.capital_entries;
create policy capital_read_scope on public.capital_entries for select to authenticated using (member_id = public.app_member_id() or public.app_is_czh());
drop policy if exists stake_read_scope on public.stake_changes;
create policy stake_read_scope on public.stake_changes for select to authenticated using (member_id = public.app_member_id() or public.app_is_czh());
drop policy if exists rounds_read_authenticated on public.rounds;
create policy rounds_read_authenticated on public.rounds for select to authenticated using (public.require_profile() is not null and status <> 'deleted');
drop policy if exists allocations_read_scope on public.round_allocations;
create policy allocations_read_scope on public.round_allocations for select to authenticated using (member_id = public.app_member_id() or public.app_is_round_admin());
drop policy if exists withdrawal_read_scope on public.withdrawal_requests;
create policy withdrawal_read_scope on public.withdrawal_requests for select to authenticated using (member_id = public.app_member_id() or public.app_is_czh());
drop policy if exists returns_read_scope on public.cash_returns;
create policy returns_read_scope on public.cash_returns for select to authenticated using (member_id = public.app_member_id() or public.app_is_czh());
drop policy if exists audits_read_scope on public.audit_logs;
create policy audits_read_scope on public.audit_logs for select to authenticated using (public.app_is_round_admin());
-- No direct insert/update/delete policies: all state changes are SECURITY DEFINER RPCs below.

create or replace function public.app_store_idempotent(p_actor uuid, p_operation text, p_key uuid, p_response jsonb) returns void language plpgsql security definer set search_path = public as $$
begin insert into app_idempotency(actor_member_id, operation, idempotency_key, response) values (p_actor, p_operation, p_key, p_response) on conflict do nothing; end $$;
create or replace function public.app_prior_idempotent(p_actor uuid, p_operation text, p_key uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select response from app_idempotency where actor_member_id = p_actor and operation = p_operation and idempotency_key = p_key
$$;

create or replace function public.app_create_round(p_scheduled_date date, p_total_stake_cents bigint, p_idempotency_key uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_round_admin(); v_seq integer; v_round uuid := gen_random_uuid(); v_prior jsonb; v_row record; v_remainder bigint; v_unallocated bigint;
begin
  if p_scheduled_date is null or p_total_stake_cents <= 0 or p_idempotency_key is null then raise exception 'ROUND_INVALID' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || p_idempotency_key::text, 0));
  v_prior := public.app_prior_idempotent(v_actor, 'create_round', p_idempotency_key); if v_prior is not null then return (v_prior->>'round_id')::uuid; end if;
  insert into daily_round_sequences(scheduled_date, last_sequence) values (p_scheduled_date, 1) on conflict (scheduled_date) do update set last_sequence = daily_round_sequences.last_sequence + 1, updated_at = now() returning last_sequence into v_seq;
  create temporary table if not exists pg_temp.pybit_allocation(member_id uuid primary key, ratio_bps integer, stake_cents bigint, rem bigint) on commit drop;
  truncate pg_temp.pybit_allocation;
  insert into pg_temp.pybit_allocation(member_id, ratio_bps, stake_cents, rem)
    select m.id, public.app_effective_ratio(m.id, now()), floor(p_total_stake_cents * public.app_effective_ratio(m.id, now()) / 10000.0)::bigint, (p_total_stake_cents * public.app_effective_ratio(m.id, now())) % 10000
    from members m where m.is_active;
  if (select coalesce(sum(ratio_bps), 0) from pg_temp.pybit_allocation) <> 10000 then raise exception 'RATIO_TOTAL_INVALID' using errcode = 'P0001'; end if;
  select p_total_stake_cents - coalesce(sum(stake_cents), 0) into v_unallocated from pg_temp.pybit_allocation;
  update pg_temp.pybit_allocation set stake_cents = stake_cents + 1 where member_id in (select member_id from pg_temp.pybit_allocation order by rem desc, member_id asc limit v_unallocated);
  if exists (select 1 from pg_temp.pybit_allocation a where public.app_member_available_cents(a.member_id, now()) < a.stake_cents) then raise exception 'INSUFFICIENT_INVESTMENT' using errcode = 'P0001'; end if;
  insert into rounds(id, scheduled_date, sequence, display_name, total_stake_cents, created_by, idempotency_key) values (v_round, p_scheduled_date, v_seq, public.app_round_name(p_scheduled_date, v_seq), p_total_stake_cents, v_actor, p_idempotency_key);
  insert into round_allocations(round_id, member_id, ratio_bps, stake_cents) select v_round, member_id, ratio_bps, stake_cents from pg_temp.pybit_allocation;
  insert into audit_logs(actor_member_id, action, target_type, target_id) values (v_actor, 'ROUND_CREATED', 'round', v_round);
  perform public.app_store_idempotent(v_actor, 'create_round', p_idempotency_key, jsonb_build_object('round_id', v_round));
  return v_round;
end $$;

create or replace function public.app_settle_round(p_round_id uuid, p_gross_result_cents bigint, p_idempotency_key uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_round_admin(); v_round rounds%rowtype; v_fee bigint; v_rake bigint; v_net bigint; v_prior jsonb;
begin
  if p_gross_result_cents is null or p_gross_result_cents < 0 or p_idempotency_key is null then raise exception 'RESULT_INVALID' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || p_idempotency_key::text, 0));
  if public.app_prior_idempotent(v_actor, 'settle_round', p_idempotency_key) is not null then return; end if;
  select * into v_round from rounds where id = p_round_id for update; if not found then raise exception 'ROUND_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_round.status <> 'open' then raise exception 'ROUND_NOT_OPEN' using errcode = 'P0001'; end if;
  v_fee := round(p_gross_result_cents * 3 / 100.0)::bigint; v_rake := round(greatest(p_gross_result_cents - v_round.total_stake_cents, 0) * 10 / 100.0)::bigint; v_net := p_gross_result_cents - v_fee - v_rake;
  create temporary table if not exists pg_temp.pybit_settlement(member_id uuid primary key, ratio_bps integer, gross_cents bigint, fee_cents bigint, rake_cents bigint, settlement_cents bigint, gross_rem bigint, fee_rem bigint, rake_rem bigint, settlement_rem bigint) on commit drop;
  truncate pg_temp.pybit_settlement;
  insert into pg_temp.pybit_settlement(member_id,ratio_bps,gross_cents,fee_cents,rake_cents,settlement_cents,gross_rem,fee_rem,rake_rem,settlement_rem)
    select member_id,ratio_bps, floor(p_gross_result_cents*ratio_bps/10000.0),floor(v_fee*ratio_bps/10000.0),floor(v_rake*ratio_bps/10000.0),floor(v_net*ratio_bps/10000.0), (p_gross_result_cents*ratio_bps)%10000,(v_fee*ratio_bps)%10000,(v_rake*ratio_bps)%10000,(v_net*ratio_bps)%10000 from round_allocations where round_id=p_round_id;
  update pg_temp.pybit_settlement set gross_cents=gross_cents+1 where member_id in (select member_id from pg_temp.pybit_settlement order by gross_rem desc,member_id asc limit (p_gross_result_cents-(select sum(gross_cents) from pg_temp.pybit_settlement)));
  update pg_temp.pybit_settlement set fee_cents=fee_cents+1 where member_id in (select member_id from pg_temp.pybit_settlement order by fee_rem desc,member_id asc limit (v_fee-(select sum(fee_cents) from pg_temp.pybit_settlement)));
  update pg_temp.pybit_settlement set rake_cents=rake_cents+1 where member_id in (select member_id from pg_temp.pybit_settlement order by rake_rem desc,member_id asc limit (v_rake-(select sum(rake_cents) from pg_temp.pybit_settlement)));
  update pg_temp.pybit_settlement set settlement_cents=settlement_cents+1 where member_id in (select member_id from pg_temp.pybit_settlement order by settlement_rem desc,member_id asc limit (v_net-(select sum(settlement_cents) from pg_temp.pybit_settlement)));
  update round_allocations a set gross_share_cents=s.gross_cents, fee_share_cents=s.fee_cents, rake_share_cents=s.rake_cents, settlement_cents=s.settlement_cents, manager_rake_income_cents=case when m.is_czh then v_rake else 0 end from pg_temp.pybit_settlement s join members m on m.id=s.member_id where a.round_id=p_round_id and a.member_id=s.member_id;
  update rounds set status='settled',gross_result_cents=p_gross_result_cents,fee_cents=v_fee,rake_cents=v_rake,distributable_cents=v_net,settled_at=now(),settled_by=v_actor where id=p_round_id;
  insert into audit_logs(actor_member_id,action,target_type,target_id) values(v_actor,'ROUND_SETTLED','round',p_round_id);
  perform public.app_store_idempotent(v_actor,'settle_round',p_idempotency_key,jsonb_build_object('round_id',p_round_id));
end $$;

create or replace function public.app_change_stake(p_member_id uuid, p_after_bps integer, p_idempotency_key uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_profile(); v_before integer; v_other integer;
begin
  if p_after_bps is null or p_after_bps < 0 or p_after_bps > 10000 or p_idempotency_key is null then raise exception 'RATIO_INVALID' using errcode='22023'; end if;
  if v_actor <> p_member_id and not public.app_is_czh() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if exists(select 1 from members where id=p_member_id and is_czh) then raise exception 'CZH_RATIO_AUTOMATIC' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(913004);
  if public.app_prior_idempotent(v_actor,'change_stake',p_idempotency_key) is not null then return; end if;
  select coalesce(sum(public.app_effective_ratio(id, now())),0) into v_other from members where is_active and not is_czh and id <> p_member_id;
  if v_other + p_after_bps > 10000 then raise exception 'RATIO_TOTAL_INVALID' using errcode='P0001'; end if;
  v_before := public.app_effective_ratio(p_member_id,now());
  insert into stake_changes(member_id,before_bps,after_bps,created_by,idempotency_key,reason) values(p_member_id,v_before,p_after_bps,v_actor,p_idempotency_key,'下一场参与比例调整');
  insert into audit_logs(actor_member_id,action,target_type,target_id) values(v_actor,'STAKE_CHANGED','member',p_member_id);
  perform public.app_store_idempotent(v_actor,'change_stake',p_idempotency_key,jsonb_build_object('member_id',p_member_id));
end $$;

create or replace function public.app_adjust_capital(p_member_id uuid, p_kind public.capital_entry_kind, p_amount_cents bigint, p_reason text, p_idempotency_key uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_czh(); v_invest bigint := 0; v_pending bigint := 0; v_principal bigint := 0;
begin
  if p_amount_cents is null or p_amount_cents <= 0 or p_idempotency_key is null then raise exception 'AMOUNT_INVALID' using errcode='22023'; end if;
  if p_kind not in ('initial','deposit','capital_correction','to_pending','balance_correction') then raise exception 'CAPITAL_KIND_INVALID' using errcode='22023'; end if;
  if public.app_prior_idempotent(v_actor,'adjust_capital',p_idempotency_key) is not null then return; end if;
  if p_kind in ('initial','deposit','capital_correction') then v_invest:=p_amount_cents; v_principal:=p_amount_cents; end if;
  if p_kind='to_pending' then if public.app_member_available_cents(p_member_id,now()) < p_amount_cents then raise exception 'INSUFFICIENT_AVAILABLE_INVESTMENT' using errcode='P0001'; end if; v_invest:=-p_amount_cents; v_pending:=p_amount_cents; end if;
  insert into capital_entries(member_id,kind,principal_delta_cents,investment_delta_cents,pending_return_delta_cents,created_by,reason,idempotency_key) values(p_member_id,p_kind,v_principal,v_invest,v_pending,v_actor,coalesce(btrim(p_reason),''),p_idempotency_key);
  insert into audit_logs(actor_member_id,action,target_type,target_id,reason) values(v_actor,'CAPITAL_ADJUSTED','member',p_member_id,coalesce(btrim(p_reason),''));
  perform public.app_store_idempotent(v_actor,'adjust_capital',p_idempotency_key,jsonb_build_object('member_id',p_member_id));
end $$;

create or replace function public.app_create_member(p_display_name text, p_idempotency_key uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_czh(); v_member uuid := gen_random_uuid(); v_name text := btrim(p_display_name);
begin
  if char_length(v_name) not between 1 and 60 or p_idempotency_key is null then raise exception 'MEMBER_NAME_INVALID' using errcode='22023'; end if;
  if public.app_prior_idempotent(v_actor,'create_member',p_idempotency_key) is not null then return (public.app_prior_idempotent(v_actor,'create_member',p_idempotency_key)->>'member_id')::uuid; end if;
  insert into members(id,display_name,is_czh,is_active,base_ratio_bps) values(v_member,v_name,false,true,0);
  insert into audit_logs(actor_member_id,action,target_type,target_id) values(v_actor,'MEMBER_CREATED','member',v_member);
  perform public.app_store_idempotent(v_actor,'create_member',p_idempotency_key,jsonb_build_object('member_id',v_member)); return v_member;
end $$;
create or replace function public.app_rename_member(p_member_id uuid, p_display_name text) returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_czh(); v_name text := btrim(p_display_name);
begin
  if char_length(v_name) not between 1 and 60 then raise exception 'MEMBER_NAME_INVALID' using errcode='22023'; end if;
  update members set display_name=v_name where id=p_member_id; if not found then raise exception 'MEMBER_NOT_FOUND' using errcode='P0001'; end if;
  insert into audit_logs(actor_member_id,action,target_type,target_id) values(v_actor,'MEMBER_RENAMED','member',p_member_id);
end $$;
create or replace function public.app_set_member_principal(p_member_id uuid, p_target_principal_cents bigint, p_idempotency_key uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_czh(); v_before bigint; v_delta bigint;
begin
  if p_target_principal_cents is null or p_target_principal_cents < 0 or p_idempotency_key is null then raise exception 'AMOUNT_INVALID' using errcode='22023'; end if;
  if public.app_prior_idempotent(v_actor,'set_member_principal',p_idempotency_key) is not null then return; end if;
  perform 1 from members where id=p_member_id for update; if not found then raise exception 'MEMBER_NOT_FOUND' using errcode='P0001'; end if;
  v_before:=public.app_member_principal_cents(p_member_id,now()); v_delta:=p_target_principal_cents-v_before;
  if v_delta < 0 and public.app_member_available_cents(p_member_id,now()) < -v_delta then raise exception 'INSUFFICIENT_AVAILABLE_INVESTMENT' using errcode='P0001'; end if;
  if v_delta <> 0 then insert into capital_entries(member_id,kind,principal_delta_cents,investment_delta_cents,created_by,reason,idempotency_key) values(p_member_id,'capital_correction',v_delta,v_delta,v_actor,'累计投入调整',p_idempotency_key); end if;
  insert into audit_logs(actor_member_id,action,target_type,target_id,metadata) values(v_actor,'MEMBER_PRINCIPAL_CHANGED','member',p_member_id,jsonb_build_object('before_cents',v_before,'after_cents',p_target_principal_cents));
  perform public.app_store_idempotent(v_actor,'set_member_principal',p_idempotency_key,jsonb_build_object('member_id',p_member_id));
end $$;
create or replace function public.app_archive_member(p_member_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_czh(); v_before integer;
begin
  if exists(select 1 from members where id=p_member_id and (is_czh or exists(select 1 from profiles where member_id=p_member_id and role='waka'))) then raise exception 'CORE_ADMIN_CANNOT_ARCHIVE' using errcode='42501'; end if;
  if exists(select 1 from round_allocations a join rounds r on r.id=a.round_id where a.member_id=p_member_id and r.status='open') then raise exception 'MEMBER_HAS_OPEN_ROUND' using errcode='P0001'; end if;
  if exists(select 1 from withdrawal_requests where member_id=p_member_id and status='pending') then raise exception 'MEMBER_HAS_PENDING_WITHDRAWAL' using errcode='P0001'; end if;
  if public.app_member_available_cents(p_member_id,now()) <> 0 or public.app_member_pending_cents(p_member_id,now()) <> 0 then raise exception 'MEMBER_HAS_BALANCE' using errcode='P0001'; end if;
  select public.app_effective_ratio(p_member_id,now()) into v_before;
  update members set is_active=false,archived_at=now(),archived_by=v_actor where id=p_member_id and is_active; if not found then raise exception 'MEMBER_NOT_ARCHIVABLE' using errcode='P0001'; end if;
  insert into stake_changes(member_id,before_bps,after_bps,created_by,reason) values(p_member_id,v_before,0,v_actor,'成员移出，后续比例归零');
  insert into audit_logs(actor_member_id,action,target_type,target_id) values(v_actor,'MEMBER_ARCHIVED','member',p_member_id);
end $$;
create or replace function public.app_restore_member(p_member_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_czh();
begin
  update members set is_active=true,archived_at=null,archived_by=null,base_ratio_bps=0 where id=p_member_id and not is_active; if not found then raise exception 'MEMBER_NOT_RESTORABLE' using errcode='P0001'; end if;
  insert into stake_changes(member_id,before_bps,after_bps,created_by,reason) values(p_member_id,0,0,v_actor,'恢复成员，比例归零');
  insert into audit_logs(actor_member_id,action,target_type,target_id) values(v_actor,'MEMBER_RESTORED','member',p_member_id);
end $$;

create or replace function public.app_submit_withdrawal(p_amount_cents bigint, p_idempotency_key uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_profile(); v_request uuid := gen_random_uuid(); v_prior jsonb; v_reserved bigint;
begin
  if p_amount_cents is null or p_amount_cents <= 0 or p_idempotency_key is null then raise exception 'AMOUNT_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || p_idempotency_key::text,0)); v_prior:=public.app_prior_idempotent(v_actor,'submit_withdrawal',p_idempotency_key); if v_prior is not null then return (v_prior->>'request_id')::uuid; end if;
  select coalesce(sum(amount_cents),0) into v_reserved from withdrawal_requests where member_id=v_actor and status='pending';
  if p_amount_cents > public.app_member_pending_cents(v_actor,now()) - v_reserved then raise exception 'WITHDRAWAL_AMOUNT_INVALID' using errcode='P0001'; end if;
  insert into withdrawal_requests(id,member_id,amount_cents,idempotency_key) values(v_request,v_actor,p_amount_cents,p_idempotency_key);
  perform public.app_store_idempotent(v_actor,'submit_withdrawal',p_idempotency_key,jsonb_build_object('request_id',v_request)); return v_request;
end $$;

create or replace function public.app_review_withdrawal(p_request_id uuid, p_complete boolean, p_reject_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_czh(); v_request withdrawal_requests%rowtype; v_entry uuid;
begin
  select * into v_request from withdrawal_requests where id=p_request_id for update; if not found then raise exception 'WITHDRAWAL_NOT_FOUND' using errcode='P0001'; end if;
  if v_request.status <> 'pending' then raise exception 'WITHDRAWAL_ALREADY_REVIEWED' using errcode='P0001'; end if;
  if p_complete then
    if public.app_member_pending_cents(v_request.member_id,now()) < v_request.amount_cents then raise exception 'PENDING_BALANCE_INSUFFICIENT' using errcode='P0001'; end if;
    insert into capital_entries(member_id,kind,pending_return_delta_cents,returned_delta_cents,created_by,reason,metadata) values(v_request.member_id,'actual_return',-v_request.amount_cents,v_request.amount_cents,v_actor,'已实际转回',jsonb_build_object('withdrawal_request_id',p_request_id)) returning id into v_entry;
    insert into cash_returns(withdrawal_request_id,member_id,amount_cents,confirmed_by,capital_entry_id) values(p_request_id,v_request.member_id,v_request.amount_cents,v_actor,v_entry);
    update withdrawal_requests set status='completed',reviewed_at=now(),reviewed_by=v_actor,reject_reason=null where id=p_request_id;
    insert into audit_logs(actor_member_id,action,target_type,target_id) values(v_actor,'WITHDRAWAL_COMPLETED','withdrawal_request',p_request_id);
  else
    update withdrawal_requests set status='rejected',reviewed_at=now(),reviewed_by=v_actor,reject_reason=nullif(btrim(coalesce(p_reject_reason,'')),'') where id=p_request_id;
    insert into audit_logs(actor_member_id,action,target_type,target_id,reason) values(v_actor,'WITHDRAWAL_REJECTED','withdrawal_request',p_request_id,nullif(btrim(coalesce(p_reject_reason,'')),''));
  end if;
end $$;

create or replace function public.app_delete_round(p_round_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_round_admin();
begin update rounds set status='deleted',deleted_at=now(),deleted_by=v_actor,delete_reason='管理员删除' where id=p_round_id and status <> 'deleted'; if not found then raise exception 'ROUND_NOT_DELETABLE' using errcode='P0001'; end if; insert into audit_logs(actor_member_id,action,target_type,target_id) values(v_actor,'ROUND_DELETED','round',p_round_id); end $$;
create or replace function public.app_restore_round(p_round_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_round_admin(); v_status public.round_status;
begin select case when gross_result_cents is null then 'open'::public.round_status else 'settled'::public.round_status end into v_status from rounds where id=p_round_id and status='deleted' for update; if not found then raise exception 'ROUND_NOT_RESTORABLE' using errcode='P0001'; end if; update rounds set status=v_status,deleted_at=null,deleted_by=null,delete_reason=null where id=p_round_id; insert into audit_logs(actor_member_id,action,target_type,target_id) values(v_actor,'ROUND_RESTORED','round',p_round_id); end $$;

-- Permission-filtered read model. Normal members receive only their own allocation and balances.
create or replace function public.app_screen_state() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_member uuid := public.require_profile(); v_role public.pybit_role := public.app_role(); v_now timestamptz := now();
begin
 return jsonb_build_object(
  'profile', jsonb_build_object('memberId',v_member,'role',v_role),
  'me', (select jsonb_build_object('id',m.id,'name',m.display_name,'isCzh',m.is_czh,'role',case when p.role in ('czh','waka') then 'ADMIN' else 'MEMBER' end,'ratioBps',public.app_effective_ratio(m.id,v_now),'czhAvailableBps',(select public.app_effective_ratio(id,v_now) from members where is_czh),'principalCents',public.app_member_principal_cents(m.id,v_now),'investmentCents',public.app_member_investment_cents(m.id,v_now),'availableCents',public.app_member_available_cents(m.id,v_now),'pendingCents',public.app_member_pending_cents(m.id,v_now),'returnedCents',coalesce((select sum(returned_delta_cents) from capital_entries where member_id=m.id and effective_at<=v_now),0)) from members m join profiles p on p.member_id=m.id where m.id=v_member),
  'rounds', coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.display_name,'scheduledDate',r.scheduled_date,'sequence',r.sequence,'status',r.status,'totalStakeCents',r.total_stake_cents,'grossResultCents',r.gross_result_cents,'feeCents',r.fee_cents,'rakeCents',r.rake_cents,'preTotalCents',public.app_member_investment_cents(v_member,r.created_at)+public.app_member_pending_cents(v_member,r.created_at),'endTotalCents',case when r.status='settled' then public.app_member_investment_cents(v_member,r.settled_at)+public.app_member_pending_cents(v_member,r.settled_at) else public.app_member_investment_cents(v_member,r.created_at)+public.app_member_pending_cents(v_member,r.created_at) end,'myAllocation',case when a.id is null then null else jsonb_build_object('ratioBps',a.ratio_bps,'stakeCents',a.stake_cents,'grossCents',a.gross_share_cents,'feeCents',a.fee_share_cents,'rakeCents',a.rake_share_cents,'settlementCents',a.settlement_cents,'managerRakeIncomeCents',a.manager_rake_income_cents) end) order by r.scheduled_date,r.sequence) from rounds r left join round_allocations a on a.round_id=r.id and a.member_id=v_member where r.status<>'deleted' or v_role in ('czh','waka')), '[]'::jsonb),
  'withdrawalRequests', coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'memberId',w.member_id,'amountCents',w.amount_cents,'status',w.status,'requestedAt',w.requested_at,'reviewedAt',w.reviewed_at,'rejectReason',w.reject_reason,'memberName',m.display_name) order by w.requested_at desc) from withdrawal_requests w join members m on m.id=w.member_id where (w.member_id=v_member or v_role='czh')), '[]'::jsonb),
  'members', case when v_role in ('czh','waka') then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.display_name,'isCzh',m.is_czh,'active',m.is_active,'ratioBps',public.app_effective_ratio(m.id,v_now),'principalCents',public.app_member_principal_cents(m.id,v_now),'investmentCents',public.app_member_investment_cents(m.id,v_now),'availableCents',public.app_member_available_cents(m.id,v_now),'pendingCents',public.app_member_pending_cents(m.id,v_now)) order by m.is_czh,m.created_at) from members m), '[]'::jsonb) else '[]'::jsonb end,
  'pendingCount', case when v_role='czh' then (select count(*) from withdrawal_requests where status='pending') else 0 end
 );
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;
grant usage on schema public to authenticated;
grant select on public.members, public.profiles, public.capital_entries, public.stake_changes, public.rounds, public.round_allocations, public.withdrawal_requests, public.cash_returns, public.audit_logs to authenticated;
grant execute on function public.app_screen_state(), public.app_create_round(date,bigint,uuid), public.app_settle_round(uuid,bigint,uuid), public.app_change_stake(uuid,integer,uuid), public.app_adjust_capital(uuid,public.capital_entry_kind,bigint,text,uuid), public.app_create_member(text,uuid), public.app_rename_member(uuid,text), public.app_set_member_principal(uuid,bigint,uuid), public.app_archive_member(uuid), public.app_restore_member(uuid), public.app_submit_withdrawal(bigint,uuid), public.app_review_withdrawal(uuid,boolean,text), public.app_delete_round(uuid), public.app_restore_round(uuid) to authenticated;
set check_function_bodies = on;
