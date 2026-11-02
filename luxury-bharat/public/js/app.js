import { html, raw, api, auth, inr, icons, toast, errMsg, $, $$ } from './lib.js';

export const S = { home: null, cart: { items: [], itemCount: 0, subtotal: 0, total: 0, shipping: 0, couponDiscount: 0, productSavings: 0 }, wish: new Set(), pmap: new Map(), routeCleanup: null };
export const actions = {};
const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
export { ls };

let navigateFn = null;
export const setNavigate = (fn) => { navigateFn = fn; };
export const go = (path, opts) => navigateFn(path, opts);
export const headerRefresh = { fn: () => {} };

// ---------- cart (server-priced; guests keep only ids+qty locally) ----------
export async function refreshCart() {
  try {
    S.cart = auth.user ? await api('/api/cart') : await api('/api/cart/price', { method: 'POST', body: { items: ls.get('lb_cart', []) } });
  } catch { /* keep previous cart */ }
  headerRefresh.fn(); renderCartDrawer();
}
export async function addToCart(id, qty = 1, { open = true } = {}) {
  try {
    const cur = S.cart.items.find((i) => i.product.id === id)?.qty || 0;
    if (auth.user) S.cart = await api('/api/cart/items', { method: 'PUT', body: { productId: id, qty: Math.min(cur + qty, 10) } });
    else { const l = ls.get('lb_cart', []); const e = l.find((x) => x.id === id); if (e) e.qty = Math.min(e.qty + qty, 10); else l.push({ id, qty }); ls.set('lb_cart', l); await refreshCart(); }
    headerRefresh.fn(); renderCartDrawer(); if (open) openCart(); else toast('Added to your bag');
  } catch (e) { toast(errMsg(e), 'err'); }
}
export async function setQty(id, qty) {
  try {
    if (auth.user) S.cart = await api('/api/cart/items', { method: 'PUT', body: { productId: id, qty } });
    else { let l = ls.get('lb_cart', []); l = qty <= 0 ? l.filter((x) => x.id !== id) : l.map((x) => (x.id === id ? { ...x, qty } : x)); ls.set('lb_cart', l); await refreshCart(); }
    headerRefresh.fn(); renderCartDrawer();
  } catch (e) { toast(errMsg(e), 'err'); }
}
export async function mergeGuestData() {
  const cart = ls.get('lb_cart', []), wish = ls.get('lb_wish', []);
  try {
    if (cart.length) { await api('/api/cart/merge', { method: 'POST', body: { items: cart } }); ls.set('lb_cart', []); }
    if (wish.length) { await api('/api/wishlist/merge', { method: 'POST', body: { ids: wish } }); ls.set('lb_wish', []); }
    const w = await api('/api/wishlist'); S.wish = new Set(w.items.map((p) => p.id));
  } catch { /* non-fatal */ }
  await refreshCart();
}
export async function loadWishlist() { if (auth.user) { try { S.wish = new Set((await api('/api/wishlist')).items.map((p) => p.id)); } catch { /* ignore */ } } else S.wish = new Set(ls.get('lb_wish', [])); headerRefresh.fn(); }
export async function toggleWish(id) {
  const on = S.wish.has(id);
  try {
    if (auth.user) await api(`/api/wishlist/${id}`, { method: on ? 'DELETE' : 'PUT' });
    else { const l = new Set(ls.get('lb_wish', [])); on ? l.delete(id) : l.add(id); ls.set('lb_wish', [...l]); }
    on ? S.wish.delete(id) : S.wish.add(id);
    $$(`[data-act="wish"][data-id="${id}"]`).forEach((b) => { b.classList.toggle('on', !on); b.setAttribute('aria-pressed', String(!on)); });
    headerRefresh.fn(); toast(on ? 'Removed from wishlist' : 'Saved to wishlist');
  } catch (e) { toast(errMsg(e), 'err'); }
}

// ---------- shared view pieces ----------
export const priceHtml = (p) => p.discountPrice ? html`<div class="price"><b>${inr(p.discountPrice)}</b><s>${inr(p.price)}</s><em>${p.discountPct}% off</em></div>` : html`<div class="price"><b>${inr(p.price)}</b></div>`;
export function productCard(p) {
  S.pmap.set(p.id, p);
  const on = S.wish.has(p.id);
  return html`<article class="pc">
    <a class="ph" href="/product/${p.slug}" aria-label="${p.name}">
      ${p.image ? html`<img src="${p.image}" alt="${p.name}" loading="lazy" width="400" height="500">` : html`<span class="noimg">No image</span>`}
      ${p.hoverImage ? html`<img class="h" src="${p.hoverImage}" alt="" loading="lazy" aria-hidden="true">` : ''}
    </a>
    <div class="badges">${p.isNew ? html`<span class="bdg gold">New</span>` : ''}${p.trending ? html`<span class="bdg">Trending</span>` : ''}${p.discountPct ? html`<span class="bdg off">${p.discountPct}% off</span>` : ''}</div>
    <button class="icon-btn wish ${on ? 'on' : ''}" data-act="wish" data-id="${p.id}" aria-label="Save ${p.name} to wishlist" aria-pressed="${on}">${raw(icons.heart)}</button>
    <button class="qv" data-act="qv" data-id="${p.id}">Quick view</button>
    <div class="info"><a class="nm" href="/product/${p.slug}">${p.name}</a>${p.category ? html`<span class="cat">${p.category.name}</span>` : ''}${priceHtml(p)}
      ${p.inStock ? html`<button class="btn dark add" data-act="add" data-id="${p.id}">Add to bag</button>` : html`<div class="sold">Sold out</div>`}</div>
  </article>`;
}

