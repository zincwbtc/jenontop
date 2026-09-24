-- Withdrawal requests paid manually by staff from the Discord #payout-log channel.
-- Pending and paid requests are deducted from the balance and consume the
-- completed surveys they used; rejected requests give both back.
CREATE TABLE IF NOT EXISTS reward_withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  amount_units INTEGER NOT NULL CHECK(amount_units > 0),
  surveys_used INTEGER NOT NULL CHECK(surveys_used >= 10),
  status TEXT NOT NULL CHECK(status IN ('pending','paid','rejected')),
  notified INTEGER NOT NULL DEFAULT 0 CHECK(notified IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reward_withdrawals_user ON reward_withdrawals(user_key, status);
CREATE INDEX IF NOT EXISTS reward_withdrawals_unnotified ON reward_withdrawals(notified) WHERE notified = 0;
