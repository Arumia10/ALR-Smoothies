-- Compatible with the nine-column orders table supplied by the owner.
-- Existing rows and columns are never rewritten, renamed or removed.
CREATE TABLE IF NOT EXISTS orders(
 order_number TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT,
 pickup_date TEXT, delivery_location TEXT, order_items TEXT,
 total_amount TEXT, created_at TEXT
);
-- Fail before any application schema is added if this is a different orders schema.
SELECT order_number,name,email,role,pickup_date,delivery_location,order_items,total_amount,created_at FROM orders LIMIT 0;
 CREATE TABLE IF NOT EXISTS vb_products(id TEXT PRIMARY KEY,price INTEGER NOT NULL CHECK(price BETWEEN 50 AND 5000),available INTEGER NOT NULL CHECK(available IN(0,1)));
 CREATE TABLE IF NOT EXISTS vb_orders(id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,date TEXT NOT NULL,fulfillment TEXT NOT NULL,room TEXT NOT NULL,total INTEGER NOT NULL CHECK(total>0),quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 40),items TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'received' CHECK(status IN('received','preparing','ready','collected','cancelled')),payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN('unpaid','paid')),demo INTEGER NOT NULL CHECK(demo IN(0,1)),created_at TEXT NOT NULL,delivery_location TEXT NOT NULL,legacy_items TEXT NOT NULL,mail_payload TEXT);
 CREATE INDEX IF NOT EXISTS vb_orders_date_status ON vb_orders(date,status,demo);
 CREATE TABLE IF NOT EXISTS vb_audit(id INTEGER PRIMARY KEY,order_id TEXT,action TEXT NOT NULL,created_at TEXT NOT NULL);

INSERT OR IGNORE INTO vb_products(id,price,available) VALUES('red-berries',350,1);
INSERT OR IGNORE INTO vb_products(id,price,available) VALUES('golden-sunrise',350,1);
INSERT OR IGNORE INTO vb_products(id,price,available) VALUES('mango-blush',350,1);
INSERT OR IGNORE INTO vb_products(id,price,available) VALUES('green-refresh',350,1);
INSERT OR IGNORE INTO vb_products(id,price,available) VALUES('ruby-boost',350,1);
INSERT OR IGNORE INTO vb_products(id,price,available) VALUES('cherry-berry',350,1);
INSERT OR IGNORE INTO vb_products(id,price,available) VALUES('raspberry-sunset',350,1);
INSERT OR IGNORE INTO vb_products(id,price,available) VALUES('tropical-fire',350,1);
INSERT OR IGNORE INTO vb_products(id,price,available) VALUES('berry-dream',450,1);
INSERT OR IGNORE INTO vb_products(id,price,available) VALUES('matcha-dream',450,1);

CREATE TABLE vb_sessions(token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL, auth_version TEXT NOT NULL);
CREATE INDEX vb_sessions_expiry ON vb_sessions(expires);
CREATE TABLE vb_rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX vb_rate_limits_expiry ON vb_rate_limits(expires);

-- Audit and state validation run in the same transaction as the change.
CREATE TRIGGER vb_validate_order_state BEFORE UPDATE ON vb_orders BEGIN
 SELECT CASE WHEN NEW.status != OLD.status AND NOT (
  (OLD.status='received' AND NEW.status IN('preparing','cancelled')) OR
  (OLD.status='preparing' AND NEW.status IN('ready','cancelled')) OR
  (OLD.status='ready' AND NEW.status IN('collected','cancelled'))
 ) THEN RAISE(ABORT,'invalid_order_transition') END;
 SELECT CASE WHEN NEW.status='collected' AND NEW.payment_status!='paid'
 THEN RAISE(ABORT,'payment_required') END;
END;
CREATE TRIGGER vb_audit_order AFTER UPDATE ON vb_orders BEGIN
 INSERT INTO vb_audit(order_id,action,created_at) VALUES(NEW.id,
 json_object('from',OLD.status,'to',NEW.status,'paymentFrom',OLD.payment_status,'paymentTo',NEW.payment_status),
 strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER vb_audit_product AFTER UPDATE ON vb_products BEGIN
 INSERT INTO vb_audit(action,created_at) VALUES(
 json_object('product',NEW.id,'price',NEW.price,'available',NEW.available),
 strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TABLE vb_email_outbox(
 order_id TEXT PRIMARY KEY REFERENCES vb_orders(id), payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','failed','review')),
 attempts INTEGER NOT NULL DEFAULT 0, first_attempt INTEGER, lease_until INTEGER,
 last_error TEXT, provider_id TEXT
);
CREATE TRIGGER vb_save_legacy_order AFTER INSERT ON vb_orders WHEN NEW.demo=0 BEGIN
 INSERT INTO orders(order_number,name,email,role,pickup_date,delivery_location,order_items,total_amount,created_at)
 VALUES(NEW.id,NEW.first_name || ' ' || NEW.last_name,NEW.email,NEW.role,NEW.date,
 NEW.delivery_location,NEW.legacy_items,printf('%.2f',NEW.total / 100.0),NEW.created_at);
 INSERT INTO vb_email_outbox(order_id,payload)
 SELECT NEW.id,NEW.mail_payload WHERE NEW.mail_payload IS NOT NULL;
END;
