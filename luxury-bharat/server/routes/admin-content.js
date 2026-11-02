import { GET, POST, PUT, PATCH, DEL, bad, notFound, v, uniqueSlug } from '../lib/http.js';
import { get, all, run, tx, now, J } from '../lib/db.js';
import { requirePerm, requireOwner } from '../lib/auth.js';
import { audit, bustHome, getSetting, setSetting, publicProducts } from '../lib/core.js';
import { renderSection, descendantIds } from './storefront.js';

const reorder = (table, ids) => tx(() => { ids.map(Number).filter(Number.isInteger).forEach((id, i) => run(`UPDATE ${table} SET position=? WHERE id=?`, i * 10, id)); });
const nextPos = (table) => (get(`SELECT COALESCE(MAX(position),-10)+10 p FROM ${table}`).p);

// ===================== categories =====================
const cat = requirePerm('categories');
const catOut = (c) => ({ id: c.id, parentId: c.parent_id, name: c.name, slug: c.slug, subtitle: c.subtitle, description: c.description, image: c.image, bgImage: c.bg_image, mobileImage: c.mobile_image, hoverImage: c.hover_image, imageFit: c.image_fit, bgColor: c.bg_color, icon: c.icon, position: c.position, visible: !!c.visible, productCount: get('SELECT COUNT(*) n FROM products WHERE category_id=?', c.id).n });
function categoryInput(b, id) {
  let parentId = null;
  if (b.parentId) {
    parentId = v.int(b.parentId, 'parentId', { min: 1 });
    if (!get('SELECT 1 FROM categories WHERE id=?', parentId)) throw bad('Choose a valid parent category.', { parentId: 'Invalid parent' });
    if (id && descendantIds([id]).includes(parentId)) throw bad('A category cannot be placed inside itself.', { parentId: 'Creates a loop' });
  }
  return {
    parentId, name: v.str(b.name, 'name', { min: 2, max: 60 }), slug: v.str(b.slug, 'slug', { max: 60, required: false }),
    subtitle: v.str(b.subtitle, 'subtitle', { max: 80, required: false }), description: v.str(b.description, 'description', { max: 500, required: false }),
    image: v.url(b.image, 'image'), bgImage: v.url(b.bgImage, 'bgImage'), mobileImage: v.url(b.mobileImage, 'mobileImage'), hoverImage: v.url(b.hoverImage, 'hoverImage'),
    imageFit: v.oneOf(b.imageFit || 'contain', 'imageFit', ['contain', 'cover']), bgColor: v.color(b.bgColor, 'bgColor') || '#3A3A3A', icon: v.str(b.icon, 'icon', { max: 30, required: false }), visible: b.visible === undefined ? 1 : v.bool(b.visible),
  };
}
GET('/api/admin/categories', cat, () => ({ categories: all('SELECT * FROM categories ORDER BY position,id').map(catOut) }));
POST('/api/admin/categories', cat, (ctx) => {
  const d = categoryInput(ctx.body);
  const slug = uniqueSlug(d.slug || d.name, (s) => !!get('SELECT 1 FROM categories WHERE slug=?', s));
  const id = Number(run('INSERT INTO categories(parent_id,name,slug,subtitle,description,image,bg_image,mobile_image,hover_image,image_fit,bg_color,icon,position,visible,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', d.parentId, d.name, slug, d.subtitle, d.description, d.image, d.bgImage, d.mobileImage, d.hoverImage, d.imageFit, d.bgColor, d.icon, nextPos('categories'), d.visible, now(), now()).lastInsertRowid);
  bustHome(); audit(ctx, 'category.create', 'category', id, { name: d.name });
  return { category: catOut(get('SELECT * FROM categories WHERE id=?', id)) };
});
PUT('/api/admin/categories/:id', cat, (ctx) => {
  const c = get('SELECT * FROM categories WHERE id=?', Number(ctx.params.id));
  if (!c) throw notFound();
  const d = categoryInput(ctx.body, c.id);
  const slug = d.slug && d.slug !== c.slug ? uniqueSlug(d.slug, (s) => !!get('SELECT 1 FROM categories WHERE slug=? AND id<>?', s, c.id)) : c.slug;
  run('UPDATE categories SET parent_id=?,name=?,slug=?,subtitle=?,description=?,image=?,bg_image=?,mobile_image=?,hover_image=?,image_fit=?,bg_color=?,icon=?,visible=?,updated_at=? WHERE id=?', d.parentId, d.name, slug, d.subtitle, d.description, d.image, d.bgImage, d.mobileImage, d.hoverImage, d.imageFit, d.bgColor, d.icon, d.visible, now(), c.id);
  bustHome(); audit(ctx, 'category.update', 'category', c.id, { name: d.name });
  return { category: catOut(get('SELECT * FROM categories WHERE id=?', c.id)) };
});
DEL('/api/admin/categories/:id', cat, (ctx) => {
  const c = get('SELECT * FROM categories WHERE id=?', Number(ctx.params.id));
  if (!c) throw notFound();
  run('DELETE FROM categories WHERE id=?', c.id); bustHome(); audit(ctx, 'category.delete', 'category', c.id, { name: c.name });
  return { ok: true };
});
POST('/api/admin/categories/reorder', cat, (ctx) => { reorder('categories', ctx.body.ids || []); bustHome(); audit(ctx, 'category.reorder', 'category', null); return { ok: true }; });

