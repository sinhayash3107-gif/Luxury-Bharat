import { GET, POST, PUT, PATCH, DEL, bad, notFound, forbidden, HttpError, v, limit, slugify, uniqueSlug, readBody } from '../lib/http.js';
import { get, all, run, tx, now, J } from '../lib/db.js';
import { requirePerm, requireStaff, requireOwner, STAFF_PERMS, DEFAULT_ADMIN_PERMS, setPermissions, issueToken, destroyUserSessions, isStaff } from '../lib/auth.js';
import { audit, bustHome, getSetting, setSetting, addSseClient } from '../lib/core.js';
import { adjustStock, transitionOrder, orderDetail, ORDER_FLOW } from './shop.js';
import { handleImageUpload } from './support.js';
import { storage } from '../lib/images.js';
import { sendMail, emailHtml, fireAndForget } from '../lib/mail.js';
import { config } from '../config.js';

const page = (q, def = 25) => { const size = Math.min(Math.max(Number(q.pageSize) || def, 1), 100), p = Math.max(Number(q.page) || 1, 1); return { size, p, offset: (p - 1) * size }; };
const like = (s) => `%${String(s).slice(0, 60).replace(/[%_]/g, '')}%`;

// ===================== uploads / media =====================
POST('/api/admin/uploads', requireStaff, limit('upload-admin', 200, 60 * 60_000), handleImageUpload);
GET('/api/admin/media', requireStaff, (ctx) => {
  const { size, offset } = page(ctx.query, 40);
  return { media: all('SELECT id,url,thumb_url thumbUrl,bytes,width,height,original_name originalName,created_at createdAt FROM media ORDER BY id DESC LIMIT ? OFFSET ?', size, offset), total: get('SELECT COUNT(*) n FROM media').n };
});
DEL('/api/admin/media/:id', requirePerm('products', 'sections', 'banners', 'categories'), (ctx) => {
  const m = get('SELECT * FROM media WHERE id=?', Number(ctx.params.id));
  if (!m) throw notFound();
  const used = get(`SELECT 1 FROM product_images WHERE url=? UNION ALL SELECT 1 FROM banners WHERE image_desktop=? OR image_mobile=? UNION ALL SELECT 1 FROM sections WHERE image=? OR bg_image=? OR mobile_image=? OR hover_image=?
    UNION ALL SELECT 1 FROM categories WHERE image=? OR bg_image=? OR mobile_image=? OR hover_image=? LIMIT 1`, m.url, m.url, m.url, m.url, m.url, m.url, m.url, m.url, m.url, m.url, m.url);
  if (used) throw new HttpError(409, 'This image is still used by a product, banner, section or category. Replace it there first.');
  run('DELETE FROM media WHERE id=?', m.id); storage.remove(m.url); if (m.thumb_url) storage.remove(m.thumb_url);
  audit(ctx, 'media.delete', 'media', m.id);
  return { ok: true };
});

