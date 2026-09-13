# PyBit V2 全新重做

这份文件适用于“旧账本不保留，直接重新开始”的情况。它会删除当前 Supabase 项目 `pybit-prod` 的 `public` 应用数据，但不会删除 `auth.users` 登录账号。

## 你要准备的东西

- 当前 Supabase 项目：`patxmiuinsgojycdglsl`
- 四个应用登录账号：`czh`、`waka`、`lf`、`lbs`
- 本目录下的四份 migration 文件

不要把密码、数据库密码、`service_role` key 或 JWT key 发给任何人，也不要填进前端。

## 执行顺序

在 Supabase → **SQL Editor → New query** 中执行下面步骤。每一步成功后再做下一步。

### 1. 清空旧应用数据

这一步会删除 `public` schema 下的旧账本、旧表、旧函数和旧权限。`auth.users` 不在 `public` schema 内，所以登录账号会保留。

```sql
drop schema if exists public cascade;
create schema public;
grant usage on schema public to anon, authenticated;
grant all on schema public to service_role;
```

点击 **Run**，确认没有红色错误后继续。

### 2. 依次执行四份 migration

每次新建一个 query，把对应文件的全部内容复制进去并点击 **Run**。顺序不能调换：

1. [`202609050001_initial_schema.sql`](./migrations/202609050001_initial_schema.sql)
2. [`202609050002_rls_and_rpc.sql`](./migrations/202609050002_rls_and_rpc.sql)
3. [`202609110001_pybit_v2.sql`](./migrations/202609110001_pybit_v2.sql)
4. [`202609120001_pybit_v2_change_plan.sql`](./migrations/202609120001_pybit_v2_change_plan.sql)

如果某一步出现红色错误，不要继续执行后面的文件，把错误截图保存下来。

### 3. 查看现有应用登录账号

执行下面的只读查询：

```sql
select id, email, created_at
from auth.users
order by created_at;
```

记下四个应用账号的 `id`。Supabase Dashboard 的登录账号不一定等于应用里的登录账号；这里必须使用 `auth.users` 里的 UUID。

### 4. 绑定四个成员

把下面四处 `REPLACE_WITH_...` 替换为上一步查到的真实 UUID，然后执行一次。

```sql
begin;

with account_map(display_name, auth_user_id, role) as (
  values
    ('czh',  'REPLACE_WITH_CZH_AUTH_USER_UUID'::uuid,  'czh'::public.pybit_role),
    ('waka', 'REPLACE_WITH_WAKA_AUTH_USER_UUID'::uuid, 'waka'::public.pybit_role),
    ('lf',   'REPLACE_WITH_LF_AUTH_USER_UUID'::uuid,   'member'::public.pybit_role),
    ('lbs',  'REPLACE_WITH_LBS_AUTH_USER_UUID'::uuid,  'member'::public.pybit_role)
), new_members as (
  insert into public.members (display_name, is_czh, is_active, base_ratio_bps)
  select display_name, display_name = 'czh', true, 0
  from account_map
  returning id, display_name
)
insert into public.profiles (auth_user_id, member_id, role)
select a.auth_user_id, m.id, a.role
from account_map a
join new_members m using (display_name);

commit;
```

### 5. 写入新的初始资产和下一场比例

当前演示起点按四个人各 `1,000 B` 设置；三位股东下一场各 `30%`，CZH 自动承担剩余 `10%`。金额在数据库中按分保存，所以 `1,000 B = 100,000`。

```sql
begin;

with czh as (
  select id from public.members where display_name = 'czh' and is_czh
)
insert into public.v2_member_openings (member_id, opening_asset_cents, effective_at, created_by)
select m.id, 100000, now(), czh.id
from public.members m cross join czh
where m.is_active;

with czh as (
  select id from public.members where display_name = 'czh' and is_czh
)
insert into public.v2_current_ratios (member_id, ratio_bps, updated_by)
select m.id,
       case when m.display_name = 'czh' then 1000 else 3000 end,
       czh.id
from public.members m cross join czh
where m.is_active;

insert into public.v2_audit_logs (action, actor_id, target_id, metadata)
select 'OPENINGS_CONFIGURED', czh.id, czh.id,
       jsonb_build_object('mode', 'fresh_start', 'openingAssetB', 1000, 'shareholderRatio', 30)
from public.members czh
where czh.display_name = 'czh' and czh.is_czh;

commit;
```

### 6. 验证初始化结果

```sql
select m.display_name, p.role,
       o.opening_asset_cents / 100.0 as opening_asset_b,
       r.ratio_bps / 100.0 as next_ratio_percent
from public.members m
join public.profiles p on p.member_id = m.id
join public.v2_member_openings o on o.member_id = m.id
join public.v2_current_ratios r on r.member_id = m.id
order by m.is_czh, m.display_name;
```

应该看到四行：

- `czh`：`1,000 B`、`10%`
- `lf`、`lbs`、`waka`：各 `1,000 B`、`30%`

之后才把前端连接到这个 Supabase 项目并发布 EdgeOne。首次登录应用时，四个人使用各自 `auth.users` 对应的账号。

## 出错时怎么处理

不要重复执行第 4 或第 5 步，以免出现重复绑定或重复期初记录。把红色错误文字截图发来，我会根据具体错误给你下一条操作。
