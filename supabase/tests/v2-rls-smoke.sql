-- Apply all migrations to a disposable Supabase project and configure four bound identities first.
-- Run each block in a session whose JWT matches the stated role.

-- member one: own individual mandate succeeds.
select public.app_v2_save_round(null,current_date,null,70000,140000,'texas','individual',null,null,gen_random_uuid());
-- member one: regular match and another member's owner id both fail FORBIDDEN.
select public.app_v2_save_round(null,current_date,null,100000,100000,'texas','regular',null,null,gen_random_uuid());
select public.app_v2_save_round(null,current_date,null,70000,140000,'texas','individual','<member-two-uuid>',null,gen_random_uuid());
-- member one: raw V2 tables have no direct SELECT privilege.
select * from public.v2_capital_events;

-- waka: regular match succeeds and all matches can be edited/deleted.
select public.app_v2_save_round(null,current_date,null,100000,500000,'texas','regular',null,null,gen_random_uuid());

-- czh: app_v2_screen_state capitalEvents contains every member; waka/member state contains own events only.
select public.app_v2_screen_state();

-- In two parallel member sessions, attempt ratios whose combined total exceeds 100%.
-- At most one transaction succeeds; query the sum in a privileged SQL editor and verify it is <= 10000.
select public.app_v2_change_own_ratio(5000,gen_random_uuid());

-- Reconciliation checks in a privileged SQL editor.
select r.id,r.gross_result_cents,sum(a.settlement_cents) settled
from public.v2_rounds r join public.v2_round_allocations a on a.round_id=r.id
where r.deleted_at is null group by r.id having sum(a.settlement_cents)<>r.gross_result_cents;
select public.app_v2_assert_nonnegative();
