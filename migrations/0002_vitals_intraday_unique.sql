-- Dedup the intraday table and enforce idempotency on (metric_type, timestamp).
-- Previously `insertIntradaySamples` ran a plain INSERT every */15 cron tick,
-- so the whole day's HR stream was re-written each tick. Left alone, the batch
-- eventually blew past the Worker CPU budget ("Exceeded CPU Limit" on the cron
-- trigger) and fresh data stopped landing.

DELETE FROM vitals
WHERE id NOT IN (
  SELECT MIN(id) FROM vitals GROUP BY metric_type, timestamp
);

-- The old non-unique index is fully covered by the new unique one.
DROP INDEX IF EXISTS idx_vitals_type_timestamp;
CREATE UNIQUE INDEX idx_vitals_type_timestamp ON vitals(metric_type, timestamp);
