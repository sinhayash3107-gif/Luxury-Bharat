import crypto from 'node:crypto';
import { get, all, run, tx, now } from './db.js';
import { HttpError, bad, forbidden, sha256, randomToken, safeEqual } from './http.js';
import { getSetting } from './core.js';
import { config } from '../config.js';

// ---------- permissions ----------
export const STAFF_PERMS = ['products', 'orders', 'inventory', 'sections', 'banners', 'categories', 'support', 'analytics', 'customers', 'content', 'coupons'];
export const DEFAULT_ADMIN_PERMS = ['products', 'orders', 'inventory', 'sections', 'banners', 'categories', 'support', 'analytics', 'customers'];

// ---------- password hashing (scrypt, per-user salt) ----------
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scrypt = (pw, salt, len = 64) => new Promise((res, rej) => crypto.scrypt(pw, salt, len, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, , salt, key] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const k = await scrypt(pw, Buffer.from(salt, 'base64'));
  const expected = Buffer.from(key, 'base64');
  return k.length === expected.length && crypto.timingSafeEqual(k, expected);
}
// A dummy hash so unknown-user logins cost the same time as real ones.
let dummy; export const dummyHash = async () => (dummy ||= await hashPassword('not-a-real-password'));

const COMMON = new Set(['password123', 'password1234', '1234567890', 'qwerty12345', 'letmein1234', 'luxurybharat1', 'welcome1234']);
export function checkPassword(pw, { email, username } = {}) {
  const min = getSetting('security').min_password_length;
  if (typeof pw !== 'string' || pw.length < min) throw bad(`Password must be at least ${min} characters.`, { password: `At least ${min} characters` });
  if (pw.length > 200) throw bad('Password is too long.', { password: 'Too long' });
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password must include letters and numbers.', { password: 'Use letters and numbers' });
  const low = pw.toLowerCase();
  if (COMMON.has(low) || (email && low.includes(email.split('@')[0].toLowerCase()) && email.split('@')[0].length > 3) || (username && low === username.toLowerCase()))
    throw bad('That password is too easy to guess. Choose something less predictable.', { password: 'Too easy to guess' });
}

// ---------- users ----------
export function loadUser(row) {
  if (!row) return null;
  const permissions = row.role === 'owner' ? STAFF_PERMS : all('SELECT permission FROM user_permissions WHERE user_id=?', row.id).map((r) => r.permission);
  return { id: row.id, username: row.username, email: row.email, role: row.role, fullName: row.full_name, phone: row.phone, emailVerified: !!row.email_verified, disabled: !!row.disabled, notifyOrders: !!row.notify_orders, permissions, createdAt: row.created_at };
}
export const isStaff = (u) => u && (u.role === 'owner' || u.role === 'admin');
export function setPermissions(userId, perms) {
  const clean = [...new Set(perms)].filter((p) => STAFF_PERMS.includes(p));
  tx(() => { run('DELETE FROM user_permissions WHERE user_id=?', userId); for (const p of clean) run('INSERT INTO user_permissions VALUES (?,?)', userId, p); });
  return clean;
}

// ---------- sessions ----------
export const SESSION_COOKIE = 'lb_sid';
export function createSession(userId, ctx) {
  const token = randomToken(32), csrf = randomToken(24);
  const days = getSetting('security').session_days;
  run('INSERT INTO sessions(token_hash,user_id,csrf,ip,user_agent,created_at,last_seen,expires_at) VALUES (?,?,?,?,?,?,?,?)',
    sha256(token), userId, csrf, ctx.ip, String(ctx.req.headers['user-agent'] || '').slice(0, 200), now(), now(), new Date(Date.now() + days * 86400_000).toISOString());
  return { token, csrf, maxAge: days * 86400 };
}
export function resolveSession(token) {
  if (!token) return null;
  const s = get('SELECT * FROM sessions WHERE token_hash=?', sha256(token));
  if (!s) return null;
  if (s.expires_at < now()) { run('DELETE FROM sessions WHERE id=?', s.id); return null; }
  const u = get('SELECT * FROM users WHERE id=?', s.user_id);
  if (!u || u.disabled) { run('DELETE FROM sessions WHERE id=?', s.id); return null; }
  if (Date.now() - Date.parse(s.last_seen) > 300_000) run('UPDATE sessions SET last_seen=? WHERE id=?', now(), s.id);
  return { id: s.id, csrf: s.csrf, user: loadUser(u) };
}
export const destroySession = (token) => token && run('DELETE FROM sessions WHERE token_hash=?', sha256(token));
export const destroyUserSessions = (userId) => run('DELETE FROM sessions WHERE user_id=?', userId);
setInterval(() => { try { run('DELETE FROM sessions WHERE expires_at < ?', now()); run('DELETE FROM auth_tokens WHERE expires_at < ?', new Date(Date.now() - 7 * 86400_000).toISOString()); } catch { /* ignore */ } }, 3_600_000).unref();

