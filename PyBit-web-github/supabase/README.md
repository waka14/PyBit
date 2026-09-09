# PyBit Supabase migrations

Apply the files in lexical order from the Supabase SQL Editor or Supabase CLI:

1. `migrations/202609050001_initial_schema.sql`
2. `migrations/202609050002_rls_and_rpc.sql`

The first invited account must be created in **Authentication → Users → Invite user**. After that person accepts the invitation, insert the first `members` and `profiles` rows in a transaction in the SQL Editor. The `profiles.auth_user_id` is the invited user's Auth UUID; `profiles.member_id` is the matching member UUID; role is `czh`, `waka`, or `member`.

完整的邀请、UUID 获取、三种角色绑定、过期邀请和重设密码步骤见 [ACCOUNT_INITIALIZATION.md](./ACCOUNT_INITIALIZATION.md)。绑定必须在成员打开邀请邮件前完成。

For the first czh, replace the placeholder Auth UUID only and run this once before the invitation is accepted:

```sql
begin;
with first_member as (
  insert into public.members (display_name, is_czh, base_ratio_bps)
  values ('czh', true, 0)
  returning id
)
insert into public.profiles (auth_user_id, member_id, role)
select 'PASTE_AUTH_USER_UUID_HERE'::uuid, id, 'czh'::public.pybit_role
from first_member;
commit;
```

After czh has logged in, the production member-management screen creates ordinary member rows. Bind their invited Auth UUIDs in the SQL Editor before they can sign in; this deliberate first version keeps account binding out of the browser and never exposes a service role key.

Never run these migrations with a browser key and never put the database password or `service_role` key in the web app. The browser uses only the project URL and publishable/anon key.

`tests/rls-smoke.sql` is a review script for a staging project. It intentionally needs three real invited sessions, so it is not run against local mock data.
