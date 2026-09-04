CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_slot ON appointments(date, time) WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS breaks (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_breaks_date ON breaks(date);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

INSERT OR IGNORE INTO settings(key,value) VALUES
('business_hours','{"0":null,"1":["10:00","19:00"],"2":["10:00","19:00"],"3":["10:00","19:00"],"4":["10:00","19:00"],"5":["10:00","19:00"],"6":["10:00","19:00"]}'),
('slot_minutes','30');
