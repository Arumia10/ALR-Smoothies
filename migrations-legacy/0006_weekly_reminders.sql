CREATE TABLE IF NOT EXISTS vb_reminder_subscriptions (
  email TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
  token TEXT NOT NULL UNIQUE,
  updated_at INTEGER NOT NULL,
  source_order_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vb_weekly_reminders (
  id TEXT PRIMARY KEY,
  sunday TEXT NOT NULL,
  email TEXT NOT NULL REFERENCES vb_reminder_subscriptions(email),
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','failed','review','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt INTEGER,
  lease_until INTEGER,
  last_error TEXT,
  provider_id TEXT,
  UNIQUE(sunday,email)
);
CREATE INDEX IF NOT EXISTS vb_weekly_reminders_pending ON vb_weekly_reminders(sunday,status);
