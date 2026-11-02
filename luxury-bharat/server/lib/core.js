import { get, all, run, now, J } from './db.js';

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  store: {
    name: 'Luxury Bharat', tagline: "India's Premium Lifestyle Store",
    support_email: 'luxurybhaarat@gmail.com', cod_enabled: false,
    shipping_flat: 9900, free_shipping_above: 299900,       // paise
    low_stock_default: 5,
    ambient_enabled: true, ambient_images: [],
  },
  footer: {
    about: 'Luxury Bharat brings considered clothing, footwear, accessories and pantry staples from across Bharat to your door.',
    address: '', phone: '', email: 'luxurybhaarat@gmail.com', hours: '',
    socials: { instagram: '', facebook: '', x: '', youtube: '' },
  },
  security: { max_failed_logins: 5, lockout_minutes: 15, session_days: 7, min_password_length: 10 },
};
const settingsCache = new Map();
export function getSetting(key) {
  if (settingsCache.has(key)) return settingsCache.get(key);
  const row = get('SELECT value FROM settings WHERE key=?', key);
  const val = { ...(DEFAULT_SETTINGS[key] || {}), ...(row ? J(row.value, {}) : {}) };
  settingsCache.set(key, val);
  return val;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', key, JSON.stringify(value), now());
  settingsCache.delete(key);
  bustHome();
}

// ---------- storefront cache (revalidated on every admin write) ----------
let homeCache = null;
export const bustHome = () => { homeCache = null; };
export const cachedHome = (build) => (homeCache ||= build());

// ---------- audit ----------
export function audit(ctx, action, entity, entityId, meta) {
  run('INSERT INTO audit_logs(actor_id,actor_email,action,entity,entity_id,meta,ip,created_at) VALUES (?,?,?,?,?,?,?,?)',
    ctx?.user?.id ?? null, ctx?.user?.email ?? null, action, entity ?? null, entityId == null ? null : String(entityId), meta ? JSON.stringify(meta) : null, ctx?.ip ?? null, now());
}

// ---------- server-sent events to staff dashboards ----------
const clients = new Set();
export function addSseClient(res, user) {
  const c = { res, user };
  clients.add(c);
  res.on('close', () => clients.delete(c));
  return c;
}
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25_000).unref();
export function broadcastStaff(event, data, perm) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (c.user.role === 'owner' || c.user.permissions.includes(perm)) c.res.write(payload);
  }
}

/** Creates a notification once per (type, ref). Returns the row, or null if it already existed. */
export function notify(type, title, body, refType, refId, data, perm) {
  const r = run('INSERT OR IGNORE INTO notifications(type,title,body,ref_type,ref_id,data,created_at) VALUES (?,?,?,?,?,?,?)',
    type, title, body, refType, String(refId), data ? JSON.stringify(data) : null, now());
  if (!r.changes) return null;
  const row = get('SELECT * FROM notifications WHERE id=?', r.lastInsertRowid);
  broadcastStaff('notification', { ...row, data: J(row.data) }, perm);
  return row;
}

export function genNumber(prefix) {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  return `${prefix}-${ymd}-${rand}`;
}

// ---------- shared product/image helpers ----------
export const bool = (x) => !!x;
export function productImages(ids) {
  if (!ids.length) return new Map();
  const rows = all(`SELECT product_id,url,thumb_url,alt FROM product_images WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY position,id`, ...ids);
  const m = new Map();
  for (const r of rows) (m.get(r.product_id) || m.set(r.product_id, []).get(r.product_id)).push(r);
  return m;
}
export function publicProducts(rows) {
  const imgs = productImages(rows.map((r) => r.id));
  const cats = new Map(all('SELECT id,name,slug FROM categories').map((c) => [c.id, c]));
  return rows.map((p) => {
    const list = imgs.get(p.id) || [];
    const price = p.discount_price ?? p.price;
    const c = cats.get(p.category_id);
    return {
      id: p.id, slug: p.slug, name: p.name, sku: p.sku, description: p.description,
      price: p.price, discountPrice: p.discount_price, finalPrice: price,
      discountPct: p.discount_price ? Math.round((1 - p.discount_price / p.price) * 100) : 0,
      image: list[0]?.url || null, thumb: list[0]?.thumb_url || list[0]?.url || null, hoverImage: list[1]?.url || null,
      images: list.map((i) => ({ url: i.url, alt: i.alt })),
      inStock: p.stock > 0, lowStock: p.stock > 0 && p.stock <= p.low_stock_threshold, stock: Math.min(p.stock, 10),
      featured: !!p.featured, trending: !!p.trending, isNew: !!p.is_new,
      tags: J(p.tags, []), attrs: J(p.attrs, {}),
      category: c ? { id: c.id, name: c.name, slug: c.slug } : null,
      seoTitle: p.seo_title, seoDescription: p.seo_description, createdAt: p.created_at, soldCount: p.sold_count,
    };
  });
}
