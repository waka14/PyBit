# 04 Supabase V2 迁移与适配

Status: ready-for-human
Blocked by: 01-domain-ledger

## Outcome

提供未应用的 V2 迁移、事务 RPC、角色过滤读取模型和前端适配器；保留生产登录、登出和导出。

## Acceptance

- RPC 一次完成比赛写入、编辑或删除，具备幂等和并发保护。
- 数据库执行 CZH／waka／普通股东权限，不依赖隐藏按钮。
- 普通股东无法读取他人的资金事件或修改他人的委托。
- 迁移文件不会自动执行，附隔离项目验收 SQL。

## Comments

- 2026-09-11：迁移、事务 RPC、前端适配器和权限冒烟脚本已准备；按授权未连接或修改生产库。
