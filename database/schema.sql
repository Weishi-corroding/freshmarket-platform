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
 expires_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, deleted_at BIGINT, UNIQUE(user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders(status,expires_at);
CREATE TABLE IF NOT EXISTS order_items (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT NOT NULL REFERENCES products(id),
 name TEXT NOT NULL, image TEXT NOT NULL, unit TEXT NOT NULL, price INTEGER NOT NULL,
 quantity INTEGER NOT NULL, UNIQUE(order_id,product_id)
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
 attempts INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, published_at BIGINT
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
