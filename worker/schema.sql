-- Store database (Cloudflare D1). The Worker creates all of this by itself on first use (ensureSchema),
-- so running this file is optional:  wrangler d1 execute hb-store --remote --file worker/schema.sql
CREATE TABLE IF NOT EXISTS subscribers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contact       TEXT NOT NULL,              -- email (lowercased) or E.164 phone
  kind          TEXT NOT NULL,              -- 'email' | 'phone'
  product       TEXT NOT NULL DEFAULT 'next-drop',
  size          TEXT NOT NULL DEFAULT 'any',
  source        TEXT NOT NULL DEFAULT 'site',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  unsubscribed_at TEXT,
  UNIQUE (contact, product, size)
);
CREATE INDEX IF NOT EXISTS idx_sub_product ON subscribers (product, unsubscribed_at);

CREATE TABLE IF NOT EXISTS sends (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  recipients  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS product_settings (
  product    TEXT PRIMARY KEY,                 -- products.json id
  status     TEXT NOT NULL DEFAULT 'archive',  -- 'archive' (sold out, notify me) | 'drop' (in the current drop) | 'live' (always on sale)
  preorder   INTEGER NOT NULL DEFAULT 0,       -- 1 = can be ordered past stock
  ship_note  TEXT NOT NULL DEFAULT '',         -- e.g. "Ships the week of Dec 8"
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory (
  product TEXT NOT NULL,
  size    TEXT NOT NULL,
  stock   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product, size)
);

CREATE TABLE IF NOT EXISTS drops (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  early_at   TEXT NOT NULL,                    -- ISO UTC: members can shop from here
  public_at  TEXT NOT NULL,                    -- ISO UTC: everyone can shop from here
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,                -- Stripe Checkout Session id
  email       TEXT,
  name        TEXT,
  total_cents INTEGER NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'usd',
  member      INTEGER NOT NULL DEFAULT 0,      -- bought during members early access
  preorder    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id   TEXT NOT NULL,
  product    TEXT NOT NULL,
  size       TEXT NOT NULL,
  qty        INTEGER NOT NULL,
  unit_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items (product, size);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);
