CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at BIGINT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), session_version INTEGER NOT NULL DEFAULT 0, deleted_at BIGINT
);
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id), name TEXT NOT NULL,
 subtitle TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0),
 original_price INTEGER NOT NULL, stock INTEGER NOT NULL CHECK(stock >= 0), sales INTEGER NOT NULL DEFAULT 0,
 views INTEGER NOT NULL DEFAULT 0,
 image TEXT NOT NULL, unit TEXT NOT NULL, origin TEXT NOT NULL, storage TEXT NOT NULL, tag TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at BIGINT NOT NULL, deleted_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id,active);
CREATE TABLE IF NOT EXISTS addresses (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 phone TEXT NOT NULL, detail TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cart_items (
 user_id TEXT NOT NULL REFERENCES users(id), product_id TEXT NOT NULL REFERENCES products(id),
 quantity INTEGER NOT NULL CHECK(quantity > 0 AND quantity <= 99), PRIMARY KEY(user_id,product_id)
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL,
 subtotal INTEGER NOT NULL, delivery_fee INTEGER NOT NULL, total INTEGER NOT NULL,
 address_snapshot TEXT NOT NULL, delivery_slot TEXT NOT NULL, note TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, created_at BIGINT NOT NULL,
 expires_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, deleted_at BIGINT,
 discount INTEGER NOT NULL DEFAULT 0, coupon_id TEXT, seckill_id TEXT, UNIQUE(user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders(status,expires_at);
CREATE TABLE IF NOT EXISTS order_items (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT NOT NULL REFERENCES products(id),
 name TEXT NOT NULL, image TEXT NOT NULL, unit TEXT NOT NULL, price INTEGER NOT NULL,
 quantity INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, UNIQUE(order_id,product_id)
);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), amount INTEGER NOT NULL,
 provider TEXT NOT NULL DEFAULT 'sandbox', status TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS refunds (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), user_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', amount INTEGER NOT NULL,
 original_status TEXT NOT NULL, decision_note TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS refund_items (
 id TEXT PRIMARY KEY, refund_id TEXT NOT NULL REFERENCES refunds(id), product_id TEXT NOT NULL REFERENCES products(id),
 quantity INTEGER NOT NULL CHECK(quantity > 0), UNIQUE(refund_id,product_id)
);
CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT NOT NULL REFERENCES products(id),
 user_id TEXT NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 content TEXT NOT NULL, created_at BIGINT NOT NULL, UNIQUE(order_id,product_id,user_id)
);
CREATE TABLE IF NOT EXISTS settlements (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), amount INTEGER NOT NULL,
 operator_id TEXT NOT NULL REFERENCES users(id), created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
 id TEXT PRIMARY KEY, topic TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, published_at BIGINT, trace_context TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(status,created_at);
CREATE TABLE IF NOT EXISTS processed_events (id TEXT PRIMARY KEY, processed_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
 body TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL,
 detail TEXT NOT NULL, trace_id TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
-- 搜索日志：记录商城搜索第一页的关键词与命中数，用于热搜词统计
CREATE TABLE IF NOT EXISTS search_logs (id TEXT PRIMARY KEY, keyword TEXT NOT NULL, results INTEGER NOT NULL, created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_search_logs_created ON search_logs(created_at);
-- 优惠券模板：amount=满减（value为减免分），percent=折扣（value为实付百分比，如90即9折）
CREATE TABLE IF NOT EXISTS coupons (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('amount','percent')),
 threshold INTEGER NOT NULL DEFAULT 0 CHECK(threshold >= 0), value INTEGER NOT NULL CHECK(value > 0), max_discount INTEGER NOT NULL DEFAULT 0 CHECK(max_discount >= 0),
 category_id TEXT REFERENCES categories(id), total INTEGER NOT NULL CHECK(total > 0), issued INTEGER NOT NULL DEFAULT 0 CHECK(issued >= 0 AND issued <= total),
 valid_from BIGINT NOT NULL, valid_to BIGINT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_coupons (
 id TEXT PRIMARY KEY, coupon_id TEXT NOT NULL REFERENCES coupons(id), user_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'unused' CHECK(status IN ('unused','used')), order_id TEXT REFERENCES orders(id),
 claimed_at BIGINT NOT NULL, used_at BIGINT, UNIQUE(coupon_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_coupons_user ON user_coupons(user_id,status);
-- 秒杀活动：活动名额与商品库存双重条件扣减，sold<=stock 由数据库兜底
CREATE TABLE IF NOT EXISTS seckill_activities (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), title TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price > 0), stock INTEGER NOT NULL CHECK(stock > 0), sold INTEGER NOT NULL DEFAULT 0 CHECK(sold >= 0 AND sold <= stock),
 start_at BIGINT NOT NULL, end_at BIGINT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seckill_window ON seckill_activities(active,end_at);
CREATE TABLE IF NOT EXISTS seckill_participants (
 activity_id TEXT NOT NULL REFERENCES seckill_activities(id), user_id TEXT NOT NULL REFERENCES users(id),
 order_id TEXT NOT NULL REFERENCES orders(id), created_at BIGINT NOT NULL, PRIMARY KEY(activity_id,user_id)
);
-- 外键列索引：PostgreSQL 不会为外键自动建索引，按用户/商品查询与删除父记录时避免全表扫描
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product ON cart_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_refunds_user ON refunds(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_items_product ON refund_items(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id,created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_operator ON settlements(operator_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_coupons_category ON coupons(category_id);
CREATE INDEX IF NOT EXISTS idx_user_coupons_order ON user_coupons(order_id);
CREATE INDEX IF NOT EXISTS idx_seckill_activities_product ON seckill_activities(product_id);
CREATE INDEX IF NOT EXISTS idx_seckill_participants_user ON seckill_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_seckill_participants_order ON seckill_participants(order_id);
