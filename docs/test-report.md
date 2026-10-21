# 鲜境 FreshMarket 系统测试报告

## 文档控制

| 项目 | 内容 |
| --- | --- |
| 文档编号 | FM-STR-001 |
| 文档名称 | 鲜境 FreshMarket 系统测试报告 |
| 版本 | 3.0 |
| 日期 | 2026-10-21 |
| 状态 | 正式稿 |
| 适用版本 | main 分支 8e6f264 及本轮数据库脚本、部署脚本修改 |
| 编制 | FreshMarket 测试组 |
| 审核 | ________ |
| 批准 | ________ |
| 关联文档 | FM-SRS-001 软件需求规格说明书；FM-SDD-001 系统设计说明书 |

修订记录：

| 版本 | 日期 | 修订内容 |
| --- | --- | --- |
| 1.0 | 2026-10-06 | 初稿 |
| 2.0 | 2026-10-18 | 基于 bb1bde2 全面测试，建立缺陷清单 DEF-01 至 DEF-14 |
| 3.0 | 2026-10-21 | 按当前代码重新执行测试；新增数据库脚本与运维脚本测试；更新缺陷状态 |

## 1. 概述

### 1.1 目的

本报告记录本轮系统测试的范围、环境、结果与缺陷，评估系统是否满足 FM-SRS-001 的需求，并给出发布建议。全部结论来自本轮实际执行的命令与原始输出（docs/evidence/2026-10-21/）；未执行的项目明确标注“未执行”，不以历史结果代替。

### 1.2 被测对象

| 项目 | 内容 |
| --- | --- |
| 被测版本 | 8e6f264 及工作区修改：database/schema.sql、database/seed.sql、scripts/export-seed.mjs，scripts 下 deploy、rollback、backup、restore、init-env 的 .sh 与 .ps1 版本 |
| 被测组件 | API（Fastify 5）、Web 前端（React 19 + Vite 7）、数据库脚本、运维脚本 |
| 部署形态 | 本地开发模式（Node 24 + SQLite），未启动 Docker 完整栈 |

### 1.3 测试周期

2026-10-21 02:00 至 03:30（UTC+8）。

### 1.4 结论摘要

- 类型检查与生产构建通过；API 自动化测试 87 项在 SQLite 上全部通过，行覆盖率 96.68%。
- 新增数据库脚本测试 3 项通过：schema.sql 与 seed.sql 可重复执行、与 seed.ts 一致、脚本建库可直接启动 API、每个外键列均有前导索引。
- 运维脚本控制流测试 .sh 19/19、.ps1 18/18 通过，覆盖部署失败自动退回、回滚镜像检查、备份校验、恢复前自动备份与失败不启动 API。
- 端到端测试 9 个用例在 3 轮完整执行中均至少通过一次，但没有一轮 9/9 全部通过；失败均由浏览器资源错误引起（DEF-15）。
- 依赖审计 0 项已知漏洞；本地 SQLite 商品列表 p95 20.07 ms，错误 0。
- 本机无 Docker 与 PostgreSQL，PostgreSQL 测试、完整栈部署、真实中间件与运维脚本实机演练未执行。
- 发布建议：可作为本机教学演示使用；对外部署前须在 PostgreSQL 与 Docker 完整栈上补测（见第 8 章）。

## 2. 测试环境

| 类别 | 内容 |
| --- | --- |
| 操作系统 | Windows 11（PowerShell 5.1.26100、Git Bash） |
| 运行时 | Node.js v24.15.0，npm 11.12.1，Node 内置 SQLite |
| 浏览器 | Microsoft Edge（Playwright 1.63.0，channel msedge） |
| 数据库 | 内存 SQLite（API 测试）、文件 SQLite（端到端与性能测试） |
| 不可用组件 | Docker、PostgreSQL、Redis、RabbitMQ（本机未安装） |

API 测试每个用例使用独立内存库；运维脚本测试在临时目录中运行脚本副本，docker 由替身代替，不触及真实容器与配置；端到端测试使用 `npm run dev` 启动的本地开发服务。

## 3. 测试范围与策略

### 3.1 测试层级

