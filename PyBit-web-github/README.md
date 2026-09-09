# PyBit Web / PWA

PyBit 是仅供受邀成员使用的私人场次收益账本。微信小程序没有被修改；网页项目完全位于本目录。

## 两种运行模式

- **开发演示：** Vite 开发服务器加 `?demo=1`，使用独立的 `pybit-demo-v2-*` 浏览器存储和模拟身份。它只用于本地验收，不能证明真实权限。
- **生产：** 不理会 `?demo=1`，不读取本地模拟角色或账本。未配置 Supabase 时只显示登录服务未配置；配置后只接受 Supabase 邀请账号的邮箱与密码登录。

生产浏览器只可配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`。绝不可放入 service role、数据库密码、JWT 密钥、微信 AppID 或 CloudBase 配置。

## 本地命令

```bash
pnpm install --frozen-lockfile
pnpm run test
pnpm run build
pnpm run dev -- --host 0.0.0.0
```

演示地址：`http://localhost:5173/?demo=1`。生产构建预览必须提供 Supabase 的两项公开环境变量；不要把 `.env.local` 提交到仓库。

## Supabase 接入

先在 Supabase 新加坡项目的 SQL Editor 按顺序执行：

1. `supabase/migrations/202609050001_initial_schema.sql`
2. `supabase/migrations/202609050002_rls_and_rpc.sql`

随后在 **Authentication → Providers → Email** 关闭公开注册（Disable signups），在 **Authentication → Users → Invite user** 邀请首位 `czh`。受邀人设定密码后，在 SQL Editor 为其建立一个 `members` 行与对应 `profiles` 行；`profiles.auth_user_id` 填 Auth Users 中该人的 UUID，`member_id` 填成员 UUID，`role` 填 `czh`。其余 `waka` 与成员按同样方式绑定。

生产规则由 RLS 与 RPC 决定：成员只能取回本人数据；`waka` 能管理场次但不能确认实际转回；`czh` 才能管理成员资金与转回确认。浏览器隐藏按钮不是安全边界。

详见 [Supabase 迁移说明](./supabase/README.md)、[账号初始化说明](./supabase/ACCOUNT_INITIALIZATION.md) 与 [EdgeOne Pages 上传说明](./EDGEONE_DEPLOY.md)。旧 ZIP 不可用于真实连接，必须用 `pnpm run package:production` 重新生成。

## 备份和回滚

登录后“导出”只导出当前账号权限范围内的 JSON，包含导出时间、数据版本和整数分单位；不会把真实账本写入 localStorage。上线后由 czh 或 waka 定期从生产页面导出，并在 Supabase Dashboard 另行导出数据库备份。

回滚前端：在 EdgeOne Pages 将上一条成功部署设为当前版本。回滚数据库：先停止写入，再按迁移的变更记录制定反向 SQL；不要用浏览器缓存或清空 localStorage 处理生产账本问题。