// ===================== hero banners =====================
const ban = requirePerm('banners');
const banOut = (b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, buttonText: b.button_text, buttonUrl: b.button_url, imageDesktop: b.image_desktop, imageMobile: b.image_mobile, videoUrl: b.video_url, badge: b.badge, align: b.align, overlay: b.overlay, heightVh: b.height_vh, visible: !!b.visible, position: b.position });
const bannerInput = (b) => {
  const overlay = Number(b.overlay ?? 0.45);
  if (!(overlay >= 0 && overlay <= 1)) throw bad('Overlay must be between 0 and 1.', { overlay: '0 to 1' });
  return { title: v.str(b.title, 'title', { max: 100 }), subtitle: v.str(b.subtitle, 'subtitle', { max: 200, required: false }), buttonText: v.str(b.buttonText, 'buttonText', { max: 40, required: false }), buttonUrl: v.link(b.buttonUrl, 'buttonUrl'),
    imageDesktop: v.url(b.imageDesktop, 'imageDesktop'), imageMobile: v.url(b.imageMobile, 'imageMobile'), videoUrl: v.url(b.videoUrl, 'videoUrl'), badge: v.str(b.badge, 'badge', { max: 40, required: false }),
    align: v.oneOf(b.align || 'left', 'align', ['left', 'center', 'right']), overlay, heightVh: v.int(b.heightVh ?? 88, 'heightVh', { min: 30, max: 100 }), visible: b.visible === undefined ? 1 : v.bool(b.visible) };
};
GET('/api/admin/banners', ban, () => ({ banners: all('SELECT * FROM banners ORDER BY position,id').map(banOut) }));
POST('/api/admin/banners', ban, (ctx) => {
  const d = bannerInput(ctx.body);
  const id = Number(run('INSERT INTO banners(title,subtitle,button_text,button_url,image_desktop,image_mobile,video_url,badge,align,overlay,height_vh,visible,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', d.title, d.subtitle, d.buttonText, d.buttonUrl, d.imageDesktop, d.imageMobile, d.videoUrl, d.badge, d.align, d.overlay, d.heightVh, d.visible, nextPos('banners'), now(), now()).lastInsertRowid);
  bustHome(); audit(ctx, 'banner.create', 'banner', id);
  return { banner: banOut(get('SELECT * FROM banners WHERE id=?', id)) };
});
PUT('/api/admin/banners/:id', ban, (ctx) => {
  const b = get('SELECT * FROM banners WHERE id=?', Number(ctx.params.id));
  if (!b) throw notFound();
  const d = bannerInput(ctx.body);
  run('UPDATE banners SET title=?,subtitle=?,button_text=?,button_url=?,image_desktop=?,image_mobile=?,video_url=?,badge=?,align=?,overlay=?,height_vh=?,visible=?,updated_at=? WHERE id=?', d.title, d.subtitle, d.buttonText, d.buttonUrl, d.imageDesktop, d.imageMobile, d.videoUrl, d.badge, d.align, d.overlay, d.heightVh, d.visible, now(), b.id);
  bustHome(); audit(ctx, 'banner.update', 'banner', b.id);
  return { banner: banOut(get('SELECT * FROM banners WHERE id=?', b.id)) };
});
DEL('/api/admin/banners/:id', ban, (ctx) => { run('DELETE FROM banners WHERE id=?', Number(ctx.params.id)); bustHome(); audit(ctx, 'banner.delete', 'banner', ctx.params.id); return { ok: true }; });
POST('/api/admin/banners/reorder', ban, (ctx) => { reorder('banners', ctx.body.ids || []); bustHome(); return { ok: true }; });
// Ambient background (floating products) is part of the homepage experience.
GET('/api/admin/ambient', ban, () => { const s = getSetting('store'); return { enabled: !!s.ambient_enabled, images: s.ambient_images || [] }; });
PUT('/api/admin/ambient', ban, (ctx) => {
  const images = (Array.isArray(ctx.body.images) ? ctx.body.images : []).slice(0, 14).map((u) => v.url(u, 'image', { required: true }));
  setSetting('store', { ...getSetting('store'), ambient_enabled: !!v.bool(ctx.body.enabled), ambient_images: images });
  audit(ctx, 'ambient.update', 'settings', 'ambient');
  return { ok: true };
});

