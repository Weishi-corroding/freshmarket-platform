# 实验四企业级能力专项检查

检查日期：2026年10月12日。代码提交：`06ceed2cc5c334ce01e7c8fe818cf179c389201b`。

依据用户截图中第4部分的六类能力。原文要求“至少覆盖多项，并有截图、代码、文档或测试报告证明”，并非要求实现清单中的每一种技术。

结论：六类均有覆盖，安全与核心业务一致性的实现相对完整；性能证据仅支持小规模短时查询。进一步复核发现恢复脚本、消息通道重连、代理后的限流、依赖健康监控存在具体问题，消息不可路由时还存在投递安全缺口。已有正常流程测试通过，不能替代这些异常路径检查。

本次只检查，没有修改业务源码、部署脚本或既有交付文档。专项脚本、报告和结果均保存在Git忽略的 `.runtime/audit-20261012/`。所有新增运行检查采用独立内存SQLite、显式故障替身或PowerShell命令替身；没有连接或破坏真实部署数据。

## 状态和证据说明

- 已实现并验证：存在代码，且同会话测试或保存的测试证据覆盖该能力。
- 已实现但验证有限：代码存在，缺少专项或真实故障验证。
- 仅方案：文档说明后续做法，当前没有运行配置或实测结果。
- 缺失：当前没有相应实现。
- 存在问题：本次隔离复核重现控制流或状态问题；不等同于已在真实Docker组件上重现故障。

## 安全逐项核查

| 条目 | 状态 | 代码和证据 | 结论与边界 |
| --- | --- | --- | --- |
| OAuth2/JWT | JWT已实现并验证 | api/src/app.ts:41；账号登录测试 | JWT有效期2小时；请求校验主体并从数据库重读角色。未实现OAuth2，不影响JWT这一选项的覆盖 |
| RBAC | 已实现并验证 | core/security.ts的角色能力矩阵；app.ts的permit；T04、T24；后台权限截图 | 服务端拦截和前端菜单控制均有；角色撤销会影响旧JWT |
| 密码哈希 | 已实现并验证 | core/security.ts的scryptSync、随机盐、timingSafeEqual；T01 | 不保存明文密码 |
| HTTPS | 仅方案 | infra/nginx.conf:3仅listen 80；docs/deployment.md:61 | 无TLS监听、证书配置或HTTPS运行证据；当前教学部署默认仅本机HTTP |
| 防越权 | 已实现并验证 | 地址/订单所有权条件；T17、T26；真实403截图 | 覆盖订单读取、付款、取消、退款及地址修改的跨用户访问 |
| 防SQL注入 | 已实现并验证 | database.ts参数绑定；catalog排序白名单；T05 | 用户输入参数化，排序不能直接拼入任意SQL |
| XSS | 基础实现，专项验证不足 | web/src/Shop.tsx:22将描述、评价作为React文本节点；无dangerouslySetInnerHTML；Nginx CSP/Helmet | 可确认基础文本转义与安全头；现有测试没有专门的存储型/反射型攻击回归，不能宣称全面防护已验收 |
| CSRF | 有基础设计，专项验证不足 | web/src/api.ts手动附加Bearer；令牌在sessionStorage；CORS限定origin且credentials:false | 业务认证不依赖浏览器自动附带的认证Cookie，降低传统CSRF条件；未提供专门的跨站攻击测试 |
| 接口限流 | 已实现，但代理场景有问题 | app.ts:33、42；accounts/controller.ts:12；nginx.conf:17 | Nginx按客户端地址限流；API默认按req.ip限流，但未配置可信代理与地址透传，详见问题3 |
| 敏感数据脱敏 | 已实现并验证，范围有限 | security.ts的maskPhone；admin/controller.ts:28、31；T27 | 员工订单响应移除原始地址快照并遮蔽手机号；账号响应排除password_hash。该结果不代表任意自由文本和全部未来字段都自动脱敏 |
| 审计日志 | 已实现并验证 | OrderRepository.audit；T25、T27；审计截图 | 记录操作人、动作、实体、详情、traceId和时间；无独立审计存储防篡改验收 |

## 数据一致性逐项核查

