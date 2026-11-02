import { GET, POST, PATCH, HttpError, bad, v, limit, rateLimit, cookie, sendJson, safeDecodeURIComponent } from '../lib/http.js';
import { get, run, tx, now } from '../lib/db.js';
import { config } from '../config.js';
import {
  hashPassword, verifyPassword, dummyHash, checkPassword, loadUser, createSession, destroySession, destroyUserSessions,
  SESSION_COOKIE, issueToken, peekToken, consumeToken, checkLocked, recordFailure, recordSuccess, requireAuth, ensureSetupToken, checkSetupToken, setPermissions,
} from '../lib/auth.js';
import { audit } from '../lib/core.js';
import { sendMail, emailHtml, fireAndForget, devOutbox } from '../lib/mail.js';

const USERNAME = /^[a-z0-9_.]{3,30}$/i;
const checkUsername = (u) => { if (!USERNAME.test(u)) throw bad('Username must be 3–30 characters: letters, numbers, dot or underscore.', { username: 'Invalid username' }); };
const phoneOk = (p) => /^[6-9]\d{9}$/.test(p);

function startSession(ctx, userId) {
  const s = createSession(userId, ctx);
  ctx.headers = { 'Set-Cookie': [cookie(SESSION_COOKIE, s.token, { maxAge: s.maxAge })] };
  return s;
}
function sendVerification(user) {
  const token = issueToken('verify', { userId: user.id, ttlMs: 24 * 3600_000 });
  const link = `${config.appUrl}/verify?token=${token}`;
  fireAndForget(sendMail({ eventKey: `verify:${user.id}:${token.slice(0, 10)}`, to: user.email, subject: 'Verify your Luxury Bharat email',
    text: `Welcome to Luxury Bharat. Verify your email to place orders:\n${link}\n\nThis link expires in 24 hours.`,
    html: emailHtml('Verify your email', ['Welcome to Luxury Bharat. Confirm your email address to start placing orders.', 'This link expires in 24 hours.'], { url: link, label: 'Verify email' }) }));
}

// ---------- session info ----------
GET('/api/me', (ctx) => ctx.user ? { user: ctx.user, csrf: ctx.session.csrf } : { user: null, csrf: null });

// ---------- one-time owner setup ----------
GET('/api/setup/status', () => ({ needsSetup: !get("SELECT 1 FROM users WHERE role='owner'"), ownerEmail: config.ownerEmail }));
POST('/api/setup/owner', limit('setup', 10, 15 * 60_000), async (ctx) => {
  if (get("SELECT 1 FROM users WHERE role='owner'")) throw new HttpError(404, 'Not found.');
  ensureSetupToken();
  if (!checkSetupToken(ctx.body.token)) throw new HttpError(403, 'Invalid setup token. Use the one printed in the server console (or OWNER_SETUP_TOKEN).');
  const email = v.email(ctx.body.email);
  if (email !== config.ownerEmail) throw bad(`The owner account must use ${config.ownerEmail}.`, { email: 'Not the configured owner email' });
  const username = v.str(ctx.body.username, 'username', { min: 3, max: 30 }); checkUsername(username);
  checkPassword(ctx.body.password, { email, username });
  const hash = await hashPassword(ctx.body.password);
  const id = tx(() => {
    if (get("SELECT 1 FROM users WHERE role='owner'")) throw new HttpError(404, 'Not found.');
    const r = run("INSERT INTO users(username,email,password_hash,role,email_verified,created_at,updated_at) VALUES (?,?,?,'owner',1,?,?)", username, email, hash, now(), now());
    return Number(r.lastInsertRowid);
  });
  ctx.user = loadUser(get('SELECT * FROM users WHERE id=?', id)); audit(ctx, 'owner.setup', 'user', id);
  const s = startSession(ctx, id);
  return { user: ctx.user, csrf: s.csrf };
});

