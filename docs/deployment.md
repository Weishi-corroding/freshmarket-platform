# 部署运维手册

本手册描述当前脚本的用法与行为；各项的实际验证范围见[测试报告](test-report.md)。

## 1. 环境分离

| 环境 | 数据与组件 | 配置 | 目标 |
| --- | --- | --- | --- |
| dev | 持久化SQLite；无外部Redis/MQ也可运行 | `.env`（可选），默认本机3001/5173 | 日常开发与快速演示 |
| test | 内存SQLite/临时PG schema；Playwright测试用户 | NODE_ENV=test、TEST_DATABASE_URL | 自动化隔离验证 |
| demo Docker | PostgreSQL、Redis、RabbitMQ、Nginx、Prom/Grafana | `.env.docker`，脚本生成独立密码 | 本机隔离的完整企业组件演示 |
| prod扩展 | PG主从与备份、统一限流、TLS、真实服务 | 外部Secret管理、关闭演示账号 | 需另行生产工程与验收 |

Docker环境设置NODE_ENV=production以启用强配置校验，但Compose整体仍是教学演示栈；六个示范角色及支付沙箱不可直接作为公网商业系统。

## 2. 启动与停止

Windows：`scripts/init-env.ps1`；Linux：`sh scripts/init-env.sh`。脚本生成随机密钥并显式写出 `SEED_DEMO`、`VITE_DEMO`；配置文件已存在时拒绝覆盖，保护已有密钥。新配置含独立 `COMPOSE_PROJECT_NAME`；已有部署必须沿用原项目名以连接原来的数据卷，不能在升级时随意改名。多套部署还须避免宿主机端口冲突。随后：

```bash
docker compose --env-file .env.docker config --quiet
# Windows：.\scripts\deploy.ps1；Linux：
sh scripts/deploy.sh
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --tail=100 api
```

默认只开放本机 8080、3000、9090、15672，以及 Alertmanager 9093 和 Jaeger 16686；数据库和 Redis 不开宿主机端口。Redis/MQ、数据库必须健康后才启动 API；API 健康后启动商城网关。首次自动迁移，`SEED_DEMO` 默认开启演示种子。生产前端只提供账号提示，不包含部署密码；对外部署应同时设置 `SEED_DEMO=false` 和 `VITE_DEMO=false` 并处理已有演示账号。

暂停服务：`docker compose --env-file .env.docker stop`；恢复：`... start`。`down`保留命名数据卷，**不要使用down -v作为常规停止操作**。开发环境用Ctrl+C停止`npm run dev`，本地数据库持久保存。

## 3. 数据脚本与初始化