// ---------- cart drawer ----------
export function openCart() { $('#cart-drawer')?.classList.add('open'); $('#cart-scrim')?.classList.add('open'); $('#cart-drawer .drawer-h button')?.focus(); }
export function closeCart() { $('#cart-drawer')?.classList.remove('open'); $('#cart-scrim')?.classList.remove('open'); }
export function renderCartDrawer() {
  const host = $('#overlays'); if (!host) return;
  let box = $('#cart-root'); if (!box) { box = document.createElement('div'); box.id = 'cart-root'; host.append(box); }
  const c = S.cart, open = $('#cart-drawer')?.classList.contains('open');
  box.innerHTML = html`<div class="scrim ${open ? 'open' : ''}" id="cart-scrim" data-act="cart-close"></div>
  <aside class="drawer ${open ? 'open' : ''}" id="cart-drawer" role="dialog" aria-modal="true" aria-label="Shopping bag">
    <div class="drawer-h"><h3>Your bag${c.itemCount ? html` <small class="muted">(${c.itemCount})</small>` : ''}</h3><button class="icon-btn" data-act="cart-close" aria-label="Close bag">${raw(icons.close)}</button></div>
    <div class="drawer-b">${!c.items.length ? html`<div class="empty"><h3>Your bag is empty</h3><p class="muted">Pieces you add will wait for you here.</p><a class="btn dark" href="/shop" data-act="cart-close">Continue shopping</a></div>` :
      c.items.map((i) => html`<div class="line"><a href="/product/${i.product.slug}" data-act="cart-close"><img src="${i.product.thumb || i.product.image}" alt=""></a>
        <div><a class="nm" href="/product/${i.product.slug}" data-act="cart-close">${i.product.name}</a><div class="muted">${inr(i.unitPrice)}</div>
          <div class="qty"><button data-act="qty" data-id="${i.product.id}" data-q="${i.qty - 1}" aria-label="Decrease quantity">−</button><span aria-live="polite">${i.qty}</span><button data-act="qty" data-id="${i.product.id}" data-q="${i.qty + 1}" aria-label="Increase quantity" ${i.qty >= i.maxQty ? 'disabled' : ''}>+</button></div>
          ${!i.available ? html`<div class="stock-low">Only ${i.maxQty} available</div>` : ''}<button class="rm" data-act="qty" data-id="${i.product.id}" data-q="0">Remove</button></div>
        <strong>${inr(i.lineTotal)}</strong></div>`)}</div>
    ${c.items.length ? html`<div class="drawer-f"><div class="sum">
      ${c.productSavings ? html`<div class="save"><span>You save</span><span>${inr(c.productSavings)}</span></div>` : ''}
      <div><span>Subtotal</span><span>${inr(c.subtotal)}</span></div><div><span>Shipping</span><span>${c.shipping ? inr(c.shipping) : 'Free'}</span></div>
      <div class="tot"><span>Total</span><span>${inr(c.total)}</span></div></div>
      <a class="btn dark solid block" style="margin-top:16px" href="/checkout" data-act="cart-close">Checkout</a>
      <button class="btn dark block" style="margin-top:8px" data-act="cart-close">Continue shopping</button></div>` : ''}
  </aside>`.toString();
}

// ---------- quick view ----------
export function quickView(id) {
  const p = S.pmap.get(id); if (!p) return;
  const m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', p.name);
  m.innerHTML = html`<div class="modal-c light"><button class="icon-btn modal-x" data-act="modal-close" aria-label="Close">${raw(icons.close)}</button>
    <div class="qv-grid"><img src="${p.image}" alt="${p.name}"><div class="in"><h2 style="font-size:38px">${p.name}</h2>${priceHtml(p)}<p>${p.description}</p>
    ${p.lowStock ? html`<p class="stock-low">Only ${p.stock} left</p>` : ''}<div class="buy-row">${p.inStock ? html`<button class="btn dark solid" data-act="add" data-id="${p.id}" data-close>Add to bag</button>` : html`<button class="btn dark" disabled>Sold out</button>`}<a class="btn dark" href="/product/${p.slug}" data-act="modal-close">Full details</a></div></div></div></div>`.toString();
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  document.body.append(m); m.querySelector('.modal-x').focus();
  const esc = (e) => { if (e.key === 'Escape') { m.remove(); document.removeEventListener('keydown', esc); } }; document.addEventListener('keydown', esc);
}

Object.assign(actions, {
  add: async (el) => { await addToCart(Number(el.dataset.id)); if (el.hasAttribute('data-close')) $('.modal')?.remove(); },
  wish: (el) => toggleWish(Number(el.dataset.id)),
  qv: (el) => quickView(Number(el.dataset.id)),
  qty: (el) => setQty(Number(el.dataset.id), Number(el.dataset.q)),
  'cart-open': () => { refreshCart(); openCart(); },
  'cart-close': () => closeCart(),
  'modal-close': () => $('.modal')?.remove(),
});
