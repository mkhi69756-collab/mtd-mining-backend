
const ALLOWED_ORIGIN = "https://mkhi69756-collab.github.io";
const MINING_COOLDOWN_HOURS = 12;
const MINING_REWARD = 10;
const COMMISSION_RATES = [0.05, 0.02, 0.01];

function response(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret",
      "Content-Type": "application/json"
    }
  });
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function hashPassword(password, saltText) {
  const salt = saltText || base64url(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: decodeBase64url(salt),
    iterations: 100000,
    hash: "SHA-256"
  }, key, 256);

  return `${salt}.${base64url(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(".");
  const actual = await hashPassword(password, salt);
  return actual.split(".")[1] === expected;
}

async function createToken(user, secret) {
  const header = base64url(new TextEncoder().encode(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ));

  const payload = base64url(new TextEncoder().encode(
    JSON.stringify({
      id: user.id,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    })
  ));

  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );

  return `${data}.${base64url(new Uint8Array(signature))}`;
}

async function authenticate(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");

  if (parts.length !== 3 || !env.JWT_SECRET) return null;

  try {
    const data = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64url(parts[2]),
      new TextEncoder().encode(data)
    );

    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64url(parts[1]))
    );

    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return await env.DB.prepare(
      "SELECT id, full_name, email, points, referral_code, wallet_address, instagram_status, telegram_status, last_mined_at FROM accounts WHERE id = ?"
    ).bind(payload.id).first();
  } catch {
    return null;
  }
}

function referralCode() {
  return "MTD" + base64url(crypto.getRandomValues(new Uint8Array(9))).toUpperCase();
}

async function getUser(request, env) {
  const user = await authenticate(request, env);
  return user;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret"
        }
      });
    }

    if (origin && origin !== ALLOWED_ORIGIN) {
      return response({ error: "Origin not allowed" }, 403);
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/" || path === "/api/health") {
        return response({
          status: "online",
          message: "MTD Mining Backend Running!",
          database: env.DB ? "configured" : "not configured"
        });
      }

      if (!env.DB) {
        return response({ error: "Database not configured" }, 500);
      }

      if (!env.JWT_SECRET) {
        return response({ error: "JWT_SECRET is not configured" }, 500);
      }

      // REGISTER
      if (path === "/api/signup" && request.method === "POST") {
        const body = await request.json();
        const fullName = String(body.fullName || body.full_name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        const referral = String(body.referralCode || body.referral_code || "").trim();

        if (!fullName || !email || password.length < 8) {
          return response({
            error: "Name, valid email and password of at least 8 characters are required"
          }, 400);
        }

        const existing = await env.DB.prepare(
          "SELECT id FROM accounts WHERE email = ?"
        ).bind(email).first();

        if (existing) return response({ error: "Email already registered" }, 409);

        let referrer = null;

        if (referral) {
          referrer = await env.DB.prepare(
            "SELECT id FROM accounts WHERE referral_code = ?"
          ).bind(referral).first();

          if (!referrer) return response({ error: "Invalid referral code" }, 400);
        }

        const passwordHash = await hashPassword(password);
        const code = referralCode();

        const result = await env.DB.prepare(`
          INSERT INTO accounts
          (full_name, email, password_hash, referral_code, referred_by)
          VALUES (?, ?, ?, ?, ?)
        `).bind(fullName, email, passwordHash, code, referrer?.id || null).run();

        const userId = result.meta.last_row_id;

        if (referrer) {
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE accounts SET points = points + 100 WHERE id = ?"
            ).bind(referrer.id),
            env.DB.prepare(`
              INSERT INTO referral_bonuses
              (referrer_id, referred_user_id, bonus)
              VALUES (?, ?, 100)
            `).bind(referrer.id, userId)
          ]);
        }

        const user = await env.DB.prepare(
          "SELECT id, full_name, email, points, referral_code FROM accounts WHERE id = ?"
        ).bind(userId).first();

        const token = await createToken(user, env.JWT_SECRET);
        return response({ message: "Registration successful", token, user }, 201);
      }

      // LOGIN
      if (path === "/api/login" && request.method === "POST") {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        const account = await env.DB.prepare(
          "SELECT * FROM accounts WHERE email = ?"
        ).bind(email).first();

        if (!account || !(await verifyPassword(password, account.password_hash))) {
          return response({ error: "Invalid email or password" }, 401);
        }

        const token = await createToken(account, env.JWT_SECRET);
        const user = {
          id: account.id,
          full_name: account.full_name,
          email: account.email,
          points: account.points,
          referral_code: account.referral_code
        };

        return response({ message: "Login successful", token, user });
      }

      // ALL ROUTES BELOW REQUIRE LOGIN
      const user = await getUser(request, env);
      if (!user) return response({ error: "Please login first" }, 401);

      // PROFILE
      if (path === "/api/me" && request.method === "GET") {
        return response({ user });
      }

      // REFERRALS
      if (path === "/api/referrals" && request.method === "GET") {
        const result = await env.DB.prepare(`
          SELECT id, full_name, email, created_at
          FROM accounts WHERE referred_by = ?
          ORDER BY id DESC
        `).bind(user.id).all();

        return response({
          referral_code: user.referral_code,
          referrals: result.results
        });
      }

      // WALLET
      if (path === "/api/wallet" && request.method === "GET") {
        return response({
          points: user.points,
          wallet_address: user.wallet_address
        });
      }

      if (path === "/api/wallet" && request.method === "POST") {
        const body = await request.json();
        const address = String(body.wallet_address || body.walletAddress || "").trim();

        if (address.length > 200) {
          return response({ error: "Wallet address is too long" }, 400);
        }

        await env.DB.prepare(
          "UPDATE accounts SET wallet_address = ? WHERE id = ?"
        ).bind(address, user.id).run();

        return response({ message: "Wallet updated", wallet_address: address });
      }

      // TASK REQUEST
      if (path.startsWith("/api/tasks/") && path.endsWith("/request") &&
          request.method === "POST") {
        const taskName = path.split("/")[3];

        if (!["instagram", "telegram"].includes(taskName)) {
          return response({ error: "Invalid task" }, 400);
        }

        const body = await request.json();
        const proof = String(body.proof_url || body.proofUrl || "").trim();

        if (proof.length > 1000) {
          return response({ error: "Proof link is too long" }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO task_verifications (user_id, task_name, proof_url, status)
          VALUES (?, ?, ?, 'pending')
          ON CONFLICT(user_id, task_name) DO UPDATE SET
          proof_url = excluded.proof_url,
          status = 'pending',
          created_at = CURRENT_TIMESTAMP,
          reviewed_at = NULL
        `).bind(user.id, taskName, proof).run();

        await env.DB.prepare(
          `UPDATE accounts SET ${taskName}_status = 'pending' WHERE id = ?`
        ).bind(user.id).run();

        return response({ message: "Task submitted for review" });
      }

      // ADMIN TASK APPROVAL
      if (path === "/api/admin/verify-task" && request.method === "POST") {
        if (!env.ADMIN_SECRET ||
            request.headers.get("X-Admin-Secret") !== env.ADMIN_SECRET) {
          return response({ error: "Admin access denied" }, 403);
        }

        const body = await request.json();
        const taskName = String(body.task_name || body.taskName || "");
        const status = String(body.status || "");
        const targetId = Number(body.user_id || body.userId);

        if (!["instagram", "telegram"].includes(taskName) ||
            !["approved", "rejected"].includes(status) ||
            !Number.isInteger(targetId)) {
          return response({ error: "Invalid verification details" }, 400);
        }

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE task_verifications
            SET status = ?, reviewed_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND task_name = ?
          `).bind(status, targetId, taskName),
          env.DB.prepare(`
            UPDATE accounts SET ${taskName}_status = ?
            WHERE id = ?
          `).bind(status, targetId)
        ]);

        return response({ message: `Task ${status}` });
      }

      // MINING (REWARDS INTERNAL POINTS, NOT REAL CRYPTOCURRENCY)
      if (path === "/api/mine" && request.method === "POST") {
        const current = await env.DB.prepare(
          "SELECT * FROM accounts WHERE id = ?"
        ).bind(user.id).first();

        if (current.instagram_status !== "approved" ||
            current.telegram_status !== "approved") {
          return response({
            error: "Please complete and get both tasks approved first"
          }, 403);
        }

        if (current.last_mined_at) {
          const last = new Date(current.last_mined_at).getTime();
          const elapsed = Date.now() - last;
          const wait = MINING_COOLDOWN_HOURS * 60 * 60 * 1000;

          if (elapsed < wait) {
            return response({
              error: "Mining cooldown active",
              remaining_ms: wait - elapsed
            }, 429);
          }
        }

        const updates = [
          env.DB.prepare(
            "UPDATE accounts SET points = points + ?, last_mined_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).bind(MINING_REWARD, user.id),
          env.DB.prepare(
            "INSERT INTO mining_events (user_id, reward) VALUES (?, ?)"
          ).bind(user.id, MINING_REWARD)
        ];

        let parentId = current.referred_by;

        for (let level = 0; level < 3 && parentId; level++) {
          const parent = await env.DB.prepare(
            "SELECT id, referred_by FROM accounts WHERE id = ?"
          ).bind(parentId).first();

          if (!parent) break;

          const commission = MINING_REWARD * COMMISSION_RATES[level];

          updates.push(
            env.DB.prepare(
              "UPDATE accounts SET points = points + ? WHERE id = ?"
            ).bind(commission, parent.id),
            env.DB.prepare(`
              INSERT INTO referral_commissions
              (earner_id, source_user_id, level, mining_reward, commission)
              VALUES (?, ?, ?, ?, ?)
            `).bind(parent.id, user.id, level + 1, MINING_REWARD, commission)
          );

          parentId = parent.referred_by;
        }

        await env.DB.batch(updates);

        return response({
          message: "Mining reward credited",
          reward: MINING_REWARD,
          commission_rates: COMMISSION_RATES
        });
      }

      return response({ error: "Route not found" }, 404);

    } catch (error) {
      return response({
        error: "Server error",
        details: error.message
      }, 500);
    }
  }
};
                             
