PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    points REAL NOT NULL DEFAULT 0,
    referral_code TEXT NOT NULL UNIQUE,
    referred_by INTEGER,
    last_mined_at TEXT,
    wallet_address TEXT,
    instagram_status TEXT NOT NULL DEFAULT 'pending',
    telegram_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referred_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS point_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS referral_bonuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    referred_user_id INTEGER NOT NULL UNIQUE,
    amount REAL NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referrer_id) REFERENCES users(id),
    FOREIGN KEY (referred_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS referral_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    earner_id INTEGER NOT NULL,
    source_user_id INTEGER NOT NULL,
    mining_transaction_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    amount REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_user_id, mining_transaction_id, level),
    FOREIGN KEY (earner_id) REFERENCES users(id),
    FOREIGN KEY (source_user_id) REFERENCES users(id),
    FOREIGN KEY (mining_transaction_id) REFERENCES point_transactions(id)
);

CREATE TABLE IF NOT EXISTS task_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    UNIQUE(user_id, task_type),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_referral
ON users(referred_by);

CREATE INDEX IF NOT EXISTS idx_transactions_user
ON point_transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_commissions_earner
ON referral_commissions(earner_id);