| 层级 | 内容 | 工具 |
| --- | --- | --- |
| 静态检查 | api 与 web 严格类型检查 | tsc |
| 构建 | API 编译、前端生产构建 | tsc、vite |
| 接口与集成 | 87 个 API 用例：账号、目录、搜索推荐、购物车、优惠券、秒杀、订单、售后、结算、Outbox、链路追踪、权限 | node:test + Fastify inject |
| 数据库脚本 | 脚本可执行性、幂等性、种子一致性、脚本建库启动、外键索引 | node:test + node:sqlite |
| 运维脚本 | 部署、回滚、备份、恢复的成功与失败分支 | scripts/test-ops.sh、scripts/test-ops.ps1 |
| 端到端 | 桌面/手机商城、下单至结算、售后、权限界面、交互回归 | Playwright |
| 性能 | 商品列表接口短时并发 | scripts/load-test.mjs |
| 安全 | 依赖漏洞审计；权限、限流、脱敏由 API 用例覆盖 | npm audit |

### 3.2 准入与准出准则

准入：依赖由 package-lock.json 经 `npm ci` 安装；被测代码固定为上述版本。

准出：所有自动化用例在 SQLite 与 PostgreSQL 上通过；端到端测试 9/9 通过；无未关闭的高级缺陷；运维脚本在实机完成备份、恢复、回滚演练；生产依赖无高危漏洞。本轮第一、二、四项未满足，见 8.1。

### 3.3 不在本轮范围

- PostgreSQL 测试、Docker 完整栈、真实 Redis/RabbitMQ、Prometheus 告警触发（本机无相应组件）。
- 真实支付与物流、长时间稳定性与容量、多节点高可用、渗透测试与镜像漏洞扫描。
- Firefox、WebKit 与真机移动设备（手机场景由 390px 视口模拟）。

## 4. 执行结果汇总

| 编号 | 测试项 | 结果 | 证据文件 |
| --- | --- | --- | --- |
| R01 | 类型检查（api + web） | 通过 | typecheck.txt |
| R02 | 生产构建 | 通过，JS 396.03 kB（gzip 122.33 kB），CSS 55.20 kB | build.txt |
| R03 | API 自动化测试 · SQLite | 87/87 通过，6.57 s；首轮 86/87，见 DEF-16 | api-tests-sqlite.txt |
| R04 | API 自动化测试 · PostgreSQL | 未执行（无 PostgreSQL） | — |
| R05 | 数据库脚本测试 | 3/3 通过（包含在 R03） | api-tests-sqlite.txt |
| R06 | 运维脚本 · POSIX sh | 19/19 通过 | ops-scripts-sh.txt |
| R07 | 运维脚本 · PowerShell 5.1 | 18/18 通过 | ops-scripts-ps1.txt |
| R08 | 端到端测试（3 轮） | 5/9、8/9、8/9；每个用例至少一轮通过（DEF-15） | e2e-local-run1.txt、e2e-local-run2.txt、e2e-local.txt |
| R09 | 性能 · 本地 SQLite | 200 次请求、并发 10：p95 20.07 ms，1474.53 次/秒，错误 0 | load-local-sqlite.json |
| R10 | 依赖漏洞审计（含开发依赖） | 0 项 | npm-audit-full.json |
| R11 | Docker 完整栈、中间件、实机运维演练 | 未执行 | — |

证据文件均位于 docs/evidence/2026-10-21/。

## 5. 详细测试结果

### 5.1 静态检查与构建

`npm run typecheck` 与 `npm run build` 退出码均为 0，无类型错误与体积告警。

### 5.2 API 自动化测试

执行 `npm test`，6 个测试文件共 87 个用例：

