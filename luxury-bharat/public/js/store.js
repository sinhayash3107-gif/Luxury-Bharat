import { html, raw, api, auth, loadMe, inr, icons, toast, errMsg, debounce, $, $$, esc } from './lib.js';
import { S, actions, setNavigate, headerRefresh, refreshCart, loadWishlist, mergeGuestData, productCard, priceHtml, addToCart, toggleWish, renderCartDrawer, ls, closeCart } from './app.js';
import { renderSection, renderHero, bindSections } from './sections.js';
import { accountRoutes } from './account.js';

const app = $('#app');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- router ----------
const routes = [];
const route = (re, fn) => routes.push([re, fn]);
let cleanup = null, navToken = 0;
export async function navigate(path, { replace = false, scroll = true } = {}) {
  if (path !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState']({}, '', path);
  await render(scroll);
}
setNavigate(navigate);
window.addEventListener('popstate', () => render(false));
async function render(scroll = true) {
  const token = ++navToken, url = new URL(location.href);
  if (cleanup) { cleanup(); cleanup = null; }
  closeCart(); $('#mnav')?.classList.remove('open'); $('#search-ov')?.classList.remove('open');
  for (const [re, fn] of routes) {
    const m = re.exec(url.pathname);
    if (!m) continue;
    app.innerHTML = '<div class="loading-page"><div class="spin" role="status" aria-label="Loading"></div></div>';
    try { const out = await fn({ params: m.slice(1), query: url.searchParams, url }); if (token !== navToken) return; if (typeof out === 'function') cleanup = out; }
    catch (e) { if (token !== navToken) return; errorPage(e); }
    if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
    app.focus?.();
    return;
  }
  errorPage({ status: 404, message: 'We could not find that page.' });
}
export function setPage(tpl, title) { app.innerHTML = tpl.toString(); if (title) document.title = `${title} | ${S.home?.store.name || 'Luxury Bharat'}`; }
function errorPage(e) { setPage(html`<div class="err-page wrap"><h1>${e.status || 'Oops'}</h1><p style="font-size:20px">${e.status === 404 ? 'We could not find that page.' : errMsg(e)}</p><a class="btn" href="/">Back to the store</a></div>`, 'Not found'); }

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act && actions[act.dataset.act]) { if (act.tagName === 'A' && !act.getAttribute('href')) e.preventDefault(); actions[act.dataset.act](act, e); if (act.tagName !== 'A') return; }
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button || a.target || a.hasAttribute('download')) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || u.pathname.startsWith('/admin') || u.pathname.startsWith('/api/')) return;
  e.preventDefault(); navigate(u.pathname + u.search);
});