`database/schema.sql` 按账号、商品目录、订单与资金、营销、可靠消息与审计、索引分段定义全部表和索引，两种数据库通用、可重复执行，API 每次启动自动执行。给已有表加列时须同时写入 schema.sql 和 `api/src/core/database.ts` 的 `additions`。`database/seed.sql` 由 `npm run build -w api && node scripts/export-seed.mjs` 从 seed.ts 生成，只用于实验环境手工导入（`sqlite3 库文件 < database/seed.sql` 或 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed.sql`，先导入 schema.sql）；其中演示账号密码公开，不应导入公网数据库。Docker 部署无需导入，API 首次启动的 seed.ts 使用 DEMO_PASSWORD，必须至少 12 位且不同于本地默认密码。

已有数据不重复初始化。不通过删除数据来切换密码；管理员可在后台对会员/员工执行启停、密码重置、逻辑删除，并使旧会话失效。正式生产仍需补充首次管理员的安全初始化和密钥管理流程。

## 4. 部署、回滚、备份和恢复

```powershell
.\scripts\deploy.ps1                       # 可选 -Version <标签>
.\scripts\rollback.ps1                     # 可选 -Version <标签>
.\scripts\backup.ps1                       # 可选 -OutputDirectory <目录>
.\scripts\restore.ps1 -BackupFile .\backups\freshmarket-YYYYMMDD-HHMMSS.dump -Force
```

Linux/macOS 使用 `sh scripts/deploy.sh [版本]`、`sh scripts/rollback.sh [版本]`、`sh scripts/backup.sh [目录]`、`sh scripts/restore.sh <备份路径> --yes`。

- 部署：检查 Docker、`.env.docker` 与 `compose config`，以“提交号-时间”或指定版本构建 api/web 镜像，`up -d --wait` 等待健康检查并经网关请求 `/api/health`。成功后写回 `APP_VERSION` 并追加 `.deploy-history`；失败时自动把 api/web 退回上一次成功的版本，新版本不记录（首次部署失败则保留现场供排查）。构建失败不会改动运行中的服务。
- 回滚：默认回到 `.deploy-history` 的上一条，确认 API 与 Web 两个镜像都在本机后以 `--no-build --no-deps --wait` 替换应用容器。连续两次回滚会在最近两个版本间切换，回到更早版本须指定版本号。数据库迁移须向后兼容；非兼容变更需要备份恢复，不能只回滚应用镜像。
- 备份：pg_dump 自定义格式先在容器内生成，`pg_restore --list` 校验可读后复制到宿主机（避免 PowerShell 文本管道损坏二进制），无论成败都删除容器内临时文件。
- 恢复：会覆盖当前数据库，必须加 `--yes` / `-Force` 确认。脚本先把当前库备份到 `backups/pre-restore`（当前库已无法导出时用 `--no-pre-backup` / `-SkipPreBackup` 跳过），再停 API、单事务 pg_restore、清空专用 Redis 的缓存及秒杀令牌，最后等待 API 恢复健康。停止、恢复、清缓存任一步失败都不启动 API；API 未恢复健康时报错而不打印成功。成功后检查代表性订单。FLUSHDB 仅适用于本 Compose 专用实例，共享 Redis 需改为命名空间清理。

`sh scripts/test-ops.sh`（19 项）与 `scripts/test-ops.ps1`（18 项）在临时目录运行脚本副本，用 docker 替身检查上述成功与失败分支，不触及真实容器与 `.env.docker`；CI 执行 sh 版本。替身测试不能替代真实演练，升级后仍需在测试数据库执行备份、恢复比对与回滚演练。

## 5. 监控与故障处理

- `/api/health`报告数据库、缓存和消息队列实际状态。数据库故障健康检查失败；Redis/MQ故障可降级服务，响应标注degraded。
- Prometheus 从内部 api:3001 采集，外部 Nginx 阻断 `/api/metrics`、Swagger 和 OpenAPI；Grafana 自动装载数据源和业务仪表盘。`up` 只代表指标采集可达；`fresh_dependency_up` 的数据库值来自实际查询，Redis/MQ 值代表已配置连接就绪。`fresh_outbox_oldest_pending_seconds` 包括 pending 与 processing，查询失败输出非数值。
- HTTP日志通过traceId串联请求、审计与异常；模板化路由标签避免高基数。
- Redis失效：商品查询回源数据库，检查连接地址/日志；核心库存决策不依赖缓存。
- RabbitMQ 失效：业务继续在 Outbox 写事件，发布任务暂停，后台每约 30 秒尝试重连并重建拓扑/消费者；pending/processing 事件租约允许恢复。mandatory 退回或 5 秒无确认时保留 pending 并重建通道；不能将发布确认当作消费完成，重复投递由事件 ID 去重。
- 消费者业务错误：检查`fresh.dead`死信队列及日志。核实修复后重新发布原消息，保留原事件id，避免重复消息产生重复通知。
- 查询慢：检查PostgreSQL连接池、索引/执行计划、热点分页，以及Prometheus p95；不使用无限连接池或无限页大小。

已有告警表达式：采集掉线 1 分钟、依赖未就绪 1 分钟、事件最旧积压超过 60 秒持续 3 分钟、5xx 占比超过 1% 持续 3 分钟、p95 超过 500ms 持续 3 分钟。Prometheus 已路由到 Alertmanager，默认 ops 接收器没有外部通道；目前仅能在 Prometheus/Grafana/Alertmanager 本地界面查看。部署方需在 `infra/alertmanager.yml` 配置真实 Webhook 或邮件接收器并验证触发和恢复，才能验收外部通知。

## 6. HTTPS与公网发布边界

教学HTTP只绑定本机。公网发布须在受信任Ingress/负载均衡或Nginx终止TLS，配置证书与自动续期，启用HSTS，把CORS_ORIGIN设为真实商城origin。不要直接开放PostgreSQL、Redis或RabbitMQ管理端。

移除六个演示账号与前端演示入口（VITE_DEMO=false），保持首次管理员初始化路径；生产支付需要签名、订单金额核验、回调去重和退款渠道，物流需要真实履约对接。执行镜像漏洞扫描、备份恢复演练、持续压力测试和用户隐私验收。当前代码的单实例内存限流与角色权限模型还需按实际生产规模加固。

## 7. Git与CI/CD

建议分支：main保持可部署；feature/业务名实现；fix/问题名修复。提交采用feat/fix/docs/test/chore类型，变更附需求号、测试结果与回滚条件。由团队评审后合并，不能把代理自检当作已完成的人工审批。

GitHub Actions执行npm ci、类型检查、SQLite后端测试、独立schema PostgreSQL测试、生产构建、Chromium E2E、运维脚本控制流测试和Compose配置检查。工作流文件已提供；本地通过不等于GitHub托管流水线已实际运行，真实推送结果由团队补录。
