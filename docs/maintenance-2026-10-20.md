# 2026-10-20 漏洞修复与验证记录

基线为 `git pull --ff-only` 拉取的 `725696a`，本记录同时描述其后的工作区修改。10 月 12 日审计、10 月 18 日报告与既有 Word/PDF 是各自提交的历史快照，不能当作当前缺陷状态或本轮运行证据。

## 本轮修复

- 消息通道：监听连接和通道的 error/close、消费者取消；失败时清理连接，后台任务可再次连接并重建拓扑和消费者。只有初始化完成的通道才向发布任务与健康检查暴露；旧连接的迟到事件不会清空新连接。
- Outbox：启用 `mandatory`，按 `messageId` 识别不可路由退回；退回后即使收到正向 confirm 也保持 pending，并关闭失效通道供重连重建。发布确认超过 5 秒、通道断开、负向确认或同步异常均保留重试状态。批次中断后剩余事件不会切换为进程内消费。至少一次投递仍可能重复，`processed_events` 负责去重。
- 恢复脚本：PowerShell 恢复流程检查 `start api` 退出码，启动失败抛错，不再打印成功；停止、数据库恢复、Redis 清理失败均不会继续启动 API。成功启动后的健康检查和代表性订单比对仍须执行。
- 部署隔离：移除 Compose 顶层固定项目名；环境初始化脚本已有随机 `COMPOSE_PROJECT_NAME`，未指定时使用 Compose 的目录默认值。同机多套部署仍须配置不同 Web 端口，不能只更换项目名。
- 依赖监控：新增 `fresh_dependency_up{dependency="database|cache|queue"}`。数据库每次抓取实际执行查询；Redis/MQ 仅在配置后输出连接就绪状态，不能据此声称完成端到端依赖操作探测。新增 `fresh_outbox_oldest_pending_seconds`，数据库查询失败输出非数值而不保留旧的正常值。增加依赖故障与 Outbox 延迟告警，Grafana 将 `up` 面板改名为“指标采集可达”。