// ---------- register / login / logout ----------
POST('/api/auth/register', limit('register', 8, 60 * 60_000), async (ctx) => {
  const email = v.email(ctx.body.email);
  const username = v.str(ctx.body.username, 'username', { min: 3, max: 30 }); checkUsername(username);
  const fullName = v.str(ctx.body.fullName, 'fullName', { max: 80, required: false });
  checkPassword(ctx.body.password, { email, username });
  if (email === config.ownerEmail) throw bad('This email is reserved. Use a different one.', { email: 'Reserved' });
  if (get('SELECT 1 FROM users WHERE email=?', email)) throw bad('An account with this email already exists.', { email: 'Already registered' });
  if (get('SELECT 1 FROM users WHERE username=?', username)) throw bad('That username is taken.', { username: 'Already taken' });
  const hash = await hashPassword(ctx.body.password);
  // NOTE: registering never grants staff access, even for allow-listed admin emails. Admins are provisioned by the owner via invite.
  const r = run("INSERT INTO users(username,email,password_hash,role,full_name,created_at,updated_at) VALUES (?,?,?,'customer',?,?,?)", username, email, hash, fullName, now(), now());
  const user = loadUser(get('SELECT * FROM users WHERE id=?', r.lastInsertRowid));
  sendVerification(user);
  const s = startSession(ctx, user.id);
  return { user, csrf: s.csrf };
});

POST('/api/auth/login', limit('login', 30, 15 * 60_000), async (ctx) => {
  const id = v.str(ctx.body.identifier, 'identifier', { max: 254 }).toLowerCase();
  const pw = v.str(ctx.body.password, 'password', { max: 200, trim: false });
  if (!rateLimit(`login-id:${id}`, 10, 15 * 60_000)) throw new HttpError(429, 'Too many attempts for this account. Try again in a few minutes.');
  const row = get('SELECT * FROM users WHERE email=? OR username=?', id, id);
  if (!row) { await verifyPassword(pw, await dummyHash()); throw new HttpError(401, 'Incorrect username/email or password.'); }
  checkLocked(row);
  if (!(await verifyPassword(pw, row.password_hash))) { recordFailure(row); throw new HttpError(401, 'Incorrect username/email or password.'); }
  if (row.disabled) throw new HttpError(403, 'This account has been disabled. Contact support.');
  recordSuccess(row);
  const user = loadUser(row); ctx.user = user;
  if (user.role !== 'customer') audit(ctx, 'auth.login', 'user', user.id);
  const s = startSession(ctx, user.id);
  return { user, csrf: s.csrf };
});

POST('/api/auth/logout', (ctx) => {
  const m = /lb_sid=([^;]+)/.exec(ctx.req.headers.cookie || '');
  if (m) destroySession(safeDecodeURIComponent(m[1]));
  ctx.headers = { 'Set-Cookie': [cookie(SESSION_COOKIE, '', { maxAge: 0 })] };
  return { ok: true };
});

// ---------- email verification ----------
POST('/api/auth/verify', limit('verify', 20, 15 * 60_000), (ctx) => {
  const t = consumeToken('verify', ctx.body.token);
  if (!t) throw bad('This verification link is invalid or has expired. Request a new one from your account.');
  run('UPDATE users SET email_verified=1, updated_at=? WHERE id=?', now(), t.user_id);
  return { ok: true };
});
POST('/api/auth/resend-verification', requireAuth, limit('resend', 5, 60 * 60_000), (ctx) => {
  if (ctx.user.emailVerified) return { ok: true, alreadyVerified: true };
  sendVerification(ctx.user);
  return { ok: true };
});

// ---------- password reset ----------
POST('/api/auth/forgot', limit('forgot', 6, 60 * 60_000), (ctx) => {
  const email = v.email(ctx.body.email);
  const u = get('SELECT * FROM users WHERE email=? AND disabled=0', email);
  if (u) {
    const token = issueToken('reset', { userId: u.id, ttlMs: 3600_000 });
    const link = `${config.appUrl}/reset?token=${token}`;
    fireAndForget(sendMail({ eventKey: `reset:${u.id}:${token.slice(0, 10)}`, to: u.email, subject: 'Reset your Luxury Bharat password',
      text: `Reset your password using this link (valid for 1 hour):\n${link}\n\nIf you did not request this, ignore this email.`,
      html: emailHtml('Reset your password', ['Use the button below to choose a new password. This link is valid for 1 hour.', 'If you did not request this, you can ignore this email.'], { url: link, label: 'Reset password' }) }));
  }
  return { ok: true, message: 'If an account exists for that email, a reset link is on its way.' }; // identical response either way
});
POST('/api/auth/reset', limit('reset', 10, 15 * 60_000), async (ctx) => {
  const t = peekToken('reset', ctx.body.token);
  if (!t) throw bad('This reset link is invalid or has expired. Request a new one.');
  const u = get('SELECT * FROM users WHERE id=?', t.user_id);
  checkPassword(ctx.body.password, { email: u.email, username: u.username });
  const hash = await hashPassword(ctx.body.password);
  if (!consumeToken('reset', ctx.body.token)) throw bad('This reset link has already been used.');
  run('UPDATE users SET password_hash=?, failed_logins=0, locked_until=NULL, updated_at=? WHERE id=?', hash, now(), u.id);
  destroyUserSessions(u.id); // every device is signed out
  return { ok: true };
});

