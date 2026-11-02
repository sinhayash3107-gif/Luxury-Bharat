// `npm run seed:demo` — fills an empty store with a demo catalogue (placeholder illustrations, not photography).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { migrate, get, run, tx, now } from './lib/db.js';
import { setSetting, getSetting, DEFAULT_SETTINGS } from './lib/core.js';
import { artSvg } from './lib/art.js';

let sharp;
try { sharp = (await import('sharp')).default; } catch { console.error('The demo seed needs `sharp` to render images. Run `npm i sharp` first.'); process.exit(1); }
migrate();
if (get('SELECT 1 FROM categories LIMIT 1')) { console.log('Catalogue already has data — demo seed skipped.'); process.exit(0); }
if (!get("SELECT 1 FROM settings WHERE key='store'")) for (const k of Object.keys(DEFAULT_SETTINGS)) setSetting(k, DEFAULT_SETTINGS[k]);

async function img(kind, color, mode = 'studio', size = 900) {
  let svg = artSvg(kind, color, { studio: mode === 'studio' });
  if (mode === 'dark') svg = svg.replace('</defs>', '</defs><rect width="400" height="400" fill="#1b1b1b"/><ellipse cx="200" cy="372" rx="140" ry="9" fill="#000" opacity=".5"/>');
  const id = crypto.randomBytes(12).toString('hex');
  const png = sharp(Buffer.from(svg), { density: 144 }).resize(size, size);
  const main = await png.clone().webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
  const th = await png.clone().resize(480, 480).webp({ quality: 76 }).toBuffer();
  fs.writeFileSync(path.join(config.uploadDir, `${id}.webp`), main.data); fs.writeFileSync(path.join(config.uploadDir, `${id}_t.webp`), th);
  const url = `/uploads/${id}.webp`, thumb = `/uploads/${id}_t.webp`;
  run('INSERT INTO media(url,thumb_url,bytes,width,height,original_name,created_at) VALUES (?,?,?,?,?,?,?)', url, thumb, main.data.length, main.info.width, main.info.height, `demo-${kind}`, now());
  return { url, thumb };
}

const CATS = [
  { slug: 'footwear', name: 'Footwear', subtitle: 'Sneakers & derbies', color: '#7A2E1D', art: ['shoe', '#F1EEE6'], hover: ['derby', '#1c1c1c'], desc: 'Hand-finished sneakers and derbies built to be worn daily.' },
  { slug: 'upper-wear', name: 'Upper wear', subtitle: 'Tees & shirts', color: '#1F3A5F', art: ['shirt', '#CDBA98'], hover: ['tee', '#EDE6D6'], desc: 'Breathable cotton and linen for every season.' },
  { slug: 'lower-wear', name: 'Lower wear', subtitle: 'Jeans & trousers', color: '#2E4A3F', art: ['jeans', '#1D3557'], hover: ['trousers', '#3A3A3A'], desc: 'Denim and tailored trousers with a considered fit.' },
  { slug: 'jackets', name: 'Jackets', subtitle: 'Leather & field', color: '#3B2A20', art: ['jacket', '#111111'], hover: ['jacket', '#9A6B3F'], desc: 'Statement outerwear, from bombers to field jackets.' },
  { slug: 'pantry', name: 'Pantry', subtitle: 'Regional staples', color: '#B5651D', art: ['jar', '#D9A21B'], hover: ['tin', '#7B8F2A'], desc: 'Saffron, honey, oils and salts sourced across Bharat.' },
  { slug: 'accessories', name: 'Accessories', subtitle: 'Watches & belts', color: '#4A2C5A', art: ['watch', '#2a1a10'], hover: ['belt', '#3B2314'], desc: 'Finishing pieces in leather and gold-tone metal.' },
];
const SUBS = [['t-shirts', 'T-Shirts', 'upper-wear'], ['shirts', 'Shirts', 'upper-wear'], ['jeans', 'Jeans', 'lower-wear'], ['trousers', 'Trousers', 'lower-wear']];

