BEGIN;

CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(80) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  points NUMERIC(20,8) NOT NULL DEFAULT 0,
  last_mined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS referred_by BIGINT REFERENCES accounts(id);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS instagram_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS telegram_status TEXT NOT NULL DEFAULT 'not_started';

UPDATE accounts
SET referral_code = UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT || id::TEXT), 1, 10))
WHERE referral_code IS NULL OR referral_code = '';

CREATE UNIQUE INDEX IF NOT EXISTS accounts_referral_code_unique
ON accounts(referral_code);

ALTER TABLE accounts ALTER COLUMN referral_code SET NOT NULL;
CREATE INDEX IF NOT EXISTS accounts_referred_by_idx ON accounts(referred_by);

CREATE TABLE IF NOT EXISTS referral_bonuses (
  id BIGSERIAL PRIMARY KEY,
  referrer_id BIGINT NOT NULL REFERENCES accounts(id),
  referred_user_id BIGINT NOT NULL UNIQUE REFERENCES accounts(id),
  bonus NUMERIC(20,8) NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_commissions (
  id BIGSERIAL PRIMARY KEY,
  earner_id BIGINT NOT NULL REFERENCES accounts(id),
  source_user_id BIGINT NOT NULL REFERENCES accounts(id),
  level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
  mining_reward NUMERIC(20,8) NOT NULL,
  commission NUMERIC(20,8) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_user_id, level, created_at)
);

CREATE TABLE IF NOT EXISTS mining_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES accounts(id),
  reward NUMERIC(20,8) NOT NULL,
  mined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mining_events_user_time_idx
ON mining_events(user_id, mined_at DESC);

CREATE TABLE IF NOT EXISTS task_verifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES accounts(id),
  task_name TEXT NOT NULL CHECK (task_name IN ('instagram','telegram')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  proof_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE(user_id, task_name)
);

COMMIT;
