// Runs the real server in-process against a throw-away database. `npm test`
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-test-'));
Object.assign(process.env, { NODE_ENV: 'development', DATA_DIR: dir, OWNER_SETUP_TOKEN: 'test-setup-token-123456', PAYMENT_MODE: 'test', APP_URL: 'http://localhost:0' });
const { start, server } = await import('../server/index.js');
const { resetRateLimits } = await import('../server/lib/http.js');
const { db, get, all, run } = await import('../server/lib/db.js');
await start(0);
const base = `http://127.0.0.1:${server.address().port}`;
let sharp; try { sharp = (await import('sharp')).default; } catch { /* optional */ }

class Client {
  constructor() { this.cookie = ''; this.csrf = null; }
  async req(method, url, body, headers = {}) {
    const h = { ...headers, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(this.csrf && method !== 'GET' ? { 'X-CSRF-Token': this.csrf } : {}) };
    let payload; if (body instanceof Buffer) payload = body; else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie?.() || []; for (const c of sc) { const [kv] = c.split(';'); this.cookie = /Max-Age=0/i.test(c) ? '' : kv; }
    const data = await res.json().catch(() => ({}));
    if (data.csrf) this.csrf = data.csrf;
    return { status: res.status, data };
  }
  get = (u) => this.req('GET', u); post = (u, b = {}) => this.req('POST', u, b); put = (u, b) => this.req('PUT', u, b); patch = (u, b) => this.req('PATCH', u, b); del = (u) => this.req('DELETE', u);
}
const outbox = () => all('SELECT * FROM email_log ORDER BY id');
const tokenFrom = (email, re) => { const m = outbox().filter((e) => e.to_email === email).map((e) => re.exec(e.body)).filter(Boolean).pop(); return m?.[1]; };
const ADDR = { name: 'Asha Rao', state: 'Karnataka', city: 'Bengaluru', line1: 'Flat 4B, Palm Residency, MG Road', pincode: '560001', phone: '9876543210' };
const PW = 'Sturdy-Pass-2026';