| 条目 | 状态 | 代码和证据 | 结论与边界 |
| --- | --- | --- | --- |
| 事务 | 已实现并验证 | database.ts:34、59；OrderService；T07、T11、T14 | PostgreSQL BEGIN/COMMIT/ROLLBACK；SQLite BEGIN IMMEDIATE与串行互斥；多商品失败整体回滚 |
| 索引 | 已实现 | database/schema.sql:13、29、30、58、68及主键/唯一约束 | 商品分类、订单用户/时间、过期状态、Outbox状态和审计时间有索引；缺少大数据量执行计划证据 |
| 连接池 | 已实现 | database.ts:29 | PostgreSQL池max=15、连接超时5秒、空闲30秒；没有池耗尽专项验收 |
| 分页 | 已实现并验证 | core/http.ts；Catalog/Orders/Admin路由；T05 | 页大小1–100，返回items/total/page/pageSize；不是无限制全表接口 |
| 库存防超卖 | 已实现并验证 | orders/service.ts:20；schema库存CHECK；T11、T12 | 条件UPDATE扣库存，失败回滚；最后3件争抢测试通过 |
| 幂等 | 已实现并验证 | orders/service.ts:11；订单/付款/退款/结算唯一约束；T09、T10、T13、T15、T19、T22 | 同key同请求返回原单，冲突409；付款、取消、退款和结算避免重复影响 |
| 分布式事务策略 | Outbox策略已实现，存在消息安全缺口 | repo.emit与业务同事务；runtime.ts:45、53；T23及10月6日真实链路8项证据 | 本地消息表、发布确认、消费去重和ack已实现；不是跨数据库Saga/TCC。未路由消息处理与channel单独关闭恢复不完整，详见问题2 |

订单、库存、付款和结算都在单一业务数据库中；当前消息消费主要产生订单通知。因此发现的MQ投递缺口影响事件与通知的最终完成，不能扩大表述为已经发生真实资金或库存丢失。

## 性能逐项核查

| 条目 | 状态 | 代码和证据 | 结论与边界 |
| --- | --- | --- | --- |
| Redis缓存 | 已实现并有历史真实验证 | CatalogService.list；runtime.ts:41–44；infra-smoke.json第2、3项 | 商品查询30秒TTL、共享版本失效；本次注入缓存读写失败后仍成功回源，返回24商品中的12条；不代表已验证真实Redis断线恢复 |
| 异步处理 | 已实现 | Runtime两秒轮询Outbox，RabbitMQ异步消费者 | 业务事务后处理通知；发布批次上限20，未提交高负载积压测试 |
| 消息队列 | 已实现并有历史真实验证 | 持久化exchange/queue/message、ConfirmChannel、prefetch、消费ack、DLQ | 10月6日实物链路8项通过；不能据此断言所有故障场景可靠 |
| CDN | 缺失 | Nginx只有本地静态资源缓存与gzip | expires/Cache-Control属于浏览器缓存，不是CDN |
| 连接池 | 已实现 | PostgreSQL pool配置 | 同上，未做容量和耗尽验证 |
| 压测报告 | 指标齐全，覆盖有限 | scripts/load-test.mjs；docs/evidence/load-test.json | QPS 1193.47、平均RT 7.56ms、p95 17.34ms、错误率0%；200请求、并发10、总时长0.167578秒，SQLite且无Redis。仅支持本地短时商品查询目标，不能作为持续峰值、写入闭环或完整PG/Redis/MQ部署容量证据 |

API全局限制为每IP每分钟300次。部署于同一Nginx后又存在IP合桶问题，因此上面的短时突发QPS不能外推为长期业务吞吐。应先修正代理身份，再在约定的限流策略下做持续测量，分开记录成功请求和429。

## 可靠性逐项核查

