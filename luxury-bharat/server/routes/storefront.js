import { GET, PUT, DEL, POST, bad, notFound, rateLimit, v } from '../lib/http.js';
import { get, all, run, now, J } from '../lib/db.js';
import { getSetting, cachedHome, publicProducts } from '../lib/core.js';
import { requireAuth } from '../lib/auth.js';
import { config } from '../config.js';

// ---------- categories ----------
export function publicCategory(c, counts) {
  return { id: c.id, slug: c.slug, name: c.name, subtitle: c.subtitle, description: c.description, parentId: c.parent_id, image: c.image, bgImage: c.bg_image, mobileImage: c.mobile_image, hoverImage: c.hover_image, imageFit: c.image_fit, bgColor: c.bg_color, count: counts?.get(c.id) ?? undefined };
}
const categoryCounts = () => new Map(all("SELECT category_id id, COUNT(*) n FROM products WHERE status='active' GROUP BY category_id").map((r) => [r.id, r.n]));
export function descendantIds(ids) {
  let out = new Set(ids), frontier = [...ids];
  for (let d = 0; d < 4 && frontier.length; d++) {
    const kids = all(`SELECT id FROM categories WHERE parent_id IN (${frontier.map(() => '?').join(',')})`, ...frontier).map((r) => r.id).filter((x) => !out.has(x));
    kids.forEach((k) => out.add(k)); frontier = kids;
  }
  return [...out];
}
export const visibleCategories = () => all('SELECT * FROM categories WHERE visible=1 ORDER BY position,id');

// ---------- sections (rendered from the database, never hard-coded) ----------
export function sectionProducts(s) {
  const limit = s.item_limit || 8;
  const manual = all(`SELECT p.* FROM section_products sp JOIN products p ON p.id=sp.product_id WHERE sp.section_id=? AND p.status='active' ORDER BY sp.position,p.id`, s.id);
  if (manual.length) return manual.slice(0, limit);
  const cats = all('SELECT category_id FROM section_categories WHERE section_id=?', s.id).map((r) => r.category_id);
  if (cats.length) {
    const ids = descendantIds(cats);
    return all(`SELECT * FROM products WHERE status='active' AND category_id IN (${ids.map(() => '?').join(',')}) ORDER BY is_new DESC, id DESC LIMIT ?`, ...ids, limit);
  }
  const base = "SELECT * FROM products WHERE status='active'";
  switch (s.source) {
    case 'featured': return all(`${base} AND featured=1 ORDER BY id DESC LIMIT ?`, limit);
    case 'trending': return all(`${base} AND trending=1 ORDER BY sold_count DESC, id DESC LIMIT ?`, limit);
    case 'new': return all(`${base} AND is_new=1 ORDER BY id DESC LIMIT ?`, limit);
    case 'bestsellers': return all(`${base} ORDER BY sold_count DESC, id DESC LIMIT ?`, limit);
    default: return [];
  }
}
export function renderSection(s) {
  const out = {
    id: s.id, slug: s.slug, name: s.name, description: s.description, type: s.type, content: s.content,
    image: s.image, bgImage: s.bg_image, mobileImage: s.mobile_image, hoverImage: s.hover_image, bgColor: s.bg_color,
    ctaText: s.cta_text, ctaUrl: s.cta_url, source: s.source, visible: !!s.visible, status: s.status, position: s.position,
  };
  if (['product_grid', 'product_carousel', 'featured_collection'].includes(s.type)) out.products = publicProducts(sectionProducts(s));
  if (s.type === 'category_catalog') {
    const linked = all('SELECT c.* FROM section_categories sc JOIN categories c ON c.id=sc.category_id WHERE sc.section_id=? AND c.visible=1 ORDER BY sc.position,c.position', s.id);
    const cats = linked.length ? linked : all('SELECT * FROM categories WHERE visible=1 AND parent_id IS NULL ORDER BY position,id');
    const counts = categoryCounts();
    out.categories = cats.map((c) => publicCategory(c, counts));
  }
  return out;
}