// ===================== products =====================
const money = (val, name, { required = true } = {}) => {
  if (val === undefined || val === null || val === '') { if (required) throw bad(`${name} is required.`, { [name]: 'Required' }); return null; }
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw bad(`${name} must be a valid amount in rupees.`, { [name]: 'Invalid amount' });
  return Math.round(n * 100);
};
function productInput(b, existing) {
  const name = v.str(b.name, 'name', { min: 2, max: 160 });
  const price = money(b.price, 'price');
  if (price <= 0) throw bad('Price must be greater than zero.', { price: 'Must be above 0' });
  const discount = money(b.discountPrice, 'discountPrice', { required: false });
  if (discount != null && discount >= price) throw bad('Discount price must be lower than the regular price.', { discountPrice: 'Must be lower than price' });
  let categoryId = null;
  if (b.categoryId !== undefined && b.categoryId !== null && b.categoryId !== '') { categoryId = v.int(b.categoryId, 'categoryId', { min: 1 }); if (!get('SELECT 1 FROM categories WHERE id=?', categoryId)) throw bad('Choose a valid category.', { categoryId: 'Invalid category' }); }
  const tags = [...new Set((Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',')).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20).map((t) => t.slice(0, 30));
  const attrsIn = b.attrs && typeof b.attrs === 'object' ? b.attrs : {};
  const attrs = {};
  if (attrsIn.color) attrs.color = String(attrsIn.color).slice(0, 30);
  if (attrsIn.material) attrs.material = String(attrsIn.material).slice(0, 40);
  if (attrsIn.size) attrs.size = (Array.isArray(attrsIn.size) ? attrsIn.size : String(attrsIn.size).split(',')).map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
  const images = (Array.isArray(b.images) ? b.images : []).slice(0, 10).map((i) => ({ url: v.url(i.url, 'image', { required: true }), alt: v.str(i.alt, 'alt', { max: 160, required: false }) }));
  const status = v.oneOf(b.status ?? 'draft', 'status', ['draft', 'active', 'archived']);
  if (status === 'active' && !images.length) throw bad('Add at least one image before publishing a product.', { images: 'Add an image' });
  return {
    name, price, discount, categoryId, tags, attrs, images, status,
    description: v.str(b.description, 'description', { max: 5000, required: false }) || '',
    sku: v.str(b.sku, 'sku', { max: 40, required: false }),
    stock: v.int(b.stock ?? 0, 'stock', { min: 0, max: 1_000_000 }),
    low: v.int(b.lowStockThreshold ?? 5, 'lowStockThreshold', { min: 0, max: 10000 }),
    featured: v.bool(b.featured), trending: v.bool(b.trending), isNew: v.bool(b.isNew),
    seoTitle: v.str(b.seoTitle, 'seoTitle', { max: 70, required: false }), seoDescription: v.str(b.seoDescription, 'seoDescription', { max: 160, required: false }),
    slug: v.str(b.slug, 'slug', { max: 80, required: false }),
  };
}
const adminProduct = (p) => {
  const imgs = all('SELECT url,thumb_url thumbUrl,alt FROM product_images WHERE product_id=? ORDER BY position,id', p.id);
  return { id: p.id, sku: p.sku, name: p.name, slug: p.slug, description: p.description, categoryId: p.category_id, categoryName: p.category_id ? get('SELECT name FROM categories WHERE id=?', p.category_id)?.name : null,
    price: p.price, discountPrice: p.discount_price, stock: p.stock, lowStockThreshold: p.low_stock_threshold, status: p.status, featured: !!p.featured, trending: !!p.trending, isNew: !!p.is_new,
    tags: J(p.tags, []), attrs: J(p.attrs, {}), seoTitle: p.seo_title, seoDescription: p.seo_description, soldCount: p.sold_count, views: p.views, images: imgs, thumb: imgs[0]?.thumbUrl || imgs[0]?.url || null, createdAt: p.created_at, updatedAt: p.updated_at };
};
const pr = requirePerm('products');
GET('/api/admin/products', pr, (ctx) => {
  const where = [], p = [];
  if (ctx.query.q) { where.push('(name LIKE ? OR sku LIKE ?)'); p.push(like(ctx.query.q), like(ctx.query.q)); }
  if (['draft', 'active', 'archived'].includes(ctx.query.status)) { where.push('status=?'); p.push(ctx.query.status); }
  if (ctx.query.category) { where.push('category_id=?'); p.push(Number(ctx.query.category)); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { size, offset } = page(ctx.query);
  return { products: all(`SELECT * FROM products ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, size, offset).map(adminProduct), total: get(`SELECT COUNT(*) n FROM products ${w}`, ...p).n };
});
GET('/api/admin/products/:id', pr, (ctx) => { const p = get('SELECT * FROM products WHERE id=?', Number(ctx.params.id)); if (!p) throw notFound(); return { product: adminProduct(p) }; });
POST('/api/admin/products', pr, (ctx) => {
  const d = productInput(ctx.body);
  const id = tx(() => {
    const sku = d.sku || `LB-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`;
    if (get('SELECT 1 FROM products WHERE sku=?', sku)) throw bad('That SKU is already in use.', { sku: 'Already in use' });
    const slug = uniqueSlug(d.slug || d.name, (s) => !!get('SELECT 1 FROM products WHERE slug=?', s));
    const pid = Number(run('INSERT INTO products(sku,name,slug,description,category_id,price,discount_price,stock,low_stock_threshold,status,featured,trending,is_new,tags,attrs,seo_title,seo_description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      sku, d.name, slug, d.description, d.categoryId, d.price, d.discount, d.stock, d.low, d.status, d.featured, d.trending, d.isNew, JSON.stringify(d.tags), JSON.stringify(d.attrs), d.seoTitle, d.seoDescription, now(), now()).lastInsertRowid);
    d.images.forEach((im, i) => run('INSERT INTO product_images(product_id,url,thumb_url,alt,position) VALUES (?,?,?,?,?)', pid, im.url, get('SELECT thumb_url FROM media WHERE url=?', im.url)?.thumb_url ?? null, im.alt, i));
    if (d.stock > 0) run('INSERT INTO inventory_movements(product_id,delta,stock_after,reason,actor_id,created_at) VALUES (?,?,?,?,?,?)', pid, d.stock, d.stock, 'initial_stock', ctx.user.id, now());
    return pid;
  });
  bustHome(); audit(ctx, 'product.create', 'product', id, { name: d.name });
  return { product: adminProduct(get('SELECT * FROM products WHERE id=?', id)) };
});
PUT('/api/admin/products/:id', pr, (ctx) => {
  const cur = get('SELECT * FROM products WHERE id=?', Number(ctx.params.id));
  if (!cur) throw notFound();
  const d = productInput(ctx.body);
  tx(() => {
    const sku = d.sku || cur.sku;
    if (get('SELECT 1 FROM products WHERE sku=? AND id<>?', sku, cur.id)) throw bad('That SKU is already in use.', { sku: 'Already in use' });
    let slug = cur.slug;
    if (d.slug && d.slug !== cur.slug) slug = uniqueSlug(d.slug, (s) => !!get('SELECT 1 FROM products WHERE slug=? AND id<>?', s, cur.id));
    run('UPDATE products SET sku=?,name=?,slug=?,description=?,category_id=?,price=?,discount_price=?,low_stock_threshold=?,status=?,featured=?,trending=?,is_new=?,tags=?,attrs=?,seo_title=?,seo_description=?,updated_at=? WHERE id=?',
      sku, d.name, slug, d.description, d.categoryId, d.price, d.discount, d.low, d.status, d.featured, d.trending, d.isNew, JSON.stringify(d.tags), JSON.stringify(d.attrs), d.seoTitle, d.seoDescription, now(), cur.id);
    if (d.stock !== cur.stock) adjustStock(cur.id, d.stock - cur.stock, 'manual_edit', { actorId: ctx.user.id });
    if (Array.isArray(ctx.body.images)) {
      run('DELETE FROM product_images WHERE product_id=?', cur.id);
      d.images.forEach((im, i) => run('INSERT INTO product_images(product_id,url,thumb_url,alt,position) VALUES (?,?,?,?,?)', cur.id, im.url, get('SELECT thumb_url FROM media WHERE url=?', im.url)?.thumb_url ?? null, im.alt, i));
    }
  });
  bustHome(); audit(ctx, 'product.update', 'product', cur.id, { name: d.name });
  return { product: adminProduct(get('SELECT * FROM products WHERE id=?', cur.id)) };
});
DEL('/api/admin/products/:id', pr, (ctx) => {
  const p = get('SELECT * FROM products WHERE id=?', Number(ctx.params.id));
  if (!p) throw notFound();
  let archived = false;
  if (get('SELECT 1 FROM order_items WHERE product_id=?', p.id)) { run("UPDATE products SET status='archived', updated_at=? WHERE id=?", now(), p.id); archived = true; } // keep order history intact
  else run('DELETE FROM products WHERE id=?', p.id);
  bustHome(); audit(ctx, archived ? 'product.archive' : 'product.delete', 'product', p.id, { name: p.name });
  return { ok: true, archived };
});

// ===================== inventory =====================
const inv = requirePerm('inventory', 'products');
GET('/api/admin/inventory', inv, (ctx) => {
  const rows = all(`SELECT p.id,p.sku,p.name,p.stock,p.low_stock_threshold lowStockThreshold,p.status,p.sold_count soldCount,(SELECT COALESCE(thumb_url,url) FROM product_images WHERE product_id=p.id ORDER BY position,id LIMIT 1) thumb FROM products p WHERE p.status<>'archived' ${ctx.query.low === '1' ? 'AND p.stock<=p.low_stock_threshold' : ''} ORDER BY (p.stock<=p.low_stock_threshold) DESC, p.stock ASC, p.name LIMIT 500`);
  return { items: rows.map((r) => ({ ...r, low: r.stock <= r.lowStockThreshold, out: r.stock === 0 })) };
});
POST('/api/admin/inventory/:id/adjust', inv, (ctx) => {
  const id = Number(ctx.params.id);
  const p = get('SELECT stock FROM products WHERE id=?', id);
  if (!p) throw notFound();
  const reason = v.str(ctx.body.reason || 'Manual adjustment', 'reason', { max: 120 });
  const delta = ctx.body.set !== undefined && ctx.body.set !== null && ctx.body.set !== '' ? v.int(ctx.body.set, 'set', { min: 0, max: 1_000_000 }) - p.stock : v.int(ctx.body.delta, 'delta', { min: -1_000_000, max: 1_000_000 });
  if (delta === 0) return { stock: p.stock };
  const r = adjustStock(id, delta, `manual: ${reason}`, { actorId: ctx.user.id });
  bustHome(); audit(ctx, 'inventory.adjust', 'product', id, { delta, reason });
  return { stock: r.stock };
});
GET('/api/admin/inventory/movements', inv, (ctx) => {
  const { size, offset } = page(ctx.query, 50);
  const pid = ctx.query.productId ? Number(ctx.query.productId) : null;
  return { movements: all(`SELECT m.id,m.product_id productId,p.name,m.delta,m.stock_after stockAfter,m.reason,m.ref_id refId,u.username actor,m.created_at createdAt FROM inventory_movements m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.actor_id ${pid ? 'WHERE m.product_id=?' : ''} ORDER BY m.id DESC LIMIT ? OFFSET ?`, ...(pid ? [pid] : []), size, offset) };
});

// ===================== orders =====================
const ord = requirePerm('orders');
GET('/api/admin/orders', ord, (ctx) => {
  const where = [], p = [];
  if (ORDER_FLOW.concat('cancelled').includes(ctx.query.status)) { where.push('status=?'); p.push(ctx.query.status); }
  if (['pending', 'paid', 'failed', 'refunded'].includes(ctx.query.payment)) { where.push('payment_status=?'); p.push(ctx.query.payment); }
  if (ctx.query.q) { where.push('(number LIKE ? OR email LIKE ? OR customer_name LIKE ? OR ship_phone LIKE ?)'); const q = like(ctx.query.q); p.push(q, q, q, q); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { size, offset } = page(ctx.query);
  const rows = all(`SELECT * FROM orders ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, size, offset);
  return { orders: rows.map((o) => ({ ...orderDetail(o), itemCount: get('SELECT COALESCE(SUM(qty),0) n FROM order_items WHERE order_id=?', o.id).n })), total: get(`SELECT COUNT(*) n FROM orders ${w}`, ...p).n,
    counts: Object.fromEntries(all('SELECT status, COUNT(*) n FROM orders GROUP BY status').map((r) => [r.status, r.n])) };
});
GET('/api/admin/orders/:number', ord, (ctx) => { const o = get('SELECT * FROM orders WHERE number=?', ctx.params.number); if (!o) throw notFound('Order not found.'); return { order: orderDetail(o) }; });
PATCH('/api/admin/orders/:number/status', ord, (ctx) => {
  const o = get('SELECT * FROM orders WHERE number=?', ctx.params.number);
  if (!o) throw notFound('Order not found.');
  const status = v.oneOf(ctx.body.status, 'status', [...ORDER_FLOW, 'cancelled']);
  const note = v.str(ctx.body.note, 'note', { max: 300, required: false });
  const updated = transitionOrder(o.id, status, { actorId: ctx.user.id, note });
  bustHome(); audit(ctx, 'order.status', 'order', o.number, { from: o.status, to: status });
  return { order: orderDetail(updated) };
});
PATCH('/api/admin/orders/:number/payment', ord, (ctx) => {
  const o = get('SELECT * FROM orders WHERE number=?', ctx.params.number);
  if (!o) throw notFound('Order not found.');
  const ps = v.oneOf(ctx.body.paymentStatus, 'paymentStatus', ['pending', 'paid', 'failed', 'refunded']);
  tx(() => { run('UPDATE orders SET payment_status=?, updated_at=? WHERE id=?', ps, now(), o.id); run('UPDATE payments SET status=? WHERE order_id=?', ps, o.id); run('INSERT INTO order_status_history(order_id,status,note,actor_id,created_at) VALUES (?,?,?,?,?)', o.id, o.status, `Payment marked ${ps}`, ctx.user.id, now()); });
  audit(ctx, 'order.payment', 'order', o.number, { to: ps });
  return { order: orderDetail(get('SELECT * FROM orders WHERE id=?', o.id)) };
});

// ===================== customers =====================
const cus = requirePerm('customers');
GET('/api/admin/customers', cus, (ctx) => {
  const { size, offset } = page(ctx.query);
  const q = ctx.query.q ? 'AND (u.username LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)' : '';
  const p = ctx.query.q ? [like(ctx.query.q), like(ctx.query.q), like(ctx.query.q)] : [];
  return { customers: all(`SELECT u.id,u.username,u.email,u.full_name fullName,u.email_verified emailVerified,u.disabled,u.created_at createdAt,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.status<>'cancelled') orders,
    (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.user_id=u.id AND o.status<>'cancelled' AND o.payment_status='paid') spent FROM users u WHERE u.role='customer' ${q} ORDER BY u.id DESC LIMIT ? OFFSET ?`, ...p, size, offset),
    total: get(`SELECT COUNT(*) n FROM users u WHERE role='customer' ${q}`, ...p).n };
});
GET('/api/admin/customers/:id', cus, (ctx) => {
  const u = get("SELECT id,username,email,full_name fullName,phone,email_verified emailVerified,disabled,created_at createdAt FROM users WHERE id=? AND role='customer'", Number(ctx.params.id));
  if (!u) throw notFound();
  return { customer: u, orders: all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50', u.id).map(orderDetail) };
});

// ===================== owner: admin accounts, permissions, security, audit =====================
const adminOut = (u) => ({ id: u.id, username: u.username, email: u.email, role: u.role, disabled: !!u.disabled, notifyOrders: !!u.notify_orders, permissions: u.role === 'owner' ? STAFF_PERMS : all('SELECT permission FROM user_permissions WHERE user_id=?', u.id).map((r) => r.permission), createdAt: u.created_at });
GET('/api/admin/admins', requireOwner, () => ({
  admins: all("SELECT * FROM users WHERE role IN ('owner','admin') ORDER BY role DESC, id").map(adminOut),
  invites: all("SELECT id,email,payload,expires_at expiresAt,created_at createdAt FROM auth_tokens WHERE kind='invite' AND used_at IS NULL AND expires_at>? ORDER BY id DESC", now()).map((i) => ({ ...i, permissions: J(i.payload, []), payload: undefined })),
  allowlist: config.adminAllowlist, allPermissions: STAFF_PERMS, defaultPermissions: DEFAULT_ADMIN_PERMS,
}));
POST('/api/admin/admins/invite', requireOwner, limit('invite-send', 20, 60 * 60_000), (ctx) => {
  const email = v.email(ctx.body.email);
  if (!config.adminAllowlist.includes(email)) throw bad('That email is not on the authorised admin list (ADMIN_EMAILS). Add it to the server configuration first.', { email: 'Not authorised' });
  if (email === config.ownerEmail) throw bad('That is the owner account.', { email: 'Owner' });
  const ex = get('SELECT role FROM users WHERE email=?', email);
  if (ex?.role === 'admin') throw bad('That person is already an admin.', { email: 'Already an admin' });
  const perms = (Array.isArray(ctx.body.permissions) ? ctx.body.permissions : DEFAULT_ADMIN_PERMS).filter((p) => STAFF_PERMS.includes(p));
  const token = issueToken('invite', { email, payload: perms, ttlMs: 7 * 86400_000 });
  const link = `${config.appUrl}/admin#/accept-invite?token=${token}`;
  fireAndForget(sendMail({ eventKey: `invite:${email}:${token.slice(0, 10)}`, to: email, subject: 'You have been invited to manage Luxury Bharat',
    text: `The owner invited you as an admin of Luxury Bharat. Accept within 7 days:\n${link}`,
    html: emailHtml('Admin invitation', ['You have been invited to help manage Luxury Bharat.', 'This link is valid for 7 days and can be used once.'], { url: link, label: 'Accept invitation' }) }));
  audit(ctx, 'admin.invite', 'user', email, { permissions: perms });
  return { ok: true, ...(config.prod ? {} : { devInviteLink: link }) };
});
PATCH('/api/admin/admins/:id', requireOwner, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', Number(ctx.params.id));
  if (!u || u.role !== 'admin') throw notFound('Admin not found.');
  if (Array.isArray(ctx.body.permissions)) setPermissions(u.id, ctx.body.permissions);
  if (ctx.body.notifyOrders !== undefined) run('UPDATE users SET notify_orders=? WHERE id=?', v.bool(ctx.body.notifyOrders), u.id);
  audit(ctx, 'admin.permissions', 'user', u.id, { permissions: ctx.body.permissions });
  return { admin: adminOut(get('SELECT * FROM users WHERE id=?', u.id)) };
});
DEL('/api/admin/admins/:id', requireOwner, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', Number(ctx.params.id));
  if (!u) throw notFound('Admin not found.');
  if (u.role === 'owner') throw forbidden('The owner account cannot be removed.');
  if (u.role !== 'admin') throw bad('That user is not an admin.');
  tx(() => { run("UPDATE users SET role='customer', updated_at=? WHERE id=?", now(), u.id); run('DELETE FROM user_permissions WHERE user_id=?', u.id); });
  destroyUserSessions(u.id);
  audit(ctx, 'admin.remove', 'user', u.id, { email: u.email });
  return { ok: true };
});
DEL('/api/admin/invites/:id', requireOwner, (ctx) => { run("UPDATE auth_tokens SET used_at=? WHERE id=? AND kind='invite'", now(), Number(ctx.params.id)); audit(ctx, 'admin.invite.revoke', 'invite', ctx.params.id); return { ok: true }; });
POST('/api/admin/users/:id/status', requireOwner, (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', Number(ctx.params.id));
  if (!u || u.role === 'owner') throw forbidden('That account cannot be changed.');
  const disabled = v.bool(ctx.body.disabled);
  run('UPDATE users SET disabled=?, updated_at=? WHERE id=?', disabled, now(), u.id);
  if (disabled) destroyUserSessions(u.id);
  audit(ctx, disabled ? 'user.disable' : 'user.enable', 'user', u.id);
  return { ok: true };
});

GET('/api/admin/security', requireOwner, () => ({ security: getSetting('security'), sessions: all("SELECT s.id,u.username,u.role,s.ip,s.user_agent userAgent,s.created_at createdAt,s.last_seen lastSeen FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.role IN ('owner','admin') AND s.expires_at>? ORDER BY s.last_seen DESC LIMIT 100", now()) }));
PUT('/api/admin/security', requireOwner, (ctx) => {
  const s = { max_failed_logins: v.int(ctx.body.max_failed_logins, 'max_failed_logins', { min: 3, max: 20 }), lockout_minutes: v.int(ctx.body.lockout_minutes, 'lockout_minutes', { min: 1, max: 1440 }), session_days: v.int(ctx.body.session_days, 'session_days', { min: 1, max: 60 }), min_password_length: v.int(ctx.body.min_password_length, 'min_password_length', { min: 8, max: 64 }) };
  setSetting('security', s); audit(ctx, 'security.update', 'settings', 'security', s);
  return { security: s };
});
POST('/api/admin/security/revoke-sessions', requireOwner, (ctx) => {
  if (ctx.body.userId) destroyUserSessions(Number(ctx.body.userId));
  else run("DELETE FROM sessions WHERE user_id<>? AND user_id IN (SELECT id FROM users WHERE role='admin')", ctx.user.id);
  audit(ctx, 'security.revoke_sessions', 'user', ctx.body.userId || 'all-admins');
  return { ok: true };
});
GET('/api/admin/audit', requireOwner, (ctx) => {
  const { size, offset } = page(ctx.query, 50);
  const q = ctx.query.q ? 'WHERE action LIKE ? OR actor_email LIKE ? OR entity_id LIKE ?' : '';
  const p = ctx.query.q ? [like(ctx.query.q), like(ctx.query.q), like(ctx.query.q)] : [];
  return { logs: all(`SELECT id,actor_email actor,action,entity,entity_id entityId,meta,ip,created_at createdAt FROM audit_logs ${q} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, size, offset).map((l) => ({ ...l, meta: J(l.meta) })), total: get(`SELECT COUNT(*) n FROM audit_logs ${q}`, ...p).n };
});

// ===================== notifications =====================
const PERM_OF = { 'order.new': 'orders', 'ticket.new': 'support', 'ticket.reply': 'support', 'stock.low': 'inventory' };
const visibleTo = (u) => (n) => u.role === 'owner' || u.permissions.includes(PERM_OF[n.type]);
GET('/api/admin/notifications', requireStaff, (ctx) => {
  const rows = all('SELECT n.*, (r.user_id IS NOT NULL) isRead FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=? ORDER BY n.id DESC LIMIT 80', ctx.user.id).filter(visibleTo(ctx.user));
  const list = rows.slice(0, 40).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, refType: n.ref_type, refId: n.ref_id, data: J(n.data), createdAt: n.created_at, read: !!n.isRead }));
  return { notifications: list, unread: rows.filter((n) => !n.isRead).length };
});
POST('/api/admin/notifications/read', requireStaff, (ctx) => {
  const ids = ctx.body.all ? all('SELECT id FROM notifications').map((r) => r.id) : (Array.isArray(ctx.body.ids) ? ctx.body.ids.map(Number).filter(Number.isInteger) : []);
  for (const id of ids) run('INSERT OR IGNORE INTO notification_reads VALUES (?,?)', ctx.user.id, id);
  return { ok: true };
});
GET('/api/admin/stream', requireStaff, (ctx) => {
  ctx.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  ctx.res.write('retry: 5000\n\n');
  addSseClient(ctx.res, ctx.user);
});