| 条目 | 状态 | 代码和证据 | 结论与边界 |
| --- | --- | --- | --- |
| 日志 | 已实现 | Fastify结构化日志、UUID请求id、响应traceId、审计日志 | Authorization和密码字段有日志脱敏配置；尚无集中日志检索/保存期限验收 |
| 监控 | 已实现并有历史截图，依赖健康覆盖不足 | app.ts指标、Prometheus采集、Grafana面板 | 有QPS、p95、5xx、RSS、事件循环指标；“API健康”只显示metrics scrape的up，详见问题4 |
| 告警 | 有规则，未形成完整通知闭环 | infra/alerts.yml；prometheus.yml | 已装载API掉线、5xx、p95规则；无Alertmanager/外部通知接收器，无真实触发—通知—恢复证据 |
| 健康检查 | 已实现，但状态判断有缺口 | app.ts:64；Compose依赖healthcheck | DB探测SELECT1失败会返回500；缓存/MQ异常允许业务降级；MQ的channel引用不能证明通道仍可用 |
| 熔断 | 缺失 | 未见独立熔断状态机、失败阈值、半开探测实现 | 缓存异常catch和固定周期重连不等同于熔断 |
| 降级 | 已实现并完成局部故障注入 | cacheGet/cacheSet失败回源；MQ不可用保留Outbox | 本次缓存操作故障时商品接口200；MQ配置存在但无连接时不偷偷切换消费方式 |
| 重试 | 部分实现，存在缺口 | Outbox pending重试、60秒处理租约、30秒重连 | 本次过期processing租约可恢复并消费一次；但channel单独关闭时不触发重连。缺少退避、次数/积压告警及真实故障演练 |
| 备份恢复 | 脚本存在，恢复控制流有问题 | scripts/backup.ps1、restore.ps1；问题1 | 未实际演练备份可恢复性、数据比对或RPO/RTO；不能以脚本文件存在标记为恢复验收通过 |

## 工程化逐项核查

| 条目 | 状态 | 代码和证据 | 结论与边界 |
| --- | --- | --- | --- |
| Git分支规范 | 有文档，实践证据不足 | docs/deployment.md:69 | 规定main/feature/fix和提交类型；当前本地及已知远端仅main、一个提交，无法由此证明完整分支评审流程 |
| 代码规范 | 基础类型约束，统一风格不足 | TypeScript配置、模块目录 | 未见ESLint/Prettier/Biome配置或lint/format门禁；类型通过不等同代码风格统一 |
| 静态检查 | 已实现并验证 | npm run typecheck与CI | 前后端TypeScript检查通过；无单独静态安全分析门禁 |
| 单元测试 | 有 | scrypt校验等纯函数断言 | 28项测试中的大部分是接口/集成场景，不应把28项全部称为纯单元测试 |
| 集成测试 | 已实现并验证 | Fastify inject＋真实DB适配器；CI两套DB测试 | 同会话SQLite28/28；当前提交远端PostgreSQL测试步骤成功；历史实物组件另有8项 |
| E2E | 已实现并验证 | e2e/shopping.spec.ts；同会话5/5及远端CI | 覆盖桌面/手机、购物闭环、售后、仓库权限；未覆盖本次新发现的故障路径 |
| 覆盖率 | 有报告，未设阈值 | Node实验性coverage；历史JSON；同会话运行输出 | 同会话SQLite行88.50%、分支80.63%、函数83.13%；CI没有最低覆盖率门禁；不同Node版本统计不宜直接比较高低 |
| OpenAPI | 已实现并验证 | swagger、swagger-ui；/api/openapi.json；T27；接口截图 | 有路径、请求Schema和Bearer定义；大量响应没有完整schema，不能据此声称可直接生成完全准确的响应类型 |
| CI/CD | CI已实际通过，CD缺失 | .github/workflows/ci.yml；远端运行链接 | 自动安装、类型、测试、构建、E2E、Compose配置验证和证据上传已成功；没有镜像发布、环境审批、自动部署与上线健康门禁 |
| Docker化 | 已实现并有历史运行证据 | 三份Dockerfile、Compose七服务、运行截图 | 本次环境无可用docker命令，未重跑完整栈；CI仅检查Compose配置，不能当作完整栈启动验收 |
| 配置分离 | 基本实现 | .env.example、初始化脚本、环境变量、Docker环境 | 私有配置不入Git，生产参数有最低校验；Compose强制演示账号/前端演示开关，不是独立正式生产配置 |