// [name, category slug, art kind, hex, colour name, price ₹, discount ₹, stock, tags, flags(f=featured,t=trending,n=new), blurb]
const P = [
  ['Heritage Leather Sneaker', 'footwear', 'shoe', '#F1EEE6', 'White', 8999, 7499, 14, 'sneakers,leather,white,casual', 'fn', 'Full-grain leather upper with a cushioned insole and a gold-finished heel tab.'],
  ['Midnight Derby', 'footwear', 'derby', '#1c1c1c', 'Black', 12999, null, 8, 'formal,derby,leather,black', 'f', 'A polished black derby, Goodyear-welted and made for long days.'],
  ['Tan Suede Derby', 'footwear', 'derby', '#A8703E', 'Tan', 11999, 9999, 6, 'derby,suede,tan', 't', 'Soft Italian-style suede on a lightweight leather sole.'],
  ['Oxblood Court Sneaker', 'footwear', 'shoe', '#6B1F26', 'Oxblood', 7999, null, 20, 'sneakers,red,court', 'n', 'A clean court silhouette in deep oxblood leather.'],
  ['Supima Crew Tee — Black', 't-shirts', 'tee', '#151515', 'Black', 1799, null, 60, 'tee,cotton,black,basics', 't', 'Heavyweight Supima cotton with a relaxed, structured drape.'],
  ['Supima Crew Tee — Ivory', 't-shirts', 'tee', '#EDE6D6', 'Ivory', 1799, 1499, 40, 'tee,cotton,ivory,basics', '', 'The everyday tee in warm ivory. Pre-washed for softness.'],
  ['Indigo Henley Tee', 't-shirts', 'tee', '#24386B', 'Indigo', 2199, null, 40, 'tee,henley,indigo', 'n', 'Garment-dyed in indigo with a three-button placket.'],
  ['Saffron Pocket Tee', 't-shirts', 'tee', '#D9902B', 'Saffron', 1999, null, 30, 'tee,saffron,pocket', '', 'Sun-warmed saffron cotton with a single chest pocket.'],
  ['Linen Shirt — Sand', 'shirts', 'shirt', '#CDBA98', 'Sand', 3499, 2799, 25, 'shirt,linen,sand,summer', 'f', 'Breathable European linen with mother-of-pearl style buttons.'],
  ['Oxford Shirt — Sky', 'shirts', 'shirt', '#8FB3D9', 'Sky blue', 3299, null, 25, 'shirt,oxford,blue', '', 'A classic button-down in a durable oxford weave.'],
  ['Midnight Poplin Shirt', 'shirts', 'shirt', '#12203F', 'Navy', 3799, null, 18, 'shirt,poplin,navy,formal', 'tn', 'Crisp cotton poplin, cut slim through the body.'],
  ['Selvedge Straight Jeans', 'jeans', 'jeans', '#1D3557', 'Indigo', 5499, 4499, 30, 'jeans,denim,indigo,selvedge', 'ft', 'Rigid selvedge denim that fades to your own pattern.'],
  ['Black Tapered Jeans', 'jeans', 'jeans', '#1b1b1d', 'Black', 4999, null, 30, 'jeans,denim,black,tapered', '', 'Stretch black denim with a clean tapered leg.'],
  ['Washed Grey Jeans', 'jeans', 'jeans', '#6B7078', 'Grey', 4799, null, 22, 'jeans,denim,grey', '', 'A soft stone-washed grey in a straight fit.'],
  ['Pleated Wool Trousers', 'trousers', 'trousers', '#3A3A3A', 'Charcoal', 6499, 5499, 16, 'trousers,wool,charcoal,formal', '', 'Single-pleat trousers in a fine wool blend.'],
  ['Chino Trousers — Khaki', 'trousers', 'trousers', '#B49A6B', 'Khaki', 3999, null, 35, 'trousers,chino,khaki', 'n', 'Garment-washed cotton twill chinos.'],
  ['Cotton Trousers — Olive', 'trousers', 'trousers', '#5A6B3A', 'Olive', 3999, null, 28, 'trousers,cotton,olive', '', 'Easy olive cotton trousers with a gentle taper.'],
  ['Black Leather Jacket', 'jackets', 'jacket', '#111111', 'Black', 24999, 19999, 9, 'jacket,leather,black,biker', 'ft', 'Supple lambskin with a gold-tone front zip and ribbed cuffs.'],
  ['Tan Bomber Jacket', 'jackets', 'jacket', '#9A6B3F', 'Tan', 12999, null, 12, 'jacket,bomber,tan', '', 'A lightweight bomber in tan with a ribbed collar.'],
  ['Olive Field Jacket', 'jackets', 'jacket', '#55613B', 'Olive', 9999, 8499, 15, 'jacket,field,olive', '', 'Utility-inspired cotton canvas with a water-repellent finish.'],
  ['Navy Quilted Jacket', 'jackets', 'jacket', '#1B2A4A', 'Navy', 8999, null, 15, 'jacket,quilted,navy,winter', 'n', 'Diamond-quilted navy for cool evenings.'],
  ['Kashmiri Saffron, 2g', 'pantry', 'jar', '#B3541E', 'Crimson', 1499, null, 40, 'saffron,kashmir,spice', 'f', 'Hand-picked mongra saffron threads from Pampore.'],
  ['Wild Forest Honey, 500g', 'pantry', 'jar', '#D9A21B', 'Amber', 899, null, 55, 'honey,forest,organic', '', 'Raw, unfiltered honey gathered from forest hives.'],
  ['Cold-pressed Mustard Oil, 1L', 'pantry', 'tin', '#7B8F2A', 'Green', 649, null, 45, 'oil,mustard,cold-pressed', '', 'Kachi ghani mustard oil with a bold, pungent finish.'],
  ['Himalayan Pink Salt, 500g', 'pantry', 'jar', '#E7B7A8', 'Pink', 399, null, 80, 'salt,himalayan,pink', '', 'Mineral-rich rock salt, coarsely ground.'],
  ['Gold-tone Dress Watch', 'accessories', 'watch', '#2a1a10', 'Gold / Brown', 14999, 11999, 10, 'watch,gold,leather', 'f', 'A slim gold-tone case with a brown leather strap.'],
  ['Leather Belt — Brown', 'accessories', 'belt', '#3B2314', 'Brown', 2499, null, 35, 'belt,leather,brown', '', 'Vegetable-tanned leather with a gold-tone buckle.'],
  ['Leather Belt — Black', 'accessories', 'belt', '#101010', 'Black', 2399, null, 35, 'belt,leather,black', 't', 'A refined black belt that suits denim and tailoring.'],
];

