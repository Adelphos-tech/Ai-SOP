-- AI Writing Review — persistent Ryne spend ledger (Brick 4B-B).
-- Additive only: creates two new tables, alters nothing, drops nothing.
-- Safe to run against a live database — no existing rows are touched.
--
-- ryne_spend_counters: atomic budget counters. Effective consumption is
--   reserved_usd + settled_usd. scope 'day' rows are keyed by UTC date;
--   scope 'total' row is keyed 'ALL'.
-- ryne_spend_events: one row per billable unit (one detector call or one
--   humanizer call). (operation_id, request_kind, request_unit) is the
--   idempotency identity: retries of the same logical operation cannot
--   create a second reservation, while a deliberately NEW operation gets
--   its own rows. No document text, prompts or provider payloads are
--   ever stored here.

CREATE TABLE IF NOT EXISTS ryne_spend_counters (
  scope        VARCHAR(16)  NOT NULL,
  scope_key    VARCHAR(16)  NOT NULL,
  reserved_usd DECIMAL(14,6) NOT NULL DEFAULT 0,
  settled_usd  DECIMAL(14,6) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
               ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ryne_spend_events (
  id                  CHAR(36) PRIMARY KEY,
  operation_id        CHAR(36) NOT NULL,
  request_kind        ENUM('DETECTION','HUMANIZER') NOT NULL,
  provider            VARCHAR(32) NOT NULL DEFAULT 'ryne',
  request_unit        VARCHAR(32) NOT NULL,
  status              ENUM('RESERVED','SETTLED','REFUNDED','UNKNOWN')
                      NOT NULL DEFAULT 'RESERVED',
  counter_day         CHAR(10) NOT NULL,
  actor_id            VARCHAR(64)  DEFAULT NULL,
  student_id          CHAR(36)     DEFAULT NULL,
  application_id      CHAR(36)     DEFAULT NULL,
  document_id         CHAR(36)     DEFAULT NULL,
  version_id          CHAR(36)     DEFAULT NULL,
  estimated_usd       DECIMAL(12,6) NOT NULL,
  settled_usd         DECIMAL(12,6) DEFAULT NULL,
  provider_cost_usd   DECIMAL(12,6) DEFAULT NULL,
  cost_basis          ENUM('ESTIMATED','UNVERIFIED_ESTIMATE','PROVIDER_REPORTED')
                      NOT NULL,
  price_unit          VARCHAR(16) NOT NULL,
  unit_price_usd      DECIMAL(12,6) DEFAULT NULL,
  unit_quantity       DECIMAL(14,2) NOT NULL,
  pricing_version     VARCHAR(64) NOT NULL,
  pricing_captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  outcome             VARCHAR(64) DEFAULT NULL,
  provider_ref        VARCHAR(128) DEFAULT NULL,
  reserved_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at          TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_ryne_op_unit (operation_id, request_kind, request_unit),
  INDEX idx_ryne_status (status),
  INDEX idx_ryne_document (document_id),
  INDEX idx_ryne_reserved_at (reserved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
