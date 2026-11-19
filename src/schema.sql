
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  referral_code TEXT NOT NULL UNIQUE,
  referred_by INTEGER REFERENCES accounts(id),
  wallet_address TEXT,
  instagram_status TEXT NOT NULL DEFAULT 'not_started',
  telegram_status TEXT NOT NULL DEFAULT 'not_started',
  last_mined_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS referral_bonuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL REFERENCES accounts(id),
  referred_user_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id),
  bonus REAL NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS referral_commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  earner_id INTEGER NOT NULL REFERENCES accounts(id),
  source_user_id INTEGER NOT NULL REFERENCES accounts(id),
  level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 3),
  mining_reward REAL NOT NULL,
  commission REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mining_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES accounts(id),
  reward REAL NOT NULL,
  mined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS mining_events_user_time_idx
ON mining_events(user_id, mined_at);

CREATE INDEX IF NOT EXISTS accounts_referred_by_idx
ON accounts(referred_by);

CREATE TABLE IF NOT EXISTS task_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES accounts(id),
  task_name TEXT NOT NULL CHECK(task_name IN ('instagram','telegram')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected')),
  proof_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  UNIQUE(user_id, task_name)
);
