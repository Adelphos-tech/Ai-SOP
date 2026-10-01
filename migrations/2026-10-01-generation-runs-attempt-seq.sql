-- Generation strict ordering (GEN-004): attempt_seq provides a strict
-- total order over generation_runs (unique, immutable, DB-generated).
-- replaces created_at ordering for all supersession/authority decisions.
--
-- SAFETY GATE — run BEFORE migrating; expected 0:
--   SELECT COUNT(*) FROM generation_runs
--   WHERE status IN ('QUEUED','RUNNING','RECOVERING','CANCEL_REQUESTED');
-- Do not apply while active runs exist unless verified safe.
--
-- Step 1 — add column (nullable; INSTANT on MySQL 8.0.12+ / 9.x).
ALTER TABLE generation_runs
  ADD COLUMN attempt_seq BIGINT NULL;

-- Step 2 — deterministic historical backfill: created_at ASC.
-- Exact historical timestamp ties are broken by id ASC — a
-- MIGRATION-ONLY deterministic tie-breaker: true sub-millisecond
-- ordering is unrecoverable from stored data. Safe because every
-- historical run is terminal; a consistent relative order is all
-- that supersession semantics require.
UPDATE generation_runs g
JOIN (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM generation_runs
) x ON x.id = g.id
SET g.attempt_seq = x.rn;

-- Step 3 — enforce NON-NULL + UNIQUE + AUTO_INCREMENT so every future
-- INSERT receives a strictly increasing value with no application
-- involvement. The UNIQUE index build is INPLACE (not INSTANT).
ALTER TABLE generation_runs
  MODIFY attempt_seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE;