| 测试文件 | 用例数 | 覆盖内容 | 关联需求 | 结果 |
| --- | --- | --- | --- | --- |
| system.test.ts | 52 | 密码哈希、登录注册、RBAC、会员与员工分离、会话失效、账号管理、商品管理与删除、目录排序分页、模糊搜索、种子补充、购物车、地址、下单快照与运费、幂等、回滚、防超卖、重复支付、支付取消竞争、超时、越权、履约状态机、售后、评价、结算、Outbox、库存调整、健康检查与指标、登录限流 | FR-ACC、FR-CAT、FR-CART、FR-ADDR、FR-ORD、FR-AFS、FR-REV、FR-NTF、FR-ADM-*、FR-OPS、NFR-REL、NFR-SEC | 通过 |
| features.test.ts | 14 | W3C 链路贯穿 HTTP、SQL、审计与 Outbox；搜索联想与热搜；买了又买；猜你喜欢；优惠券分摊、领取、用券、退券与管理；秒杀限购、时间窗、并发名额与活动管理 | FR-SEARCH-REC、FR-PROM-COUPON、FR-PROM-SECKILL、NFR-OBS | 通过 |
| fixes.test.ts | 7 | 经营概览数值类型；会员级限流；TRUST_PROXY 下的限流隔离；超时取消后缓存失效；部分退款通知；删除默认地址后的默认迁移 | FR-ADM-DASH、NFR-SEC-04、FR-NTF、FR-ADDR | 通过 |
| runtime.test.ts | 8 | 消息通道断开重连、拓扑失败、通道错误、mandatory 退回、批次中断、负向确认、确认超时、依赖指标 | NFR-REL-04、NFR-AVL-01、FR-OPS-02 | 通过 |
| search-highlight.test.ts | 3 | 搜索高亮的字符匹配、Unicode 归一化与字面处理 | FR-CAT-08 | 通过 |
| database-scripts.test.ts | 3 | 见 5.3 | NFR-MNT-03 | 通过 |

覆盖率（含被测试引用的前端 search-highlight.ts）：

| 范围 | 行 % | 分支 % | 函数 % |
| --- | --- | --- | --- |
| 全部文件 | 96.68 | 88.67 | 91.91 |
| core/database.ts | 66.67 | 91.67 | 73.91 |
| core/runtime.ts | 91.80 | 69.74 | 67.44 |
| promotions/seckill.ts | 93.33 | 73.17 | 84.62 |

database.ts 未覆盖的部分是 PostgreSQL 分支，只有设置 TEST_DATABASE_URL 时才会执行；seckill.ts 未覆盖的是 Redis 令牌闸门，需要真实 Redis。

### 5.3 数据库脚本测试

| 编号 | 用例 | 方法 | 结果 |
| --- | --- | --- | --- |
| TC-DB-01 | schema.sql 与 seed.sql 可重复执行，数据与 seed.ts 一致 | 在文件库上依次执行 schema、schema、seed、seed，核对 6 分类、48 商品、6 账号、1 地址、3 优惠券、1 秒杀活动 | 通过 |
| TC-DB-02 | 脚本初始化的库可直接由 API 启动 | 在 TC-DB-01 的库上启动 API，迁移与种子后行数不变；演示会员以 Fresh@123456 登录成功；商品接口返回 48 款 | 通过 |
| TC-DB-03 | 每个外键列都有前导索引 | 遍历所有表的外键，核对存在以该列开头的索引（含主键与唯一约束） | 通过 |

设置 TEST_DATABASE_URL 后，TC-DB-01、TC-DB-02 在 PostgreSQL 临时 schema 中执行，本轮未执行。schema.sql 本轮只调整结构与注释，并新增两个索引（idx_refunds_status、idx_payments_created），表、列与约束保持不变；其余 84 个 API 用例在新脚本上全部通过。

### 5.4 运维脚本测试

`scripts/test-ops.sh` 与 `scripts/test-ops.ps1` 把脚本复制到临时目录执行，docker 命令由替身记录并按需返回失败。两套脚本的检查项相同，sh 版本多一项版本号格式校验。

