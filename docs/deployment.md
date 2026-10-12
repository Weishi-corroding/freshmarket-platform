# 部署运维手册

## 1. 环境分离

| 环境 | 数据与组件 | 配置 | 目标 |
| --- | --- | --- | --- |
| dev | 持久化SQLite；无外部Redis/MQ也可运行 | `.env`（可选），默认本机3001/5173 | 日常开发与快速演示 |
| test | 内存SQLite/临时PG schema；Playwright测试用户 | NODE_ENV=test、TEST_DATABASE_URL | 自动化隔离验证 |
| demo Docker | PostgreSQL、Redis、RabbitMQ、Nginx、Prom/Grafana | `.env.docker`，脚本生成独立密码 | 本机隔离的完整企业组件演示 |
| prod扩展 | PG主从与备份、统一限流、TLS、真实服务 | 外部Secret管理、关闭演示账号 | 需另行生产工程与验收 |

Docker环境设置NODE_ENV=production以启用强配置校验，但Compose整体仍是教学演示栈；六个示范角色及支付沙箱不可直接作为公网商业系统。

## 2. 启动与停止

Windows：`scripts/init-env.ps1`；Linux：`sh scripts/init-env.sh`。配置文件已存在时脚本拒绝覆盖，保护已有密钥。随后：

```bash
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --tail=100 api
```

默认只开放本机8080、3000、9090、15672；数据库和Redis不开宿主机端口。Redis/MQ、数据库必须健康后才启动API；API健康后启动商城网关。首次自动迁移和初始化种子数据。

暂停服务：`docker compose --env-file .env.docker stop`；恢复：`... start`。`down`保留命名数据卷，**不要使用down -v作为常规停止操作**。开发环境用Ctrl+C停止`npm run dev`，本地数据库持久保存。

## 3. 数据脚本与初始化

`database/schema.sql`定义所有实体和索引，可在SQLite/PostgreSQL执行。`database/seed.sql`只用于实验默认账号和商品；默认密码公开，不应导入公网数据库。应用首次启动的`seed.ts`使用DEMO_PASSWORD配置；Docker中必须为至少12位且不同于本地默认密码。

已有数据不重复初始化。不通过删除数据来切换密码；已有用户密码需安全管理流程处理。本项目没有提供生产账号生命周期/密码重置服务，正式使用应增加该模块。

## 4. 备份、恢复和回滚

```powershell
.\scripts\backup.ps1
.\scripts\restore.ps1 -BackupFile .\backups\freshmarket-YYYYMMDD-HHMMSS.dump
.\scripts\rollback.ps1 -Version 1.0.0
```

备份使用pg_dump自定义格式，先在容器内生成，再复制到指定目录，避免PowerShell文本管道损坏二进制文件。恢复脚本先停API，复制备份并使用单事务pg_restore；失败时保留停止状态供检查。恢复会覆盖当前数据库，应先生成当前备份，在可控演练环境验证。

发布前设置APP_VERSION，例如1.0.0，执行build并保留旧API/WEB镜像。回滚脚本检查旧镜像存在后使用--no-build替换应用容器。数据库迁移需向后兼容；非兼容变更需要备份恢复，不能只回滚应用镜像。

本次未通过破坏运行数据来演练恢复，不能声明已验证RPO/RTO；脚本和步骤已交付，需在测试数据库执行一次恢复比对。

## 5. 监控与故障处理

- `/api/health`报告数据库、缓存和消息队列实际状态。数据库故障健康检查失败；Redis/MQ故障可降级服务，响应标注degraded。
- Prometheus从内部api:3001采集，外部Nginx阻断`/api/metrics`；Grafana自动装载数据源和业务仪表盘。
- HTTP日志通过traceId串联请求、审计与异常；模板化路由标签避免高基数。
- Redis失效：商品查询回源数据库，检查连接地址/日志；核心库存决策不依赖缓存。
- RabbitMQ失效：业务继续在Outbox写事件，发布任务暂停，30秒重连后补发；pending/processing事件租约保证可恢复。
- 消费者业务错误：检查`fresh.dead`死信队列及日志。核实修复后重新发布原消息，保留原事件id，避免重复消息产生重复通知。
- 查询慢：检查PostgreSQL连接池、索引/执行计划、热点分页，以及Prometheus p95；不使用无限连接池或无限页大小。

已有告警表达式：API掉线1分钟、5xx占比超过1%持续3分钟、p95超过500ms持续3分钟。未接外部通知接收器，因此只能在Prometheus/Grafana查看告警状态。

## 6. HTTPS与公网发布边界

教学HTTP只绑定本机。公网发布须在受信任Ingress/负载均衡或Nginx终止TLS，配置证书与自动续期，启用HSTS，把CORS_ORIGIN设为真实商城origin。不要直接开放PostgreSQL、Redis或RabbitMQ管理端。

移除六个演示账号与前端演示入口（VITE_DEMO=false），保持首次管理员初始化路径；生产支付需要签名、订单金额核验、回调去重和退款渠道，物流需要真实履约对接。执行镜像漏洞扫描、备份恢复演练、持续压力测试和用户隐私验收。当前代码的单实例内存限流与角色权限模型还需按实际生产规模加固。

## 7. Git与CI/CD

建议分支：main保持可部署；feature/业务名实现；fix/问题名修复。提交采用feat/fix/docs/test/chore类型，变更附需求号、测试结果与回滚条件。由团队评审后合并，不能把代理自检当作已完成的人工审批。

GitHub Actions执行npm ci、类型检查、SQLite后端测试、独立schema PostgreSQL测试、生产构建、Chromium E2E和Compose配置检查。工作流文件已提供；本地通过不等于GitHub托管流水线已实际运行，真实推送结果由团队补录。
