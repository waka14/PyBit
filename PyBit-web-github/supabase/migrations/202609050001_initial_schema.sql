-- PyBit production ledger schema. Apply before 202609050002_rls_and_rpc.sql.
-- Monetary values are integer cents and ownership is integer basis points.
create extension if not exists pgcrypto;

do $$ begin
  create type public.pybit_role as enum ('czh', 'waka', 'member');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.round_status as enum ('open', 'settled', 'deleted');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.withdrawal_status as enum ('pending', 'completed', 'rejected', 'needs_review');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.capital_entry_kind as enum ('initial', 'deposit', 'capital_correction', 'to_pending', 'actual_return', 'balance_correction');
exception when duplicate_object then null; end $$;

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  is_czh boolean not null default false,
  is_active boolean not null default true,
  base_ratio_bps integer not null default 0 check (base_ratio_bps between 0 and 10000),
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint one_active_czh_per_workspace unique nulls not distinct (is_czh) deferrable initially immediate
);
-- The constraint above permits only one true and one false row on older PostgreSQL versions if used alone.
-- Replace it with a partial index, which is the actual invariant we need.
alter table public.members drop constraint if exists one_active_czh_per_workspace;
create unique index if not exists members_one_czh_idx on public.members ((is_czh)) where is_czh;

create table if not exists public.profiles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  member_id uuid not null unique references public.members(id) on delete restrict,
  role public.pybit_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Cross-table role/member consistency is enforced by the trigger below, not a CHECK constraint.

create table if not exists public.capital_entries (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  kind public.capital_entry_kind not null,
  -- Deltas let every balance be replayed without overwriting historical rounds.
  principal_delta_cents bigint not null default 0,
  investment_delta_cents bigint not null default 0,
  pending_return_delta_cents bigint not null default 0,
  returned_delta_cents bigint not null default 0,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references public.members(id) on delete set null,
  reason text not null default '',
  idempotency_key uuid,
  metadata jsonb not null default '{}'::jsonb,
  check (reason = btrim(reason)),
  check (principal_delta_cents <> 0 or investment_delta_cents <> 0 or pending_return_delta_cents <> 0 or returned_delta_cents <> 0),
  unique (member_id, idempotency_key)
);

create table if not exists public.stake_changes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  before_bps integer not null check (before_bps between 0 and 10000),
  after_bps integer not null check (after_bps between 0 and 10000),
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.members(id) on delete restrict,
  reason text not null default '',
  idempotency_key uuid,
  unique (member_id, idempotency_key)
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  scheduled_date date not null,
  timezone text not null default 'Asia/Shanghai' check (timezone = 'Asia/Shanghai'),
  sequence integer not null check (sequence > 0),
  display_name text not null,
  status public.round_status not null default 'open',
  total_stake_cents bigint not null check (total_stake_cents > 0),
  gross_result_cents bigint check (gross_result_cents >= 0),
  fee_cents bigint not null default 0 check (fee_cents >= 0),
  rake_cents bigint not null default 0 check (rake_cents >= 0),
  distributable_cents bigint not null default 0 check (distributable_cents >= 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.members(id) on delete restrict,
  settled_at timestamptz,
  settled_by uuid references public.members(id) on delete restrict,
  deleted_at timestamptz,
  deleted_by uuid references public.members(id) on delete restrict,
  delete_reason text,
  idempotency_key uuid unique,
  updated_at timestamptz not null default now(),
  unique (scheduled_date, sequence),
  check (status <> 'settled' or gross_result_cents is not null),
  check ((status = 'deleted') = (deleted_at is not null))
);

create table if not exists public.round_allocations (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  ratio_bps integer not null check (ratio_bps between 0 and 10000),
  stake_cents bigint not null check (stake_cents >= 0),
  gross_share_cents bigint not null default 0 check (gross_share_cents >= 0),
  fee_share_cents bigint not null default 0 check (fee_share_cents >= 0),
  rake_share_cents bigint not null default 0 check (rake_share_cents >= 0),
  settlement_cents bigint not null default 0 check (settlement_cents >= 0),
  manager_rake_income_cents bigint not null default 0 check (manager_rake_income_cents >= 0),
  created_at timestamptz not null default now(),
  unique (round_id, member_id)
);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  status public.withdrawal_status not null default 'pending',
  requested_at timestamptz not null default now(),
  idempotency_key uuid not null,
  reviewed_at timestamptz,
  reviewed_by uuid references public.members(id) on delete restrict,
  reject_reason text,
  review_block_reason text,
  unique (member_id, idempotency_key),
  check ((status = 'pending') = (reviewed_at is null)),
  check ((status = 'completed') = (reviewed_at is not null))
);

create table if not exists public.cash_returns (
  id uuid primary key default gen_random_uuid(),
  withdrawal_request_id uuid not null unique references public.withdrawal_requests(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references public.members(id) on delete restrict,
  capital_entry_id uuid not null unique references public.capital_entries(id) on delete restrict
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_member_id uuid references public.members(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_id uuid,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_round_sequences (
  scheduled_date date primary key,
  last_sequence integer not null check (last_sequence >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_idempotency (
  actor_member_id uuid not null references public.members(id) on delete restrict,
  operation text not null,
  idempotency_key uuid not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_member_id, operation, idempotency_key)
);

create index if not exists capital_entries_member_effective_idx on public.capital_entries (member_id, effective_at, created_at);
create index if not exists stake_changes_member_effective_idx on public.stake_changes (member_id, effective_at desc, created_at desc);
create index if not exists rounds_status_date_idx on public.rounds (status, scheduled_date, sequence);
create index if not exists allocations_member_idx on public.round_allocations (member_id, round_id);
create index if not exists withdrawal_requests_member_status_idx on public.withdrawal_requests (member_id, status, requested_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create or replace trigger members_set_updated_at before update on public.members for each row execute function public.set_updated_at();
create or replace trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create or replace trigger rounds_set_updated_at before update on public.rounds for each row execute function public.set_updated_at();

create or replace function public.enforce_profile_role_member() returns trigger language plpgsql security definer set search_path = public as $$
declare target_is_czh boolean;
begin
  select is_czh into target_is_czh from members where id = new.member_id;
  if target_is_czh is null then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001'; end if;
  if (new.role = 'czh') <> target_is_czh then raise exception 'PROFILE_ROLE_MEMBER_MISMATCH' using errcode = 'P0001'; end if;
  if new.role = 'waka' and target_is_czh then raise exception 'PROFILE_ROLE_MEMBER_MISMATCH' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists profiles_enforce_role_member on public.profiles;
create trigger profiles_enforce_role_member before insert or update on public.profiles for each row execute function public.enforce_profile_role_member();

-- A profile cannot be modified by its authenticated owner. Initial profile rows are created by the
-- dashboard SQL editor (first CZH) or a future server-side invitation endpoint.
