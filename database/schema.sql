-- =============================================================================
-- 鲜境 FreshMarket 数据库结构脚本（SQLite 3.45+ / PostgreSQL 17 通用）
--
-- 1. API 每次启动都会执行本脚本（core/database.ts migrate），因此所有语句都必须是
--    CREATE ... IF NOT EXISTS，可重复执行，不得包含 DROP 或会改写数据的语句。
-- 2. 已有数据库不会因 CREATE TABLE IF NOT EXISTS 获得新列。给已有表加列时，
--    除修改此处外，还必须在 database.ts 的 additions 中登记同名列定义。
-- 3. 只使用两种方言都支持的类型：TEXT、INTEGER、BIGINT。
--    金额统一为整数“分”；时间统一为 Unix 毫秒（BIGINT）；布尔值为 0/1 INTEGER。
-- 4. users、products、orders 为逻辑删除（deleted_at 非空即已删除），查询须过滤
--    deleted_at IS NULL；订单明细、退款等历史记录保留，不做物理删除。
-- 5. 表按外键依赖顺序创建，PostgreSQL 要求被引用表先存在。
--
-- 手工初始化：sqlite3 freshmarket.sqlite < database/schema.sql
--             psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 一、账号
-- -----------------------------------------------------------------------------
-- 会员与员工共用一张表，role=member 为会员，其余为员工角色
-- （operator 运营 / warehouse 仓库 / support 客服 / finance 财务 / admin 管理员）
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,                              -- 演示账号为 u-<role>，其余为随机 ID
 username TEXT NOT NULL UNIQUE,                    -- 登录名，逻辑删除后仍占用
 name TEXT NOT NULL,                               -- 显示名称
 password_hash TEXT NOT NULL,                      -- scrypt 哈希（含盐），不存明文
 role TEXT NOT NULL DEFAULT 'member',
 created_at BIGINT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),  -- 0=停用，禁止登录
 session_version INTEGER NOT NULL DEFAULT 0,       -- JWT 携带此值；自增即令全部旧会话失效
 deleted_at BIGINT                                 -- 逻辑删除时间
);

-- 会员收货地址，每个会员至多一个 is_default=1
CREATE TABLE IF NOT EXISTS addresses (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 name TEXT NOT NULL,                               -- 收货人
 phone TEXT NOT NULL,                              -- 手机号，界面与日志中脱敏展示
 detail TEXT NOT NULL,                             -- 详细地址（含配送区域）
 is_default INTEGER NOT NULL DEFAULT 0
);

-- 站内消息，由 Outbox 事件消费者生成
CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 created_at BIGINT NOT NULL
);

-- -----------------------------------------------------------------------------
-- 二、商品目录
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
 id TEXT PRIMARY KEY,                              -- fruit / seafood / meat / vegetable / dairy / ready
 name TEXT NOT NULL,
 icon TEXT NOT NULL                                -- 前端图标名
);

CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY,
 category_id TEXT NOT NULL REFERENCES categories(id),
 name TEXT NOT NULL,
 subtitle TEXT NOT NULL,
 description TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price > 0),          -- 售价（分）
 original_price INTEGER NOT NULL,                  -- 划线价（分）
 stock INTEGER NOT NULL CHECK(stock >= 0),         -- 可售库存；扣减用 UPDATE ... WHERE stock>=?，CHECK 兜底不超卖
 sales INTEGER NOT NULL DEFAULT 0,                 -- 累计销量，用于排序与推荐
 views INTEGER NOT NULL DEFAULT 0,                 -- 浏览次数，用于排序与推荐
 image TEXT NOT NULL,
 unit TEXT NOT NULL,                               -- 规格，如“500g / 盒”
 origin TEXT NOT NULL,                             -- 产地
 storage TEXT NOT NULL,                            -- 储存方式
 tag TEXT NOT NULL,                                -- 卖点标签
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),  -- 0=下架
 created_at BIGINT NOT NULL,
 deleted_at BIGINT                                 -- 逻辑删除；历史订单仍可引用
);

-- 购物车：同一会员同一商品只有一行，数量 1..99
CREATE TABLE IF NOT EXISTS cart_items (
 user_id TEXT NOT NULL REFERENCES users(id),
 product_id TEXT NOT NULL REFERENCES products(id),
 quantity INTEGER NOT NULL CHECK(quantity > 0 AND quantity <= 99),
 PRIMARY KEY(user_id,product_id)
);

-- 搜索日志：记录商城搜索第一页的关键词与命中数，用于热搜词统计
CREATE TABLE IF NOT EXISTS search_logs (
 id TEXT PRIMARY KEY,
 keyword TEXT NOT NULL,
 results INTEGER NOT NULL,                         -- 命中数，0 不计入热搜
 created_at BIGINT NOT NULL
);

