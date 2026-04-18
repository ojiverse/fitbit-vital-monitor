-- intraday raw samples, retained for 7 days (older rows are archived to R2 then deleted).
CREATE TABLE vitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME NOT NULL,
  metric_type TEXT NOT NULL,
  value REAL NOT NULL
);
CREATE INDEX idx_vitals_timestamp ON vitals(timestamp);
CREATE INDEX idx_vitals_type_timestamp ON vitals(metric_type, timestamp);

-- daily aggregates kept indefinitely. `meta` holds JSON for sleep stages etc.
CREATE TABLE vitals_daily (
  date TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  value REAL NOT NULL,
  meta TEXT,
  PRIMARY KEY (date, metric_type)
);
CREATE INDEX idx_vitals_daily_type_date ON vitals_daily(metric_type, date);

-- OAuth tokens. Always id = 1; TokenStore DO is the only writer.
CREATE TABLE auth_tokens (
  id INTEGER PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  scope TEXT NOT NULL,
  fitbit_user_id TEXT NOT NULL,
  updated_at DATETIME NOT NULL
);

-- latest rate limit header values. Always id = 1.
CREATE TABLE rate_limit_state (
  id INTEGER PRIMARY KEY,
  limit_total INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  reset_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

-- latest known state of every Fitbit device linked to the account.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  battery_level INTEGER,
  last_sync_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
