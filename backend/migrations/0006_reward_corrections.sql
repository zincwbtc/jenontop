-- Store-funded corrections keep the provider's original amount intact.
-- One promised total per transaction prevents repeated compensation.
CREATE TABLE IF NOT EXISTS reward_corrections (
  transaction_id TEXT PRIMARY KEY REFERENCES reward_conversions(transaction_id),
  promised_units INTEGER NOT NULL CHECK(promised_units > 0),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
