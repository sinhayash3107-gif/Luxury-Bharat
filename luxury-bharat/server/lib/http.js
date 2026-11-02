import crypto from 'node:crypto';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}
export const bad = (msg, fields) => new HttpError(400, msg, fields);
export const forbidden = (msg = 'You do not have permission to do this.') => new HttpError(403, msg);
export const notFound = (msg = 'Not found.') => new HttpError(404, msg);

// ---------- router ----------
const routes = [];
export function route(method, pattern, ...handlers) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handlers });
}
export const GET = (p, ...h) => route('GET', p, ...h);
export const POST = (p, ...h) => route('POST', p, ...h);
export const PUT = (p, ...h) => route('PUT', p, ...h);
export const PATCH = (p, ...h) => route('PATCH', p, ...h);
export const DEL = (p, ...h) => route('DELETE', p, ...h);
export function matchRoute(method, path) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
      return { handlers: r.handlers, params };
    }
  }
  return null;
}
export const pathExistsForOtherMethod = (path) => routes.some((r) => r.re.test(path));

// ---------- request helpers ----------
export function clientIp(req) {
  if (config.trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { req.resume(); return reject(new HttpError(413, 'Request body too large.')); }
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request body too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
export async function readJson(req, limit = 1_000_000) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { const v = JSON.parse(buf.toString('utf8')); return v && typeof v === 'object' ? v : {}; }
  catch { throw bad('Request body is not valid JSON.'); }
}

export function safeDecodeURIComponent(value) {
  if (value === undefined || value === null) return value;
  try { return decodeURIComponent(String(value)); }
  catch { return String(value); }
}
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = safeDecodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function cookie(name, value, { maxAge, httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (httpOnly) c += '; HttpOnly';
  if (config.prod || config.appUrl.startsWith('https://')) c += '; Secure';
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

// ---------- responses ----------
export function securityHeaders(res) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' https:",
    "connect-src 'self' https://lumberjack.razorpay.com",
    "frame-src 'self' https://api.razorpay.com",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

// ---------- rate limiting (in-memory sliding window) ----------
const hits = new Map();
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 3_600_000) hits.delete(k); }, 300_000).unref();
/** Returns true if allowed. */
export function rateLimit(key, max, windowMs) {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(t); hits.set(key, arr); return true;
}
export function limit(name, max, windowMs) {
  return (ctx) => { if (!rateLimit(`${name}:${ctx.ip}`, max, windowMs)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.'); };
}
export const resetRateLimits = () => hits.clear();

export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// ---------- validation helpers ----------
export const v = {
  str(val, name, { min = 0, max = 500, required = true, trim = true } = {}) {
    if (val === undefined || val === null || val === '') { if (required) throw bad(`${name} is required.`, { [name]: 'Required' }); return null; }
    if (typeof val !== 'string') throw bad(`${name} must be text.`, { [name]: 'Must be text' });
    const s = trim ? val.trim() : val;
    if (required && !s) throw bad(`${name} is required.`, { [name]: 'Required' });
    if (s.length < min) throw bad(`${name} must be at least ${min} characters.`, { [name]: `Min ${min} characters` });
    if (s.length > max) throw bad(`${name} must be at most ${max} characters.`, { [name]: `Max ${max} characters` });
    return s;
  },
  int(val, name, { min = -Infinity, max = Infinity, required = true } = {}) {
    if (val === undefined || val === null || val === '') { if (required) throw bad(`${name} is required.`, { [name]: 'Required' }); return null; }
    const n = Number(val);
    if (!Number.isInteger(n)) throw bad(`${name} must be a whole number.`, { [name]: 'Whole number required' });
    if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}.`, { [name]: `Between ${min} and ${max}` });
    return n;
  },
  bool: (val) => (val === true || val === 1 || val === '1' || val === 'true' ? 1 : 0),
  oneOf(val, name, list, { required = true } = {}) {
    if ((val === undefined || val === null || val === '') && !required) return null;
    if (!list.includes(val)) throw bad(`${name} must be one of: ${list.join(', ')}.`, { [name]: 'Invalid choice' });
    return val;
  },
  email(val, name = 'email') {
    const s = v.str(val, name, { max: 254 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw bad('Enter a valid email address.', { [name]: 'Invalid email' });
    return s;
  },
  /** Only allow our own upload paths or https URLs for images/videos stored in the DB. */
  url(val, name, { required = false } = {}) {
    if (val === undefined || val === null || val === '') { if (required) throw bad(`${name} is required.`, { [name]: 'Required' }); return null; }
    const s = String(val).trim();
    if (s.startsWith('/uploads/') && !s.includes('..')) return s;
    if (/^https:\/\/[^\s"'<>]+$/.test(s)) return s;
    throw bad(`${name} must be an uploaded image or an https link.`, { [name]: 'Invalid link' });
  },
  /** Internal navigation path or https link (for CTA buttons). Blocks javascript: and data: URLs. */
  link(val, name) {
    if (val === undefined || val === null || val === '') return null;
    const s = String(val).trim();
    if (/^\/(?!\/)[^\s"'<>]*$/.test(s) || /^https:\/\/[^\s"'<>]+$/.test(s) || /^#[\w-]*$/.test(s)) return s;
    throw bad(`${name} must start with / or https://`, { [name]: 'Invalid link' });
  },
  color(val, name) {
    if (val === undefined || val === null || val === '') return null;
    if (!/^#[0-9a-fA-F]{6}$/.test(String(val))) throw bad(`${name} must be a hex colour like #D4AF37.`, { [name]: 'Invalid colour' });
    return String(val);
  },
};

export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item';
export function uniqueSlug(base, exists) {
  let s = slugify(base), i = 2;
  while (exists(s)) s = `${slugify(base)}-${i++}`;
  return s;
}
export const rupees = (paise) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 });