function buildHome() {
  const store = getSetting('store');
  const counts = categoryCounts();
  const cats = visibleCategories().map((c) => publicCategory(c, counts));
  return {
    store: { name: store.name, tagline: store.tagline, ambientEnabled: store.ambient_enabled, ambientImages: store.ambient_images || [], shippingFlat: store.shipping_flat, freeShippingAbove: store.free_shipping_above },
    payments: { cod: !!store.cod_enabled, test: config.paymentMode === 'test', razorpay: !!(config.razorpay.keyId && config.razorpay.keySecret) },
    banners: all('SELECT * FROM banners WHERE visible=1 ORDER BY position,id').map((b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, buttonText: b.button_text, buttonUrl: b.button_url, imageDesktop: b.image_desktop, imageMobile: b.image_mobile, videoUrl: b.video_url, badge: b.badge, align: b.align, overlay: b.overlay, heightVh: b.height_vh })),
    categories: cats,
    sections: all("SELECT * FROM sections WHERE visible=1 AND status='published' ORDER BY position,id").map(renderSection),
    footer: getSetting('footer'),
    pages: all('SELECT slug,title FROM pages WHERE visible=1 ORDER BY position').map((p) => ({ slug: p.slug, title: p.title })),
  };
}
GET('/api/home', () => cachedHome(buildHome));
GET('/api/categories', () => ({ categories: visibleCategories().map((c) => publicCategory(c, categoryCounts())) }));
GET('/api/pages/:slug', (ctx) => {
  const p = get('SELECT slug,title,body,updated_at FROM pages WHERE slug=? AND visible=1', ctx.params.slug);
  if (!p) throw notFound('Page not found.');
  return { page: p };
});

// ---------- search & listing ----------
const STOP = new Set(['for', 'the', 'and', 'with', 'a', 'an', 'of', 'in', 'to']);
const tokenize = (s) => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => !STOP.has(t)).map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));

function scoreProduct(p, tokens, catName) {
  if (!tokens.length) return { score: 0, matched: 0 };
  const name = p.name.toLowerCase(), words = name.match(/[a-z0-9]+/g) || [], tags = J(p.tags, []).join(' ').toLowerCase(), cat = (catName || '').toLowerCase();
  const attrs = Object.values(J(p.attrs, {})).flat().join(' ').toLowerCase(), desc = p.description.toLowerCase();
  let score = 0, matched = 0;
  for (const t of tokens) {
    let s = 0;
    if (words.some((w) => w === t || w === t + 's')) s = 8; else if (words.some((w) => w.startsWith(t))) s = 6; else if (name.includes(t)) s = 4;
    if (tags.includes(t)) s = Math.max(s, 5);
    if (attrs.includes(t)) s = Math.max(s, 5);
    if (cat.includes(t)) s = Math.max(s, 3);
    if (desc.includes(t)) s = Math.max(s, 1);
    if (s) matched++;
    score += s;
  }
  if (name.includes(tokens.join(' '))) score += 10;
  return { score, matched };
}