const catId = {};
let pos = 0;
for (const c of CATS) {
  const a = await img(c.art[0], c.art[1], 'cutout'), h = await img(c.hover[0], c.hover[1], 'cutout');
  catId[c.slug] = Number(run('INSERT INTO categories(name,slug,subtitle,description,image,hover_image,mobile_image,bg_color,position,visible,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)', c.name, c.slug, c.subtitle, c.desc, a.url, h.url, a.url, c.color, pos += 10, now(), now()).lastInsertRowid);
}
for (const [slug, name, parent] of SUBS) catId[slug] = Number(run('INSERT INTO categories(name,slug,parent_id,bg_color,position,visible,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)', name, slug, catId[parent], '#3A3A3A', pos += 10, now(), now()).lastInsertRowid);

const productIds = {};
let n = 1;
for (const [name, cat, kind, hex, colour, price, disc, stock, tags, flags, blurb] of P) {
  const studio = await img(kind, hex, 'studio'), dark = await img(kind, hex, 'dark');
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
  const id = Number(run('INSERT INTO products(sku,name,slug,description,category_id,price,discount_price,stock,low_stock_threshold,status,featured,trending,is_new,tags,attrs,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    `LB-${String(1000 + n++)}`, name, slug, blurb, catId[cat], price * 100, disc ? disc * 100 : null, stock, 5, 'active', +flags.includes('f'), +flags.includes('t'), +flags.includes('n'), JSON.stringify(tags.split(',')), JSON.stringify({ color: colour }), now(), now()).lastInsertRowid);
  run('INSERT INTO product_images(product_id,url,thumb_url,alt,position) VALUES (?,?,?,?,0)', id, studio.url, studio.thumb, name);
  run('INSERT INTO product_images(product_id,url,thumb_url,alt,position) VALUES (?,?,?,?,1)', id, dark.url, dark.thumb, `${name} — editorial view`);
  run('INSERT INTO inventory_movements(product_id,delta,stock_after,reason,created_at) VALUES (?,?,?,?,?)', id, stock, stock, 'initial_stock', now());
  productIds[name] = id;
}

// --- homepage content ---
run('INSERT INTO banners(title,subtitle,button_text,button_url,badge,align,overlay,height_vh,visible,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,0,?,?)', 'LUXURY BHARAT', "India's Premium Lifestyle Store", 'EXPLORE COLLECTION', '/shop', 'Autumn–Winter 2026', 'left', 0.45, 92, now(), now());
const jacketArt = await img('jacket', '#9A6B3F', 'cutout');
const S = (name, type, o = {}) => {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = Number(run('INSERT INTO sections(name,slug,description,type,image,bg_color,cta_text,cta_url,content,source,item_limit,position,visible,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)',
    name, slug, o.description ?? null, type, o.image ?? null, o.bgColor ?? null, o.ctaText ?? null, o.ctaUrl ?? null, o.content ?? null, o.source ?? 'manual', o.limit ?? 8, (pos += 10), o.status ?? 'published', now(), now()).lastInsertRowid);
  for (const c of o.cats || []) run('INSERT INTO section_categories VALUES (?,?,0)', id, catId[c]);
  return id;
};
pos = 0;
S('Shop the catalogue', 'category_catalog', { description: 'Six ways into the collection.' });
S('Featured Products', 'product_grid', { description: 'Pieces we keep coming back to.', source: 'featured', limit: 8, ctaText: 'View all', ctaUrl: '/shop' });
S('The Autumn Edit', 'editorial_banner', { description: 'Outerwear cut for cooler evenings — leather, quilting and field cloth.', image: jacketArt.url, bgColor: '#3B2A20', ctaText: 'Shop jackets', ctaUrl: '/category/jackets' });
S('Trending Products', 'product_carousel', { description: 'What shoppers are buying right now.', source: 'trending', limit: 10 });
S('New Arrivals', 'product_carousel', { description: 'Just landed.', source: 'new', limit: 10, ctaText: 'See what’s new', ctaUrl: '/shop?new=1' });
S('Footwear', 'product_carousel', { description: 'Sneakers and derbies.', source: 'category', cats: ['footwear'], ctaText: 'All footwear', ctaUrl: '/category/footwear' });
S('Jackets', 'product_carousel', { source: 'category', cats: ['jackets'], ctaText: 'All jackets', ctaUrl: '/category/jackets' });
S('Accessories', 'product_carousel', { source: 'category', cats: ['accessories'], ctaText: 'All accessories', ctaUrl: '/category/accessories' });
S('Complimentary shipping', 'promo_banner', { description: 'Free delivery on every order above ₹2,999.', bgColor: '#D4AF37', ctaText: 'Start shopping', ctaUrl: '/shop' });
for (const [nm, cs] of [['T-Shirts', ['t-shirts']], ['Shirts', ['shirts']], ['Jeans', ['jeans']], ['Trousers', ['trousers']]]) S(nm, 'product_carousel', { source: 'category', cats: cs, status: 'draft', ctaText: `All ${nm.toLowerCase()}`, ctaUrl: `/category/${cs[0]}` });
S('Festive Collection', 'featured_collection', { description: 'Placeholder for the next campaign — add products and publish when ready.', source: 'manual', status: 'draft' });

// ambient floating products behind the hero
const amb = [];
for (const [k, c] of [['jacket', '#111111'], ['shoe', '#F1EEE6'], ['shirt', '#CDBA98'], ['jeans', '#1D3557'], ['derby', '#A8703E'], ['tee', '#24386B'], ['watch', '#2a1a10'], ['trousers', '#B49A6B']]) amb.push((await img(k, c, 'cutout', 600)).url);
setSetting('store', { ...getSetting('store'), ambient_images: amb, ambient_enabled: true });
console.log(`Demo catalogue created: ${CATS.length + SUBS.length} categories, ${P.length} products, banner, sections.`);