async function newCustomer(tag, verify = true) {
  resetRateLimits();
  const c = new Client();
  const r = await c.post('/api/auth/register', { username: `cust_${tag}`, email: `cust_${tag}@example.com`, password: PW, fullName: `Customer ${tag}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  if (verify) { const t = tokenFrom(`cust_${tag}@example.com`, /verify\?token=([\w-]+)/); assert.ok(t); assert.equal((await c.post('/api/auth/verify', { token: t })).status, 200); }
  return c;
}
let owner, admin, productId, productSlug, pngBuf;

test('malformed cookie and decoded paths are rejected gracefully instead of crashing', async () => {
  const badCookie = await fetch(base + '/api/me', { headers: { Cookie: 'lb_sid=%zz' } });
  const badPath = await fetch(base + '/%E0%A4%A');
  assert.equal(badCookie.status, 200, 'invalid cookie should not crash the request');
  assert.equal(badPath.status, 400, 'invalid URL encoding should yield a client error instead of 500');
});

test('owner setup: wrong token rejected, right token works once, then disabled', async () => {
  const anon = new Client();
  assert.equal((await anon.get('/api/setup/status')).data.needsSetup, true);
  assert.equal((await anon.post('/api/setup/owner', { token: 'nope', email: 'luxurybhaarat@gmail.com', username: 'owner', password: PW })).status, 403);
  assert.equal((await anon.post('/api/setup/owner', { token: process.env.OWNER_SETUP_TOKEN, email: 'someone@else.com', username: 'owner', password: PW })).status, 400);
  owner = new Client();
  const r = await owner.post('/api/setup/owner', { token: process.env.OWNER_SETUP_TOKEN, email: 'luxurybhaarat@gmail.com', username: 'owner', password: PW });
  assert.equal(r.status, 200); assert.equal(r.data.user.role, 'owner');
  assert.equal((await new Client().post('/api/setup/owner', { token: process.env.OWNER_SETUP_TOKEN, email: 'luxurybhaarat@gmail.com', username: 'owner2', password: PW })).status, 404);
});

test('passwords are hashed, never stored in plaintext; DB allows only one owner', () => {
  const rows = all('SELECT password_hash FROM users');
  assert.ok(rows.length && rows.every((r) => r.password_hash.startsWith('scrypt$') && !r.password_hash.includes(PW)));
  assert.throws(() => run("INSERT INTO users(username,email,password_hash,role,created_at,updated_at) VALUES ('x','x@x.co','h','owner','n','n')"));
});

test('registering with an authorised admin email does NOT grant admin access', async () => {
  resetRateLimits();
  const sneaky = new Client();
  const r = await sneaky.post('/api/auth/register', { username: 'sinha_customer', email: 'sinhayash3107@gmail.com', password: PW });
  assert.equal(r.data.user.role, 'customer');
  assert.equal((await sneaky.get('/api/admin/overview')).status, 403);
  assert.equal((await sneaky.get('/api/admin/products')).status, 403);
  // the owner's email cannot be registered as a customer either
  assert.equal((await new Client().post('/api/auth/register', { username: 'imposter', email: 'luxurybhaarat@gmail.com', password: PW })).status, 400);
});

test('owner invites an allow-listed admin; admin accepts via one-time link; non-allow-listed email refused', async () => {
  assert.equal((await owner.post('/api/admin/admins/invite', { email: 'random@evil.com', permissions: ['products'] })).status, 400);
  const inv = await owner.post('/api/admin/admins/invite', { email: 'sinhayash3107@gmail.com', permissions: ['products', 'orders', 'inventory', 'sections', 'support', 'analytics', 'customers', 'categories', 'banners'] });
  assert.equal(inv.status, 200);
  const token = new URL(inv.data.devInviteLink.replace('#', '')).searchParams.get('token');
  admin = new Client();
  assert.equal((await admin.post('/api/auth/accept-invite', { token: 'garbage-garbage-garbage-12', username: 'yash', password: PW })).status, 400);
  const acc = await admin.post('/api/auth/accept-invite', { token, username: 'yash', password: PW });
  assert.equal(acc.status, 200); assert.equal(acc.data.user.role, 'admin');
  assert.equal((await new Client().post('/api/auth/accept-invite', { token, username: 'again', password: PW })).status, 400, 'token is single-use');
});

test('RBAC: admins cannot create/remove admins, see owner-only pages, or exceed granted permissions', async () => {
  assert.equal((await admin.post('/api/admin/admins/invite', { email: '20dhruv08@gmail.com' })).status, 403);
  assert.equal((await admin.get('/api/admin/admins')).status, 403);
  assert.equal((await admin.get('/api/admin/audit')).status, 403);
  assert.equal((await admin.get('/api/admin/security')).status, 403);
  assert.equal((await admin.put('/api/admin/settings/store', { name: 'x' })).status, 403);
  const ownerRow = get("SELECT id FROM users WHERE role='owner'");
  assert.equal((await admin.del(`/api/admin/admins/${ownerRow.id}`)).status, 403);
  assert.equal((await admin.patch(`/api/admin/admins/${ownerRow.id}`, { permissions: [] })).status, 403);
  assert.equal((await admin.get('/api/admin/coupons')).status, 403, 'coupons permission was not granted');
  assert.equal((await admin.get('/api/admin/products')).status, 200);
  assert.throws(() => run("UPDATE users SET role='customer' WHERE role='owner'"), /immutable/);
});

test('admin uploads images (validated) and manages a product', async () => {
  pngBuf = sharp ? await sharp({ create: { width: 64, height: 64, channels: 3, background: '#aaa' } }).png().toBuffer() : Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6b3a30000000049454e44ae426082', 'hex');
  const up = await admin.req('POST', '/api/admin/uploads', pngBuf, { 'Content-Type': 'image/png', 'X-Filename': 'a.png' });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal((await admin.req('POST', '/api/admin/uploads', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { 'Content-Type': 'image/png' })).status, 400, 'SVG / non-image content rejected by magic-byte check');
  assert.equal((await new Client().req('POST', '/api/admin/uploads', pngBuf, { 'Content-Type': 'image/png' })).status, 401);
  const cat = (await admin.post('/api/admin/categories', { name: 'Test Jackets', bgColor: '#3B2A20' })).data.category;
  const p = await admin.post('/api/admin/products', { name: 'Black Test Jacket', price: 1000, discountPrice: 800, stock: 3, status: 'active', categoryId: cat.id, tags: 'black, jacket', images: [{ url: up.data.media.url }], isNew: true, attrs: { color: 'Black' } });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  productId = p.data.product.id; productSlug = p.data.product.slug;
  assert.equal(p.data.product.price, 100000); assert.equal(p.data.product.discountPrice, 80000);
  assert.equal((await admin.post('/api/admin/products', { name: 'Bad', price: 100, discountPrice: 200, status: 'draft' })).status, 400, 'discount must be below price');
  assert.equal((await admin.post('/api/admin/products', { name: 'No image', price: 100, status: 'active' })).status, 400, 'active needs an image');
  const edit = await admin.put(`/api/admin/products/${productId}`, { ...p.data.product, price: 1000, discountPrice: 800, stock: 3, images: p.data.product.images, tags: ['black', 'jacket'] });
  assert.equal(edit.status, 200);
});

test('search finds exact + related products and filters work', async () => {
  const c = new Client();
  const r = (await c.get('/api/products?q=black%20jacket')).data;
  assert.ok(r.items.some((i) => i.id === productId && i.match === 'exact'));
  assert.ok((await c.get('/api/products?q=jacket&inStock=1&sort=price_asc')).data.total >= 1);
  assert.equal((await c.get('/api/products?q=zzzznothing')).data.total, 0);
  assert.ok((await c.get('/api/search/suggest?q=jack')).data.products.length >= 1);
  const detail = await c.get(`/api/products/${productSlug}`); assert.equal(detail.data.product.discountPct, 20);
});

test('checkout: email must be verified; server recalculates price; address validated', async () => {
  const unv = await newCustomer('unv', false);
  await unv.put('/api/cart/items', { productId, qty: 1 });
  const blocked = await unv.post('/api/orders', { address: ADDR, paymentMethod: 'test' });
  assert.equal(blocked.status, 403); assert.match(blocked.data.error, /verify/i);

  const c = await newCustomer('buyer');
  await c.put('/api/cart/items', { productId, qty: 2 });
  assert.equal((await c.post('/api/orders', { address: { ...ADDR, pincode: '12' }, paymentMethod: 'test' })).status, 400);
  assert.equal((await c.post('/api/orders', { address: { ...ADDR, phone: '12345' }, paymentMethod: 'test' })).status, 400);
  assert.equal((await c.post('/api/orders', { address: { ...ADDR, state: 'Atlantis' }, paymentMethod: 'test' })).status, 400);
  assert.equal((await c.post('/api/orders', { address: ADDR, paymentMethod: 'cod' })).status, 400, 'COD disabled by default');
  const ok = await c.post('/api/orders', { address: ADDR, paymentMethod: 'test', price: 1, total: 1, items: [{ id: productId, price: 1 }] }); // tampered fields are ignored
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const o = ok.data.order;
  assert.equal(o.subtotal, 160000, 'priced from the database: 2 × ₹800');
  assert.equal(o.shipping, 9900); assert.equal(o.total, 169900);
  assert.equal(get('SELECT stock FROM products WHERE id=?', productId).stock, 1, 'stock deducted');
  assert.equal(o.paymentStatus, 'pending');
  assert.equal((await c.post(`/api/orders/${o.number}/test-pay`)).data.order.paymentStatus, 'paid');
  globalThis.__order = { c, number: o.number, id: o.id };
});

test('new-order notification + emails are created exactly once per recipient', async () => {
  const n = all("SELECT * FROM notifications WHERE type='order.new'"); assert.equal(n.length, 1);
  await new Promise((r) => setTimeout(r, 50));
  const mails = outbox().filter((e) => e.event_key.startsWith(`order:${globalThis.__order.id}:new:`));
  assert.deepEqual(mails.map((m) => m.to_email).sort(), ['luxurybhaarat@gmail.com', 'sinhayash3107@gmail.com']);
  assert.match(mails[0].body, /NEW ORDER RECEIVED/);
  const list = (await admin.get('/api/admin/notifications')).data; assert.ok(list.notifications.some((x) => x.title === 'NEW ORDER RECEIVED')); assert.ok(list.unread >= 1);
  assert.throws(() => run('INSERT INTO notifications(type,title,ref_type,ref_id,created_at) VALUES (?,?,?,?,?)', 'order.new', 't', 'order', String(globalThis.__order.id), 'n'), /UNIQUE/, 'DB-level dedupe');
});

test('inventory cannot be oversold under concurrent orders', async () => {
  get('SELECT 1'); run('UPDATE products SET stock=3 WHERE id=?', productId);
  const buyers = []; for (let i = 0; i < 6; i++) { const c = await newCustomer(`race${i}`); await c.put('/api/cart/items', { productId, qty: 1 }); buyers.push(c); }
  const results = await Promise.all(buyers.map((c) => c.post('/api/orders', { address: ADDR, paymentMethod: 'test' })));
  const okN = results.filter((r) => r.status === 200).length, conflict = results.filter((r) => r.status === 409 || r.status === 400).length;
  assert.equal(okN, 3, `exactly 3 of 6 succeed, got ${okN}`); assert.equal(conflict, 3);
  assert.equal(get('SELECT stock FROM products WHERE id=?', productId).stock, 0);
  assert.equal(get('SELECT COALESCE(SUM(qty),0) n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=? AND o.status<>\'cancelled\' AND o.id<>?', productId, globalThis.__order.id).n, 3);
  const mv = get('SELECT COUNT(*) n FROM inventory_movements WHERE product_id=? AND reason=?', productId, 'order_placed').n; assert.ok(mv >= 4, 'every deduction is recorded');
  assert.ok(all("SELECT 1 FROM notifications WHERE type='stock.low'").length >= 1, 'low/out-of-stock alert raised');
});

test('order privacy and lifecycle: other customers blocked, admin updates status, cancellation restores stock once', async () => {
  const { c, number } = globalThis.__order;
  const stranger = await newCustomer('stranger');
  assert.equal((await stranger.get(`/api/orders/${number}`)).status, 404);
  assert.equal((await stranger.post(`/api/orders/${number}/cancel`)).status, 404);
  assert.equal((await c.patch(`/api/admin/orders/${number}/status`, { status: 'delivered' })).status, 403, 'customers cannot change status');
  assert.equal((await new Client().get(`/api/orders/${number}`)).status, 401);
  assert.equal((await admin.patch(`/api/admin/orders/${number}/status`, { status: 'confirmed' })).status, 200);
  assert.equal((await admin.patch(`/api/admin/orders/${number}/status`, { status: 'pending' })).status, 400, 'no moving backwards');
  const before = get('SELECT stock FROM products WHERE id=?', productId).stock;
  const cancel = await c.post(`/api/orders/${number}/cancel`); assert.equal(cancel.status, 200);
  assert.equal(get('SELECT stock FROM products WHERE id=?', productId).stock, before + 2, 'stock returned');
  assert.equal((await c.post(`/api/orders/${number}/cancel`)).status, 200); // idempotent
  assert.equal(get('SELECT stock FROM products WHERE id=?', productId).stock, before + 2, 'restored only once');
  const hist = (await c.get(`/api/orders/${number}`)).data.order.history.map((h) => h.status);
  assert.equal(hist[0], 'pending'); assert.ok(hist.includes('confirmed')); assert.equal(hist.at(-1), 'cancelled');
});

test('analytics: cancelled orders excluded from revenue; paid and pending are separate', async () => {
  const o = (await admin.get('/api/admin/overview')).data;
  const paid = get("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status<>'cancelled' AND payment_status='paid'").n;
  assert.equal(o.paidRevenue, paid);
  const cancelledPaid = get("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status='cancelled' AND payment_status='paid'").n; assert.ok(cancelledPaid > 0);
  const s = (await admin.get('/api/admin/analytics/sales?range=daily')).data;
  assert.equal(s.totals.paid, paid); assert.equal(s.totals.pending, o.pendingRevenue);
  assert.equal((await new Client().get('/api/admin/analytics/sales')).status, 401);
});

test('section builder: create, publish, hide, reorder — storefront reflects it from the database', async () => {
  const mk = async (name, extra = {}) => (await admin.post('/api/admin/sections', { name, type: 'product_grid', source: 'featured', status: 'published', visible: true, productIds: [productId], ...extra })).data.section;
  const a = await mk('Winter Collection'), b = await mk('Diwali Collection', { type: 'promo_banner', ctaText: 'Shop', ctaUrl: '/shop', description: 'Festive offers' });
  const names = async () => (await new Client().get('/api/home')).data.sections.map((s) => s.name);
  assert.ok((await names()).includes('Winter Collection') && (await names()).includes('Diwali Collection'));
  await admin.patch(`/api/admin/sections/${a.id}`, { visible: false }); assert.ok(!(await names()).includes('Winter Collection'), 'hidden');
  await admin.patch(`/api/admin/sections/${a.id}`, { visible: true, status: 'draft' }); assert.ok(!(await names()).includes('Winter Collection'), 'draft not shown');
  await admin.patch(`/api/admin/sections/${a.id}`, { status: 'published' });
  const ids = (await admin.get('/api/admin/sections')).data.sections.map((s) => s.id).filter((i) => i !== b.id); ids.unshift(b.id);
  assert.equal((await admin.post('/api/admin/sections/reorder', { ids })).status, 200);
  assert.equal((await names())[0], 'Diwali Collection');
  assert.equal((await admin.post('/api/admin/sections', { name: 'x', type: 'promo_banner', ctaUrl: 'javascript:alert(1)' })).status, 400, 'unsafe link rejected');
  assert.equal((await new Client().post('/api/admin/sections', { name: 'x', type: 'promo_banner' })).status, 401);
  assert.equal((await admin.del(`/api/admin/sections/${b.id}`)).status, 200); assert.ok(!(await names()).includes('Diwali Collection'));
  const prev = await admin.post('/api/admin/sections/preview', { name: 'Draft preview', type: 'product_carousel', productIds: [productId] }); assert.equal(prev.data.section.products.length, 1);
});

test('hero banner + category + footer are editable and reflected on the storefront', async () => {
  const b = await admin.post('/api/admin/banners', { title: 'EDITED HERO', subtitle: 'Sub', buttonText: 'GO', buttonUrl: '/shop', align: 'center', overlay: 0.6, heightVh: 70, visible: true });
  assert.equal(b.status, 200);
  let home = (await new Client().get('/api/home')).data; assert.ok(home.banners.some((x) => x.title === 'EDITED HERO' && x.align === 'center' && x.heightVh === 70));
  assert.equal((await admin.post('/api/admin/banners', { title: 'bad', buttonUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await admin.put('/api/admin/settings/footer', { about: 'x' })).status, 403, 'footer needs the content permission');
  assert.equal((await owner.put('/api/admin/settings/footer', { about: 'About text', phone: '+91 99999 00000', socials: { instagram: 'https://instagram.com/lb' } })).status, 200);
  home = (await new Client().get('/api/home')).data; assert.equal(home.footer.about, 'About text');
});

test('support tickets: customer opens, staff is notified and replies, customer reads the reply', async () => {
  const c = await newCustomer('ticket');
  const t = await c.post('/api/tickets', { category: 'Delivery', subject: 'My order hasn’t arrived', body: 'It has been ten days now.' });
  assert.equal(t.status, 200); const n = t.data.ticket.number;
  assert.ok(all("SELECT 1 FROM notifications WHERE type='ticket.new'").length >= 1);
  assert.equal((await c.post('/api/tickets', { category: 'Delivery', subject: 'x', body: 'short' })).status, 400);
  assert.equal((await (await newCustomer('other')).get(`/api/tickets/${n}`)).status, 404, 'tickets are private');
  assert.equal((await admin.post(`/api/admin/tickets/${n}/reply`, { body: 'We are checking with the courier.' })).status, 200);
  assert.equal((await admin.patch(`/api/admin/tickets/${n}`, { status: 'resolved' })).status, 200);
  const view = (await c.get(`/api/tickets/${n}`)).data.ticket; assert.equal(view.status, 'resolved'); assert.ok(view.replies.some((r) => r.isStaff && /courier/.test(r.body)));
  assert.equal((await c.get('/api/admin/tickets')).status, 403);
});

test('security: CSRF, lockout, validation, password reset, headers', async () => {
  const c = await newCustomer('sec');
  const noCsrf = await fetch(`${base}/api/account/profile`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: c.cookie }, body: JSON.stringify({ fullName: 'x' }) });
  assert.equal(noCsrf.status, 403, 'state-changing request without CSRF token');
  const cross = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ identifier: 'a', password: 'b' }) });
  assert.equal(cross.status, 403, 'cross-site origin blocked');
  resetRateLimits();
  const v = new Client(); let last;
  for (let i = 0; i < 5; i++) last = await v.post('/api/auth/login', { identifier: 'cust_sec', password: 'wrong-password-1' });
  assert.equal(last.status, 401);
  assert.equal((await v.post('/api/auth/login', { identifier: 'cust_sec', password: PW })).status, 429, 'account locked after repeated failures, even with the right password');
  resetRateLimits();
  assert.equal((await new Client().post('/api/auth/forgot', { email: 'nobody@example.com' })).status, 200, 'no account enumeration');
  await new Client().post('/api/auth/forgot', { email: 'cust_sec@example.com' });
  const rt = tokenFrom('cust_sec@example.com', /reset\?token=([\w-]+)/); assert.ok(rt);
  assert.equal((await new Client().post('/api/auth/reset', { token: rt, password: 'short' })).status, 400);
  assert.equal((await new Client().post('/api/auth/reset', { token: rt, password: 'Brand-New-Pass-77' })).status, 200);
  assert.equal((await new Client().post('/api/auth/reset', { token: rt, password: 'Another-Pass-88x' })).status, 400, 'reset token single-use');
  assert.equal((await new Client().post('/api/auth/login', { identifier: 'cust_sec', password: 'Brand-New-Pass-77' })).status, 200);
  assert.equal((await c.get('/api/me')).data.user, null, 'old sessions revoked after reset');
  const h = await fetch(`${base}/`); assert.match(h.headers.get('content-security-policy'), /default-src 'self'/); assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  const sql = await fetch(`${base}/api/products?q=${encodeURIComponent("' OR 1=1; DROP TABLE products;--")}`); assert.equal(sql.status, 200);
  assert.ok(get('SELECT COUNT(*) n FROM products').n > 0, 'products table intact');
});

test('owner can change admin permissions and remove an admin (sessions revoked immediately)', async () => {
  const adminRow = get("SELECT id FROM users WHERE email='sinhayash3107@gmail.com'");
  assert.equal((await owner.patch(`/api/admin/admins/${adminRow.id}`, { permissions: ['support'] })).status, 200);
  assert.equal((await admin.get('/api/admin/products')).status, 403, 'permission removal is immediate');
  assert.equal((await admin.get('/api/admin/tickets')).status, 200);
  assert.equal((await owner.del(`/api/admin/admins/${adminRow.id}`)).status, 200);
  assert.equal((await admin.get('/api/admin/tickets')).status, 401, 'removed admin is signed out');
  assert.equal(get('SELECT role FROM users WHERE id=?', adminRow.id).role, 'customer');
  assert.ok(all("SELECT 1 FROM audit_logs WHERE action IN ('admin.invite','admin.remove')").length >= 2, 'audit trail written');
  assert.equal((await owner.get('/api/admin/audit')).status, 200);
});

test('SPA + SEO: pages are served, product page has server-rendered meta, admin shell loads', async () => {
  const p = await (await fetch(`${base}/product/${productSlug}`)).text(); assert.match(p, /<title>Black Test Jacket/); assert.match(p, /application\/ld\+json/);
  for (const u of ['/', '/shop', '/admin', '/js/store.js', '/admin/admin.js', '/css/store.css', '/robots.txt', '/sitemap.xml']) assert.equal((await fetch(base + u)).status, 200, u);
  assert.equal((await fetch(`${base}/uploads/..%2F..%2Fetc%2Fpasswd`)).status, 404, 'path traversal blocked');
  assert.equal((await fetch(`${base}/..%2Fserver%2Fconfig.js`)).status === 200 && (await (await fetch(`${base}/..%2Fserver%2Fconfig.js`)).text()).includes('resendKey'), false, 'server source never served');
});

test.after(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(0), 100).unref(); });
