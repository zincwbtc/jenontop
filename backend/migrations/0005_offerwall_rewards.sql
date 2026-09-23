CREATE TABLE IF NOT EXISTS reward_conversions (
  transaction_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  amount_units INTEGER NOT NULL CHECK(amount_units > 0),
  status TEXT NOT NULL CHECK(status IN ('credited','reversed')),
  completed_survey INTEGER NOT NULL CHECK(completed_survey IN (0,1)),
  offer_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reward_conversions_user ON reward_conversions(user_key, status);
CREATE TABLE IF NOT EXISTS reward_sync (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_success TEXT,
  scan_page INTEGER NOT NULL DEFAULT 1,
  last_error TEXT
);
INSERT OR IGNORE INTO reward_sync(id) VALUES(1);
