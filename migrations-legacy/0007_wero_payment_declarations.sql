CREATE TABLE IF NOT EXISTS vb_payment_declarations (
  order_id TEXT PRIMARY KEY REFERENCES vb_orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK(method='wero'),
  amount INTEGER NOT NULL CHECK(amount>0),
  declared_at TEXT NOT NULL
);
