'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '20kb' }));

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://mkhi69756-collab.github.io';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mkhi69756-collab.github.io/mtd-mining-system/';
const BACKEND_PUBLIC_URL = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!process.env.DATABASE_URL || !JWT_SECRET || JWT_SECRET.length < 32 || !ADMIN_KEY || ADMIN_KEY.length < 24) {
  console.error('Missing/weak DATABASE_URL, JWT_SECRET (32+ chars), or ADMIN_KEY (24+ chars).');
  process.exit(1);
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === FRONTEND_ORIGIN) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key']
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false });

app.use('/api', apiLimiter);

function tokenFor(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Please login again.' });
  }
}
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'MTD Mining API' }));

app.get('/tonconnect-manifest.json', (req, res) => {
  if (!BACKEND_PUBLIC_URL) return res.status(503).json({ error: 'BACKEND_PUBLIC_URL is not configured' });
  res.set('Access-Control-Allow-Origin', '*');
  res.json({
    url: FRONTEND_URL,
    name: 'MTD Mining',
    iconUrl: `${BACKEND_PUBLIC_URL}/icon-180.png`
  });
});
app.use(express.static(require('path').join(__dirname, 'public')));

app.post('/api/signup', authLimiter, asyncRoute(async (req, res) => {
  const { full_name, email, password, referral_code } = req.body || {};
  if (typeof full_name !== 'string' || !full_name.trim() || full_name.trim().length > 80 ||
      typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'Enter a name, valid email, and password of at least 8 characters.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let referrerId = null;
    if (typeof referral_code === 'string' && referral_code.trim()) {
      const ref = await client.query(
        'SELECT id FROM accounts WHERE referral_code = $1 FOR UPDATE',
        [referral_code.trim().toUpperCase()]
      );
      if (!ref.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Referral code is invalid.' });
      }
      referrerId = ref.rows[0].id;
    }

    const hash = await bcrypt.hash(password, 12);
    let created;
    // Retry a rare referral-code collision.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = require('crypto').randomBytes(6).toString('hex').toUpperCase();
      try {
        created = await client.query(
          `INSERT INTO accounts(full_name,email,password_hash,referral_code,referred_by)
           VALUES($1,$2,$3,$4,$5)
           RETURNING id,full_name,email,points,referral_code`,
          [full_name.trim(), email.trim().toLowerCase(), hash, code, referrerId]
        );
        break;
      } catch (e) {
        if (e.code === '23505' && e.constraint !== 'accounts_email_key') {
          if (attempt === 2) throw e;
          continue;
        }
        throw e;
      }
    }
    const user = created.rows[0];

    if (referrerId) {
      await client.query('UPDATE accounts SET points = points + 100 WHERE id = $1', [referrerId]);
      await client.query(
        'INSERT INTO referral_bonuses(referrer_id,referred_user_id,bonus) VALUES($1,$2,100)',
        [referrerId, user.id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ message: 'Account created.', token: tokenFor(user), user });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'This email is already registered.' });
    throw e;
  } finally {
    client.release();
  }
}));

app.post('/api/login', authLimiter, asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const q = await pool.query(
    `SELECT id,full_name,email,password_hash,points,referral_code,wallet_address,
            instagram_status,telegram_status,last_mined_at
     FROM accounts WHERE email=$1`,
    [email.trim().toLowerCase()]
  );
  const user = q.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  const { password_hash, ...safeUser } = user;
  res.json({ message: 'Login successful.', token: tokenFor(user), user: safeUser });
}));

app.get('/api/me', auth, asyncRoute(async (req, res) => {
  const q = await pool.query(
    `SELECT id,full_name,email,points,referral_code,wallet_address,
            instagram_status,telegram_status,last_mined_at,
            CASE WHEN last_mined_at IS NULL THEN NULL
                 ELSE last_mined_at + INTERVAL '12 hours' END AS next_mine_at
     FROM accounts WHERE id=$1`,
    [req.user.id]
  );
  if (!q.rowCount) return res.status(404).json({ error: 'Account not found.' });
  const u = q.rows[0];
  res.json({
    ...u,
    referral_link: `${FRONTEND_URL}?ref=${encodeURIComponent(u.referral_code)}`
  });
}));

