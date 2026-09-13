# PYBIT V2 前端组装边界

- `src/v2/`：V2 页面、领域展示和仓库调用，是当前业务基线。
- `src/ui/index.ts`：可复用视觉组件唯一公共出口。
- `src/components/`：B 标、导航、图标、翻牌、粒子等无业务状态组件。
- `src/v2/styles/`：V2 视觉主题分层；加载顺序由 `src/v2/v2.css` 固定。

后端或仓库接口更新时先保持 `V2Repository` 与页面数据结构可用，再适配页面；不要让视觉组件直接读取 Supabase。下一次换肤从 `tokens.css` 开始，可替换材质和动效，但保留页面、权限和事件处理。

验证顺序：`pnpm test` → `pnpm run build` → 360／390／430px 与桌面页面检查 → waka／lf／lbs／czh 权限入口检查。
