import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate, get, all, run, now } from './lib/db.js';
import { HttpError, matchRoute, pathExistsForOtherMethod, readJson, parseCookies, cookie, securityHeaders, sendJson, clientIp, rateLimit, safeEqual } from './lib/http.js';
import { resolveSession, SESSION_COOKIE, ensureSetupToken } from './lib/auth.js';
import { getSetting, DEFAULT_SETTINGS, setSetting } from './lib/core.js';

migrate();
// Baseline CMS content (settings + policy pages). Demo catalogue is separate: `npm run seed:demo`.
if (!get("SELECT 1 FROM settings WHERE key='store'")) for (const k of Object.keys(DEFAULT_SETTINGS)) setSetting(k, DEFAULT_SETTINGS[k]);
if (!get('SELECT 1 FROM pages LIMIT 1')) {
  const pg = [
    ['about', 'About Us', 'Luxury Bharat is an independent Indian lifestyle store.\n\nEdit this page from the admin dashboard under Website Management → Footer.'],
    ['refund-policy', 'Refund Policy', 'Add your refund and returns policy here.'],
    ['privacy-policy', 'Privacy Policy', 'Add your privacy policy here.'],
    ['terms', 'Terms and Conditions', 'Add your terms and conditions here.'],
    ['support', 'Customer Support', 'Open a support ticket from your account, or write to us at the email shown in the footer.'],
  ];
  pg.forEach(([slug, title, body], i) => run('INSERT INTO pages(slug,title,body,visible,position,updated_at) VALUES (?,?,?,?,?,?)', slug, title, body, 1, i, now()));
}

// Route modules register themselves with the router on import.
await import('./routes/auth.js');
await import('./routes/storefront.js');
await import('./routes/shop.js');
await import('./routes/support.js');
await import('./routes/admin.js');
await import('./routes/admin-content.js');
await import('./routes/analytics.js');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function serveFile(req, res, file, { immutable = false } = {}) {
  let st; try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : (ext === '.html' ? 'no-cache' : 'public, max-age=300'),
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  return true;
}
const within = (base, rel) => { const f = path.join(base, rel); return f.startsWith(base + path.sep) ? f : null; };

