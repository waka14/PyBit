# EdgeOne Pages 部署（真实生产）

旧归档不能用于真实 Supabase 连接，见 [LEGACY_ZIPS_DO_NOT_UPLOAD.md](./LEGACY_ZIPS_DO_NOT_UPLOAD.md)。本项目的 EdgeOne 原生配置是根目录的 `edgeone.json`；构建后它会被复制到 `dist/` 和生产 ZIP 根目录。`_headers`、`_redirects` 仅保留作其他静态主机兼容文件，**不是** EdgeOne 的上线配置来源。

`edgeone.json` 使用 EdgeOne Pages 官方支持的 SPA fallback、响应头和缓存规则：[官方配置说明](https://pages.edgeone.ai/document/edgeone-json)。

## 方式 A：连接源码，由 EdgeOne 平台构建

1. 在 EdgeOne Pages 创建静态站点项目并连接源码仓库，构建目录选 `web`。
2. 安装命令填 `pnpm install --frozen-lockfile`，构建命令填 `pnpm run build`，输出目录填 `web/dist`（若平台的根目录已设为 `web`，输出目录填 `dist`）。
3. 在项目的 **Environment Variables / 环境变量** 中仅新增：
   - `VITE_SUPABASE_URL`：Supabase Project URL；
   - `VITE_SUPABASE_PUBLISHABLE_KEY`：Supabase publishable key。
4. 不添加 `VITE_ALLOW_DEMO`；生产代码忽略演示参数。
5. 部署后，将 EdgeOne 分配的默认 HTTPS 域名填入 Supabase **Authentication → URL Configuration** 的 Site URL 和允许的 Redirect URLs，按 [账号初始化说明](./supabase/ACCOUNT_INITIALIZATION.md) 创建首批账号。

平台变量只在**平台重新构建**时写进前端 JS；改变量后必须重新部署。

## 方式 B：直接上传 ZIP

1. 在本机 `web/.env.production.local` 只填写两行：

```dotenv
VITE_SUPABASE_URL=https://REPLACE_WITH_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=REPLACE_WITH_PUBLISHABLE_KEY
```

2. 运行 `pnpm run package:production`。脚本会强制关闭演示、运行测试和类型检查、构建、扫描敏感内容，并生成 `pybit-edgeone-production.zip`。
3. EdgeOne 平台变量**不会改写已经生成的 JS**；因此直接上传前必须按本机变量重新打包，不能上传旧 ZIP。
4. 在 EdgeOne Pages 项目中选择 **Direct Upload / 直接上传**，上传 `pybit-edgeone-production.zip`。ZIP 内 `index.html` 与 `edgeone.json` 位于根目录。
5. 部署后把该默认 HTTPS 域名配置到 Supabase URL Configuration；使用 czh、waka、普通成员分别登录验证。

## 发布后核对

- 未登录只显示登录，找不到公开注册入口。
- `?demo=1` 不显示模拟身份或重置演示数据。
- 刷新任意前端路径能回到单页应用。
- Service Worker 出现“新版本可用”时，用户点击后才更新。
- 按 `supabase/tests/rls-smoke.sql` 在真实受邀账号会话中验证数据库权限。
