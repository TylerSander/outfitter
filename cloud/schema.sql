-- Outfitter accounts schema (D1 / SQLite).
-- users.sub is the WorkOS user id (JWT `sub`) - the only identity key.
CREATE TABLE IF NOT EXISTS users (
  sub TEXT PRIMARY KEY,
  email TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A saved item: a free-form link, or a reference to a catalog app
-- (kind='app' + app_id) the user wants to remember for a future machine.
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL REFERENCES users(sub),
  kind TEXT NOT NULL CHECK (kind IN ('link', 'app')),
  url TEXT,
  title TEXT NOT NULL,
  note TEXT,
  app_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_sub, created_at DESC);

-- Audit-lite: append-only per-user activity trail, kept in our own DB
-- (WorkOS Audit Logs is org-scoped/enterprise - see vault note).
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_sub TEXT NOT NULL,
  action TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_sub, id DESC);