| 脚本 | 检查项 | sh | ps1 |
| --- | --- | --- | --- |
| deploy | 健康时记录版本并写回 APP_VERSION | 通过 | 通过 |
| deploy | 构建失败时不启动服务、不改版本 | 通过 | 通过 |
| deploy | 健康检查失败时自动退回上一成功版本，不记录新版本 | 通过 | 通过 |
| deploy | 网关探测 /api/health 失败视为不健康 | 通过 | 通过 |
| deploy | 首次发布失败不退回，保留现场 | 通过 | 通过 |
| deploy | 拒绝非法版本号 | 通过 | 参数校验 |
| rollback | 默认回到上一个记录版本 | 通过 | 通过 |
| rollback | 任一镜像不存在时拒绝执行 | 通过 | 通过 |
| rollback | 无历史时要求显式指定版本 | 通过 | 通过 |
| backup | 校验转储可读并清理容器内副本 | 通过 | 通过 |
| backup | 转储不可读时失败且仍清理 | 通过 | 通过 |
| restore | 未确认（--yes / -Force）时不执行 | 通过 | 通过 |
| restore | 先备份当前库再恢复并启动 API | 通过 | 通过 |
| restore | 恢复前备份失败时不做任何改动 | 通过 | 通过 |
| restore | 可跳过恢复前备份 | 通过 | 通过 |
| restore | 停止 API、pg_restore、清空 Redis 任一失败时 API 保持停止（3 项） | 通过 | 通过 |
| restore | API 未恢复健康时报告失败 | 通过 | 通过 |

另对 init-env.sh 手工验证：生成 12 项配置、DEMO_PASSWORD 为 25 位，文件已存在时拒绝覆盖并以 1 退出。替身测试只验证控制流，不代表真实容器中的 pg_dump、pg_restore 与健康等待已演练。

### 5.5 端到端测试

执行 `npm run test:e2e`（Edge，本地开发服务），共 9 个用例，完整执行 3 轮：

| 用例 | 第 1 轮 | 第 2 轮 | 第 3 轮 |
| --- | --- | --- | --- |
| 桌面目录、本地图片、搜索与详情 | 失败 | 失败 | 通过 |
| 顶部导航与图标分类栏高亮同步 | 失败 | 通过 | 通过 |
| 手机商城可用且无横向溢出 | 失败 | 通过 | 通过 |
| 会员下单、支付、员工履约、收货、评价与结算 | 通过 | 通过 | 通过 |
| 会员售后与客服审核、审计可见 | 失败 | 通过 | 失败 |
| 仓库界面显示履约与库存、隐藏特权功能 | 通过 | 通过 | 通过 |
| 顶部配送地址选择器切换区域 | 通过 | 通过 | 通过 |
| 配送时段只标记所选项 | 通过 | 通过 | 通过 |
| 弹窗输入与部分退款提交 | 通过 | 通过 | 通过 |
| 合计 | 5/9 | 8/9 | 8/9 |

失败原因：第 1 轮与其他高负载任务并行，出现“浏览器上下文已关闭”和页面加载超时；第 2 轮为图片解码错误（EncodingError）；第 3 轮的跟踪记录显示开发服务的 style.css 请求返回 net::ERR_INSUFFICIENT_RESOURCES，员工登录页未渲染。“桌面目录”单独重跑 3 次均通过。本轮未修改前端与 API 业务代码，失败与浏览器在开发服务下的资源压力有关，登记为 DEF-15。截图输出到 docs/screenshots/。

### 5.6 性能测试

单进程 API、文件 SQLite、无 Redis，对 `GET /api/products?pageSize=12&sort=default` 发起 200 次请求、并发 10：平均 5.92 ms，p50 4.62 ms，p95 20.07 ms，p99 23.67 ms，吞吐 1474.53 次/秒，错误 0，满足 NFR-PERF-01（p95 < 500 ms）。该结果只说明本机短时表现，不代表生产容量。

### 5.7 安全测试

- `npm audit` 含开发依赖的已知漏洞 0 项。
- 权限与隔离由 API 用例验证：匿名、会员、越岗员工访问后台被拒绝；会员与员工不能使用对方入口；角色撤销、重置密码、停用与删除使旧令牌立即失效；他人订单一律 404；员工侧手机号脱敏。
- 限流：登录暴力尝试返回 429 且提示统一；会员级限流按验签后的令牌主体计数；未设置 TRUST_PROXY 时伪造 X-Forwarded-For 无法获得新限额，设置后按真实客户端分别计数。
- 注入：排序字段为固定枚举，搜索关键词参数绑定，% 与 _ 按字面匹配。
- 未执行：生产配置守卫在容器中的启动拒绝、网关安全头与文档屏蔽、前端产物凭据检查（需 Docker）。