消息协议依据：[RabbitMQ 发布确认语义](https://www.rabbitmq.com/docs/confirms)规定 mandatory 消息的退回在确认之前发送；[amqplib Channel API](https://amqp-node.github.io/amqplib/channel_api.html)说明 return、error、close 和消费者取消回调。回归测试使用故障替身验证这些分支，不等同于真实 RabbitMQ 故障演练。

## DEF-01—DEF-14 当前状态

- **DEF-01：代码已修复，SQLite 回归通过，PostgreSQL 本轮未重跑。** `dashboard` 聚合统一数值化，空值使用 COALESCE；现有跨方言测试继续由 CI 的两种数据库任务执行。
- **DEF-02：公开密码构建路径已移除。** Docker 前端只接受 `VITE_DEMO`，不再传入密码；生产构建只自动填账号。本轮检查构建产物；真实部署密码暴露检查未重跑。教学栈的 `SEED_DEMO` 与 `VITE_DEMO` 默认仍为 true，对外部署必须显式关闭并处理已存在的演示账号。
- **DEF-03：代码已修复，注入回归通过。** 网关覆盖客户端地址头，API 仅在配置后信任代理；默认忽略伪造转发头。限流仍为单实例内存计数。
- **DEF-04：测试镜像已复制 web 源码；容器构建与运行待复验。**
- **DEF-05：已有 POSIX 备份、恢复、部署和回滚脚本。** 本轮只运行 PowerShell 恢复控制流测试，未在 Linux 实际演练；`start.ps1` 作为 Windows 入口仍可使用 npm.cmd。
- **DEF-06：配置已修复并验证。** 两个不同项目名生成不同的 PostgreSQL 数据卷名。已有部署继续使用原来的项目名；改名会切换数据卷，不能误当作数据库丢失。
- **DEF-07：网关已阻断 Swagger/OpenAPI。** API 内部和开发入口仍注册文档；本轮未启动真实 Nginx 复验。
- **DEF-08：API 代理响应已隐藏重复安全头。** 本轮静态核对配置，未复验真实网关响应。
- **DEF-09：恢复后清理该 Compose 专用 Redis 数据库。** 清理失败时不启动 API；控制流测试通过，真实缓存恢复待复验。共享 Redis 场景不能照搬 FLUSHDB。
- **DEF-10：转储临时文件已在 finally/trap 中清理。** 清理采用尽力执行；Docker 故障时仍需人工检查容器残留。
- **DEF-11：外键索引和 PostgreSQL 迁移咨询锁已实现。** 本轮 SQLite 迁移通过，PostgreSQL 并发迁移未重跑。
- **DEF-12：本轮 npm audit 全量审计为 0。** 锁文件已有 concurrently 9.2.5 / shell-quote 1.12.0，未使用强制批量升级。
- **DEF-13：已有唯一版本部署脚本和部署历史。** 应使用 deploy.ps1/deploy.sh；直接使用默认 local 标签反复 build 仍会覆盖镜像，不能据此保证可回滚。真实版本切换本轮未演练。
- **DEF-14：部分完成。** 已有 Alertmanager 和 Prometheus 路由，默认 ops 接收器仍未配置邮件或 Webhook；仅能在本地界面查看告警，外部通知交付仍待部署方配置与验证。

旧设计中的 OBS-01（超时库存缓存失效）、OBS-02（部分退款通知）、OBS-06（删除默认地址）已有代码修复及自动回归。OBS-03（推荐权重归一化）、OBS-04（失败事件退避/重试上限）、OBS-05（控制器查询分层）仍待后续迭代，不能标为已完成。

## 本轮验证与边界

原始结果位于 [docs/evidence/2026-10-20](evidence/2026-10-20/)。测试数据库使用内存 SQLite，RabbitMQ 故障采用连接/通道替身，PowerShell 用 docker 函数替身检查五条控制流；没有恢复或覆盖真实数据库。

- `npm run typecheck`、`npm run build`：通过，见 typecheck.txt、build.txt。
- `npm test`：84/84 通过，其中 `runtime.test.ts` 新增 8 项；本轮行/分支/函数覆盖率为 96.54% / 88.39% / 91.91%，包含测试导入的前端搜索高亮模块，不代表前端整体覆盖率。
- Edge Playwright：9/9 通过，29.3 秒，见 e2e-local.txt、e2e-results.json；截图在 `docs/screenshots/2026-10-20/local/`。使用本地持久化 SQLite 开发服务，覆盖商城、下单至结算、售后、权限和交互；没有新增优惠券/秒杀的浏览器端用例。
- `scripts/test-restore.ps1`：5/5 通过；Compose 静态配置的两项目 PostgreSQL 数据卷名不同，见 restore-control-flow.txt、compose-isolation.json。
- `npm audit --json`：含开发依赖的已知漏洞总数为 0，见 npm-audit-full.json。这是本轮审计时点的结果，不替代镜像审计。

环境：系统 Node v24.12.0，npm 11.20.0；项目 `node` 依赖使 npm scripts 实际使用 Node v26.12.0。默认 5173 端口被已有 VS Code 进程占用且不返回 HTTP 响应，首次 E2E 启动未完成；没有修改该进程，改用 Vite 自动选择的 5174 启动后设置 `E2E_BASE_URL=http://127.0.0.1:5174`，最终九项通过。运行后停止了本轮独立启动的开发服务。

复现命令：

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm audit --json
.\scripts\test-restore.ps1
# 若默认端口被占用，先另开终端 npm run dev，再按 Vite 实际地址设置 E2E_BASE_URL；本轮为 5174。
$env:E2E_BASE_URL='http://127.0.0.1:5174'
$env:E2E_SCREENSHOT_DIR='docs/screenshots/2026-10-20/local'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME='docs/evidence/2026-10-20/e2e-results.json'
npm run test:e2e -- --reporter=list,json
```

本机 Docker CLI 可用，但 Docker Desktop Linux 引擎没有运行；本轮未执行 PostgreSQL、真实 Redis/RabbitMQ、完整容器栈、Prometheus 告警触发/恢复、Linux 运维和真实备份恢复。因此不以 SQLite 和故障替身的通过结果替代这些验收，也不沿用 10 月 18 日的测试数量和覆盖率。

后续按用户要求更新三套 Word/PDF，采用末尾追加修订补充的方式：需求追加 1 页，设计与测试各追加 2 页，PDF 总页数分别为 48、61、36。原有正文、表格、图片和样式不改写；原 140 页 PDF 的字节、绘图内容和文本完整保留。当前状态以文末 2026-10-20 补充为准，前文仍是 10 月 18 日历史基线。

Word 原有正文节点、节设置、样式与媒体资源逐项校验通过；新增补充文本与 PDF 提取文字一致，新增五页已渲染检查。Windows Word COM 在沙箱内外均返回 0x8007000E，未完成 Office 原生重排验证；补充页依据 Word 原样式渲染，PDF 使用增量方式追加，避免旧页面重排。详细结构校验见 `docs/evidence/2026-10-20/documents-update.json`；交付清单与文件校验值已同步。