当前提交的[GitHub Actions运行](https://github.com/Weishi-corroding/freshmarket-platform/actions/runs/38186876585)已核实成功，包含SQLite、PostgreSQL、构建、Chromium E2E与Compose配置检查。该事实已在本次会话前一轮检查中直接从GitHub API确认；本轮未重复运行通过的基础测试。

## 运维部署逐项核查

| 条目 | 状态 | 代码和证据 | 结论与边界 |
| --- | --- | --- | --- |
| dev/test/prod区分 | dev/test/demo已区分，prod只有扩展方案 | docs/deployment.md:7–12；test schema隔离；compose.yaml | NODE_ENV=production触发配置校验，但演示Compose仍强制SEED_DEMO=true及VITE_DEMO=true；不能当作已完成正式生产环境 |
| 部署架构图 | 已交付 | docs/diagrams/architecture.png及设计文档 | 前端、网关、API、DB、缓存、队列和监控关系清楚 |
| 回滚方案 | 文档和脚本存在，实测不足 | rollback.ps1检查旧镜像并用no-build替换；部署手册 | 已说明数据库迁移兼容限制；无实际版本切换/数据兼容/健康确认演练 |
| 容器或云部署 | 容器教学部署有历史证据 | 七容器运行状态、健康和Grafana截图 | 没有云部署不构成缺项；容器部署是原文允许的选项 |

## 需要优先修复的具体问题

### 问题1 恢复前停止API失败仍继续恢复

位置：[restore.ps1第5行](D:/Codes/AI辅助软件开发实践/freshmarket-platform/scripts/restore.ps1:5)、[第10行](D:/Codes/AI辅助软件开发实践/freshmarket-platform/scripts/restore.ps1:10)。

脚本检查了复制与pg_restore的退出码，却没有检查stop api和start api。当前PowerShell的PSNativeCommandUseErrorActionPreference为false，ErrorActionPreference=Stop不会自动把任意原生命令非零退出码转成终止异常。

使用进程内docker命令替身执行原脚本：模拟stop返回1后，仍继续cp、pg_restore、start，并输出“Database restored and API restarted”；另一次模拟start返回1，同样打印成功。没有执行真实Docker或数据库恢复。

影响：停止失败时可能在应用仍写数据库期间恢复；启动失败时可能误报恢复完成。优先补齐两处退出码检查，成功后验证健康；再用独立测试数据库做备份—恢复—代表性订单比对。

证据：[恢复脚本控制流结果](D:/Codes/AI辅助软件开发实践/freshmarket-platform/.runtime/audit-20261012/restore-control-flow-probe.json)。

### 问题2 消息通道恢复与不可路由消息处理不完整

位置：[runtime.ts第25行](D:/Codes/AI辅助软件开发实践/freshmarket-platform/api/src/core/runtime.ts:25)、[第26行](D:/Codes/AI辅助软件开发实践/freshmarket-platform/api/src/core/runtime.ts:26)、[第67行](D:/Codes/AI辅助软件开发实践/freshmarket-platform/api/src/core/runtime.ts:67)。

连接broker有error/close监听，但ConfirmChannel没有相应监听。只有broker close才清空this.channel；若连接还在而channel单独关闭，重连条件仍为假。故障替身触发channel.close后，重新调用connect没有建立新连接，health仍返回queue=connected，随后发送失败只把Outbox改回pending。

此外publish没有mandatory=true和return处理，确认回调成功就把Outbox标记sent。若队列或绑定被移除而exchange仍存在，消息不可路由也可能被RabbitMQ确认，当前代码无法据此保留或重试消息。[RabbitMQ官方确认语义](https://www.rabbitmq.com/docs/confirms)及[不可路由消息说明](https://www.rabbitmq.com/docs/publishers)支持这一判断。

本次以发布确认替身验证了“确认回调即可标sent”的代码边界，并未运行真实Broker删队列实验；消息丢失是由代码与官方协议语义推出的条件性风险，不能表述为本次已在真实RabbitMQ观测到丢消息。

建议：处理channel error/close、初始化失败和消费者取消；清理失效引用并重建拓扑/消费者；使用mandatory和return关联messageId，在确认可路由后再标记sent。随后对独立队列执行通道关闭、队列/绑定缺失和恢复后的消费去重验证。

证据：[隔离运行结果](D:/Codes/AI辅助软件开发实践/freshmarket-platform/.runtime/audit-20261012/enterprise-probes.json)中的channel_only_closure_reconnection和publisher_confirmation_boundary。

### 问题3 经过Nginx的不同用户共用API限流桶

位置：[app.ts第33行](D:/Codes/AI辅助软件开发实践/freshmarket-platform/api/src/app.ts:33)、[nginx.conf第20行](D:/Codes/AI辅助软件开发实践/freshmarket-platform/infra/nginx.conf:20)。

Fastify未设置可信代理，Nginx也没有覆盖并转发经过确认的客户端地址。已安装的@fastify/rate-limit默认keyGenerator为req.ip，因此经同一代理建立的连接在API看来来自同一地址。

Fastify注入11个不同X-Forwarded-For客户端、相同代理remoteAddress：前10次错误密码登录为401，第11个新客户端被429；换成不同的真实remoteAddress则仍为401。证明不同转发客户端共用配额。Nginx自身按客户端IP限流，不能消除后端合桶问题。

影响：普通用户可能因其他人的请求被限流；压测的全局300次/分钟配额也会由所有代理用户共享。应在Nginx覆盖客户端地址头并仅信任确定的代理来源，或针对端点设计适当身份维度；不能直接信任任意外部X-Forwarded-For。

证据：enterprise-probes.json中的reverse_proxy_rate_limit_identity。

### 问题4 监控健康值没有反映数据库或消息依赖故障

位置：[prometheus.yml第7行](D:/Codes/AI辅助软件开发实践/freshmarket-platform/infra/prometheus.yml:7)、[Grafana面板](D:/Codes/AI辅助软件开发实践/freshmarket-platform/infra/grafana/dashboards/freshmarket.json)、[app.ts第64行](D:/Codes/AI辅助软件开发实践/freshmarket-platform/api/src/app.ts:64)。

当前“API健康”和API掉线告警使用up，而Prometheus抓取的是/api/metrics，并非/api/health。注入数据库健康查询故障时，/api/health为500而/api/metrics仍为200。由采集配置可知，metrics可访问时up仍可为1；该值证明采集可达，不证明业务数据库正常。本次没有启动真实Prometheus来演练告警。

另有channel引用失效仍报告queue=connected的问题。现有指标未覆盖依赖可用性、Outbox最旧积压时间或死信数量。已有5xx/延迟规则仍然有价值，但无用户流量时不能替代依赖健康告警。

建议：将采集可达与业务就绪分开命名；增加依赖健康和Outbox积压指标或外部健康探测，关联告警，并完成一次触发/恢复验证。

## 验证材料与复现

本次新增Node检查共6项观察：代理限流身份、Redis操作失败回源、Outbox过期租约恢复、数据库健康与指标采集差异、发布确认边界、channel单独关闭重连。PowerShell检查覆盖stop失败与start失败两种控制流。它们分别保存为：

- [Node检查脚本](D:/Codes/AI辅助软件开发实践/freshmarket-platform/.runtime/audit-20261012/enterprise-probes.mjs)
- [Node检查结果](D:/Codes/AI辅助软件开发实践/freshmarket-platform/.runtime/audit-20261012/enterprise-probes.json)
- [恢复控制流检查脚本](D:/Codes/AI辅助软件开发实践/freshmarket-platform/.runtime/audit-20261012/restore-control-flow-probe.ps1)
- [恢复控制流检查结果](D:/Codes/AI辅助软件开发实践/freshmarket-platform/.runtime/audit-20261012/restore-control-flow-probe.json)

Node检查使用本次会话已经编译的api/dist，源码未变更；运行时为捆绑Node24.19.0。脚本只操作内存数据库并恢复进程内amqp.connect替身；PowerShell脚本在单独进程中用函数遮蔽docker，没有实际恢复数据库。

同会话前轮已通过SQLite28项、Edge5项、类型检查与生产构建；本轮未重复执行这些已经通过且源码未变的检查。真实PostgreSQL/Redis/RabbitMQ故障恢复、TLS、长时压测、备份恢复及版本回滚演练仍需在独立测试部署中完成。现有10月6日组件证据与本次故障替身结果必须分别标注。