// ===================== section builder =====================
const sec = requirePerm('sections');
const SECTION_TYPES = ['product_grid', 'editorial_banner', 'product_carousel', 'category_catalog', 'featured_collection', 'promo_banner', 'custom_content'];
const SOURCES = ['manual', 'featured', 'trending', 'new', 'bestsellers', 'category'];
function sectionIn(s) {
  return { id: s.id, name: s.name, slug: s.slug, description: s.description, type: s.type, image: s.image, bgImage: s.bg_image, mobileImage: s.mobile_image, hoverImage: s.hover_image, bgColor: s.bg_color, ctaText: s.cta_text, ctaUrl: s.cta_url, content: s.content, source: s.source, itemLimit: s.item_limit, position: s.position, visible: !!s.visible, status: s.status,
    productIds: all('SELECT product_id FROM section_products WHERE section_id=? ORDER BY position', s.id).map((r) => r.product_id), categoryIds: all('SELECT category_id FROM section_categories WHERE section_id=? ORDER BY position', s.id).map((r) => r.category_id) };
}
function sectionInput(b) {
  const ids = (a, table, label) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 60).filter((id) => get(`SELECT 1 FROM ${table} WHERE id=?`, id));
  return { name: v.str(b.name, 'name', { min: 2, max: 80 }), slug: v.str(b.slug, 'slug', { max: 80, required: false }), description: v.str(b.description, 'description', { max: 400, required: false }),
    type: v.oneOf(b.type, 'type', SECTION_TYPES), image: v.url(b.image, 'image'), bgImage: v.url(b.bgImage, 'bgImage'), mobileImage: v.url(b.mobileImage, 'mobileImage'), hoverImage: v.url(b.hoverImage, 'hoverImage'), bgColor: v.color(b.bgColor, 'bgColor'),
    ctaText: v.str(b.ctaText, 'ctaText', { max: 40, required: false }), ctaUrl: v.link(b.ctaUrl, 'ctaUrl'), content: v.str(b.content, 'content', { max: 6000, required: false }),
    source: v.oneOf(b.source || 'manual', 'source', SOURCES), itemLimit: v.int(b.itemLimit ?? 8, 'itemLimit', { min: 1, max: 24 }),
    visible: b.visible === undefined ? 1 : v.bool(b.visible), status: v.oneOf(b.status || 'draft', 'status', ['draft', 'published']),
    productIds: ids(b.productIds, 'products'), categoryIds: ids(b.categoryIds, 'categories') };
}
function writeLinks(id, d) {
  run('DELETE FROM section_products WHERE section_id=?', id); run('DELETE FROM section_categories WHERE section_id=?', id);
  d.productIds.forEach((p, i) => run('INSERT INTO section_products VALUES (?,?,?)', id, p, i));
  d.categoryIds.forEach((c, i) => run('INSERT INTO section_categories VALUES (?,?,?)', id, c, i));
}
GET('/api/admin/sections', sec, () => ({ sections: all('SELECT * FROM sections ORDER BY position,id').map(sectionIn), types: SECTION_TYPES, sources: SOURCES }));
GET('/api/admin/sections/:id/preview', sec, (ctx) => { const s = get('SELECT * FROM sections WHERE id=?', Number(ctx.params.id)); if (!s) throw notFound(); return { section: renderSection(s), store: { name: getSetting('store').name } }; });
POST('/api/admin/sections/preview', sec, (ctx) => {
  // Preview an unsaved draft: validate like a save, but render without persisting.
  const d = sectionInput(ctx.body);
  const fake = { id: -1, name: d.name, slug: d.slug || 'preview', description: d.description, type: d.type, image: d.image, bg_image: d.bgImage, mobile_image: d.mobileImage, hover_image: d.hoverImage, bg_color: d.bgColor, cta_text: d.ctaText, cta_url: d.ctaUrl, content: d.content, source: d.source, item_limit: d.itemLimit, visible: 1, status: 'published', position: 0 };
  return { section: renderDraft(fake, d) };
});
function renderDraft(fake, d) {
  // Resolve products without writing: explicit picks first, else categories, else source rule.
  const out = renderSection({ ...fake, id: -1 });
  if (['product_grid', 'product_carousel', 'featured_collection'].includes(d.type) && (d.productIds.length || d.categoryIds.length)) {
    const rows = d.productIds.length
      ? d.productIds.map((id) => get("SELECT * FROM products WHERE id=? AND status='active'", id)).filter(Boolean)
      : (() => { const ids = descendantIds(d.categoryIds); return all(`SELECT * FROM products WHERE status='active' AND category_id IN (${ids.map(() => '?').join(',')}) ORDER BY is_new DESC,id DESC LIMIT ?`, ...ids, d.itemLimit); })();
    out.products = publicProducts(rows.slice(0, d.itemLimit));
  }
  if (d.type === 'category_catalog' && d.categoryIds.length) out.categories = d.categoryIds.map((id) => get('SELECT * FROM categories WHERE id=?', id)).filter(Boolean).map((c) => ({ id: c.id, slug: c.slug, name: c.name, subtitle: c.subtitle, image: c.image, mobileImage: c.mobile_image, hoverImage: c.hover_image, imageFit: c.image_fit, bgColor: c.bg_color }));
  return out;
}
POST('/api/admin/sections', sec, (ctx) => {
  const d = sectionInput(ctx.body);
  const id = tx(() => {
    const slug = uniqueSlug(d.slug || d.name, (s) => !!get('SELECT 1 FROM sections WHERE slug=?', s));
    const sid = Number(run('INSERT INTO sections(name,slug,description,type,image,bg_image,mobile_image,hover_image,bg_color,cta_text,cta_url,content,source,item_limit,position,visible,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', d.name, slug, d.description, d.type, d.image, d.bgImage, d.mobileImage, d.hoverImage, d.bgColor, d.ctaText, d.ctaUrl, d.content, d.source, d.itemLimit, nextPos('sections'), d.visible, d.status, now(), now()).lastInsertRowid);
    writeLinks(sid, d); return sid;
  });
  bustHome(); audit(ctx, 'section.create', 'section', id, { name: d.name, status: d.status });
  return { section: sectionIn(get('SELECT * FROM sections WHERE id=?', id)) };
});
PUT('/api/admin/sections/:id', sec, (ctx) => {
  const s = get('SELECT * FROM sections WHERE id=?', Number(ctx.params.id));
  if (!s) throw notFound();
  const d = sectionInput(ctx.body);
  tx(() => {
    const slug = d.slug && d.slug !== s.slug ? uniqueSlug(d.slug, (x) => !!get('SELECT 1 FROM sections WHERE slug=? AND id<>?', x, s.id)) : s.slug;
    run('UPDATE sections SET name=?,slug=?,description=?,type=?,image=?,bg_image=?,mobile_image=?,hover_image=?,bg_color=?,cta_text=?,cta_url=?,content=?,source=?,item_limit=?,visible=?,status=?,updated_at=? WHERE id=?', d.name, slug, d.description, d.type, d.image, d.bgImage, d.mobileImage, d.hoverImage, d.bgColor, d.ctaText, d.ctaUrl, d.content, d.source, d.itemLimit, d.visible, d.status, now(), s.id);
    writeLinks(s.id, d);
  });
  bustHome(); audit(ctx, 'section.update', 'section', s.id, { name: d.name, status: d.status });
  return { section: sectionIn(get('SELECT * FROM sections WHERE id=?', s.id)) };
});
PATCH('/api/admin/sections/:id', sec, (ctx) => {
  const s = get('SELECT * FROM sections WHERE id=?', Number(ctx.params.id));
  if (!s) throw notFound();
  const visible = ctx.body.visible === undefined ? s.visible : v.bool(ctx.body.visible);
  const status = ctx.body.status === undefined ? s.status : v.oneOf(ctx.body.status, 'status', ['draft', 'published']);
  run('UPDATE sections SET visible=?, status=?, updated_at=? WHERE id=?', visible, status, now(), s.id);
  bustHome(); audit(ctx, 'section.toggle', 'section', s.id, { visible, status });
  return { section: sectionIn(get('SELECT * FROM sections WHERE id=?', s.id)) };
});
DEL('/api/admin/sections/:id', sec, (ctx) => { const s = get('SELECT name FROM sections WHERE id=?', Number(ctx.params.id)); if (!s) throw notFound(); run('DELETE FROM sections WHERE id=?', Number(ctx.params.id)); bustHome(); audit(ctx, 'section.delete', 'section', ctx.params.id, { name: s.name }); return { ok: true }; });
POST('/api/admin/sections/reorder', sec, (ctx) => { reorder('sections', ctx.body.ids || []); bustHome(); audit(ctx, 'section.reorder', 'section', null); return { ok: true }; });

