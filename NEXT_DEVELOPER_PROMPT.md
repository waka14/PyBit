# 下一位开发者启动 Prompt

你接手的是 PYBIT V2 前后端一体源码。先读取 `AGENTS.md`、`FULLSTACK_HANDOFF.md`、`.scratch/pybit-v2/change-plan-2026-09-12.md`、`PRODUCT.md`、`DESIGN.md`、`UI_ARCHITECTURE.md` 和 `README.md`。

本目录是当前开发基线。保留 V2 已确认的账务、权限、成员 ID、委托流程和收益/资产分离规则；不要从旧版恢复常规抽水、近三场、取回申请或旧进行中场次。前端沿用现有冷黑白交易界面、B标1.0、后置 B、像素风暴、翻牌和五层样式模块。

开始工作先运行：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm run dev -- --host 0.0.0.0
```

使用 `http://localhost:5173/?demo=1` 检查 waka、lf、lbs、czh。修改领域、仓库接口、Supabase RPC 或迁移前，先说明规则依据并补测试。不要执行生产 migration、历史重算、真实资金测试或正式发布；真实 Supabase 验证必须使用隔离项目。

每轮交付说明功能、数据保存、权限、历史回归、手机宽度、测试结果及未验证部分。演示成功不能证明生产持久化或真实 RLS 已通过。