app.get('/api/referrals', auth, asyncRoute(async (req, res) => {
  const q = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM accounts WHERE referred_by=$1) AS direct_referrals,
       (SELECT COALESCE(SUM(bonus),0) FROM referral_bonuses WHERE referrer_id=$1) AS bonus_points,
       (SELECT COALESCE(SUM(commission),0) FROM referral_commissions WHERE earner_id=$1) AS commission_points`,
    [req.user.id]
  );
  res.json(q.rows[0]);
}));

app.post('/api/wallet', auth, asyncRoute(async (req, res) => {
  const address = req.body && req.body.address;
  if (address !== null && (typeof address !== 'string' || address.length > 150)) {
    return res.status(400).json({ error: 'Invalid wallet address.' });
  }
  await pool.query('UPDATE accounts SET wallet_address=$1 WHERE id=$2', [address || null, req.user.id]);
  res.json({ message: address ? 'Wallet connected.' : 'Wallet disconnected.', wallet_address: address || null });
}));

// These are review requests, not automatic proof of following/joining.
// Admin must verify externally before approving.
app.post('/api/tasks/:task/request', auth, asyncRoute(async (req, res) => {
  const task = req.params.task;
  if (!['instagram', 'telegram'].includes(task)) return res.status(400).json({ error: 'Unknown task.' });
  const proof = typeof req.body?.proof_url === 'string' ? req.body.proof_url.trim() : null;
  if (proof && (!proof.startsWith('https://') || proof.length > 500)) {
    return res.status(400).json({ error: 'Proof link must be a valid HTTPS URL.' });
  }
  await pool.query(
    `INSERT INTO task_verifications(user_id,task_name,status,proof_url)
     VALUES($1,$2,'pending',$3)
     ON CONFLICT(user_id,task_name)
     DO UPDATE SET status=CASE WHEN task_verifications.status='approved' THEN 'approved' ELSE 'pending' END,
                   proof_url=EXCLUDED.proof_url, created_at=NOW()`,
    [req.user.id, task, proof]
  );
  const q = await pool.query('SELECT instagram_status,telegram_status FROM accounts WHERE id=$1', [req.user.id]);
  res.json({ message: 'Verification request submitted. Mining unlocks after approval.', ...q.rows[0] });
}));

app.post('/api/admin/verify-task', asyncRoute(async (req, res) => {
  if (!ADMIN_KEY || req.get('X-Admin-Key') !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized.' });
  const { user_id, task, decision } = req.body || {};
  if (!Number.isInteger(Number(user_id)) || !['instagram','telegram'].includes(task) ||
      !['approved','rejected'].includes(decision)) {
    return res.status(400).json({ error: 'Provide user_id, task (instagram/telegram), and decision (approved/rejected).' });
  }
  const col = task === 'instagram' ? 'instagram_status' : 'telegram_status';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE task_verifications SET status=$1,reviewed_at=NOW()
       WHERE user_id=$2 AND task_name=$3 RETURNING id`,
      [decision, Number(user_id), task]
    );
    if (!r.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No pending verification request found.' });
    }
    await client.query(`UPDATE accounts SET ${col}=$1 WHERE id=$2`, [decision, Number(user_id)]);
    await client.query('COMMIT');
    res.json({ message: `${task} marked ${decision}.` });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

app.post('/api/mine', auth, asyncRoute(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT id,points,last_mined_at,instagram_status,telegram_status
       FROM accounts WHERE id=$1 FOR UPDATE`,
      [req.user.id]
    );
    if (!locked.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Account not found.' });
    }
    const user = locked.rows[0];
    if (user.instagram_status !== 'approved' || user.telegram_status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Instagram and Telegram verification must both be approved before mining.' });
    }
    if (user.last_mined_at && new Date(user.last_mined_at).getTime() > Date.now() - 12*60*60*1000) {
      const next = new Date(new Date(user.last_mined_at).getTime() + 12*60*60*1000);
      await client.query('ROLLBACK');
      return res.status(429).json({ error: 'Mining cooldown is active.', next_mine_at: next });
    }

    const reward = '10.00000000';
    const updated = await client.query(
      `UPDATE accounts SET points=points+$1,last_mined_at=NOW()
       WHERE id=$2 RETURNING points,last_mined_at`,
      [reward, req.user.id]
    );
    await client.query('INSERT INTO mining_events(user_id,reward) VALUES($1,$2)', [req.user.id, reward]);

    // 0.1% of 10 points = 0.01 points to each available upline, up to 3 levels.
    let childId = req.user.id;
    for (let level=1; level<=3; level++) {
      const p = await client.query('SELECT referred_by FROM accounts WHERE id=$1', [childId]);
      const parentId = p.rows[0]?.referred_by;
      if (!parentId) break;
      await client.query('UPDATE accounts SET points=points+0.01 WHERE id=$1', [parentId]);
      await client.query(
        `INSERT INTO referral_commissions(earner_id,source_user_id,level,mining_reward,commission)
         VALUES($1,$2,$3,10,0.01)`,
        [parentId, req.user.id, level]
      );
      childId = parentId;
    }
    await client.query('COMMIT');
    const last = updated.rows[0].last_mined_at;
    res.json({
      message: 'Mining successful.',
      reward: 10,
      points: updated.rows[0].points,
      last_mined_at: last,
      next_mine_at: new Date(new Date(last).getTime() + 12*60*60*1000)
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

app.use((err, req, res, next) => {
  console.error(err);
  if (err.message === 'Origin not allowed by CORS') return res.status(403).json({ error: 'Origin not allowed.' });
  res.status(500).json({ error: 'Server error. Please try again later.' });
});

const port = Number(process.env.PORT || 10000);
app.listen(port, '0.0.0.0', () => console.log(`MTD Mining API listening on ${port}`));
