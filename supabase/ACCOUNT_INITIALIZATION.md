# PyBit 首批账号初始化（Supabase 控制台）

此流程只使用 Supabase 控制台和 SQL Editor，不需要、也不应使用 `service_role`、数据库密码或 JWT 密钥。

## 先完成一次通用设置

1. 打开 Supabase 项目，进入 **Authentication → Providers → Email**，关闭 **Allow new users to sign up**／公开注册。
2. 进入 **Authentication → URL Configuration**，把 **Site URL** 填为 EdgeOne 分配的正式 HTTPS 根网址，例如 `https://你的项目.edgeone.app`。
3. 在 **Redirect URLs** 只添加该正式网址的两条精确地址：`https://你的项目.edgeone.app` 和 `https://你的项目.edgeone.app/?auth=recovery`。不要添加本地地址、通配符或陌生域名。
4. 在 SQL Editor 按顺序执行两份项目迁移。确认成功后再邀请账号。

## 重要顺序

邀请操作会立即发送邮件，但用户**不要立刻打开邮件**。管理员先在 **Authentication → Users** 找到新行并复制 Auth User UUID，执行对应 SQL 绑定模板，确认成功后再让用户打开邀请邮件。这样成员设定密码后会直接进入已绑定账户，不会卡在“账号尚未绑定成员资料”。

一个 Auth User UUID 只能绑定一个成员，一个 `member_id` 也只能绑定一个 Auth User UUID；数据库的 `profiles.auth_user_id` 主键和 `profiles.member_id` 唯一约束会拒绝重复绑定。

## 创建第一个 czh

1. 在 **Authentication → Users** 点击 **Invite user**，填写 czh 的邮箱并发送。暂时不要让 czh 打开邮件。
2. 点击新用户行，复制 **User UID**。
3. 打开 **SQL Editor → New query**，把以下唯一占位符替换为该 UUID 后执行：

```sql
begin;

with new_member as (
  insert into public.members (display_name, is_czh, is_active, base_ratio_bps)
  values ('czh', true, true, 0)
  returning id
)
insert into public.profiles (auth_user_id, member_id, role)
select 'REPLACE_WITH_CZH_AUTH_USER_UUID'::uuid, id, 'czh'::public.pybit_role
from new_member;

commit;
```

4. 成功后让 czh 打开原邀请邮件，在正式 EdgeOne 网址设置密码。

## 创建 waka

1. 仍在 **Authentication → Users → Invite user** 邀请 waka 邮箱；先不要打开邮件。
2. 复制 waka 的 **User UID**。
3. 在 SQL Editor 执行：

```sql
begin;

with new_member as (
  insert into public.members (display_name, is_czh, is_active, base_ratio_bps)
  values ('waka', false, true, 0)
  returning id
)
insert into public.profiles (auth_user_id, member_id, role)
select 'REPLACE_WITH_WAKA_AUTH_USER_UUID'::uuid, id, 'waka'::public.pybit_role
from new_member;

commit;
```

4. 成功后让 waka 打开邀请邮件并设置密码。

## 创建普通成员

1. 在 **Authentication → Users → Invite user** 邀请该股东邮箱；先不要打开邮件。
2. 复制该用户的 **User UID**。
3. 把显示名和 UUID 替换后执行：

```sql
begin;

with new_member as (
  insert into public.members (display_name, is_czh, is_active, base_ratio_bps)
  values ('REPLACE_WITH_MEMBER_DISPLAY_NAME', false, true, 0)
  returning id
)
insert into public.profiles (auth_user_id, member_id, role)
select 'REPLACE_WITH_MEMBER_AUTH_USER_UUID'::uuid, id, 'member'::public.pybit_role
from new_member;

commit;
```

4. 成功后让成员打开邀请邮件并设置密码。

## 绑定已经存在的成员

如果 czh 已从网页的“添加股东”创建过成员，不要再创建第二个成员。先在 `public.members` 找到稳定 ID，再执行以下模板：

```sql
insert into public.profiles (auth_user_id, member_id, role)
values (
  'REPLACE_WITH_AUTH_USER_UUID'::uuid,
  'REPLACE_WITH_EXISTING_MEMBER_UUID'::uuid,
  'member'::public.pybit_role
);
```

如出现唯一约束错误，停止操作并核对 UUID；不要删除已有 `profiles` 行来“重试”。

## 邀请过期或成员误先打开了链接

- 邀请过期：在 **Authentication → Users** 找到用户，使用控制台的重发邀请操作；如该控制台版本没有该按钮，删除未完成的 Auth 用户后重新邀请，并重新执行绑定模板。
- 已先打开且页面提示“账号尚未绑定成员资料”：先执行绑定模板，再重新发送邀请。不要假定已消耗的旧链接还能继续使用。
- 忘记密码：成员在正式网页登录页填写邮箱，点“忘记密码”；邮件只会跳回上面设置过的正式 EdgeOne HTTPS 地址。
