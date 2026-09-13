# PyBit Web / PWA

当前代码入口为 PYBIT V2：三位股东常规比赛、个人单独委托生命周期、直接资产增减和股东大盘。本轮规则以 [2026-09-12 修改方案](./.scratch/pybit-v2/change-plan-2026-09-12.md) 为准，旧指导文件只在不冲突处继续适用。V2 生产 migration 尚未应用。

## V2 前端视觉模块

当前 V2 使用已确认的 PYBIT 冷黑白交易界面。页面从 `src/ui/index.ts` 引用无业务状态的视觉组件；`src/v2/v2.css` 按 tokens、foundation、components、motion、responsive 五层组装样式。详细边界见 `DESIGN.md` 与 `UI_ARCHITECTURE.md`。

PyBit 是仅供受邀成员使用的私人场次收益账本。微信小程序没有被修改；网页项目完全位于本目录。

## 两种运行模式

- **开发演示：** Vite 开发服务器加 `?demo=1`，使用内存账本和模拟身份；刷新或点“重置”即可恢复演示数据，包含一条待接手委托用于检查锁定金额。它只用于本地验收，不能证明真实权限。
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
3. `supabase/migrations/202609110001_pybit_v2.sql`（先用于隔离项目）
4. `supabase/migrations/202609120001_pybit_v2_change_plan.sql`（本轮委托生命周期叠加层；本轮不执行）

随后在 **Authentication → Providers → Email** 关闭公开注册（Disable signups），在 **Authentication → Users → Invite user** 邀请首位 `czh`。受邀人设定密码后，在 SQL Editor 为其建立一个 `members` 行与对应 `profiles` 行；`profiles.auth_user_id` 填 Auth Users 中该人的 UUID，`member_id` 填成员 UUID，`role` 填 `czh`。其余 `waka` 与成员按同样方式绑定。

生产规则由 RLS 与 RPC 决定：CZH 和 `waka` 能管理全部比赛、接手和结算委托；普通股东只能管理自己的待接手单独委托，执行中和已结算只读；每个人只能修改自己的资产和下一场比例。CZH 可以查看全部资金变动，其他身份只接收自己的资金记录。浏览器隐藏按钮不是安全边界。

详见 [Supabase 迁移说明](./supabase/README.md)、[账号初始化说明](./supabase/ACCOUNT_INITIALIZATION.md) 与 [EdgeOne Pages 上传说明](./EDGEONE_DEPLOY.md)。旧 ZIP 不可用于真实连接，必须用 `pnpm run package:production` 重新生成。

如需把当前版本交给前端继续做视觉和手机交互，先看 [前端交接说明](./FRONTEND_HANDOFF.md) 和 [前端交接 Prompt](./FRONTEND_HANDOFF_PROMPT.md)。

## 备份和回滚

V2 浏览器不会把真实账本写入 localStorage。“导出”只包含当前登录者有权看到的数据；上线后仍应由 czh 或 waka 在 Supabase Dashboard 定期导出完整数据库备份。

回滚前端：在 EdgeOne Pages 将上一条成功部署设为当前版本。回滚数据库：先停止写入，再按迁移的变更记录制定反向 SQL；不要用浏览器缓存或清空 localStorage 处理生产账本问题。