// ---------- header / footer / search ----------
function renderHeader() {
  const cats = (S.home?.categories || []).filter((c) => !c.parentId);
  const cnt = S.cart.itemCount, wn = S.wish.size, name = S.home?.store.name || 'Luxury Bharat';
  const [w1, ...rest] = name.split(' ');
  $('#hdr').innerHTML = html`<button class="icon-btn menu-btn" data-act="menu" aria-label="Menu" aria-expanded="false">${raw(icons.menu)}</button>
    <a class="logo" href="/" aria-label="${name} home">${w1} <b>${rest.join(' ')}</b></a>
    <nav class="nav" aria-label="Main">${cats.slice(0, 6).map((c) => html`<a href="/category/${c.slug}" class="${location.pathname === `/category/${c.slug}` ? 'on' : ''}">${c.name}</a>`)}</nav>
    <div class="hdr-tools"><button class="icon-btn" data-act="search-open" aria-label="Search">${raw(icons.search)}</button>
      <a class="icon-btn" href="/account/wishlist" aria-label="Wishlist (${wn})">${raw(icons.heart)}${wn ? html`<span class="badge-n">${wn}</span>` : ''}</a>
      <a class="icon-btn" href="${auth.user ? '/account' : '/login'}" aria-label="${auth.user ? 'Your account' : 'Sign in'}">${raw(icons.user)}</a>
      <button class="icon-btn" data-act="cart-open" aria-label="Open bag (${cnt} items)">${raw(icons.bag)}${cnt ? html`<span class="badge-n">${cnt}</span>` : ''}</button></div>`.toString();
  let m = $('#mnav'); if (!m) { m = document.createElement('nav'); m.id = 'mnav'; m.className = 'mobile-nav'; m.setAttribute('aria-label', 'Mobile'); document.body.append(m); }
  m.innerHTML = html`<a href="/shop">All products</a>${cats.map((c) => html`<a href="/category/${c.slug}">${c.name}</a>`)}<a href="${auth.user ? '/account' : '/login'}">${auth.user ? 'Your account' : 'Sign in'}</a>`.toString();
}
headerRefresh.fn = renderHeader;
function renderFooter() {
  const f = S.home?.footer || {}, pages = S.home?.pages || [], cats = (S.home?.categories || []).filter((c) => !c.parentId), soc = f.socials || {};
  $('#ftr').innerHTML = html`<div class="wrap"><div class="ftr-g"><div><div class="logo" style="margin-bottom:14px">${S.home?.store.name}</div><p>${f.about}</p></div>
    <div><h4>Shop</h4>${cats.map((c) => html`<a href="/category/${c.slug}">${c.name}</a>`)}</div>
    <div><h4>Help</h4>${pages.map((p) => html`<a href="/page/${p.slug}">${p.title}</a>`)}<a href="${auth.user ? '/account/tickets/new' : '/login'}">Contact support</a></div>
    <div><h4>Visit &amp; contact</h4>${f.address ? html`<p>${f.address}</p>` : ''}${f.phone ? html`<p><a href="tel:${f.phone}">${f.phone}</a></p>` : ''}${f.email ? html`<p><a href="mailto:${f.email}">${f.email}</a></p>` : ''}${f.hours ? html`<p>${f.hours}</p>` : ''}
      ${Object.entries(soc).filter(([, u]) => u).map(([k, u]) => html`<a href="${u}" target="_blank" rel="noopener noreferrer">${k[0].toUpperCase() + k.slice(1)}</a>`)}</div></div>
    <div class="copy"><span>© ${new Date().getFullYear()} ${S.home?.store.name}. All rights reserved.</span><span>Made in Bharat</span></div></div>`.toString();
}
const AMB = [[4, 12, 300, 26, -12], [70, 8, 260, 31, 10], [38, 52, 220, 29, 6], [82, 56, 320, 34, -8], [8, 70, 250, 28, 14], [58, 82, 230, 33, -16], [24, 28, 180, 37, 8], [90, 30, 200, 30, -4]];
function renderAmbient() {
  const st = S.home?.store, host = $('#ambient');
  if (!st?.ambientEnabled || !st.ambientImages.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="ambient-layer">${AMB.map(([x, y, s, d, r], i) => `<div class="amb" style="--x:${x}%;--y:${y}%;--s:${s}px;--d:${d}s;--r:${r}deg;--delay:-${i * 3}s"><img src="${esc(st.ambientImages[i % st.ambientImages.length])}" alt="" loading="lazy"></div>`).join('')}</div>`;
}
if (!reduced) { let tick = false; addEventListener('scroll', () => { if (tick) return; tick = true; requestAnimationFrame(() => { document.documentElement.style.setProperty('--scroll', scrollY); tick = false; }); }, { passive: true }); }

function searchOverlay() {
  let ov = $('#search-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'search-ov'; ov.className = 'search-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Search'); document.body.append(ov);
    ov.innerHTML = `<button class="icon-btn" style="position:absolute;top:18px;right:18px" data-act="search-close" aria-label="Close search">${icons.close}</button><form class="search-box" role="search" id="search-form"><label class="sr" for="q">Search products</label><input id="q" name="q" autocomplete="off" placeholder="Search jackets, sneakers, saffron…"><div id="sugg"></div></form>`;
    const sugg = debounce(async (q) => {
      const box = $('#sugg'); if (q.trim().length < 2) { box.innerHTML = ''; return; }
      try {
        const d = await api(`/api/search/suggest?q=${encodeURIComponent(q)}`);
        box.innerHTML = html`<div class="sugg">${d.products.map((p) => html`<a href="/product/${p.slug}" data-act="search-close"><img src="${p.image}" alt=""><span>${p.name}<small>${inr(p.price)}</small></span></a>`)}</div>
          ${d.categories.length || d.terms.length ? html`<div class="chips">${d.categories.map((c) => html`<a class="chip" href="/category/${c.slug}" data-act="search-close">${c.name}</a>`)}${d.terms.map((t) => html`<a class="chip" href="/search?q=${encodeURIComponent(t)}" data-act="search-close">${t}</a>`)}</div>` : ''}
          ${!d.products.length ? html`<p class="muted" style="margin-top:20px">No matches yet — try a different word.</p>` : html`<p style="margin-top:18px"><a class="link" href="/search?q=${encodeURIComponent(q)}" data-act="search-close">See all results for “${q}”</a></p>`}`.toString();
      } catch { /* ignore */ }
    }, 220);
    $('#q', ov).addEventListener('input', (e) => sugg(e.target.value));
    $('#search-form', ov).addEventListener('submit', (e) => { e.preventDefault(); const q = $('#q', ov).value.trim(); if (q) { ov.classList.remove('open'); navigate(`/search?q=${encodeURIComponent(q)}`); } });
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.classList.remove('open'); });
  }
  ov.classList.add('open'); setTimeout(() => $('#q', ov).focus(), 30);
}
Object.assign(actions, {
  'search-open': searchOverlay, 'search-close': () => $('#search-ov')?.classList.remove('open'),
  menu: (el) => { const o = $('#mnav').classList.toggle('open'); el.setAttribute('aria-expanded', String(o)); },
});

// ---------- home ----------
async function loadHome() { S.home = await api('/api/home'); renderHeader(); renderFooter(); renderAmbient(); }
route(/^\/$/, async () => {
  document.title = `${S.home.store.name} — ${S.home.store.tagline}`;
  const secs = S.home.sections; let light = 0;
  app.innerHTML = html`${renderHero(S.home.banners, S.home.store)}${secs.length ? secs.map((s) => {
    const prodType = ['product_grid', 'product_carousel', 'featured_collection', 'custom_content'].includes(s.type);
    return renderSection(s, { light: prodType && (light++ % 2 === 0 || true) });
  }) : html`<div class="wrap empty"><h3>The collection is being curated</h3><p class="muted">Check back soon.</p></div>`}`.toString();
  return bindSections(app);
});

// admin section preview (loaded in an iframe by the dashboard; same renderer as the live site)
route(/^\/preview$/, async () => {
  const draw = (s) => { app.innerHTML = renderSection(s).toString(); app._unbind?.(); app._unbind = bindSections(app); };
  const id = new URL(location.href).searchParams.get('section');
  if (id) { try { draw((await api(`/api/admin/sections/${encodeURIComponent(id)}/preview`)).section); } catch (e) { app.innerHTML = `<p style="padding:40px">${esc(errMsg(e))}</p>`; } }
  else app.innerHTML = '<p style="padding:40px;color:#999">Waiting for preview…</p>';
  const onMsg = (e) => { if (e.origin === location.origin && e.data?.type === 'render-section') draw(e.data.section); };
  addEventListener('message', onMsg); return () => removeEventListener('message', onMsg);
});

// ---------- listing / search ----------
const SORTS = [['recommended', 'Recommended'], ['newest', 'Newest'], ['popular', 'Popularity'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']];
async function listing({ query, category }) {
  const q = query.get('q') || '', params = new URLSearchParams(query); if (category) params.set('category', category.slug);
  const [d, cd] = await Promise.all([api(`/api/products?${params}`), category ? api(`/api/categories`) : null]);
  const title = category ? category.name : q ? `Results for “${q}”` : 'All products';
  const crumbs = [['Home', '/'], ...(category ? [['Shop', '/shop'], [category.name]] : [['Shop', q ? '/shop' : undefined], ...(q ? [['Search']] : [])])];
  const set = (k, v) => { const p = new URLSearchParams(location.search); if (v === '' || v == null || v === false) p.delete(k); else p.set(k, v); p.delete('page'); navigate(`${location.pathname}?${p}`, { replace: true, scroll: false }); };
  const exact = d.items.filter((i) => i.match === 'exact'), related = d.items.filter((i) => i.match !== 'exact');
  const qv = (k) => query.get(k) || '';
  document.title = `${title} | ${S.home.store.name}`;
  app.innerHTML = html`<div class="page-light light"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb">${crumbs.map(([t, h], i) => html`${i ? html`<span>/</span>` : ''}${h ? html`<a href="${h}">${t}</a>` : html`<span aria-current="page">${t}</span>`}`)}</nav>
    <div class="list-head"><div><h1>${title}</h1><p class="muted" style="margin:6px 0 0">${category?.description || `${d.total} ${d.total === 1 ? 'product' : 'products'}`}</p></div>
      <div style="display:flex;gap:10px;align-items:center"><button class="btn dark filter-toggle" data-act="filters">Filters</button><label class="sr" for="sort">Sort by</label><select class="in" id="sort" style="width:auto;min-width:200px">${SORTS.map(([v, l]) => html`<option value="${v}" ${qv('sort') === v || (!qv('sort') && v === 'recommended') ? 'selected' : ''}>${l}</option>`)}</select></div></div>
    <div class="list-layout"><aside class="filters" id="filters" aria-label="Filters">
      ${d.facets.categories.length > 1 && !category ? html`<h4>Category</h4>${d.facets.categories.map((c) => html`<label class="chk"><input type="radio" name="cat" value="${c.slug}" ${qv('category') === c.slug ? 'checked' : ''}> ${c.name} <span class="muted">(${c.count})</span></label>`)}${qv('category') ? html`<button class="link" data-act="clear-cat">Clear category</button>` : ''}` : ''}
      <h4>Price (₹)</h4><div style="display:flex;gap:8px"><input class="in" id="pmin" type="number" min="0" placeholder="Min" value="${qv('min')}" aria-label="Minimum price"><input class="in" id="pmax" type="number" min="0" placeholder="Max" value="${qv('max')}" aria-label="Maximum price"></div>
      <h4>Show</h4><label class="chk"><input type="checkbox" data-f="inStock" ${qv('inStock') ? 'checked' : ''}> In stock only</label><label class="chk"><input type="checkbox" data-f="discount" ${qv('discount') ? 'checked' : ''}> On discount</label><label class="chk"><input type="checkbox" data-f="new" ${qv('new') ? 'checked' : ''}> New arrivals</label><label class="chk"><input type="checkbox" data-f="trending" ${qv('trending') ? 'checked' : ''}> Trending</label>
      ${d.facets.colors.length ? html`<h4>Colour</h4>${d.facets.colors.map((c) => html`<label class="chk"><input type="radio" name="color" value="${c}" ${qv('color').toLowerCase() === c.toLowerCase() ? 'checked' : ''}> ${c}</label>`)}${qv('color') ? html`<button class="link" data-act="clear-color">Clear colour</button>` : ''}` : ''}
      <p style="margin-top:20px"><a class="link" href="${category ? `/category/${category.slug}` : '/shop'}">Reset all filters</a></p></aside>
    <div>${!d.items.length ? html`<div class="empty"><h3>Nothing matches that</h3><p class="muted">${q ? 'Try a broader word, or browse a category.' : 'Try removing a filter.'}</p><a class="btn dark" href="/shop">Browse everything</a></div>` : html`
      ${q && exact.length ? html`<div class="result-note">Best matches</div>` : ''}<div class="prod-grid">${exact.map(productCard)}</div>
      ${related.length ? html`<div class="result-note" style="margin-top:44px">${q ? 'Related to your search' : 'More to explore'}</div><div class="prod-grid">${related.map(productCard)}</div>` : ''}
      ${d.total > d.page * d.pageSize ? html`<div class="cta-row"><button class="btn dark" data-act="more">Show more</button></div>` : ''}`}
      ${q && d.recommended.length ? html`<div class="result-note" style="margin-top:56px">Recommended for you</div><div class="prod-grid">${d.recommended.map(productCard)}</div>` : ''}</div></div></div></div>`.toString();
  $('#sort').addEventListener('change', (e) => set('sort', e.target.value === 'recommended' ? '' : e.target.value));
  $$('[data-f]').forEach((c) => c.addEventListener('change', () => set(c.dataset.f, c.checked ? (c.dataset.f === 'discount' ? '1' : '1') : '')));
  $$('input[name=cat]').forEach((r) => r.addEventListener('change', () => set('category', r.value)));
  $$('input[name=color]').forEach((r) => r.addEventListener('change', () => set('color', r.value)));
  const price = debounce(() => { const p = new URLSearchParams(location.search); const a = $('#pmin').value, b = $('#pmax').value; a ? p.set('min', a) : p.delete('min'); b ? p.set('max', b) : p.delete('max'); navigate(`${location.pathname}?${p}`, { replace: true, scroll: false }); }, 600);
  $('#pmin').addEventListener('input', price); $('#pmax').addEventListener('input', price);
  actions.filters = () => $('#filters').classList.toggle('open');
  actions['clear-cat'] = () => set('category', ''); actions['clear-color'] = () => set('color', '');
  actions.more = () => { const p = new URLSearchParams(location.search); p.set('pageSize', String(Math.min(d.pageSize + 24, 60))); navigate(`${location.pathname}?${p}`, { replace: true, scroll: false }); };
}
route(/^\/shop\/?$/, ({ query }) => listing({ query }));
route(/^\/search\/?$/, ({ query }) => listing({ query }));
route(/^\/category\/([\w-]+)\/?$/, async ({ params, query }) => {
  const cat = (S.home.categories || []).find((c) => c.slug === params[0]);
  if (!cat) throw { status: 404 };
  return listing({ query, category: cat });
});

// ---------- product page ----------
route(/^\/product\/([\w-]+)\/?$/, async ({ params }) => {
  const d = await api(`/api/products/${params[0]}`), p = d.product;
  S.pmap.set(p.id, p); document.title = `${p.seoTitle || p.name} | ${S.home.store.name}`;
  const rv = await recentlyViewed(p);
  const on = S.wish.has(p.id); let qty = 1;
  app.innerHTML = html`<div class="page-light light"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><a href="/shop">Shop</a>${d.breadcrumbs.map((c) => html`<span>/</span><a href="/category/${c.slug}">${c.name}</a>`)}<span>/</span><span aria-current="page">${p.name}</span></nav>
    <div class="pdp"><div class="gallery"><div class="thumbs">${p.images.map((im, i) => html`<button class="${i ? '' : 'on'}" data-thumb="${im.url}" aria-label="View image ${i + 1}"><img src="${im.url}" alt=""></button>`)}</div><div class="main"><img id="pdp-img" src="${p.image}" alt="${p.images[0]?.alt || p.name}"></div></div>
    <div class="pdp-info"><div style="display:flex;gap:6px;margin-bottom:12px">${p.isNew ? html`<span class="bdg gold">New</span>` : ''}${p.trending ? html`<span class="bdg">Trending</span>` : ''}</div>
      <h1>${p.name}</h1>${priceHtml(p)}<p class="muted" style="margin:0">Inclusive of all taxes · ${p.finalPrice >= S.home.store.freeShippingAbove ? 'Free shipping' : `Free shipping above ${inr(S.home.store.freeShippingAbove)}`}</p>
      <p class="desc">${p.description}</p>
      ${p.inStock ? html`${p.lowStock ? html`<p class="stock-low">Only ${p.stock} left in stock</p>` : html`<p style="color:#1b6b3a;font-weight:600">In stock</p>`}
        <div class="buy-row"><div class="qty"><button id="qm" aria-label="Decrease quantity">−</button><span id="qv" aria-live="polite">1</span><button id="qp" aria-label="Increase quantity">+</button></div><button class="btn dark solid" id="addbtn">Add to bag</button>
        <button class="btn dark wish ${on ? 'on' : ''}" data-act="wish" data-id="${p.id}" aria-pressed="${on}" style="flex:0 0 auto">${raw(icons.heart)} Wishlist</button></div>` : html`<div class="note warn" style="margin:20px 0">This piece is sold out right now.</div><button class="btn dark wish ${on ? 'on' : ''}" data-act="wish" data-id="${p.id}" aria-pressed="${on}">${raw(icons.heart)} Save to wishlist</button>`}
      <dl class="kv"><dt>SKU</dt><dd>${p.sku}</dd>${p.category ? html`<dt>Category</dt><dd><a class="link" href="/category/${p.category.slug}">${p.category.name}</a></dd>` : ''}${p.attrs.color ? html`<dt>Colour</dt><dd>${p.attrs.color}</dd>` : ''}${p.attrs.size?.length ? html`<dt>Sizes</dt><dd>${p.attrs.size.join(', ')}</dd>` : ''}${p.attrs.material ? html`<dt>Material</dt><dd>${p.attrs.material}</dd>` : ''}${p.tags.length ? html`<dt>Tags</dt><dd>${p.tags.join(', ')}</dd>` : ''}</dl></div></div>
    ${d.related.length ? html`<h2 style="font-size:40px;margin:30px 0 24px">You may also like</h2><div class="prod-rail" data-rail>${d.related.map(productCard)}</div>` : ''}
    ${rv.length ? html`<h2 style="font-size:40px;margin:56px 0 24px">Recently viewed</h2><div class="prod-rail" data-rail>${rv.map(productCard)}</div>` : ''}<div style="height:80px"></div></div></div>`.toString();
  $$('[data-thumb]').forEach((b) => b.addEventListener('click', () => { $('#pdp-img').src = b.dataset.thumb; $$('[data-thumb]').forEach((x) => x.classList.toggle('on', x === b)); }));
  const max = Math.min(p.stock, 10);
  $('#qm')?.addEventListener('click', () => { qty = Math.max(1, qty - 1); $('#qv').textContent = qty; });
  $('#qp')?.addEventListener('click', () => { qty = Math.min(max, qty + 1); $('#qv').textContent = qty; });
  $('#addbtn')?.addEventListener('click', () => addToCart(p.id, qty));
  return bindSections(app);
});
async function recentlyViewed(current) {
  try {
    let items = [];
    if (auth.user) { items = (await api('/api/recently-viewed')).items; api('/api/recently-viewed', { method: 'POST', body: { id: current.id } }).catch(() => {}); }
    else { const ids = ls.get('lb_rv', []); if (ids.length) items = (await api(`/api/products/by-ids?ids=${ids.join(',')}`)).items; ls.set('lb_rv', [current.id, ...ids.filter((x) => x !== current.id)].slice(0, 12)); }
    return items.filter((i) => i.id !== current.id).slice(0, 8);
  } catch { return []; }
}

// ---------- CMS pages ----------
route(/^\/page\/([\w-]+)\/?$/, async ({ params }) => {
  const { page } = await api(`/api/pages/${params[0]}`); document.title = `${page.title} | ${S.home.store.name}`;
  app.innerHTML = html`<div class="page-light light"><div class="wrap"><div class="custom" style="padding:64px 0 100px"><h1 style="font-size:clamp(38px,5vw,64px);margin-bottom:28px">${page.title}</h1>${page.body.split(/\n{2,}/).map((t) => html`<p style="font-size:18px;line-height:1.8">${t}</p>`)}</div></div></div>`.toString();
});

accountRoutes({ route, setPage, navigate });

// ---------- boot ----------
(async function boot() {
  try {
    await Promise.all([loadMe(), loadHome()]);
    if (auth.user) await mergeGuestData(); else await refreshCart();
    await loadWishlist(); renderCartDrawer(); renderHeader();
    await render(false);
  } catch (e) { app.innerHTML = `<div class="err-page"><h1>Hold on</h1><p>${esc(errMsg(e))}</p><button class="btn" onclick="location.reload()">Reload</button></div>`; }
})();
export { renderHeader, loadHome, renderAmbient };
