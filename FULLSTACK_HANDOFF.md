# PYBIT V2 前后端一体交接

交接日期：2026-09-12

## 当前基线

本目录是当前唯一开发基线，包含 React/Vite 手机网页、V2 账务领域层、内存演示仓库、Supabase 生产适配器、RLS/RPC 迁移草案、测试和视觉系统。旧版源码只作为历史参考，不应覆盖本目录。

业务规则以 `.scratch/pybit-v2/change-plan-2026-09-12.md` 为最高优先级；视觉规则以 `DESIGN.md` 为准。`V2Repository` 是页面与数据层的边界。

## 启动

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm run dev -- --host 0.0.0.0
```

打开 `http://localhost:5173/?demo=1`。演示可切换 waka、lf、lbs、czh；演示仓库只保存在页面内存中，刷新会恢复基线。

## 前端

- `src/v2/V2App.tsx`：收益、资产、账本及表单流程。
- `src/v2/V2Chart.tsx`：点击、键盘与横向拖动图表。
- `src/ui/index.ts`：B 标、导航、图标、翻牌和粒子等视觉组件的稳定出口。
- `src/v2/styles/`：tokens、foundation、components、motion、responsive 五层样式。
- 金额展示为 `1,234.56 B`；涨跌同时使用颜色、正负号和文字。

## 后端与账务

- `src/v2/domain.ts`：V2 唯一账务重放与统计边界。
- `src/v2/repository.ts`：演示仓库、权限和 revision 并发保护。
- `src/v2/supabaseRepository.ts`：生产 RPC 适配器。
- `supabase/migrations/`：数据库迁移草案；尚未应用到真实生产库。
- `supabase/tests/`：RLS/RPC 烟雾测试脚本；尚未在隔离 Supabase 实跑。

## 已验证

- 本地自动测试 51 项通过。
- TypeScript 检查和 Vite 生产构建通过。
- 360、390、430、1024px 无横向溢出。
- waka/czh 显示管理入口；lf/lbs 不显示新增比赛、接手和结算入口，仓库测试同时验证直接越权调用被拒绝。
- 演示资产修改会同步更新个人资产、大盘和成功反馈；刷新恢复演示基线符合当前设计。

## 尚未验证或未执行

- 未运行生产数据库 migration、历史重算或真实资金测试。
- 未在隔离 Supabase 验证真实 RLS、RPC 事务和并发行为。
- 未配置真实 `.env.production.local`，也未正式发布 EdgeOne。
- 生产变更与发布必须另行确认。

## 安全要求

浏览器端只允许 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY`。不要把 service role、数据库密码或 JWT secret 写入源码、前端环境文件或交付包。