// ---------- one-time tokens (verify / reset / invite) ----------
export function issueToken(kind, { userId = null, email = null, payload = null, ttlMs }) {
  const token = randomToken(32);
  run('UPDATE auth_tokens SET used_at=? WHERE kind=? AND used_at IS NULL AND (user_id IS ? AND email IS ?)', now(), kind, userId, email); // invalidate older ones
  run('INSERT INTO auth_tokens(user_id,kind,token_hash,email,payload,expires_at,created_at) VALUES (?,?,?,?,?,?,?)',
    userId, kind, sha256(token), email, payload ? JSON.stringify(payload) : null, new Date(Date.now() + ttlMs).toISOString(), now());
  return token;
}
export function peekToken(kind, token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const t = get('SELECT * FROM auth_tokens WHERE token_hash=? AND kind=?', sha256(token), kind);
  if (!t || t.used_at || t.expires_at < now()) return null;
  return t;
}
export function consumeToken(kind, token) {
  const t = peekToken(kind, token);
  if (!t) return null;
  const r = run('UPDATE auth_tokens SET used_at=? WHERE id=? AND used_at IS NULL', now(), t.id);
  return r.changes ? t : null; // atomic: a token can be consumed once
}

// ---------- brute-force lockout ----------
export function checkLocked(u) {
  if (u.locked_until && u.locked_until > now()) throw new HttpError(429, 'Too many failed attempts. This account is temporarily locked. Try again later or reset your password.');
}
export function recordFailure(u) {
  const sec = getSetting('security');
  const n = u.failed_logins + 1;
  if (n >= sec.max_failed_logins) run('UPDATE users SET failed_logins=0, locked_until=? WHERE id=?', new Date(Date.now() + sec.lockout_minutes * 60_000).toISOString(), u.id);
  else run('UPDATE users SET failed_logins=? WHERE id=?', n, u.id);
}
export const recordSuccess = (u) => (u.failed_logins || u.locked_until) && run('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?', u.id);

// ---------- guards (used as route middleware) ----------
export const requireAuth = (ctx) => { if (!ctx.user) throw new HttpError(401, 'Please sign in to continue.'); };
export const requireStaff = (ctx) => { requireAuth(ctx); if (!isStaff(ctx.user)) throw forbidden(); };
export const requireOwner = (ctx) => { requireAuth(ctx); if (ctx.user.role !== 'owner') throw forbidden('Only the owner can do this.'); };
/** Passes if the user is staff and holds at least one of the listed permissions (owner holds all). */
export const requirePerm = (...perms) => (ctx) => {
  requireStaff(ctx);
  if (ctx.user.role === 'owner') return;
  if (!perms.some((p) => ctx.user.permissions.includes(p))) throw forbidden();
};
export const hasPerm = (u, p) => u && (u.role === 'owner' || (u.role === 'admin' && u.permissions.includes(p)));

// ---------- owner one-time setup token ----------
let setupToken = config.setupToken;
export function ensureSetupToken() {
  if (get("SELECT 1 FROM users WHERE role='owner'")) return null;
  if (!setupToken) { setupToken = randomToken(18); console.log(`\n[setup] No owner exists yet.\n[setup] One-time owner setup token: ${setupToken}\n[setup] Open ${config.appUrl}/admin and use it to create the owner account (${config.ownerEmail}).\n`); }
  return setupToken;
}
export const checkSetupToken = (t) => !!setupToken && typeof t === 'string' && safeEqual(t, setupToken);
