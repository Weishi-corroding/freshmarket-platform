# 鲜境 FreshMarket 企业级生鲜购物平台

依据《实验四：【项目实战】企业级应用——XX商城系统》与教材第九章设计，参考盒马的生鲜选购体验。包含独立 React 商城、员工运营后台和真实持久化 API；金额以整数“分”存储，支付与配送为实验沙箱。

## 本机快速启动

需要 **Node.js 24+**，无需先安装数据库。Windows 在项目目录执行：

```powershell
.\start.ps1
```

也可执行：

```bash
npm ci
npm run dev
```

| 入口 | 地址 |
| --- | --- |
| 顾客商城 | http://localhost:5173 |
| 员工登录 | http://localhost:5173/admin/login |
| 运营工作台 | http://localhost:5173/admin |
| Swagger 接口文档 | http://localhost:3001/api/docs |
| 健康检查 | http://localhost:3001/api/health |
| 本地监控指标 | http://localhost:3001/api/metrics |

本地开发模式使用 `api/.runtime/freshmarket.sqlite`，数据在重启后保留。需要修改配置时，将 `.env.example` 复制为 `.env`。开发模式适合演示和调试，完整部署使用 PostgreSQL。

演示商品共 48 款，时令水果、海鲜水产、肉禽蛋品、新鲜蔬菜、乳品烘焙、方便速食各 8 款。默认开启演示数据时，启动 API 会自动补入缺少的商品，保留已有商品的价格、库存、上下架状态及订单；设置 `SEED_DEMO=false` 时不执行补充。

## 演示账号

| 账号 | 身份 | 权限 |
| --- | --- | --- |
| member | 会员 | 购物、地址、个人订单、收货、售后、评价 |
| operator | 运营 | 商品维护、上下架、订单查看、经营概览 |
| warehouse | 仓库 | 库存调整、订单拣货及配送 |
| support | 客服 | 售后审核、订单查看 |
| finance | 财务 | 已完成订单结算、经营概览 |
| admin | 管理员 | 全部后台能力、角色分配及审计 |

**本地默认密码：`Fresh@123456`**。商城登录弹窗只提供会员账号；运营、仓库、客服、财务及管理员统一从 `/admin/login` 登录。Docker 模式使用生成的 `.env.docker` 中的 `DEMO_PASSWORD`；开发与 Docker 数据彼此独立。

会员与员工分别保存登录会话，可在同一浏览器中分别登录、分别退出。员工控制台使用独立布局，员工账号无法调用购物车、收货地址、下单、支付、收货、售后申请或评价接口；会员账号无法访问后台接口。管理员在“账号管理”中分别维护员工与会员，支持新增、姓名/账号查询、详情、资料编辑、密码重置、启停和删除；员工还可按岗位筛选及调整岗位，两类账号不能互相转换。停用、重置密码或删除后旧会话失效。升级后旧版共用登录会话失效，需从对应入口重新登录。

后台删除权限单独授予管理员，运营仍可维护商品和上下架，仓库负责库存与履约。管理员可删除错误商品，商品同步从商城、后台列表和购物车移除，历史订单与售后明细保留，重启演示数据不会重新创建已删除商品。管理员不能删除、停用或降级本人，系统至少保留一名启用的管理员；有未完成订单或待审核售后的账号需先处理业务再删除，也可先停用。

订单支持按订单号/收货人搜索，管理员可修改待付款、待拣货订单的配送信息，取消待付款订单并归还库存，仅可删除已取消且没有支付、退款、结算记录的错误订单。售后、结算和审计支持搜索与详情，退款审核和财务结算沿用业务流程；支付、退款、结算及审计记录不开放任意修改和删除。账号、商品和错误订单采用逻辑删除并记录审计，数据库启动时会自动补充旧库所需字段。

## 完整 Docker 部署

安装并启动 Docker Desktop，确保使用 Linux containers。首次生成环境变量：

```powershell
.\scripts\init-env.ps1
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
```

Linux/macOS：

```bash
sh scripts/init-env.sh
docker compose --env-file .env.docker up -d --build
```

商场与后台：http://localhost:8080；监控：http://localhost:3000；Prometheus：http://localhost:9090；RabbitMQ 管理：http://localhost:15672。Grafana 与消息队列密码在 `.env.docker` 中。PostgreSQL、Redis、API 仅在容器网络内部提供服务。

该 Compose 是**隔离的教学演示部署**，包含六个演示账号及沙箱支付。默认仅绑定本机。公网生产部署需关闭演示登录提示、停用演示账号、接入真实支付和配送，并配置受信任 HTTPS 证书，具体见 [部署运维](docs/deployment.md)。

## 已实现的闭环

