'use strict';
/*
 * Optional accounts for LabPrep AI. Turned on by one setting, DATABASE_URL, holding the connection string of a free
 * Neon Postgres database (https://neon.com). No extra npm package is needed: Neon speaks SQL over plain HTTPS.
 *
 * Without DATABASE_URL this file does nothing and the site keeps everything in each visitor's browser instead.
 *
 * What is stored, per account: the email, a salted scrypt password hash, login sessions (only a hash of the cookie
 * value), the student's subjects and their experiments (the same JSON the browser already keeps).
 */
const crypto = require('crypto');

const SESSION_MS = 30 * 24 * 3600 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@.]{2,}$/;

const cleanEnv = (v) => String(v || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
const DB_VARS = ['DATABASE_URL', 'NEON_DATABASE_URL', 'POSTGRES_URL'];
function findDbUrl() {
  for (const want of DB_VARS) {
    const name = Object.keys(process.env).find((k) => k.trim().toUpperCase() === want && cleanEnv(process.env[k]));
    if (name) return cleanEnv(process.env[name]);
  }
  return '';
}

module.exports = function createAccounts({ HttpError, readBody, sendJson, rateLimit }) {
  const MAX_USERS = Number(process.env.MAX_USERS) || 500;
  const MAX_ITEMS = Number(process.env.MAX_EXPERIMENTS_PER_USER) || 60;
  const MAX_SUBJECTS = 100;
  const MAX_ITEM_BYTES = 700 * 1024;

  /* ---------- are we configured? ---------- */
  const raw = findDbUrl();
  const override = cleanEnv(process.env.DATABASE_HTTP_URL); // advanced: point at another SQL-over-HTTP endpoint (used by tests)
  let note = '';
  let endpoint = null;
  if (!raw) note = 'No DATABASE_URL setting was found, so experiments are saved in each browser only.';
  else if (!/^postgres(ql)?:\/\//i.test(raw)) note = 'DATABASE_URL does not look like a Postgres connection string. It should start with postgresql://';
  else {
    let host = '';
    try { host = new URL(raw).hostname; } catch { note = 'DATABASE_URL could not be read. Copy the connection string again from Neon.'; }
    if (!note) {
      if (override) endpoint = override;
      else if (/neon\.(tech|build)$/i.test(host)) endpoint = `https://${host}/sql`;
      else note = 'Only Neon databases are supported (their address ends in neon.tech). Create a free one at neon.com and paste its connection string.';
    }
  }
  const enabled = !!endpoint;

  /* ---------- tiny SQL-over-HTTP client ---------- */
  async function dbCall(body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': raw, 'Neon-Raw-Text-Output': 'true', 'Neon-Array-Mode': 'true' },
        body: JSON.stringify(body)
      });
    } catch (err) {
      const e = new Error(err && err.name === 'AbortError' ? 'database timed out' : 'database unreachable'); e.db = true; throw e;
    } finally { clearTimeout(timer); }
    let payload = null;
    try { payload = await res.json(); } catch {}
    if (!res.ok) { const e = new Error(`database error: ${(payload && payload.message) || 'HTTP ' + res.status}`); e.db = true; throw e; }
    return payload || {};
  }
  const toRows = (r) => {
    const names = (r.fields || []).map((f) => f.name);
    return (r.rows || []).map((row) => Object.fromEntries(names.map((n, i) => [n, row[i]])));
  };
  const P = (params) => params.map((v) => (v == null ? null : String(v)));
  const q = async (query, params = []) => toRows(await dbCall({ query, params: P(params) }));
  const tx = async (list) => {
    const r = await dbCall({ queries: list.map(([query, params = []]) => ({ query, params: P(params) })) });
    return (r.results || []).map(toRows);
  };

  let schemaReady = null;
  function ensureSchema() {
    if (!schemaReady) {
      schemaReady = tx([
        ['CREATE TABLE IF NOT EXISTS lp_users (id text PRIMARY KEY, email text UNIQUE NOT NULL, pass_hash text NOT NULL, created_at bigint NOT NULL)'],
        ['CREATE TABLE IF NOT EXISTS lp_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL, expires_at bigint NOT NULL)'],
        ['CREATE INDEX IF NOT EXISTS lp_sessions_user ON lp_sessions (user_id)'],
        ['CREATE TABLE IF NOT EXISTS lp_subjects (user_id text NOT NULL, id text NOT NULL, name text NOT NULL, color text NOT NULL, pos integer NOT NULL, PRIMARY KEY (user_id, id))'],
        ['CREATE TABLE IF NOT EXISTS lp_items (user_id text NOT NULL, id text NOT NULL, data text NOT NULL, updated_at bigint NOT NULL, PRIMARY KEY (user_id, id))']
      ]).catch((err) => { schemaReady = null; throw err; });
    }
    return schemaReady;
  }

  // Database trouble should look like "try again", never a stack trace, and never leak connection details.
  async function guard(fn) {
    try { await ensureSchema(); return await fn(); }
    catch (err) {
      if (err && err.db) { console.error('Account database problem:', err.message); throw new HttpError(503, 'The account database is not reachable right now. Please try again in a moment.'); }
      throw err;
    }
  }

  /* ---------- passwords & sessions ---------- */
  const scrypt = (pw, salt) => new Promise((resolve, reject) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));
  async function hashPassword(pw) {
    const salt = crypto.randomBytes(16);
    return `s1$${salt.toString('hex')}$${(await scrypt(pw, salt)).toString('hex')}`;
  }
  async function checkPassword(pw, stored) {
    const [v, s, h] = String(stored || '').split('$');
    if (v !== 's1' || !s || !h) return false;
    const k = await scrypt(pw, Buffer.from(s, 'hex'));
    const hb = Buffer.from(h, 'hex');
    return hb.length === k.length && crypto.timingSafeEqual(hb, k);
  }
  const DUMMY_HASH = `s1$${'00'.repeat(16)}$${'00'.repeat(64)}`;
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

  function cookieValue(req, name) {
    const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(req.headers.cookie || '');
    return m ? decodeURIComponent(m[1]) : '';
  }
  const isHttps = (req) => !!req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  function setCookie(req, res, value, maxAgeSec) {
    res.setHeader('Set-Cookie', `lp_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`);
  }

  const sessionCache = new Map(); // token hash -> { user, until }: saves a database round trip on most requests
  async function startSession(req, res, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await tx([
      ['DELETE FROM lp_sessions WHERE user_id = $1 AND expires_at < $2', [userId, Date.now()]],
      ['INSERT INTO lp_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha(token), userId, Date.now() + SESSION_MS]]
    ]);
    setCookie(req, res, token, Math.floor(SESSION_MS / 1000));
  }

  async function getUser(req) {
    if (!enabled) return null;
    const token = cookieValue(req, 'lp_session');
    if (!token || token.length < 20) return null;
    const h = sha(token);
    const hit = sessionCache.get(h);
    if (hit && hit.until > Date.now()) return hit.user;
    return guard(async () => {
      const rows = await q('SELECT u.id AS id, u.email AS email FROM lp_sessions s JOIN lp_users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2', [h, Date.now()]);
      const user = rows[0] ? { id: rows[0].id, email: rows[0].email } : null;
      if (user) {
        if (sessionCache.size > 2000) sessionCache.clear();
        sessionCache.set(h, { user, until: Date.now() + 60000 });
      }
      return user;
    });
  }

  // State-changing requests must carry a custom header. A web page on another site cannot add one without
  // permission, which blocks cross-site request forgery even if cookie rules ever change.
  function needHeader(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-labprep'] !== '1') throw new HttpError(400, 'Please reload the page and try again.');
  }
  async function requireUser(req) {
    needHeader(req);
    const user = await getUser(req);
    if (!user) throw new HttpError(401, 'Please sign in to continue.', 'login');
    return user;
  }

  async function jsonBody(req, limit = 64 * 1024) {
    const buf = await readBody(req, limit, 'That request is too large.');
    try { return buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw new HttpError(400, 'Invalid request.'); }
  }
  const normEmail = (e) => String(e || '').trim().toLowerCase();
  function checkCreds(b, forRegister) {
    const email = normEmail(b.email), password = String(b.password == null ? '' : b.password);
    if (!EMAIL_RE.test(email) || email.length > 120) throw new HttpError(400, 'Enter a valid email address.');
    if (forRegister && password.length < 8) throw new HttpError(400, 'Use a password with at least 8 characters.');
    if (password.length > 200) throw new HttpError(400, 'That password is too long.');
    return { email, password };
  }

  /* ---------- library (subjects + experiments) ---------- */
  function cleanSubjects(list) {
    if (!Array.isArray(list) || list.length > MAX_SUBJECTS) throw new HttpError(400, `You can have up to ${MAX_SUBJECTS} subjects.`);
    return list.map((s, i) => {
      if (!s || !ID_RE.test(String(s.id))) throw new HttpError(400, 'Invalid subject.');
      const name = String(s.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!name) throw new HttpError(400, 'A subject needs a name.');
      return { id: String(s.id), name, color: /^#[0-9a-fA-F]{6}$/.test(String(s.color)) ? String(s.color) : '#0F766E', pos: i };
    });
  }

  async function handle(req, res, pathname) {
    const isAcct = pathname.startsWith('/api/auth/') || pathname === '/api/account/delete' || pathname === '/api/library' || pathname === '/api/sync';
    if (!isAcct) return false;
    if (!enabled) throw new HttpError(404, 'Accounts are not set up on this site.');

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      needHeader(req);
      rateLimit(req, 'register', 10);
      const { email, password } = checkCreds(await jsonBody(req), true);
      const hash = await hashPassword(password);
      return guard(async () => {
        if (Number((await q('SELECT count(*) AS n FROM lp_users'))[0].n) >= MAX_USERS) throw new HttpError(403, 'This site is not accepting new accounts right now.');
        if ((await q('SELECT id FROM lp_users WHERE email = $1', [email]))[0]) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
        const id = crypto.randomBytes(12).toString('hex');
        try { await q('INSERT INTO lp_users (id, email, pass_hash, created_at) VALUES ($1, $2, $3, $4)', [id, email, hash, Date.now()]); }
        catch (err) { if (/unique|duplicate/i.test(err.message)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.'); throw err; }
        await startSession(req, res, id);
        sendJson(res, 200, { user: { id, email } });
        return true;
      });
    }
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      needHeader(req);
      rateLimit(req, 'login', 20, 15 * 60 * 1000);
      const { email, password } = checkCreds(await jsonBody(req), false);
      return guard(async () => {
        const row = (await q('SELECT id, pass_hash FROM lp_users WHERE email = $1', [email]))[0];
        const good = await checkPassword(password, row ? row.pass_hash : DUMMY_HASH); // same work whether or not the email exists
        if (!row || !good) throw new HttpError(401, 'Wrong email or password.');
        await startSession(req, res, row.id);
        sendJson(res, 200, { user: { id: row.id, email } });
        return true;
      });
    }
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      needHeader(req);
      const token = cookieValue(req, 'lp_session');
      if (token) {
        sessionCache.delete(sha(token));
        try { await guard(() => q('DELETE FROM lp_sessions WHERE token_hash = $1', [sha(token)])); } catch {}
      }
      setCookie(req, res, '', 0);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (pathname === '/api/account/delete' && req.method === 'POST') {
      const user = await requireUser(req);
      rateLimit(req, 'login', 20, 15 * 60 * 1000);
      const b = await jsonBody(req);
      return guard(async () => {
        const row = (await q('SELECT pass_hash FROM lp_users WHERE id = $1', [user.id]))[0];
        if (!row || !(await checkPassword(String(b.password || ''), row.pass_hash))) throw new HttpError(401, 'That password is not right.');
        await tx([
          ['DELETE FROM lp_items WHERE user_id = $1', [user.id]],
          ['DELETE FROM lp_subjects WHERE user_id = $1', [user.id]],
          ['DELETE FROM lp_sessions WHERE user_id = $1', [user.id]],
          ['DELETE FROM lp_users WHERE id = $1', [user.id]]
        ]);
        sessionCache.clear();
        setCookie(req, res, '', 0);
        sendJson(res, 200, { ok: true });
        return true;
      });
    }
    if (pathname === '/api/library' && req.method === 'GET') {
      const user = await requireUser(req);
      return guard(async () => {
        const subjects = await q('SELECT id, name, color FROM lp_subjects WHERE user_id = $1 ORDER BY pos', [user.id]);
        const items = (await q('SELECT data FROM lp_items WHERE user_id = $1', [user.id])).map((r) => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        sendJson(res, 200, { subjects, items, limits: { experiments: MAX_ITEMS } });
        return true;
      });
    }
    if (pathname === '/api/sync' && req.method === 'POST') {
      const user = await requireUser(req);
      const b = await jsonBody(req, 12 * 1024 * 1024);
      const subjects = b.subjects === undefined ? null : cleanSubjects(b.subjects);
      const upserts = (Array.isArray(b.upsert) ? b.upsert : []).map((it) => {
        if (!it || typeof it !== 'object' || !ID_RE.test(String(it.id))) throw new HttpError(400, 'Invalid experiment.');
        const data = JSON.stringify(it);
        if (data.length > MAX_ITEM_BYTES) throw new HttpError(413, 'One experiment is too large to save to your account (very long PDFs). Split the PDF and upload the parts separately.');
        return { id: String(it.id), data };
      });
      const removes = (Array.isArray(b.remove) ? b.remove : []).map(String).filter((id) => ID_RE.test(id));
      return guard(async () => {
        const have = (await q('SELECT id FROM lp_items WHERE user_id = $1', [user.id])).map((r) => r.id);
        const final = new Set(have.filter((id) => !removes.includes(id)));
        upserts.forEach((u) => final.add(u.id));
        if (final.size > MAX_ITEMS) throw new HttpError(409, `Your account can hold ${MAX_ITEMS} experiments. Delete some you no longer need first.`);
        const now = Date.now();
        const list = [];
        if (subjects) {
          list.push(['DELETE FROM lp_subjects WHERE user_id = $1', [user.id]]);
          subjects.forEach((s) => list.push(['INSERT INTO lp_subjects (user_id, id, name, color, pos) VALUES ($1, $2, $3, $4, $5)', [user.id, s.id, s.name, s.color, s.pos]]));
        }
        upserts.forEach((u) => list.push(['INSERT INTO lp_items (user_id, id, data, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at', [user.id, u.id, u.data, now]]));
        removes.forEach((id) => list.push(['DELETE FROM lp_items WHERE user_id = $1 AND id = $2', [user.id, id]]));
        if (list.length) await tx(list);
        sendJson(res, 200, { ok: true });
        return true;
      });
    }
    throw new HttpError(405, 'Method not allowed.');
  }

  return {
    enabled, note, getUser, requireUser, handle, ensureSchema: () => guard(async () => true),
    info: () => ({ enabled, note: enabled ? '' : note, maxExperiments: MAX_ITEMS })
  };
};