-- -----------------------------------------------------------------------------
-- 三、订单与资金
-- -----------------------------------------------------------------------------
-- 订单状态：pending 待支付 → paid → picking → delivering → completed；
-- 另有 cancelled（取消/超时）与 refunded（全额退款）。状态流转见 orders/service.ts
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL,
 subtotal INTEGER NOT NULL,                        -- 商品原价合计（分）
 delivery_fee INTEGER NOT NULL,                    -- 运费按 subtotal-discount 计算，≥9900 免运费
 total INTEGER NOT NULL,                           -- 应付 = subtotal - discount + delivery_fee
 address_snapshot TEXT NOT NULL,                   -- 下单时地址的 JSON 快照，地址修改不影响历史订单
 delivery_slot TEXT NOT NULL,                      -- 配送时段
 note TEXT NOT NULL,                               -- 订单备注
 idempotency_key TEXT NOT NULL,                    -- 请求头 idempotency-key
 request_hash TEXT NOT NULL,                       -- 请求体 SHA-256；同键不同请求返回 409
 created_at BIGINT NOT NULL,
 expires_at BIGINT NOT NULL,                       -- 待支付截止时间，过期由后台任务取消并回补库存
 updated_at BIGINT NOT NULL,
 deleted_at BIGINT,
 discount INTEGER NOT NULL DEFAULT 0,              -- 优惠券优惠合计（分）；秒杀订单以秒杀价成交，此处为 0
 coupon_id TEXT,                                   -- 使用的 user_coupons.id
 seckill_id TEXT,                                  -- 秒杀订单对应的 seckill_activities.id
 UNIQUE(user_id,idempotency_key)
);

-- 订单明细：保存下单时的名称、图片、单价快照
CREATE TABLE IF NOT EXISTS order_items (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id),
 product_id TEXT NOT NULL REFERENCES products(id),
 name TEXT NOT NULL,
 image TEXT NOT NULL,
 unit TEXT NOT NULL,
 price INTEGER NOT NULL,                           -- 成交单价（分）
 quantity INTEGER NOT NULL,
 discount INTEGER NOT NULL DEFAULT 0,              -- 本行分摊的优惠；部分退款按 ceil(discount*q/quantity) 扣回
 UNIQUE(order_id,product_id)
);

-- 支付记录（沙箱）：每单至多一条
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
 amount INTEGER NOT NULL,
 provider TEXT NOT NULL DEFAULT 'sandbox',
 status TEXT NOT NULL,                             -- success / refunded（整单退款后）
 created_at BIGINT NOT NULL
);

-- 售后退款：每单至多一次申请
CREATE TABLE IF NOT EXISTS refunds (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',           -- pending / approved / rejected
 amount INTEGER NOT NULL,                          -- 退款金额（分）
 original_status TEXT NOT NULL,                    -- 申请时的订单状态
 decision_note TEXT NOT NULL DEFAULT '',           -- 审核意见
 created_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL
);

-- 按商品部分退款时的商品与数量；整单或按金额退款时无记录
CREATE TABLE IF NOT EXISTS refund_items (
 id TEXT PRIMARY KEY,
 refund_id TEXT NOT NULL REFERENCES refunds(id),
 product_id TEXT NOT NULL REFERENCES products(id),
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 UNIQUE(refund_id,product_id)
);

-- 商品评价：已完成订单的每个商品每人一条
CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id),
 product_id TEXT NOT NULL REFERENCES products(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 content TEXT NOT NULL,
 created_at BIGINT NOT NULL,
 UNIQUE(order_id,product_id,user_id)
);

-- 财务结算：已完成订单每单一条
CREATE TABLE IF NOT EXISTS settlements (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
 amount INTEGER NOT NULL,
 operator_id TEXT NOT NULL REFERENCES users(id),   -- 执行结算的财务人员
 created_at BIGINT NOT NULL
);

-- -----------------------------------------------------------------------------
-- 四、营销：优惠券与限时秒杀
-- -----------------------------------------------------------------------------
-- 优惠券模板：amount=满减（value 为减免分），percent=折扣（value 为实付百分比，如 90 即 9 折）
CREATE TABLE IF NOT EXISTS coupons (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('amount','percent')),
 threshold INTEGER NOT NULL DEFAULT 0 CHECK(threshold >= 0),         -- 使用门槛（分），按适用商品小计判断
 value INTEGER NOT NULL CHECK(value > 0),
 max_discount INTEGER NOT NULL DEFAULT 0 CHECK(max_discount >= 0),   -- 折扣券封顶（分），0 为不封顶
 category_id TEXT REFERENCES categories(id),                         -- 限定分类，NULL 为全场
 total INTEGER NOT NULL CHECK(total > 0),                            -- 发行总量
 issued INTEGER NOT NULL DEFAULT 0 CHECK(issued >= 0 AND issued <= total),  -- 已领取，领取用 issued<total 条件更新
 valid_from BIGINT NOT NULL,
 valid_to BIGINT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at BIGINT NOT NULL
);

