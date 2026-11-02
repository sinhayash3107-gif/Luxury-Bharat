-- Luxury Bharat schema v1. Money is stored as integer paise (1 INR = 100 paise). Timestamps are ISO-8601 UTC.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin','owner')),
  full_name TEXT, phone TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  notify_orders INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Exactly one owner can ever exist, enforced by the database itself.
CREATE UNIQUE INDEX one_owner ON users(role) WHERE role = 'owner';
CREATE TRIGGER owner_no_demote BEFORE UPDATE OF role ON users
  WHEN OLD.role = 'owner' AND NEW.role <> 'owner' BEGIN SELECT RAISE(ABORT, 'owner role is immutable'); END;
CREATE TRIGGER owner_no_delete BEFORE DELETE ON users
  WHEN OLD.role = 'owner' BEGIN SELECT RAISE(ABORT, 'owner cannot be deleted'); END;

CREATE TABLE user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  ip TEXT, user_agent TEXT,
  created_at TEXT NOT NULL, last_seen TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- One table for email-verification, password-reset and admin-invite tokens (only SHA-256 hashes are stored).
CREATE TABLE auth_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify','reset','invite')),
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT, payload TEXT,
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE, thumb_url TEXT, bytes INTEGER, width INTEGER, height INTEGER,
  original_name TEXT, uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  subtitle TEXT, description TEXT,
  image TEXT, bg_image TEXT, mobile_image TEXT, hover_image TEXT,
  image_fit TEXT NOT NULL DEFAULT 'contain' CHECK (image_fit IN ('contain','cover')),
  bg_color TEXT NOT NULL DEFAULT '#3A3A3A', icon TEXT,
  position INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  discount_price INTEGER CHECK (discount_price IS NULL OR (discount_price >= 0 AND discount_price < price)),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  featured INTEGER NOT NULL DEFAULT 0, trending INTEGER NOT NULL DEFAULT 0, is_new INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]', attrs TEXT NOT NULL DEFAULT '{}',
  seo_title TEXT, seo_description TEXT,
  sold_count INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_products_cat ON products(category_id);
CREATE INDEX idx_products_status ON products(status);

CREATE TABLE product_images (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL, thumb_url TEXT, alt TEXT, position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_pimg_product ON product_images(product_id, position);

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL, stock_after INTEGER NOT NULL,
  reason TEXT NOT NULL, ref_type TEXT, ref_id TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_invmov_product ON inventory_movements(product_id, created_at);

CREATE TABLE banners (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL, subtitle TEXT, button_text TEXT, button_url TEXT,
  image_desktop TEXT, image_mobile TEXT, video_url TEXT, badge TEXT,
  align TEXT NOT NULL DEFAULT 'left' CHECK (align IN ('left','center','right')),
  overlay REAL NOT NULL DEFAULT 0.45 CHECK (overlay >= 0 AND overlay <= 1),
  height_vh INTEGER NOT NULL DEFAULT 88 CHECK (height_vh BETWEEN 30 AND 100),
  visible INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE sections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT,
  type TEXT NOT NULL CHECK (type IN ('product_grid','editorial_banner','product_carousel','category_catalog','featured_collection','promo_banner','custom_content')),
  image TEXT, bg_image TEXT, mobile_image TEXT, hover_image TEXT, bg_color TEXT,
  cta_text TEXT, cta_url TEXT, content TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','featured','trending','new','bestsellers','category')),
  item_limit INTEGER NOT NULL DEFAULT 8,
  position INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE section_products (
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (section_id, product_id)
);
CREATE TABLE section_categories (
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (section_id, category_id)
);

CREATE TABLE addresses (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL, phone TEXT NOT NULL, state TEXT NOT NULL, city TEXT NOT NULL,
  line1 TEXT NOT NULL, pincode TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX idx_addr_user ON addresses(user_id);

CREATE TABLE cart_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL CHECK (qty > 0), updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE wishlists (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, PRIMARY KEY (user_id, product_id)
);
CREATE TABLE recently_viewed (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL, PRIMARY KEY (user_id, product_id)
);

CREATE TABLE coupons (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('percent','flat')), value INTEGER NOT NULL CHECK (value > 0),
  min_subtotal INTEGER NOT NULL DEFAULT 0, max_uses INTEGER, used_count INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT, ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 0,        -- coupons ship disabled; the owner/admin activates them
  created_at TEXT NOT NULL
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','packed','shipped','delivered','cancelled')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('razorpay','test','cod')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, shipping INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
  coupon_code TEXT,
  email TEXT NOT NULL, customer_name TEXT NOT NULL,
  ship_name TEXT NOT NULL, ship_phone TEXT NOT NULL, ship_state TEXT NOT NULL, ship_city TEXT NOT NULL,
  ship_line1 TEXT NOT NULL, ship_pincode TEXT NOT NULL,
  stock_restored INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_orders_user ON orders(user_id, created_at);
CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL, sku TEXT NOT NULL, image TEXT,
  list_price INTEGER NOT NULL, unit_price INTEGER NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX idx_oitems_order ON order_items(order_id);
CREATE TABLE order_status_history (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL, note TEXT, actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL
);
CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, provider_order_id TEXT, provider_payment_id TEXT,
  amount INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL, subject TEXT NOT NULL,
  order_number TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE ticket_replies (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_staff INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, image TEXT, created_at TEXT NOT NULL
);

-- (type, ref_type, ref_id) is unique so the same event can never notify twice.
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, ref_type TEXT NOT NULL, ref_id TEXT NOT NULL,
  data TEXT, created_at TEXT NOT NULL,
  UNIQUE (type, ref_type, ref_id)
);
CREATE TABLE notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE email_log (
  id INTEGER PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,          -- dedupe key, e.g. order:42:new:owner@x.com
  to_email TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  provider TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, actor_email TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, meta TEXT, ip TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE pages (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', visible INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