export function searchProducts(q) {
  const tokens = tokenize(q.q);
  const cats = new Map(all('SELECT * FROM categories').map((c) => [c.id, c]));
  let catFilter = null;
  if (q.category) { const c = all('SELECT id FROM categories WHERE slug=?', String(q.category)); catFilter = new Set(c.length ? descendantIds([c[0].id]) : [-1]); }
  const all_ = all("SELECT * FROM products WHERE status='active'");
  const scored = [];
  for (const p of all_) {
    if (catFilter && !catFilter.has(p.category_id)) continue;
    const { score, matched } = scoreProduct(p, tokens, cats.get(p.category_id)?.name);
    if (tokens.length && !matched) continue;
    scored.push({ p, score, matched, match: !tokens.length || matched === tokens.length ? 'exact' : 'related' });
  }
  // Related: same-category siblings of the best exact matches (e.g. other jackets when searching "black jacket").
  if (tokens.length) {
    const top = scored.filter((x) => x.match === 'exact').sort((a, b) => b.score - a.score).slice(0, 3);
    const topCats = new Set(top.map((x) => x.p.category_id).filter(Boolean));
    const have = new Set(scored.map((x) => x.p.id));
    for (const p of all_) if (!have.has(p.id) && topCats.has(p.category_id) && (!catFilter || catFilter.has(p.category_id))) scored.push({ p, score: 0, matched: 0, match: 'related' });
  }
  const facetBase = scored.slice();
  const min = q.min != null && q.min !== '' ? Math.round(Number(q.min) * 100) : null, max = q.max != null && q.max !== '' ? Math.round(Number(q.max) * 100) : null;
  const color = q.color ? String(q.color).toLowerCase() : null;
  let list = scored.filter(({ p }) => {
    const price = p.discount_price ?? p.price;
    if (min != null && price < min) return false;
    if (max != null && price > max) return false;
    if (q.discount && !p.discount_price) return false;
    if (q.discount && p.discount_price && Math.round((1 - p.discount_price / p.price) * 100) < Number(q.discount)) return false;
    if (q.inStock === '1' && p.stock <= 0) return false;
    if (q.new === '1' && !p.is_new) return false;
    if (q.trending === '1' && !p.trending) return false;
    if (color) { const c = J(p.attrs, {}).color; if (!c || !String(c).toLowerCase().includes(color)) return false; }
    return true;
  });
  const sort = q.sort || 'recommended';
  const price = (x) => x.p.discount_price ?? x.p.price;
  const cmp = { recommended: (a, b) => b.score - a.score || b.p.featured - a.p.featured || b.p.sold_count - a.p.sold_count || b.p.id - a.p.id,
    price_asc: (a, b) => price(a) - price(b), price_desc: (a, b) => price(b) - price(a),
    newest: (a, b) => (a.p.created_at < b.p.created_at ? 1 : -1), popular: (a, b) => b.p.sold_count + b.p.views / 20 - (a.p.sold_count + a.p.views / 20) }[sort] || ((a, b) => b.score - a.score);
  const rank = (x) => (x.match === 'exact' ? 0 : 1);
  list.sort((a, b) => rank(a) - rank(b) || cmp(a, b)); // exact matches always lead; the chosen sort applies within each group
  const pageSize = Math.min(Number(q.pageSize) || 24, 60), page = Math.max(Number(q.page) || 1, 1);
  const slice = list.slice((page - 1) * pageSize, page * pageSize);
  const pub = publicProducts(slice.map((x) => x.p));
  const items = pub.map((p, i) => ({ ...p, match: slice[i].match }));
  const catCount = new Map(); const colors = new Set();
  for (const { p } of facetBase) { catCount.set(p.category_id, (catCount.get(p.category_id) || 0) + 1); const c = J(p.attrs, {}).color; if (c) colors.add(String(c)); }
  const prices = facetBase.map((x) => price(x));
  let recommended = [];
  if (tokens.length) {
    const have = new Set(list.map((x) => x.p.id));
    recommended = publicProducts(all("SELECT * FROM products WHERE status='active' AND (featured=1 OR trending=1) ORDER BY sold_count DESC, id DESC LIMIT 12").filter((p) => !have.has(p.id)).slice(0, 6));
  }
  return { items, total: list.length, exactCount: list.filter((x) => x.match === 'exact').length, page, pageSize, recommended,
    facets: { categories: [...catCount].filter(([id]) => cats.get(id)).map(([id, n]) => ({ slug: cats.get(id).slug, name: cats.get(id).name, count: n })), colors: [...colors].sort(), priceMin: prices.length ? Math.min(...prices) : 0, priceMax: prices.length ? Math.max(...prices) : 0 } };
}
GET('/api/products', (ctx) => searchProducts(ctx.query));

GET('/api/search/suggest', (ctx) => {
  const q = String(ctx.query.q || '').trim().slice(0, 60);
  if (q.length < 2) return { products: [], categories: [], terms: [] };
  const tokens = tokenize(q);
  const cats = new Map(all('SELECT * FROM categories').map((c) => [c.id, c]));
  const scored = all("SELECT * FROM products WHERE status='active'").map((p) => ({ p, ...scoreProduct(p, tokens, cats.get(p.category_id)?.name) })).filter((x) => x.matched).sort((a, b) => b.matched - a.matched || b.score - a.score).slice(0, 5);
  const categories = [...cats.values()].filter((c) => c.visible && tokens.some((t) => c.name.toLowerCase().includes(t))).slice(0, 3).map((c) => ({ name: c.name, slug: c.slug }));
  const terms = new Set();
  for (const p of all("SELECT tags FROM products WHERE status='active'")) for (const t of J(p.tags, [])) if (t.toLowerCase().includes(q.toLowerCase())) terms.add(t);
  return { products: publicProducts(scored.map((x) => x.p)).map((p) => ({ name: p.name, slug: p.slug, image: p.thumb, price: p.finalPrice })), categories, terms: [...terms].slice(0, 5) };
});

