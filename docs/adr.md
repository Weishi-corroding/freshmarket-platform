# 架构决策记录

| ADR | 决策 | 采用理由 | 替代与限制 | 证据 |
| --- | --- | --- | --- | --- |
| 001 | 模块化单体+独立React工程 | 实验闭环在单数据库事务中更易验证；职能模块仍可拆分 | 微服务需服务发现、跨服务事务；本期不引入（单体内链路追踪见ADR-011） | api/src/modules、web/src |
| 002 | TypeScript/Fastify | 本机已有Node24，前后端易复现；JSON Schema与OpenAPI成熟 | 教材Java/若依作为参考；不是原教材代码复制 | 需求文档及依赖锁文件 |
| 003 | PostgreSQL部署、SQLite本地开发 | 主部署具备行锁与连接池；本地无需Docker先行即可演示 | SQLite不宣称生产并发能力；PG路径需独立验证 | database.ts、TEST_DATABASE_URL测试入口 |
| 004 | 条件扣库存+用户/订单行锁 | 将防超卖、重复下单、付款取消竞争限制在同事务中 | Redis预扣/分布式锁不作为账务依据 | 并发争抢及付款取消测试 |
| 005 | 事务Outbox+RabbitMQ | 不要求数据库与MQ分布式提交；消费去重处理重复投递 | 不是跨数据库Saga/TCC；处理失败进入DLQ | runtime.ts、Outbox失败重试测试 |
| 006 | Redis商品读缓存 | 高频读可缓存，库存/价格下单时仍读取数据库 | 缓存30秒内可短暂落后，失效故障不阻断业务 | CatalogService与共享版本 |
| 007 | JWT主体+请求时读取RBAC | 修改权限不等待JWT过期；注册永远会员 | 无refresh token、SSO或OAuth登录 | role revocation测试 |
| 008 | 生鲜已发货不回库存 | 退款商品存在冷链与品质风险，避免重新销售 | 未建立批次与损耗账；本期整单售后一次 | 已配送退款不回库存测试 |
| 009 | 已收货且无售后才结算 | 退款与结算锁同订单；避免当前沙箱账务重复 | 已结算后售后人工处理；多商家账务未实现 | 重复结算与售后冻结测试 |
| 010 | Docker Compose+Nginx+指标 | 符合实验复现、监控和运维要求，依赖外置配置 | Kubernetes/多区域HA/TLS证书属于后续生产工程 | compose、infra、运维脚本 |
| 011 | OpenTelemetry手动埋点+W3C traceparent | 在统一Query层埋点，SQLite/PostgreSQL都有SQL span；traceId贯穿响应、日志、审计与Outbox异步链路 | 未用自动埋点（node:sqlite无插件、ESM需预加载）；Jaeger内存存储仅教学部署 | tracing.ts、features测试、Jaeger验证 |
| 012 | 推荐基于SQL统计与现有模糊搜索 | 48款商品规模下共购统计与品类偏好可解释、可测试，无需离线训练 | 未引入Elasticsearch或机器学习模型；热搜按搜索日志计数，无防刷 | CatalogService、search_logs |
| 013 | 优惠券按行分摊+条件核销 | 部分退款按分摊扣回，退款不超过实付；每人一张由唯一约束保证，发放量条件更新防超发 | 一单仅用一张券，不支持叠加；整单退款退券，部分退款不退 | coupons.ts、退款分摊测试 |
| 014 | 秒杀名额与库存双条件扣减+Redis令牌闸门 | 数据库保证不超卖与每人限购；Redis只削峰，故障时回落数据库 | 取消释放的名额最多60秒后在闸门可见；未做排队异步下单 | seckill.ts、并发抢购测试 |

版本策略：npm以package-lock锁定；容器使用明确版本标签或受维护大版本补丁通道；公网发布前应记录digest并重做依赖/镜像扫描。Prometheus与RabbitMQ版本在2026-10-06参照官方生命周期更新，见设计文档参考链接。