-- 会员领取的券：每人每种券一张
CREATE TABLE IF NOT EXISTS user_coupons (
 id TEXT PRIMARY KEY,
 coupon_id TEXT NOT NULL REFERENCES coupons(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'unused' CHECK(status IN ('unused','used')),
 order_id TEXT REFERENCES orders(id),              -- 使用该券的订单；订单取消或全额退款后释放
 claimed_at BIGINT NOT NULL,
 used_at BIGINT,
 UNIQUE(coupon_id,user_id)
);

-- 秒杀活动：活动名额与商品库存双重条件扣减，sold<=stock 由数据库兜底
CREATE TABLE IF NOT EXISTS seckill_activities (
 id TEXT PRIMARY KEY,
 product_id TEXT NOT NULL REFERENCES products(id),
 title TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price > 0),          -- 秒杀价（分）
 stock INTEGER NOT NULL CHECK(stock > 0),          -- 活动名额
 sold INTEGER NOT NULL DEFAULT 0 CHECK(sold >= 0 AND sold <= stock),
 start_at BIGINT NOT NULL,
 end_at BIGINT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at BIGINT NOT NULL
);

-- 秒杀参与记录：主键保证每个会员每个活动限购一件；未支付取消时删除并归还名额，退款不归还
CREATE TABLE IF NOT EXISTS seckill_participants (
 activity_id TEXT NOT NULL REFERENCES seckill_activities(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 order_id TEXT NOT NULL REFERENCES orders(id),
 created_at BIGINT NOT NULL,
 PRIMARY KEY(activity_id,user_id)
);

-- -----------------------------------------------------------------------------
-- 五、可靠消息与审计
-- -----------------------------------------------------------------------------
-- 事务性发件箱：业务事务内写入，后台任务发布到 RabbitMQ 或进程内消费
CREATE TABLE IF NOT EXISTS outbox (
 id TEXT PRIMARY KEY,                              -- 事件 ID，消费端据此去重
 topic TEXT NOT NULL,                              -- order.created / order.paid / order.cancelled / order.refunded 等
 payload TEXT NOT NULL,                            -- JSON
 status TEXT NOT NULL DEFAULT 'pending',           -- pending / processing / sent
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at BIGINT NOT NULL,
 published_at BIGINT,
 trace_context TEXT NOT NULL DEFAULT ''            -- W3C traceparent，消费时延续同一条链路
);

-- 消费去重：同一事件 ID 只处理一次
CREATE TABLE IF NOT EXISTS processed_events (
 id TEXT PRIMARY KEY,
 processed_at BIGINT NOT NULL
);

-- 审计日志：所有状态变更与后台操作，与业务写入处于同一事务
CREATE TABLE IF NOT EXISTS audit_logs (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL,                           -- 操作人 ID；超时取消等系统任务为 system
 action TEXT NOT NULL,                             -- 如 order.create、refund.decision、stock.adjust
 entity_id TEXT NOT NULL,
 detail TEXT NOT NULL,                             -- JSON
 trace_id TEXT NOT NULL,                           -- 与 HTTP 响应的 traceId 一致
 created_at BIGINT NOT NULL
);

-- -----------------------------------------------------------------------------
-- 六、索引
-- PostgreSQL 不会为外键自动建索引，按用户/商品查询与删除父记录时避免全表扫描
-- -----------------------------------------------------------------------------
-- 业务查询
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id,active);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders(status,expires_at);          -- 超时取消扫描
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status,created_at);        -- 售后待审核列表与计数
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);            -- 经营概览近 7 日收款
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(status,created_at);         -- Outbox 待发布扫描
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_search_logs_created ON search_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_user_coupons_user ON user_coupons(user_id,status);
CREATE INDEX IF NOT EXISTS idx_seckill_window ON seckill_activities(active,end_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id,created_at);
-- 外键列
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product ON cart_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_refunds_user ON refunds(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_items_product ON refund_items(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_operator ON settlements(operator_id);
CREATE INDEX IF NOT EXISTS idx_coupons_category ON coupons(category_id);
CREATE INDEX IF NOT EXISTS idx_user_coupons_order ON user_coupons(order_id);
CREATE INDEX IF NOT EXISTS idx_seckill_activities_product ON seckill_activities(product_id);
CREATE INDEX IF NOT EXISTS idx_seckill_participants_user ON seckill_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_seckill_participants_order ON seckill_participants(order_id);
