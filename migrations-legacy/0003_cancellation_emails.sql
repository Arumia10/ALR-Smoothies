CREATE TABLE IF NOT EXISTS vb_cancellation_emails (
  order_id TEXT PRIMARY KEY REFERENCES vb_orders(id),
  reason TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','failed','review')),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt INTEGER,
  lease_until INTEGER,
  last_error TEXT,
  provider_id TEXT
);
