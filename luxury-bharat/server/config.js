import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependencies). Real environment variables win.
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch { /* no .env file */ }

const list = (s) => (s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const env = process.env.NODE_ENV || 'development';
const dataDir = path.resolve(root, process.env.DATA_DIR || './data');

export const config = {
  root,
  env,
  prod: env === 'production',
  port: Number(process.env.PORT || 3000),
  appUrl: (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''),
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'luxury-bharat.db'),
  uploadDir: path.join(dataDir, 'uploads'),
  publicDir: path.join(root, 'public'),
  trustProxy: process.env.TRUST_PROXY === '1',
  devOutboxEnabled: process.env.DEV_OUTBOX_ENABLED === '1',
  ownerEmail: (process.env.OWNER_EMAIL || 'luxurybhaarat@gmail.com').toLowerCase(),
  adminAllowlist: list(process.env.ADMIN_EMAILS || 'sinhayash3107@gmail.com,20dhruv08@gmail.com'),
  setupToken: process.env.OWNER_SETUP_TOKEN || '',
  resendKey: process.env.RESEND_API_KEY || '',
  mailFrom: process.env.MAIL_FROM || 'Luxury Bharat <onboarding@resend.dev>',
  paymentMode: process.env.PAYMENT_MODE || (env === 'production' ? 'live' : 'test'),
  razorpay: { keyId: process.env.RAZORPAY_KEY_ID || '', keySecret: process.env.RAZORPAY_KEY_SECRET || '' },
};
if (config.prod && config.paymentMode === 'test') {
  console.warn('[warn] PAYMENT_MODE=test is not allowed in production; the fake payment flow is disabled.');
  config.paymentMode = 'live';
}
fs.mkdirSync(config.uploadDir, { recursive: true });
