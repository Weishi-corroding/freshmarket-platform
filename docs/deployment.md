# 部署运维手册

当前维护状态与验证边界见 [2026-10-20 维护记录](maintenance-2026-10-20.md)。本轮未启动完整 Docker 栈；下列步骤是当前操作说明，不代表本轮已完成真实恢复或发布验收。

## 1. 环境分离

| 环境 | 数据与组件 | 配置 | 目标 |
| --- | --- | --- | --- |
| dev | 持久化SQLite；无外部Redis/MQ也可运行 | `.env`（可选），默认本机3001/5173 | 日常开发与快速演示 |
| test | 内存SQLite/临时PG schema；Playwright测试用户 | NODE_ENV=test、TEST_DATABASE_URL | 自动化隔离验证 |
| demo Docker | PostgreSQL、Redis、RabbitMQ、Nginx、Prom/Grafana | `.env.docker`，脚本生成独立密码 | 本机隔离的完整企业组件演示 |
| prod扩展 | PG主从与备份、统一限流、TLS、真实服务 | 外部Secret管理、关闭演示账号 | 需另行生产工程与验收 |

Docker环境设置NODE_ENV=production以启用强配置校验，但Compose整体仍是教学演示栈；六个示范角色及支付沙箱不可直接作为公网商业系统。

## 2. 启动与停止

Windows：`scripts/init-env.ps1`；Linux：`sh scripts/init-env.sh`。配置文件已存在时脚本拒绝覆盖，保护已有密钥。新配置含独立 `COMPOSE_PROJECT_NAME`；已有部署必须沿用原项目名以连接原来的数据卷，不能在升级时随意改名。多套部署还须避免宿主机端口冲突。随后：

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

`database/schema.sql`定义所有实体和索引，可在SQLite/PostgreSQL执行。`database/seed.sql`只用于实验默认账号和商品；默认密码公开，不应导入公网数据库。应用首次启动的`seed.ts`使用DEMO_PASSWORD配置；Docker中必须为至少12位且不同于本地默认密码。

已有数据不重复初始化。不通过删除数据来切换密码；管理员可在后台对会员/员工执行启停、密码重置、逻辑删除，并使旧会话失效。正式生产仍需补充首次管理员的安全初始化和密钥管理流程。

## 4. 备份、恢复和回滚

```powershell
.\scripts\backup.ps1
.\scripts\restore.ps1 -BackupFile .\backups\freshmarket-YYYYMMDD-HHMMSS.dump
.\scripts\deploy.ps1
.\scripts\rollback.ps1
```

Linux 使用对应的 `sh scripts/backup.sh`、`sh scripts/restore.sh <备份路径>`、`sh scripts/deploy.sh`、`sh scripts/rollback.sh [版本号]`。

备份使用 pg_dump 自定义格式，先在容器内生成，再复制到指定目录，避免 PowerShell 文本管道损坏二进制文件；备份和恢复均尝试清理容器临时转储。恢复脚本先停 API，复制备份并使用单事务 pg_restore，清空专用 Redis 的缓存及秒杀令牌后再启动 API。停止、恢复或清缓存失败不继续启动；启动失败报错而不打印成功。成功后必须检查 `/api/health` 和代表性订单。Redis 的 FLUSHDB 仅适用于本 Compose 专用实例，共享 Redis 需改为命名空间清理。恢复会覆盖当前数据库，应先生成当前备份，在可控演练环境验证。

使用 deploy 脚本生成提交号加时间的唯一镜像标签（也可显式传版本），写回 `.env.docker` 并追加 `.deploy-history`，保留旧 API/WEB 镜像。回滚脚本默认选择上一次部署，也可指定版本，检查旧镜像后使用 --no-build 替换应用容器。直接重复构建默认 local 标签会覆盖同一镜像，无法保证有可回滚版本。部署/回滚命令返回后还需检查容器健康和代表性业务。数据库迁移须向后兼容；非兼容变更需要备份恢复，不能只回滚应用镜像。

本轮使用 `scripts/test-restore.ps1` 的 docker 函数替身验证停止、恢复、清缓存、启动失败及成功共五条控制流；没有执行真实数据恢复，不能声明本轮已验证 RPO/RTO。10 月 18 日的独立演练保留为历史记录，升级后仍需在测试数据库执行恢复比对。

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

GitHub Actions执行npm ci、类型检查、SQLite后端测试、独立schema PostgreSQL测试、生产构建、Chromium E2E和Compose配置检查。工作流文件已提供；本地通过不等于GitHub托管流水线已实际运行，真实推送结果由团队补录。