分类/搜索/分页/排序 → 商品详情 → 购物车 → 地址与配送时段 → 幂等下单 → 事务预扣库存 → 沙箱支付 → 仓库拣货/配送 → 会员确认收货 → 评价 → 财务结算；支持待付款取消、15分钟支付超时归还库存、整单/部分退款及审计。

顶部主导航与下方图标分类栏共用同一 URL `category` 参数，点击任一分类时两者的选中高亮同步更新。

商城和后台商品搜索忽略大小写与全半角差异，支持连续文字、单处错字以及商品名称的字面重合匹配，不包含商品专用映射或同义词表。单个中文关键词为两字时，允许名称命中其中一个字；更长的关键词要求至少命中75%的不同字。准确匹配优先，其次是三字以上的一处错字、漏字、多字或相邻字颠倒，最后补充最多6款字面重合商品，避免结果过多。多个空格分隔的关键词必须全部命中（可跨名称、产地、副标题），最多一处错字，不启用单字扩展；价格和销量排序、分类、上下架筛选及分页继续生效。搜索结果中名称、简介、产地的匹配文字以红色显示，清空搜索后恢复普通文字。

顶部地址选择器支持展开选择配送区域；登录后还会列出本人收货地址，选择结果写入全局状态并持久化，结算页会优先选中该地址。

商品列表的“综合推荐”按 销量×0.5 + 浏览量×0.3 + 新品权重×0.2 加权排序（访问商品详情累计浏览量），不再退化为按上架时间倒序；结算页配送时段的选中项会显示勾选标识。

售后弹窗支持整单退款或按商品部分退款（勾选商品并调整数量，自动计算退款金额），审批后仅归还所选商品的库存与销量，已结算订单按净额结算；同时修复了弹窗内输入框因副作用重复聚焦而无法输入的问题（售后原因、商品评价输入框均受影响）。售后弹窗的商品行采用标准 Flex 布局（复选框、80×80 缩略图、名称省略号、价格与数量/删除控件对齐），校验提示改为输入框下方的温和小字，底部按钮区带分割线。

订单事务使用库存条件更新防超卖；支付、退款和结算采用唯一约束与订单行锁；Outbox 在业务事务中写入事件，RabbitMQ 使用持久化消息、发布确认与消费去重。未配置消息队列的本地模式通过持久化 Outbox 执行进程内消费。详细边界见 [设计文档](docs/design.md)。

## 验证与复现

```bash
npm run typecheck
npm test
npm run build
# Windows 默认使用已安装的 Edge；Linux 需安装 Playwright Chromium
npx playwright install --with-deps chromium
npm run test:e2e
# 确保 API 已启动，默认200请求、并发10
npm run load
```

PostgreSQL 集成测试可设置 `TEST_DATABASE_URL`；测试会创建独立临时 schema，并在结束后删除。不要授予公共用户测试数据库权限。实际测量、测试日志及运行范围在 [测试报告](docs/test-report.md) 和 `docs/evidence/` 中。

## 文档与交付

- [需求文档](docs/requirements.md)：用例、流程、领域模型、ER、权限矩阵、可验证指标。
- [设计文档](docs/design.md)：技术选型、分层结构、库存/支付/售后/结算一致性、Outbox、安全与可观测性。
- [测试报告](docs/test-report.md)：自动化测试、覆盖率、端到端截图、压测及验证边界。
- [部署运维](docs/deployment.md)：环境配置、启动、备份、恢复、回滚、监控与故障处理。
- [AI过程记录](docs/ai-log.md)、[架构决策](docs/adr.md)、[15分钟讲解脚本](docs/demo-script.md)。
- `database/schema.sql`、`database/seed.sql`、`.github/workflows/ci.yml`、`infra/`。
- `deliverables/`：Word文档、实验报告、PPT、系统演示视频、源码交付压缩包。

文档生成：`python scripts/generate-deliverables.py`（依赖 `python-docx`、`python-pptx`、Pillow）；源码压缩包：`python scripts/package.py`。姓名、学号、团队分工和签名由提交人据实填写。

`deliverables/` 另含Word和PPT的PDF副本，实际Office渲染结果已经检查。演示视频为WebM格式，包含真实浏览器操作与中文字幕讲解；可使用Edge、Chrome或VLC播放。录屏脚本为 `scripts/record-demo.mjs`，读取本机 `.env.docker`，需要Playwright浏览器与FFmpeg助手；运行 `npx playwright install ffmpeg` 后执行 `node scripts/record-demo.mjs`。自动录屏会创建一名演示会员及真实沙箱订单，不修改现有订单。

生成Word/PPT后可在安装Office的Windows运行 `scripts/render-documents.ps1` 导出PDF与预览，再执行 `python scripts/check-deliverables.py` 检查交付物。该渲染步骤是可选工具，不是运行商城的前置条件。交付包不包含本机密钥、依赖安装目录或教材原始材料。