// ===================== website settings (owner) =====================
GET('/api/admin/settings/store', requireOwner, () => ({ store: getSetting('store') }));
PUT('/api/admin/settings/store', requireOwner, (ctx) => {
  const b = ctx.body, cur = getSetting('store');
  const rs = (x, n) => { const k = Number(x); if (!Number.isFinite(k) || k < 0 || k > 1_000_000) throw bad(`${n} must be a valid amount.`, { [n]: 'Invalid amount' }); return Math.round(k * 100); };
  const s = { ...cur, name: v.str(b.name, 'name', { max: 60 }), tagline: v.str(b.tagline, 'tagline', { max: 100, required: false }) || '', support_email: v.email(b.support_email, 'support_email'), cod_enabled: !!v.bool(b.cod_enabled), shipping_flat: rs(b.shipping_flat, 'shipping_flat'), free_shipping_above: rs(b.free_shipping_above, 'free_shipping_above') };
  setSetting('store', s); audit(ctx, 'settings.store', 'settings', 'store', { cod: s.cod_enabled });
  return { store: s };
});
const cnt = requirePerm('content');
GET('/api/admin/settings/footer', cnt, () => ({ footer: getSetting('footer') }));
PUT('/api/admin/settings/footer', cnt, (ctx) => {
  const b = ctx.body, soc = b.socials || {};
  const https = (x, n) => { if (!x) return ''; if (!/^https:\/\/[^\s"'<>]+$/.test(String(x))) throw bad(`${n} must be a full https:// link.`, { [n]: 'Invalid link' }); return String(x); };
  const f = { about: v.str(b.about, 'about', { max: 1000, required: false }) || '', address: v.str(b.address, 'address', { max: 300, required: false }) || '', phone: v.str(b.phone, 'phone', { max: 20, required: false }) || '', email: b.email ? v.email(b.email) : '', hours: v.str(b.hours, 'hours', { max: 100, required: false }) || '',
    socials: { instagram: https(soc.instagram, 'instagram'), facebook: https(soc.facebook, 'facebook'), x: https(soc.x, 'x'), youtube: https(soc.youtube, 'youtube') } };
  setSetting('footer', f); audit(ctx, 'settings.footer', 'settings', 'footer');
  return { footer: f };
});
GET('/api/admin/pages', cnt, () => ({ pages: all('SELECT slug,title,body,visible,position,updated_at updatedAt FROM pages ORDER BY position') }));
PUT('/api/admin/pages/:slug', cnt, (ctx) => {
  const slug = String(ctx.params.slug);
  if (!/^[a-z0-9-]{2,50}$/.test(slug)) throw bad('Page address may only contain lowercase letters, numbers and dashes.');
  const title = v.str(ctx.body.title, 'title', { max: 100 }), body = v.str(ctx.body.body, 'body', { max: 20000, required: false, trim: false }) || '';
  run('INSERT INTO pages(slug,title,body,visible,position,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title, body=excluded.body, visible=excluded.visible, updated_at=excluded.updated_at', slug, title, body, ctx.body.visible === undefined ? 1 : v.bool(ctx.body.visible), nextPos('pages') + 10, now());
  bustHome(); audit(ctx, 'page.save', 'page', slug);
  return { ok: true };
});
DEL('/api/admin/pages/:slug', cnt, (ctx) => { run('DELETE FROM pages WHERE slug=?', ctx.params.slug); bustHome(); audit(ctx, 'page.delete', 'page', ctx.params.slug); return { ok: true }; });

// ===================== coupons (architecture ready; ship disabled) =====================
const cou = requirePerm('coupons');
const couOut = (c) => ({ id: c.id, code: c.code, type: c.type, value: c.value, minSubtotal: c.min_subtotal, maxUses: c.max_uses, usedCount: c.used_count, startsAt: c.starts_at, endsAt: c.ends_at, active: !!c.active });
function couponIn(b) {
  const type = v.oneOf(b.type, 'type', ['percent', 'flat']);
  const value = type === 'percent' ? v.int(b.value, 'value', { min: 1, max: 90 }) : Math.round(Number(b.value) * 100);
  if (!Number.isInteger(value) || value <= 0) throw bad('Enter a valid value.', { value: 'Invalid' });
  const date = (x) => (x ? (Number.isNaN(Date.parse(x)) ? (() => { throw bad('Invalid date.'); })() : new Date(x).toISOString()) : null);
  return { code: v.str(b.code, 'code', { min: 3, max: 24 }).toUpperCase().replace(/[^A-Z0-9_-]/g, ''), type, value, min: Math.round(Number(b.minSubtotal || 0) * 100), max: b.maxUses ? v.int(b.maxUses, 'maxUses', { min: 1 }) : null, startsAt: date(b.startsAt), endsAt: date(b.endsAt), active: v.bool(b.active) };
}
GET('/api/admin/coupons', cou, () => ({ coupons: all('SELECT * FROM coupons ORDER BY id DESC').map(couOut) }));
POST('/api/admin/coupons', cou, (ctx) => { const d = couponIn(ctx.body); const id = Number(run('INSERT INTO coupons(code,type,value,min_subtotal,max_uses,starts_at,ends_at,active,created_at) VALUES (?,?,?,?,?,?,?,?,?)', d.code, d.type, d.value, d.min, d.max, d.startsAt, d.endsAt, d.active, now()).lastInsertRowid); audit(ctx, 'coupon.create', 'coupon', id); return { coupon: couOut(get('SELECT * FROM coupons WHERE id=?', id)) }; });
PUT('/api/admin/coupons/:id', cou, (ctx) => { const c = get('SELECT * FROM coupons WHERE id=?', Number(ctx.params.id)); if (!c) throw notFound(); const d = couponIn(ctx.body); run('UPDATE coupons SET code=?,type=?,value=?,min_subtotal=?,max_uses=?,starts_at=?,ends_at=?,active=? WHERE id=?', d.code, d.type, d.value, d.min, d.max, d.startsAt, d.endsAt, d.active, c.id); audit(ctx, 'coupon.update', 'coupon', c.id); return { coupon: couOut(get('SELECT * FROM coupons WHERE id=?', c.id)) }; });
DEL('/api/admin/coupons/:id', cou, (ctx) => { run('DELETE FROM coupons WHERE id=?', Number(ctx.params.id)); audit(ctx, 'coupon.delete', 'coupon', ctx.params.id); return { ok: true }; });