## 6. 缺陷清单

严重级别：高——数据错误、凭据泄露或阻断发布；中——部署运维场景下功能不可用或明显风险；低——特定条件下出现或可运维性不足。

| 编号 | 标题 | 级别 | 当前状态 |
| --- | --- | --- | --- |
| DEF-01 | 经营概览在 PostgreSQL 上返回字符串与 NULL | 高 | 已修复；SQLite 回归通过，PostgreSQL 待复验 |
| DEF-02 | 演示密码构建进公开前端代码 | 高 | 已修复；前端构建只接收 VITE_DEMO，不再接收密码；部署产物待复验 |
| DEF-03 | 网关后限流全体用户共享限额 | 中 | 已修复；网关覆盖客户端地址，API 仅在 TRUST_PROXY 时信任代理，回归通过 |
| DEF-04 | 容器化测试镜像缺少 web 源码 | 中 | 已修复；容器内运行待复验 |
| DEF-05 | 运维脚本只有 PowerShell 版本 | 中 | 已修复；.sh 与 .ps1 行为一致，控制流测试通过，实机演练待执行 |
| DEF-06 | Compose 项目名固定，多套部署共用数据卷 | 低 | 已修复；init-env 生成独立 COMPOSE_PROJECT_NAME |
| DEF-07 | 生产网关公开 Swagger 与 OpenAPI | 低 | 已修复；网关返回 404，待实机复验 |
| DEF-08 | 安全响应头重复且冲突 | 低 | 已修复；网关隐藏 API 同名头，待实机复验 |
| DEF-09 | 恢复后缓存返回旧数据 | 低 | 已修复；恢复流程清空 Redis，失败不启动 API |
| DEF-10 | 转储文件遗留在数据库容器中 | 低 | 已修复；备份与恢复在 trap/finally 中清理 |
| DEF-11 | 外键列缺少索引，迁移无并发锁 | 低 | 已修复；TC-DB-03 验证外键索引，PostgreSQL 迁移使用咨询锁 |
| DEF-12 | 开发依赖存在严重级安全公告 | 低 | 已修复；本轮审计 0 项 |
| DEF-13 | 镜像标签固定，无可回滚旧镜像 | 低 | 已修复；deploy 生成唯一版本，失败自动退回上一成功版本 |
| DEF-14 | 告警没有外部接收端 | 低 | 部分修复；Alertmanager 已接入，外部通知渠道由部署方配置 |
| DEF-15 | 端到端测试在本机开发服务下不稳定 | 低 | 新增；未关闭 |
| DEF-16 | 注册接口偶发 500 | 低 | 新增；未复现 |

DEF-15：Edge 在 Vite 开发服务下加载大量未打包模块时出现 ERR_INSUFFICIENT_RESOURCES 与图片解码错误，导致 1 至 4 个用例超时。建议端到端测试改为针对生产构建（vite preview 或 Docker 网关）执行，并在 CI 中保留失败重试与跟踪文件。

DEF-16：首轮 `npm test`（与端到端测试、文档生成等任务并行）中“registration rejects role injection and creates members only”的第二次注册返回 500；随后单独执行 3 次、完整执行 7 次均通过，未能复现，测试输出未保留服务端错误栈。建议在测试中对 500 响应打印响应体与日志，持续观察。

## 7. 需求覆盖与未覆盖风险

### 7.1 需求覆盖

