# 旧 ZIP 不可用于真实生产连接

以下归档是在 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_PUBLISHABLE_KEY` 写入前构建的，仅可作为历史本地演示构建记录，**不得上传到 EdgeOne 用于真实 Supabase 生产连接**：

- `pybit-edgeone-dist.zip`
- `pybit-edgeone-dist-20260905-203829.zip`

真实生产 ZIP 必须通过 `pnpm run package:production` 在本机读取 `.env.production.local` 后重新生成；输出文件为 `pybit-edgeone-production.zip`。