// ---------- product detail ----------
GET('/api/products/by-ids', (ctx) => {
  const ids = String(ctx.query.ids || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 24);
  if (!ids.length) return { items: [] };
  const rows = all(`SELECT * FROM products WHERE status='active' AND id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const pub = publicProducts(rows);
  return { items: ids.map((id) => pub.find((p) => p.id === id)).filter(Boolean) };
});
GET('/api/products/:slug', (ctx) => {
  const row = get("SELECT * FROM products WHERE slug=? AND status='active'", ctx.params.slug);
  if (!row) throw notFound('This product is no longer available.');
  if (rateLimit(`view:${ctx.ip}:${row.id}`, 1, 30 * 60_000)) run('UPDATE products SET views=views+1 WHERE id=?', row.id);
  const [product] = publicProducts([row]);
  const tags = new Set(product.tags.map((t) => t.toLowerCase()));
  const rel = all("SELECT * FROM products WHERE status='active' AND id<>? AND category_id IS ?", row.id, row.category_id)
    .map((p) => ({ p, n: J(p.tags, []).filter((t) => tags.has(t.toLowerCase())).length })).sort((a, b) => b.n - a.n || b.p.sold_count - a.p.sold_count).slice(0, 8).map((x) => x.p);
  const crumbs = [];
  let c = row.category_id ? get('SELECT * FROM categories WHERE id=?', row.category_id) : null;
  while (c) { crumbs.unshift({ name: c.name, slug: c.slug }); c = c.parent_id ? get('SELECT * FROM categories WHERE id=?', c.parent_id) : null; }
  return { product, related: publicProducts(rel), breadcrumbs: crumbs };
});

// ---------- recently viewed + wishlist (signed-in; guests keep ids in localStorage and merge on login) ----------
GET('/api/recently-viewed', requireAuth, (ctx) => ({ items: publicProducts(all("SELECT p.* FROM recently_viewed r JOIN products p ON p.id=r.product_id WHERE r.user_id=? AND p.status='active' ORDER BY r.viewed_at DESC LIMIT 12", ctx.user.id)) }));
POST('/api/recently-viewed', requireAuth, (ctx) => {
  const id = v.int(ctx.body.id, 'id', { min: 1 });
  if (!get("SELECT 1 FROM products WHERE id=? AND status='active'", id)) throw notFound();
  run('INSERT INTO recently_viewed VALUES (?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET viewed_at=excluded.viewed_at', ctx.user.id, id, now());
  run('DELETE FROM recently_viewed WHERE user_id=? AND product_id NOT IN (SELECT product_id FROM recently_viewed WHERE user_id=? ORDER BY viewed_at DESC LIMIT 30)', ctx.user.id, ctx.user.id);
  return { ok: true };
});
GET('/api/wishlist', requireAuth, (ctx) => ({ items: publicProducts(all("SELECT p.* FROM wishlists w JOIN products p ON p.id=w.product_id WHERE w.user_id=? AND p.status='active' ORDER BY w.created_at DESC", ctx.user.id)) }));
PUT('/api/wishlist/:id', requireAuth, (ctx) => {
  const id = Number(ctx.params.id);
  if (!get("SELECT 1 FROM products WHERE id=? AND status='active'", id)) throw notFound();
  run('INSERT OR IGNORE INTO wishlists VALUES (?,?,?)', ctx.user.id, id, now()); return { ok: true };
});
DEL('/api/wishlist/:id', requireAuth, (ctx) => { run('DELETE FROM wishlists WHERE user_id=? AND product_id=?', ctx.user.id, Number(ctx.params.id)); return { ok: true }; });
POST('/api/wishlist/merge', requireAuth, (ctx) => {
  for (const id of (Array.isArray(ctx.body.ids) ? ctx.body.ids : []).slice(0, 50)) if (Number.isInteger(id) && get("SELECT 1 FROM products WHERE id=? AND status='active'", id)) run('INSERT OR IGNORE INTO wishlists VALUES (?,?,?)', ctx.user.id, id, now());
  return { ok: true };
});