function indexHtml(url) {
  let html = fs.readFileSync(path.join(config.publicDir, 'index.html'), 'utf8');
  const store = getSetting('store');
  let title = `${store.name} — ${store.tagline}`, desc = 'Premium clothing, footwear, accessories and pantry from across Bharat.', image = '', ld = '';
  const m = url.pathname.match(/^\/product\/([\w-]+)$/);
  if (m) {
    const p = get("SELECT * FROM products WHERE slug=? AND status='active'", m[1]);
    if (p) {
      const img = get('SELECT url FROM product_images WHERE product_id=? ORDER BY position,id LIMIT 1', p.id)?.url || '';
      title = `${p.seo_title || p.name} | ${store.name}`; desc = (p.seo_description || p.description || desc).slice(0, 160); image = img ? config.appUrl + img : '';
      ld = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: p.name, sku: p.sku, image: image || undefined, description: desc, offers: { '@type': 'Offer', priceCurrency: 'INR', price: ((p.discount_price ?? p.price) / 100).toFixed(2), availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: `${config.appUrl}/product/${p.slug}` } }).replace(/</g, '\\u003c')}</script>`;
    }
  }
  const c = url.pathname.match(/^\/category\/([\w-]+)$/);
  if (c) { const cat = get('SELECT name,description FROM categories WHERE slug=? AND visible=1', c[1]); if (cat) { title = `${cat.name} | ${store.name}`; desc = cat.description || desc; } }
  const head = `<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">${image ? `<meta property="og:image" content="${esc(image)}">` : ''}<link rel="canonical" href="${esc(config.appUrl + url.pathname)}">${ld}`;
  return html.replace('<!--SEO-->', head);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, 'http://x');
  const ip = clientIp(req);
  securityHeaders(res);
  const ctx = { req, res, url, ip, query: Object.fromEntries(url.searchParams), params: {}, user: null, session: null, body: {} };
  try {
    const cookies = parseCookies(req.headers.cookie);
    const sess = resolveSession(cookies[SESSION_COOKIE]);
    if (sess) { ctx.session = sess; ctx.user = sess.user; }

    if (url.pathname.startsWith('/api/')) {
      if (!rateLimit(`api:${ip}`, 600, 60_000)) throw new HttpError(429, 'Too many requests. Slow down.');
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const m = matchRoute(method, url.pathname.replace(/\/$/, '') || '/');
      if (!m) { if (pathExistsForOtherMethod(url.pathname)) throw new HttpError(405, 'Method not allowed.'); throw new HttpError(404, 'Not found.'); }
      ctx.params = m.params;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        // CSRF: same-origin check on every state-changing request, plus a per-session token for signed-in users.
        const originHeader = req.headers.origin || (req.headers.referer ? (function () { try { return new URL(req.headers.referer).origin; } catch { return null; } })() : null);
        let origin = null;
        if (originHeader) {
          try { origin = new URL(originHeader).origin; }
          catch { throw new HttpError(403, 'Cross-site request blocked.'); }
        }
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-site request blocked.');
        if (ctx.session && !safeEqual(req.headers['x-csrf-token'] || '', ctx.session.csrf)) throw new HttpError(403, 'Security token missing or expired. Refresh the page and try again.');
        const ct = String(req.headers['content-type'] || '');
        if (!ct.startsWith('image/') && !ct.includes('application/json') && Number(req.headers['content-length'] || 0) > 0) throw new HttpError(415, 'Unsupported content type.');
        if (!ct.startsWith('image/')) ctx.body = await readJson(req);
      }
      const handlers = m.handlers;
      for (let i = 0; i < handlers.length - 1; i++) await handlers[i](ctx);
      const out = await handlers[handlers.length - 1](ctx);
      if (!res.writableEnded && !res.headersSent) sendJson(res, ctx.status || 200, out ?? { ok: true }, ctx.headers);
      return;
    }

    // ---- static + SPA ----
    if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
    let p = url.pathname;
    try { p = decodeURIComponent(url.pathname); }
    catch { throw new HttpError(400, 'Bad request.'); }
    if (p.includes('\0')) throw new HttpError(400, 'Bad request.');
    if (p.startsWith('/uploads/')) { const f = within(config.uploadDir, p.slice(9)); if (f && serveFile(req, res, f, { immutable: true })) return; throw new HttpError(404, 'Not found.'); }
    if (p === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${config.appUrl}/sitemap.xml\n`); }
    if (p === '/sitemap.xml') {
      const urls = ['/', '/shop', ...all('SELECT slug FROM categories WHERE visible=1').map((c) => `/category/${c.slug}`), ...all("SELECT slug FROM products WHERE status='active'").map((x) => `/product/${x.slug}`)];
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(config.appUrl + u)}</loc></url>`).join('')}</urlset>`);
    }
    if (p.startsWith('/admin')) {
      const rel = p.replace(/^\/admin\/?/, '');
      const f = rel && within(path.join(config.publicDir, 'admin'), rel);
      if (f && serveFile(req, res, f)) return;
      res.setHeader('X-Robots-Tag', 'noindex');
      return serveFile(req, res, path.join(config.publicDir, 'admin', 'index.html'));
    }
    const f = p === '/' ? null : within(config.publicDir, p.slice(1));
    if (f && path.extname(f) && serveFile(req, res, f)) return;
    if (path.extname(p)) throw new HttpError(404, 'Not found.');
    const body = indexHtml(url);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, fields: e.fields });
    if (String(e.message).includes('UNIQUE constraint failed')) return sendJson(res, 409, { error: 'That value is already in use.' });
    console.error(`[error] ${req.method} ${url.pathname}`, e);
    sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  } finally {
    if (!config.prod && url.pathname.startsWith('/api/') && process.env.LOG_REQUESTS) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

ensureSetupToken();
export function start(port = config.port) {
  return new Promise((resolve) => server.listen(port, () => { console.log(`[server] Luxury Bharat running at ${config.appUrl} (${config.env})`); resolve(server); }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start();
export { server };