| 需求 | 覆盖方式 | 本轮结论 |
| --- | --- | --- |
| FR-ACC、FR-ADM-USR | API 用例、端到端 | 通过 |
| FR-CAT、FR-SEARCH-REC | API 用例、高亮单元测试、端到端 | 通过（端到端见 DEF-15） |
| FR-CART、FR-ADDR | API 用例、端到端 | 通过 |
| FR-PROM-COUPON、FR-PROM-SECKILL | API 用例 | 通过；Redis 令牌闸门未覆盖；无浏览器端用例 |
| FR-ORD、FR-AFS、FR-REV、FR-NTF | API 用例、端到端 | 通过 |
| FR-ADM-DASH、PRD、STK、ORD、AFS、SET、AUD | API 用例、端到端 | 通过 |
| FR-OPS | API 用例（健康、指标、OpenAPI、链路追踪） | 通过 |
| NFR-REL、NFR-SEC、NFR-PRIV | API 并发、竞争、越权、限流用例 | SQLite 通过；PostgreSQL 未执行 |
| NFR-PERF-01 | 负载脚本 | 通过 |
| NFR-DEP-01 至 03 | 运维脚本控制流测试 | 通过；实机演练未执行 |
| NFR-MNT-03 | 数据库脚本测试 | 通过（SQLite） |
| NFR-REL-05、NFR-AVL、NFR-OBS-02、NFR-DEP-04 | 需要 PostgreSQL 或 Docker 完整栈 | 未执行 |

### 7.2 未覆盖风险

- 两种数据库差异：本轮只在 SQLite 上执行，PostgreSQL 特有的行锁、咨询锁和类型转换未验证；CI 的 PostgreSQL 任务是唯一保障。
- 运维脚本实机行为：docker compose `--wait` 的健康等待、pg_dump/pg_restore 与 Redis 清理只在替身中验证了调用顺序与退出码处理。
- 营销功能的浏览器端交互（领券、秒杀倒计时）没有端到端用例。
- Redis 秒杀令牌、RabbitMQ 发布确认只有单元替身测试，无真实中间件故障演练。

## 8. 结论与发布建议

### 8.1 准出准则核对

| 准则 | 结论 |
| --- | --- |
| 自动化用例在两种数据库上通过 | 未满足：SQLite 通过，PostgreSQL 未执行 |
| 端到端测试 9/9 通过 | 未满足：单轮最好 8/9（DEF-15） |
| 无未关闭的高级缺陷 | 满足：DEF-01、DEF-02 已修复，待 PostgreSQL 与部署产物复验 |
| 运维脚本实机演练 | 未满足：仅完成控制流测试 |
| 生产依赖无高危漏洞 | 满足 |

### 8.2 结论

核心业务、营销、权限与数据一致性在 SQLite 上全部通过自动化验证；本轮重写的数据库脚本与运维脚本通过新增测试。由于缺少 PostgreSQL 与 Docker 环境，且端到端测试存在环境性不稳定，本轮不满足对外发布的准出准则。

### 8.3 发布建议

1. 本机教学演示：可以使用。
2. 对外部署前：在 CI 或具备 Docker 的主机上执行 PostgreSQL 测试、`sh scripts/deploy.sh` 完整部署、端到端测试，以及备份、恢复、回滚实机演练，并复验 DEF-01、02、04、05、07、08。
3. 部署时设置 SEED_DEMO=false、VITE_DEMO=false，为 Alertmanager 配置外部通知渠道（DEF-14）。

## 附录 A 复现命令

```bash
npm ci
npm run typecheck
npm test                                   # SQLite
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/db npm test   # PostgreSQL（本轮未执行）
npm run build
sh scripts/test-ops.sh
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ops.ps1
npm run test:e2e
npm audit --json
# 性能：另开终端启动 API（npm run dev -w api），再执行
npm run load
```

## 附录 B 证据文件索引

| 文件（docs/evidence/2026-10-21/） | 内容 |
| --- | --- |
| environment.txt | 执行时间、Node 与 npm 版本、基线提交 |
| typecheck.txt、build.txt | 类型检查与构建输出 |
| api-tests-sqlite.txt | API 测试与覆盖率输出 |
| ops-scripts-sh.txt、ops-scripts-ps1.txt | 运维脚本控制流测试输出 |
| e2e-local-run1.txt、e2e-local-run2.txt、e2e-local.txt | 端到端测试 3 轮输出 |
| e2e-results-run1.json、e2e-results-run2.json、e2e-results.json | 端到端测试 JSON 结果 |
| load-local-sqlite.json、load-local-sqlite.log | 性能测试结果 |
| npm-audit-full.json | 依赖审计结果 |

2026-10-18 的 Docker 完整栈、PostgreSQL 与实机运维演练记录保存在 docs/evidence/2026-10-18/，对应提交 bb1bde2，不作为本轮结论依据。