// ---------- admin invitation acceptance (owner-provisioned) ----------
GET('/api/auth/invite', limit('invite-peek', 30, 15 * 60_000), (ctx) => {
  const t = peekToken('invite', ctx.query.token);
  if (!t) throw bad('This invitation is invalid or has expired. Ask the owner for a new one.');
  const existing = get('SELECT username FROM users WHERE email=?', t.email);
  return { email: t.email, existingUsername: existing?.username || null };
});
POST('/api/auth/accept-invite', limit('invite', 10, 15 * 60_000), async (ctx) => {
  const t = peekToken('invite', ctx.body.token);
  if (!t) throw bad('This invitation is invalid or has expired. Ask the owner for a new one.');
  if (!config.adminAllowlist.includes(t.email)) throw new HttpError(403, 'This email is no longer on the authorised admin list.');
  const existing = get('SELECT * FROM users WHERE email=?', t.email);
  let username = existing?.username;
  if (!existing) { username = v.str(ctx.body.username, 'username', { min: 3, max: 30 }); checkUsername(username); if (get('SELECT 1 FROM users WHERE username=?', username)) throw bad('That username is taken.', { username: 'Already taken' }); }
  checkPassword(ctx.body.password, { email: t.email, username });
  const hash = await hashPassword(ctx.body.password);
  const perms = JSON.parse(t.payload || '[]');
  const id = tx(() => {
    if (!consumeToken('invite', ctx.body.token)) throw bad('This invitation has already been used.');
    let uid;
    if (existing) { run("UPDATE users SET role='admin', password_hash=?, email_verified=1, disabled=0, updated_at=? WHERE id=? AND role<>'owner'", hash, now(), existing.id); uid = existing.id; }
    else uid = Number(run("INSERT INTO users(username,email,password_hash,role,email_verified,created_at,updated_at) VALUES (?,?,?,'admin',1,?,?)", username, t.email, hash, now(), now()).lastInsertRowid);
    setPermissions(uid, perms);
    return uid;
  });
  destroyUserSessions(id);
  ctx.user = loadUser(get('SELECT * FROM users WHERE id=?', id)); audit(ctx, 'admin.invite.accepted', 'user', id, { email: t.email });
  const s = startSession(ctx, id);
  return { user: ctx.user, csrf: s.csrf };
});

// ---------- account ----------
PATCH('/api/account/profile', requireAuth, (ctx) => {
  const fullName = v.str(ctx.body.fullName, 'fullName', { max: 80, required: false });
  const phone = v.str(ctx.body.phone, 'phone', { max: 10, required: false });
  if (phone && !phoneOk(phone)) throw bad('Enter a valid 10-digit Indian mobile number.', { phone: 'Invalid phone' });
  let username = ctx.user.username;
  if (ctx.body.username && ctx.body.username !== username) {
    username = v.str(ctx.body.username, 'username', { min: 3, max: 30 }); checkUsername(username);
    if (get('SELECT 1 FROM users WHERE username=? AND id<>?', username, ctx.user.id)) throw bad('That username is taken.', { username: 'Already taken' });
  }
  run('UPDATE users SET full_name=?, phone=?, username=?, updated_at=? WHERE id=?', fullName, phone, username, now(), ctx.user.id);
  return { user: loadUser(get('SELECT * FROM users WHERE id=?', ctx.user.id)) };
});
POST('/api/account/password', requireAuth, limit('pwchange', 10, 60 * 60_000), async (ctx) => {
  const row = get('SELECT * FROM users WHERE id=?', ctx.user.id);
  if (!(await verifyPassword(String(ctx.body.current || ''), row.password_hash))) throw bad('Your current password is incorrect.', { current: 'Incorrect' });
  checkPassword(ctx.body.password, { email: row.email, username: row.username });
  run('UPDATE users SET password_hash=?, updated_at=? WHERE id=?', await hashPassword(ctx.body.password), now(), row.id);
  destroyUserSessions(row.id);
  const s = startSession(ctx, row.id);
  return { ok: true, csrf: s.csrf };
});

// ---------- development helpers (never registered in production) ----------
if (!config.prod) GET('/api/dev/outbox', () => ({ note: 'Development only: emails that would have been sent.', emails: devOutbox(50) }));
