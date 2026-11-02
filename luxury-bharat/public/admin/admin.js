import { html, raw, esc, api, auth, loadMe, inr, dateFmt, ago, toast, errMsg, showFieldErrors, uploadImage, $, $$ } from '/js/lib.js';
import { chip, thumb, formHtml, collect, hydrate, formModal, modal, table, chart, installWidgetHandlers, chooseFile } from './admin-ui.js';
import { builderPage } from './admin-builder.js';

const root = $('#root');
const can = (p) => !p || (Array.isArray(p) ? p.some(can) : p === 'owner' ? auth.user.role === 'owner' : auth.user.role === 'owner' || auth.user.permissions.includes(p));
const isStaff = (u) => u && (u.role === 'owner' || u.role === 'admin');
const P = (title, body, acts = '') => html`<div class="pagehead"><h1>${title}</h1><div class="acts">${acts}</div></div>${body}`;
const hashParts = () => { const [p, q] = location.hash.slice(1).split('?'); return { path: p || '/', q: new URLSearchParams(q || '') }; };
const rs = (paise) => (paise == null ? '' : paise / 100);
const money = (n) => inr(n);
let counts = { pending: 0, tickets: 0, unread: 0 };
let es = null;

const NAV = [
  ['', [['Dashboard', '/', null]]],
  ['Website Management', [['Homepage', '/homepage', 'banners'], ['Hero Banners', '/banners', 'banners'], ['Section Builder', '/sections', 'sections'], ['Category Management', '/categories', 'categories'], ['Image Management', '/media', ['products', 'sections', 'banners', 'categories']], ['Footer & Pages', '/footer', 'content'], ['Website Settings', '/settings', 'owner']]],
  ['Products', [['All Products', '/products', 'products'], ['Add Product', '/products/new', 'products'], ['Inventory', '/inventory', ['inventory', 'products']], ['Coupons', '/coupons', 'coupons']]],
  ['Orders', [['All Orders', '/orders', 'orders', 'pending'], ...['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'].map((s) => [s[0].toUpperCase() + s.slice(1), `/orders?status=${s}`, 'orders'])]],
  ['Customers', [['All Customers', '/customers', 'customers']]],
  ['Support', [['Tickets', '/tickets', 'support', 'tickets']]],
  ['Analytics', [['Sales', '/analytics/sales', 'analytics'], ['Customers', '/analytics/customers', 'analytics'], ['Products', '/analytics/products', 'analytics']]],
  ['Administration', [['Admin Accounts', '/admins', 'owner'], ['Roles & Permissions', '/roles', 'owner'], ['Security Settings', '/security', 'owner'], ['Audit Logs', '/audit', 'owner']]],
];

// ================= auth screens =================
function loginScreen(msg = '') {
  root.innerHTML = html`<div class="login"><div class="box"><div class="brand" style="padding:0 0 18px;border:0;color:#0D0D0D">Luxury <b>Bharat</b><small>Dashboard</small></div><h1>Sign in</h1>${msg ? html`<p class="warn-box">${msg}</p>` : ''}
    <form id="lf" novalidate><label class="fl"><span>Email or username</span><input name="identifier" autocomplete="username" required></label><label class="fl"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label><button class="btn gold" style="width:100%;justify-content:center">Sign in</button></form>
    <p style="margin-top:16px;font-size:13px"><a href="#/setup" id="setup-link" hidden>First-time owner setup</a> <a href="/">← Back to store</a></p></div></div>`.toString();
  api('/api/setup/status').then((s) => { if (s.needsSetup) $('#setup-link').hidden = false; });
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try { const r = await api('/api/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(f)) }); auth.user = r.user; auth.csrf = r.csrf;
      if (!isStaff(r.user)) { await api('/api/auth/logout', { method: 'POST' }); await loadMe(); return loginScreen('This account does not have dashboard access.'); }
      boot(); } catch (err) { toast(errMsg(err), 'err'); }
  });
}
async function setupScreen() {
  const st = await api('/api/setup/status');
  if (!st.needsSetup) { location.hash = '#/'; return loginScreen('The owner account already exists. Sign in below.'); }
  root.innerHTML = html`<div class="login"><div class="box"><h1>Create the owner account</h1><p class="muted">One-time setup. The token is printed in the server console on first start (or set OWNER_SETUP_TOKEN).</p>
    <form id="sf" novalidate><label class="fl"><span>Setup token</span><input name="token" required autocomplete="off"></label><label class="fl"><span>Owner email</span><input name="email" type="email" value="${st.ownerEmail}" required></label><label class="fl"><span>Username</span><input name="username" required></label><label class="fl"><span>Password (10+ chars, letters & numbers)</span><input name="password" type="password" minlength="10" autocomplete="new-password" required></label><button class="btn gold" style="width:100%;justify-content:center">Create owner</button></form></div></div>`.toString();
  $('#sf').addEventListener('submit', async (e) => { e.preventDefault(); showFieldErrors(e.target); try { const r = await api('/api/setup/owner', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); auth.user = r.user; auth.csrf = r.csrf; location.hash = '#/'; boot(); } catch (err) { showFieldErrors(e.target, err.fields); toast(errMsg(err), 'err'); } });
}
async function inviteScreen(token) {
  let info; try { info = await api(`/api/auth/invite?token=${encodeURIComponent(token)}`); } catch (e) { return loginScreen(errMsg(e)); }
  root.innerHTML = html`<div class="login"><div class="box"><h1>Accept your invitation</h1><p class="muted">Setting up admin access for <strong>${info.email}</strong>.</p><form id="af" novalidate>
    ${info.existingUsername ? html`<p class="muted">You already have the account “${info.existingUsername}”. Choosing a password here updates it.</p>` : html`<label class="fl"><span>Username</span><input name="username" required></label>`}
    <label class="fl"><span>Password</span><input name="password" type="password" minlength="10" autocomplete="new-password" required></label><button class="btn gold" style="width:100%;justify-content:center">Join the team</button></form></div></div>`.toString();
  $('#af').addEventListener('submit', async (e) => { e.preventDefault(); showFieldErrors(e.target); try { const r = await api('/api/auth/accept-invite', { method: 'POST', body: { token, ...Object.fromEntries(new FormData(e.target)) } }); auth.user = r.user; auth.csrf = r.csrf; location.hash = '#/'; boot(); } catch (err) { showFieldErrors(e.target, err.fields); toast(errMsg(err), 'err'); } });
}

// ================= shell =================
function shell() {
  root.innerHTML = html`<div class="shell"><aside class="side" id="side"><div class="brand">Luxury <b>Bharat</b><small>${auth.user.role === 'owner' ? 'Owner console' : 'Admin console'}</small></div>
    ${NAV.map(([g, items]) => { const vis = items.filter((i) => can(i[2])); return vis.length ? html`${g ? html`<h4>${g}</h4>` : ''}${vis.map(([l, h, , c]) => html`<a href="#${h}" data-h="${h}">${l}${c ? html`<span class="cnt" data-c="${c}" hidden></span>` : ''}</a>`)}` : ''; })}</aside>
    <div class="main"><div class="top"><button class="btn ghost sm menu-t" id="mt" aria-label="Menu">☰</button><a href="/" target="_blank" rel="noopener" class="btn ghost sm">View store ↗</a><span class="sp"></span>
      <button class="bell" id="bell" aria-label="Notifications">🔔<span class="cnt" id="bellc" hidden></span></button><span><strong>${auth.user.username}</strong> <span class="chip">${auth.user.role}</span></span><button class="btn ghost sm" id="lo">Sign out</button></div>
    <div id="notif"></div><div class="content" id="main"></div></div></div>`.toString();
  $('#mt').onclick = () => $('#side').classList.toggle('open');
  $('#lo').onclick = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ } es?.close(); await loadMe(); loginScreen(); };
  $('#bell').onclick = toggleBell;
}
function markNav() {
  const cur = location.hash.slice(1) || '/';
  $$('.side a').forEach((a) => a.classList.toggle('on', a.dataset.h === cur || (a.dataset.h !== '/' && !a.dataset.h.includes('?') && cur.startsWith(a.dataset.h) && !$$('.side a').some((o) => o.dataset.h === cur))));
}
async function refreshCounts() {
  try {
    const o = await api('/api/admin/overview'); counts.pending = o.pendingOrders; counts.tickets = o.openTickets;
    const n = await api('/api/admin/notifications'); counts.unread = n.unread; counts.list = n.notifications;
    $$('[data-c]').forEach((el) => { const v = counts[el.dataset.c]; el.textContent = v; el.hidden = !v; });
    const b = $('#bellc'); if (b) { b.textContent = counts.unread; b.hidden = !counts.unread; }
  } catch { /* offline */ }
}
function toggleBell() {
  const host = $('#notif'); if (host.innerHTML) { host.innerHTML = ''; return; }
  const link = (n) => (n.type === 'order.new' ? `#/orders/${n.data?.number}` : n.type.startsWith('ticket') ? `#/tickets/${n.data?.number}` : '#/inventory');
  host.innerHTML = html`<div class="pop"><div style="display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #efece6"><strong>Notifications</strong><button class="btn sm ghost" id="mr">Mark all read</button></div>
    ${(counts.list || []).length ? counts.list.map((n) => html`<a class="ni ${n.read ? '' : 'unread'}" href="${link(n)}"><strong>${n.title}</strong><small>${n.body}</small><small>${ago(n.createdAt)}</small></a>`) : html`<p class="muted" style="padding:20px">Nothing yet.</p>`}</div>`.toString();
  $('#mr').onclick = async () => { await api('/api/admin/notifications/read', { method: 'POST', body: { all: true } }); await refreshCounts(); host.innerHTML = ''; };
  host.onclick = (e) => { if (e.target.closest('a')) host.innerHTML = ''; };
}
function startStream() {
  es?.close(); es = new EventSource('/api/admin/stream');
  es.addEventListener('notification', (ev) => {
    const n = JSON.parse(ev.data); refreshCounts();
    if (n.type === 'order.new' || n.type === 'ticket.new') {
      const bar = document.createElement('div'); bar.className = 'nb'; bar.setAttribute('role', 'alert');
      bar.innerHTML = `<span>${esc(n.title)}</span><span>${esc(n.body || '')}</span><a class="btn sm" href="#/${n.type === 'order.new' ? 'orders' : 'tickets'}/${esc(n.data?.number)}">Open</a><button aria-label="Dismiss">×</button>`;
      bar.querySelector('button').onclick = () => bar.remove(); bar.querySelector('a').onclick = () => bar.remove(); document.body.append(bar); setTimeout(() => bar.remove(), 20000);
    }
    const p = hashParts().path; if (p === '/' || p === '/orders' || p === '/tickets') route();
  });
}

// ================= router =================
const routes = [];
const R = (re, perm, fn) => routes.push([re, perm, fn]);
async function route() {
  if (!auth.user) return;
  const { path, q } = hashParts(); const main = $('#main');
  if (!main) return;
  markNav(); $('#side').classList.remove('open');
  for (const [re, perm, fn] of routes) {
    const m = re.exec(path); if (!m) continue;
    if (!can(perm)) { main.innerHTML = P('No access', html`<div class="empty-box">Your account doesn’t have permission for this area. Ask the owner to update your permissions.</div>`).toString(); return; }
    main.innerHTML = '<p class="muted">Loading…</p>';
    try { const out = await fn(m.slice(1), q, main); if (out) main.innerHTML = out.toString(); } catch (e) { main.innerHTML = P('Something went wrong', html`<div class="warn-box">${errMsg(e)}</div>`).toString(); }
    return;
  }
  main.innerHTML = P('Not found', html`<div class="empty-box">That page doesn’t exist.</div>`).toString();
}
window.addEventListener('hashchange', () => { const { path, q } = hashParts(); if (!auth.user) { if (path === '/setup') setupScreen(); else if (path === '/accept-invite') inviteScreen(q.get('token')); return; } route(); });

// act: delegated button actions inside #main
const acts = {};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-do]'); if (!b || !acts[b.dataset.do]) return;
  if (b.tagName !== 'INPUT') e.preventDefault(); Promise.resolve(acts[b.dataset.do](b, e)).catch((err) => toast(errMsg(err), 'err'));
});
const reload = () => route();
const tick = async (fn, msg) => { await fn(); if (msg) toast(msg); reload(); };

// ================= dashboard =================
R(/^\/$/, null, async () => {
  const o = await api('/api/admin/overview'); const money_ = can('analytics');
  let sales = null; if (money_) sales = await api('/api/admin/analytics/sales?range=daily');
  return P(`Welcome back, ${auth.user.username}`, html`
    <div class="stats">${money_ ? html`<div class="stat"><span>Paid revenue</span><strong>${money(o.paidRevenue)}</strong><small>excludes cancelled orders</small></div><div class="stat"><span>Awaiting payment</span><strong>${money(o.pendingRevenue)}</strong><small>unpaid, not cancelled</small></div>` : ''}
      <div class="stat"><span>Orders</span><strong>${o.totalOrders}</strong><small>${o.pendingOrders} pending</small></div><div class="stat"><span>Customers</span><strong>${o.totalCustomers}</strong></div><div class="stat"><span>Products</span><strong>${o.totalProducts}</strong></div><div class="stat"><span>Open tickets</span><strong>${o.openTickets}</strong></div></div>
    ${sales ? html`<div class="panel"><div class="ph"><h3>Sales — last 30 days</h3><a class="btn sm ghost" href="#/analytics/sales">Full analytics</a></div>${chart(sales.series.map((r) => r.bucket), [{ name: 'Paid', color: '#0D0D0D', values: sales.series.map((r) => r.paidRevenue / 100) }, { name: 'Awaiting payment', color: '#D4AF37', values: sales.series.map((r) => r.pendingRevenue / 100) }], { fmt: (n) => '₹' + Math.round(n).toLocaleString('en-IN') })}</div>` : ''}
    <div class="cols-3-2"><div class="panel"><div class="ph"><h3>Recent orders</h3><a class="btn sm ghost" href="#/orders">All orders</a></div>${table([{ h: 'Order', f: (r) => html`<a href="#/orders/${r.number}"><strong>${r.number}</strong></a>` }, { h: 'Customer', f: (r) => r.customer.name }, { h: 'Status', f: (r) => chip(r.status) }, { h: 'Total', cls: 'right', f: (r) => money(r.total) }], o.recentOrders, { empty: 'No orders yet.' })}</div>
      <div><div class="panel"><h3>Inventory alerts</h3>${o.lowStock.length ? o.lowStock.map((p) => html`<p style="margin:0 0 8px"><a href="#/inventory"><strong>${p.name}</strong></a> — ${chip(p.stock === 0 ? 'out' : 'low')} ${p.stock} left</p>`) : html`<p class="muted">All stocked.</p>`}</div>
      ${o.bestSellers ? html`<div class="panel"><h3>Best sellers</h3>${o.bestSellers.length ? o.bestSellers.map((p) => html`<p style="margin:0 0 6px">${p.name} <span class="muted">· ${p.soldCount} sold</span></p>`) : html`<p class="muted">No sales yet.</p>`}</div>` : ''}
      <div class="panel"><h3>New customers</h3>${o.recentCustomers.length ? o.recentCustomers.map((c) => html`<p style="margin:0 0 6px">${c.username} <span class="muted">· ${ago(c.createdAt)}</span></p>`) : html`<p class="muted">No customers yet.</p>`}</div></div></div>`);
});

// ================= homepage / banners =================
R(/^\/homepage$/, 'banners', async (_, __, main) => {
  const [amb, secs, ban] = await Promise.all([api('/api/admin/ambient'), can('sections') ? api('/api/admin/sections') : { sections: [] }, api('/api/admin/banners')]);
  const fields = [{ name: 'enabled', type: 'checkbox', label: 'Show the floating product background', wide: true }, { name: 'images', type: 'images', label: 'Floating product images (transparent PNG/WebP cut-outs look best)', wide: true, help: 'Up to 14 images. Shown softly behind the hero and catalogue; decorative only, simplified on phones and switched off for reduced-motion users.' }];
  main.innerHTML = P('Homepage', html`<div class="cols2"><div><div class="panel"><h3>Animated background</h3><form id="af">${formHtml(fields, { enabled: amb.enabled, images: amb.images.map((u) => ({ url: u })) })}<div class="mfoot"><button class="btn gold">Save background</button></div></form></div>
    <div class="panel"><h3>Homepage layout</h3><p class="muted">The homepage is built from your hero banners (${ban.banners.filter((b) => b.visible).length} visible) followed by sections in order.</p>${secs.sections.map((s) => html`<p style="margin:0 0 6px">${chip(s.visible && s.status === 'published' ? 'on' : 'off')} ${s.name} <span class="muted">· ${s.type.replace(/_/g, ' ')}</span></p>`)}<p style="margin-top:14px"><a class="btn ghost sm" href="#/banners">Edit hero banners</a> <a class="btn ghost sm" href="#/sections">Open section builder</a></p></div></div>
    <div class="panel"><div class="ph"><h3>Live storefront</h3><a class="btn sm ghost" href="/" target="_blank" rel="noopener">Open ↗</a></div><iframe src="/" title="Storefront preview" style="width:100%;height:640px;border:1px solid #e1ded7"></iframe></div></div>`).toString();
  const f = $('#af'); hydrate(f);
  f.addEventListener('submit', async (e) => { e.preventDefault(); const v = collect(f, fields); try { await api('/api/admin/ambient', { method: 'PUT', body: { enabled: v.enabled, images: v.images.map((i) => i.url) } }); toast('Background saved'); } catch (er) { toast(errMsg(er), 'err'); } });
});
const bannerFields = [
  { name: 'title', label: 'Title', required: true, max: 100 }, { name: 'subtitle', label: 'Subtitle', max: 200 }, { name: 'buttonText', label: 'Button text', max: 40 }, { name: 'buttonUrl', label: 'Button link', ph: '/shop or https://…' },
  { name: 'badge', label: 'Promotional badge', max: 40, ph: 'Autumn–Winter 2026' }, { name: 'align', label: 'Text alignment', type: 'select', options: ['left', 'center', 'right'] },
  { name: 'overlay', label: 'Overlay darkness', type: 'range', min: 0, max: 1, step: 0.05, default: 0.45 }, { name: 'heightVh', label: 'Banner height (% of screen)', type: 'number', min: 30, max: 100 },
  { name: 'imageDesktop', label: 'Desktop image', type: 'image' }, { name: 'imageMobile', label: 'Mobile image', type: 'image' }, { name: 'videoUrl', label: 'Background video (https link)', wide: true, ph: 'https://…/clip.mp4' }, { name: 'visible', label: 'Visible on the storefront', type: 'checkbox', wide: true },
];
R(/^\/banners$/, 'banners', async () => {
  const { banners } = await api('/api/admin/banners');
  acts['ban-edit'] = (b) => { const x = banners.find((y) => y.id === Number(b.dataset.id)); formModal({ title: x ? 'Edit banner' : 'New banner', fields: bannerFields, values: x || { align: 'left', overlay: 0.45, heightVh: 88, visible: true }, onSubmit: async (v) => { await api(x ? `/api/admin/banners/${x.id}` : '/api/admin/banners', { method: x ? 'PUT' : 'POST', body: v }); toast('Banner saved'); reload(); } }); };
  acts['ban-del'] = async (b) => { if (confirm('Delete this banner?')) await tick(() => api(`/api/admin/banners/${b.dataset.id}`, { method: 'DELETE' }), 'Banner deleted'); };
  acts['ban-vis'] = async (b) => { const x = banners.find((y) => y.id === Number(b.dataset.id)); await tick(() => api(`/api/admin/banners/${x.id}`, { method: 'PUT', body: { ...x, visible: !x.visible } })); };
  acts['ban-move'] = async (b) => { const ids = banners.map((x) => x.id), i = ids.indexOf(Number(b.dataset.id)), j = i + Number(b.dataset.dir); if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await tick(() => api('/api/admin/banners/reorder', { method: 'POST', body: { ids } })); };
  return P('Hero banners', html`<p class="muted">Visible banners rotate on the homepage in this order. Everything here is editable without code.</p>${!banners.length ? html`<div class="empty-box">No banners — the homepage falls back to a default “Luxury Bharat” hero.</div>` : html`<div class="cards">${banners.map((b) => html`<div class="card-i"><div class="cv" style="background:#0d0d0d">${b.imageDesktop ? html`<img src="${b.imageDesktop}" alt="">` : html`<span style="color:#D4AF37;font:28px var(--serif)">${b.title}</span>`}</div><div class="cb"><div><strong>${b.title}</strong> ${chip(b.visible ? 'on' : 'off')}<div class="muted">${b.subtitle || ''}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" data-do="ban-edit" data-id="${b.id}">Edit</button><button class="btn sm ghost" data-do="ban-vis" data-id="${b.id}">${b.visible ? 'Hide' : 'Show'}</button><button class="btn sm ghost" data-do="ban-move" data-id="${b.id}" data-dir="-1" aria-label="Move earlier">↑</button><button class="btn sm ghost" data-do="ban-move" data-id="${b.id}" data-dir="1" aria-label="Move later">↓</button><button class="btn sm danger" data-do="ban-del" data-id="${b.id}">Delete</button></div></div></div>`)}</div>`}`, html`<button class="btn gold" data-do="ban-edit">+ New banner</button>`);
});

// ================= categories =================
R(/^\/categories$/, 'categories', async () => {
  const { categories } = await api('/api/admin/categories');
  const opts = [['', '— none (top level) —'], ...categories.map((c) => [c.id, c.name])];
  const fields = (self) => [
    { name: 'name', label: 'Name', required: true, max: 60 }, { name: 'slug', label: 'Slug', help: 'Leave blank to generate from the name.' }, { name: 'subtitle', label: 'Subtitle (shown on the card)', max: 80 }, { name: 'parentId', label: 'Parent category', type: 'select', options: opts.filter((o) => o[0] !== self) },
    { name: 'description', label: 'Description', type: 'textarea', wide: true, rows: 2 }, { name: 'bgColor', label: 'Card background colour', type: 'color', default: '#3A3A3A' }, { name: 'imageFit', label: 'Image fit', type: 'select', options: [['contain', 'Product cut-out (contain)'], ['cover', 'Full photo (cover)']] },
    { name: 'image', label: 'Cover image (catalogue card)', type: 'image', help: 'A transparent cut-out reads best on the coloured card.' }, { name: 'mobileImage', label: 'Mobile image', type: 'image' }, { name: 'hoverImage', label: 'Hover image', type: 'image' }, { name: 'bgImage', label: 'Background image', type: 'image' },
    { name: 'visible', label: 'Visible in the storefront catalogue & menu', type: 'checkbox', wide: true }];
  acts['cat-edit'] = (b) => { const x = categories.find((y) => y.id === Number(b.dataset.id)); formModal({ title: x ? `Edit ${x.name}` : 'New category', fields: fields(x?.id), values: x ? { ...x, parentId: x.parentId ?? '' } : { bgColor: '#3A3A3A', imageFit: 'contain', visible: true, parentId: '' }, onSubmit: async (v) => { await api(x ? `/api/admin/categories/${x.id}` : '/api/admin/categories', { method: x ? 'PUT' : 'POST', body: { ...v, parentId: v.parentId || null } }); toast('Category saved'); reload(); } }); };
  acts['cat-del'] = async (b) => { if (confirm('Delete this category? Its products stay but become uncategorised.')) await tick(() => api(`/api/admin/categories/${b.dataset.id}`, { method: 'DELETE' }), 'Category deleted'); };
  acts['cat-move'] = async (b) => { const ids = categories.map((x) => x.id), i = ids.indexOf(Number(b.dataset.id)), j = i + Number(b.dataset.dir); if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await tick(() => api('/api/admin/categories/reorder', { method: 'POST', body: { ids } })); };
  const name = (id) => categories.find((c) => c.id === id)?.name;
  return P('Category management', html`<p class="muted">The numbered editorial catalogue on the homepage uses each top-level category’s image and colour, in this order.</p>${table([
    { h: '#', f: (r) => categories.indexOf(r) + 1 }, { h: 'Card', f: (r) => html`<div style="width:64px;height:64px;background:${r.bgColor};display:grid;place-items:center">${r.image ? html`<img src="${r.image}" alt="" style="max-width:100%;max-height:100%;object-fit:contain">` : ''}</div>` },
    { h: 'Name', f: (r) => html`<strong>${r.name}</strong><div class="muted">${r.parentId ? `in ${name(r.parentId)}` : r.subtitle || ''}</div>` }, { h: 'Products', f: (r) => r.productCount }, { h: 'Visible', f: (r) => chip(r.visible ? 'on' : 'off') },
    { h: '', cls: 'right nowrap', f: (r) => html`<button class="btn sm ghost" data-do="cat-move" data-id="${r.id}" data-dir="-1" aria-label="Move up">↑</button> <button class="btn sm ghost" data-do="cat-move" data-id="${r.id}" data-dir="1" aria-label="Move down">↓</button> <button class="btn sm" data-do="cat-edit" data-id="${r.id}">Edit</button> <button class="btn sm danger" data-do="cat-del" data-id="${r.id}">Delete</button>` }], categories)}`, html`<button class="btn gold" data-do="cat-edit">+ New category</button>`);
});

// ================= media =================
R(/^\/media$/, ['products', 'sections', 'banners', 'categories'], async () => {
  const { media, total } = await api('/api/admin/media?pageSize=100');
  acts['media-up'] = async () => { const fs = await chooseFile(true); for (const f of fs) await uploadImage(f); toast(`${fs.length} uploaded`); reload(); };
  acts['media-del'] = async (b) => { if (confirm('Delete this image?')) await tick(() => api(`/api/admin/media/${b.dataset.id}`, { method: 'DELETE' }), 'Image deleted'); };
  acts['media-copy'] = async (b) => { await navigator.clipboard?.writeText(location.origin + b.dataset.url); toast('Link copied'); };
  return P('Image management', html`<p class="muted">${total} images. Uploads are validated, resized to 1600 px and converted to WebP.</p><div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">${media.map((m) => html`<div class="card-i"><div class="cv" style="aspect-ratio:1;background:#e9e6e0"><img src="${m.thumbUrl || m.url}" alt="" loading="lazy" style="object-fit:cover"></div><div class="cb" style="padding:8px"><small class="muted">${m.width ? `${m.width}×${m.height}` : ''} · ${Math.round(m.bytes / 1024)} KB</small><div style="display:flex;gap:4px"><button class="btn sm ghost" data-do="media-copy" data-url="${m.url}">Copy link</button><button class="btn sm danger" data-do="media-del" data-id="${m.id}" aria-label="Delete">×</button></div></div></div>`)}</div>`, html`<button class="btn gold" data-do="media-up">Upload images</button>`);
});

// ================= footer, pages, website settings =================
R(/^\/footer$/, 'content', async () => {
  const [{ footer }, { pages }] = await Promise.all([api('/api/admin/settings/footer'), api('/api/admin/pages')]);
  const ff = [{ name: 'about', label: 'About us (shown in footer)', type: 'textarea', wide: true, rows: 3 }, { name: 'address', label: 'Address', type: 'textarea', rows: 2 }, { name: 'hours', label: 'Opening hours / support hours' }, { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Contact email', type: 'email' },
    ...['instagram', 'facebook', 'x', 'youtube'].map((k) => ({ name: `s_${k}`, label: `${k[0].toUpperCase() + k.slice(1)} link`, ph: 'https://…' }))];
  const vals = { ...footer, ...Object.fromEntries(['instagram', 'facebook', 'x', 'youtube'].map((k) => [`s_${k}`, footer.socials?.[k] || ''])) };
  acts['page-edit'] = (b) => { const x = pages.find((p) => p.slug === b.dataset.slug); const fs = [...(x ? [] : [{ name: 'slug', label: 'Page address (lowercase-with-dashes)', required: true }]), { name: 'title', label: 'Title', required: true }, { name: 'body', label: 'Content (blank line = new paragraph)', type: 'textarea', rows: 12, wide: true }, { name: 'visible', label: 'Published', type: 'checkbox' }];
    formModal({ title: x ? x.title : 'New page', fields: fs, values: x || { visible: true }, onSubmit: async (v) => { await api(`/api/admin/pages/${x ? x.slug : v.slug}`, { method: 'PUT', body: v }); toast('Page saved'); reload(); } }); };
  acts['page-del'] = async (b) => { if (confirm('Delete this page?')) await tick(() => api(`/api/admin/pages/${b.dataset.slug}`, { method: 'DELETE' }), 'Page deleted'); };
  setTimeout(() => { const f = $('#ff'); if (!f) return; hydrate(f); f.addEventListener('submit', async (e) => { e.preventDefault(); const v = collect(f, ff); const body = { ...v, socials: Object.fromEntries(['instagram', 'facebook', 'x', 'youtube'].map((k) => [k, v[`s_${k}`] || ''])) }; try { await api('/api/admin/settings/footer', { method: 'PUT', body }); toast('Footer saved'); } catch (er) { showFieldErrors(f, er.fields); toast(errMsg(er), 'err'); } }); }, 0);
  return P('Footer & pages', html`<div class="cols2"><div class="panel"><h3>Footer & contact details</h3><form id="ff">${formHtml(ff, vals)}<div class="mfoot"><button class="btn gold">Save footer</button></div></form></div>
    <div class="panel"><div class="ph"><h3>Policy & info pages</h3><button class="btn sm gold" data-do="page-edit">+ New page</button></div>${table([{ h: 'Page', f: (p) => html`<strong>${p.title}</strong><div class="muted">/page/${p.slug}</div>` }, { h: 'Status', f: (p) => chip(p.visible ? 'published' : 'draft') }, { h: '', cls: 'right nowrap', f: (p) => html`<button class="btn sm" data-do="page-edit" data-slug="${p.slug}">Edit</button> <button class="btn sm danger" data-do="page-del" data-slug="${p.slug}">×</button>` }], pages)}</div></div>`);
});
R(/^\/settings$/, 'owner', async () => {
  const { store } = await api('/api/admin/settings/store');
  const fs = [{ name: 'name', label: 'Store name', required: true }, { name: 'tagline', label: 'Tagline' }, { name: 'support_email', label: 'Support email', type: 'email', required: true }, { name: 'shipping_flat', label: 'Flat shipping charge (₹)', type: 'number', step: '0.01', min: 0 }, { name: 'free_shipping_above', label: 'Free shipping above (₹)', type: 'number', step: '0.01', min: 0 }, { name: 'cod_enabled', label: 'Enable Cash on Delivery', type: 'checkbox', wide: true, help: 'Off by default. When on, customers can choose COD at checkout.' }];
  setTimeout(() => { const f = $('#sf2'); f?.addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/api/admin/settings/store', { method: 'PUT', body: collect(f, fs) }); toast('Settings saved'); } catch (er) { showFieldErrors(f, er.fields); toast(errMsg(er), 'err'); } }); }, 0);
  return P('Website settings', html`<div class="panel"><form id="sf2">${formHtml(fs, { ...store, shipping_flat: rs(store.shipping_flat), free_shipping_above: rs(store.free_shipping_above) })}<div class="mfoot"><button class="btn gold">Save settings</button></div></form></div>
    <div class="panel"><h3>Payments & email</h3><p class="muted">Payment gateway keys (Razorpay) and the email provider (Resend) are server environment variables, never stored in the database or exposed to the browser. See the README for the exact names.</p></div>`);
});

// ================= products =================
R(/^\/products$/, 'products', async (_, q) => {
  const { products, total } = await api(`/api/admin/products?${new URLSearchParams({ q: q.get('q') || '', status: q.get('status') || '', page: q.get('page') || 1 })}`);
  const pg = Number(q.get('page') || 1), pages = Math.ceil(total / 25);
  acts['prod-del'] = async (b) => { if (confirm('Delete this product? Products with order history are archived instead.')) { const r = await api(`/api/admin/products/${b.dataset.id}`, { method: 'DELETE' }); toast(r.archived ? 'Archived (has order history)' : 'Deleted'); reload(); } };
  setTimeout(() => $('#pq')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = `#/products?q=${encodeURIComponent(e.target.value)}&status=${$('#ps').value}`; }), 0);
  setTimeout(() => $('#ps')?.addEventListener('change', (e) => { location.hash = `#/products?q=${encodeURIComponent($('#pq').value)}&status=${e.target.value}`; }), 0);
  return P('Products', html`<div class="bar"><input id="pq" placeholder="Search name or SKU…" value="${q.get('q') || ''}" aria-label="Search products"><select id="ps" aria-label="Status">${[['', 'All statuses'], ['active', 'Active'], ['draft', 'Draft'], ['archived', 'Archived']].map(([v, l]) => html`<option value="${v}" ${q.get('status') === v ? 'selected' : ''}>${l}</option>`)}</select><span class="muted">${total} products</span></div>
    <div class="panel">${table([{ h: '', f: (p) => thumb(p.thumb) }, { h: 'Product', f: (p) => html`<a href="#/products/${p.id}"><strong>${p.name}</strong></a><div class="muted">${p.sku} · ${p.categoryName || 'Uncategorised'}</div>` }, { h: 'Price', f: (p) => p.discountPrice ? html`<strong>${money(p.discountPrice)}</strong> <s class="muted">${money(p.price)}</s>` : money(p.price) },
      { h: 'Stock', f: (p) => html`${p.stock} ${p.stock <= p.lowStockThreshold ? chip(p.stock === 0 ? 'out' : 'low') : ''}` }, { h: 'Status', f: (p) => chip(p.status) }, { h: 'Flags', f: (p) => [p.featured && 'Featured', p.trending && 'Trending', p.isNew && 'New'].filter(Boolean).join(' · ') }, { h: '', cls: 'right nowrap', f: (p) => html`<a class="btn sm" href="#/products/${p.id}">Edit</a> <button class="btn sm danger" data-do="prod-del" data-id="${p.id}">Delete</button>` }], products, { empty: 'No products match.' })}
    ${pages > 1 ? html`<div class="bar" style="margin-top:14px">${pg > 1 ? html`<a class="btn sm ghost" href="#/products?page=${pg - 1}&q=${q.get('q') || ''}&status=${q.get('status') || ''}">← Prev</a>` : ''}<span>Page ${pg} / ${pages}</span>${pg < pages ? html`<a class="btn sm ghost" href="#/products?page=${pg + 1}&q=${q.get('q') || ''}&status=${q.get('status') || ''}">Next →</a>` : ''}</div>` : ''}</div>`, html`<a class="btn gold" href="#/products/new">+ Add product</a>`);
});
R(/^\/products\/(new|\d+)$/, 'products', async ([id], _, main) => {
  const [{ categories }, cur] = await Promise.all([api('/api/admin/categories'), id === 'new' ? null : api(`/api/admin/products/${id}`)]);
  const p = cur?.product;
  const fields = [
    { name: 'name', label: 'Product name', required: true, max: 160 }, { name: 'sku', label: 'SKU', help: 'Leave blank to auto-generate.' }, { name: 'categoryId', label: 'Category', type: 'select', options: [['', '— choose —'], ...categories.map((c) => [c.id, (c.parentId ? '↳ ' : '') + c.name])] }, { name: 'status', label: 'Status', type: 'select', options: [['draft', 'Draft (hidden)'], ['active', 'Active (on sale)'], ['archived', 'Archived']] },
    { name: 'price', label: 'Price (₹)', type: 'number', step: '0.01', min: 0, required: true }, { name: 'discountPrice', label: 'Discount price (₹)', type: 'number', step: '0.01', min: 0, help: 'Must be lower than the price. Leave empty for no discount.' }, { name: 'stock', label: 'Stock quantity', type: 'number', min: 0, required: true }, { name: 'lowStockThreshold', label: 'Low-stock alert at', type: 'number', min: 0 },
    { name: 'description', label: 'Description', type: 'textarea', rows: 5, wide: true }, { name: 'images', label: 'Product images (first = main, second = hover image)', type: 'images', wide: true },
    { name: 'color', label: 'Colour' }, { name: 'material', label: 'Material' }, { name: 'size', label: 'Sizes (comma separated)' }, { name: 'tags', label: 'Tags (comma separated)', help: 'Used by search & related products, e.g. black, leather, jacket.' },
    { name: 'featured', label: 'Featured', type: 'checkbox' }, { name: 'trending', label: 'Trending', type: 'checkbox' }, { name: 'isNew', label: 'New arrival', type: 'checkbox' }, { name: 'slug', label: 'URL slug' }, { name: 'seoTitle', label: 'SEO title', max: 70 }, { name: 'seoDescription', label: 'SEO description', max: 160 }];
  const vals = p ? { ...p, price: rs(p.price), discountPrice: rs(p.discountPrice), categoryId: p.categoryId ?? '', color: p.attrs?.color || '', material: p.attrs?.material || '', size: (p.attrs?.size || []).join(', '), tags: p.tags.join(', '), images: p.images } : { status: 'draft', stock: 0, lowStockThreshold: 5, images: [] };
  main.innerHTML = P(p ? `Edit: ${p.name}` : 'Add product', html`<form class="panel" id="pf" novalidate>${formHtml(fields, vals)}<div class="mfoot"><a class="btn ghost" href="#/products">Cancel</a><button class="btn gold">${p ? 'Save changes' : 'Create product'}</button></div></form>`).toString();
  const f = $('#pf'); hydrate(f);
  f.addEventListener('submit', async (e) => { e.preventDefault(); showFieldErrors(f); const v = collect(f, fields);
    const body = { ...v, categoryId: v.categoryId || null, attrs: { color: v.color, material: v.material, size: v.size }, images: v.images };
    try { await api(p ? `/api/admin/products/${p.id}` : '/api/admin/products', { method: p ? 'PUT' : 'POST', body }); toast('Product saved'); location.hash = '#/products'; } catch (er) { showFieldErrors(f, er.fields); toast(errMsg(er), 'err'); } });
});

// ================= inventory =================
R(/^\/inventory$/, ['inventory', 'products'], async (_, q) => {
  const tab = q.get('tab') || 'stock';
  const tabs = html`<div class="tabs">${[['stock', 'Stock levels'], ['low', 'Low & out of stock'], ['moves', 'Movement history']].map(([k, l]) => html`<a href="#/inventory?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`)}</div>`;
  if (tab === 'moves') { const { movements } = await api('/api/admin/inventory/movements?pageSize=100'); return P('Inventory', html`${tabs}<div class="panel">${table([{ h: 'When', f: (m) => dateFmt(m.createdAt) }, { h: 'Product', f: (m) => m.name }, { h: 'Change', f: (m) => html`<strong style="color:${m.delta < 0 ? '#9b1c14' : '#14532d'}">${m.delta > 0 ? '+' : ''}${m.delta}</strong>` }, { h: 'Stock after', f: (m) => m.stockAfter }, { h: 'Reason', f: (m) => html`${m.reason}${m.refId ? html` <span class="muted">· ${m.refId}</span>` : ''}` }, { h: 'By', f: (m) => m.actor || 'system' }], movements)}</div>`); }
  const { items } = await api(`/api/admin/inventory${tab === 'low' ? '?low=1' : ''}`);
  acts['inv-adj'] = (b) => { const it = items.find((i) => i.id === Number(b.dataset.id)); formModal({ title: `Adjust stock — ${it.name}`, wide: false, fields: [{ name: 'mode', label: 'Action', type: 'select', options: [['add', 'Add stock (received)'], ['remove', 'Remove stock (damaged / lost)'], ['set', 'Set exact count (stock-take)']] }, { name: 'qty', label: 'Quantity', type: 'number', min: 0, required: true }, { name: 'reason', label: 'Reason', max: 120, ph: 'e.g. Supplier delivery' }], values: { mode: 'add' },
    onSubmit: async (v) => { const n = Number(v.qty); await api(`/api/admin/inventory/${it.id}/adjust`, { method: 'POST', body: { ...(v.mode === 'set' ? { set: n } : { delta: v.mode === 'add' ? n : -n }), reason: v.reason || 'Manual adjustment' } }); toast('Stock updated'); reload(); } }); };
  return P('Inventory', html`${tabs}<div class="panel">${table([{ h: '', f: (i) => thumb(i.thumb, 40) }, { h: 'Product', f: (i) => html`<strong>${i.name}</strong><div class="muted">${i.sku}</div>` }, { h: 'In stock', f: (i) => html`<strong>${i.stock}</strong> ${i.out ? chip('out') : i.low ? chip('low') : ''}` }, { h: 'Alert at', f: (i) => i.lowStockThreshold }, { h: 'Sold', f: (i) => i.soldCount }, { h: 'Status', f: (i) => chip(i.status) }, { h: '', cls: 'right', f: (i) => html`<button class="btn sm" data-do="inv-adj" data-id="${i.id}">Adjust</button>` }], items, { empty: 'Nothing to show.' })}</div>`);
});

// ================= coupons =================
R(/^\/coupons$/, 'coupons', async () => {
  const { coupons } = await api('/api/admin/coupons');
  const fs = [{ name: 'code', label: 'Code', required: true, max: 24 }, { name: 'type', label: 'Type', type: 'select', options: [['percent', 'Percent off'], ['flat', 'Flat amount off (₹)']] }, { name: 'value', label: 'Value (percent, or ₹ for flat)', type: 'number', step: '0.01', required: true }, { name: 'minSubtotal', label: 'Minimum subtotal (₹)', type: 'number', step: '0.01' }, { name: 'maxUses', label: 'Max uses', type: 'number', min: 1 }, { name: 'startsAt', label: 'Starts', type: 'date' }, { name: 'endsAt', label: 'Ends', type: 'date' }, { name: 'active', label: 'Active (customers can use it)', type: 'checkbox', wide: true, help: 'Coupons are created inactive. Turn this on when you’re ready to launch the offer.' }];
  acts['cp-edit'] = (b) => { const x = coupons.find((c) => c.id === Number(b.dataset.id)); formModal({ title: x ? 'Edit coupon' : 'New coupon', wide: false, fields: fs, values: x ? { ...x, value: x.type === 'flat' ? x.value / 100 : x.value, minSubtotal: x.minSubtotal / 100, startsAt: x.startsAt?.slice(0, 10), endsAt: x.endsAt?.slice(0, 10) } : { type: 'percent', active: false }, onSubmit: async (v) => { await api(x ? `/api/admin/coupons/${x.id}` : '/api/admin/coupons', { method: x ? 'PUT' : 'POST', body: v }); toast('Coupon saved'); reload(); } }); };
  acts['cp-del'] = async (b) => { if (confirm('Delete this coupon?')) await tick(() => api(`/api/admin/coupons/${b.dataset.id}`, { method: 'DELETE' }), 'Deleted'); };
  return P('Coupons', html`<div class="panel">${table([{ h: 'Code', f: (c) => html`<strong>${c.code}</strong>` }, { h: 'Offer', f: (c) => c.type === 'percent' ? `${c.value}% off` : `${money(c.value)} off` }, { h: 'Min', f: (c) => (c.minSubtotal ? money(c.minSubtotal) : '—') }, { h: 'Used', f: (c) => `${c.usedCount}${c.maxUses ? ` / ${c.maxUses}` : ''}` }, { h: 'Status', f: (c) => chip(c.active ? 'active' : 'draft') }, { h: '', cls: 'right nowrap', f: (c) => html`<button class="btn sm" data-do="cp-edit" data-id="${c.id}">Edit</button> <button class="btn sm danger" data-do="cp-del" data-id="${c.id}">×</button>` }], coupons, { empty: 'No coupons yet.' })}</div>`, html`<button class="btn gold" data-do="cp-edit">+ New coupon</button>`);
});

// ================= orders =================
const FLOW = ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];
R(/^\/orders$/, 'orders', async (_, q) => {
  const st = q.get('status') || '';
  const { orders, counts: c, total } = await api(`/api/admin/orders?${new URLSearchParams({ status: st, q: q.get('q') || '', payment: q.get('payment') || '' })}`);
  setTimeout(() => $('#oq')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = `#/orders?status=${st}&q=${encodeURIComponent(e.target.value)}`; }), 0);
  return P('Orders', html`<div class="tabs"><a href="#/orders" class="${!st ? 'on' : ''}">All</a>${[...FLOW, 'cancelled'].map((s) => html`<a href="#/orders?status=${s}" class="${st === s ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)} (${c[s] || 0})</a>`)}</div>
    <div class="bar"><input id="oq" placeholder="Search order #, name, email, phone…" value="${q.get('q') || ''}" style="min-width:300px" aria-label="Search orders"><span class="muted">${total} orders</span></div>
    <div class="panel">${table([{ h: 'Order', f: (o) => html`<a href="#/orders/${o.number}"><strong>${o.number}</strong></a><div class="muted">${dateFmt(o.createdAt)}</div>` }, { h: 'Customer', f: (o) => html`${o.customer.name}<div class="muted">${o.customer.email}</div>` }, { h: 'Items', f: (o) => o.itemCount }, { h: 'Total', f: (o) => html`<strong>${money(o.total)}</strong>` }, { h: 'Payment', f: (o) => html`${chip(o.paymentStatus)} <span class="muted">${o.paymentMethod}</span>` }, { h: 'Status', f: (o) => chip(o.status) }], orders, { empty: 'No orders found.' })}</div>`);
});
R(/^\/orders\/([\w-]+)$/, 'orders', async ([n]) => {
  const { order: o } = await api(`/api/admin/orders/${n}`);
  const next = FLOW[FLOW.indexOf(o.status) + 1];
  const setStatus = (status) => formModal({ title: status === 'cancelled' ? 'Cancel this order?' : `Mark order as ${status}`, wide: false, submit: status === 'cancelled' ? 'Cancel order' : `Mark ${status}`,
    fields: [{ name: 'note', label: 'Note for the customer timeline (optional)', max: 300, wide: true, help: status === 'cancelled' ? 'Cancelling returns the items to stock. If the order was paid, a refund is due.' : 'The customer is emailed about the new status.' }],
    onSubmit: async (v) => { await api(`/api/admin/orders/${o.number}/status`, { method: 'PATCH', body: { status, note: v.note || null } }); toast(`Order ${status}`); reload(); } });
  acts['o-next'] = () => setStatus(next); acts['o-cancel'] = () => setStatus('cancelled');
  acts['o-pay'] = async (b) => tick(() => api(`/api/admin/orders/${o.number}/payment`, { method: 'PATCH', body: { paymentStatus: b.dataset.v } }), 'Payment updated');
  const open = !['delivered', 'cancelled'].includes(o.status);
  return P(`Order ${o.number}`, html`${o.status === 'cancelled' && o.paymentStatus === 'paid' ? html`<div class="warn-box">Cancelled after payment — a refund is due to the customer.</div>` : ''}<div class="cols-3-2"><div>
    <div class="panel"><h3>Items</h3>${table([{ h: '', f: (i) => thumb(i.image, 44) }, { h: 'Product', f: (i) => html`${i.name}<div class="muted">${i.sku}</div>` }, { h: 'Price', f: (i) => money(i.unitPrice) }, { h: 'Qty', f: (i) => i.qty }, { h: 'Total', cls: 'right', f: (i) => money(i.unitPrice * i.qty) }], o.items)}
      <dl class="kv2" style="margin-top:14px"><dt>Subtotal</dt><dd>${money(o.subtotal)}</dd>${o.discount ? html`<dt>Discount ${o.couponCode || ''}</dt><dd>−${money(o.discount)}</dd>` : ''}<dt>Shipping</dt><dd>${o.shipping ? money(o.shipping) : 'Free'}</dd><dt><strong>Total</strong></dt><dd><strong>${money(o.total)}</strong></dd></dl></div>
    <div class="panel"><h3>Status history</h3><ul class="timeline">${[...o.history].reverse().map((h) => html`<li><strong>${h.status}</strong> ${h.note ? html`— ${h.note}` : ''}<div class="muted">${dateFmt(h.createdAt)}</div></li>`)}</ul></div></div>
    <div><div class="panel"><h3>Manage</h3><p>${chip(o.status)} ${chip(o.paymentStatus)}</p>${open ? html`<div style="display:grid;gap:8px">${next ? html`<button class="btn gold" data-do="o-next">Mark as ${next}</button>` : ''}<button class="btn danger" data-do="o-cancel">Cancel order</button></div>` : html`<p class="muted">This order is ${o.status}; its status is final.</p>`}
      <h3 style="margin-top:20px;font-size:18px">Payment</h3><p class="muted">${o.paymentMethod === 'test' ? 'Test payment (not real money)' : o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Razorpay'}</p><div style="display:flex;gap:6px;flex-wrap:wrap">${['pending', 'paid', 'failed', 'refunded'].map((s) => html`<button class="btn sm ${o.paymentStatus === s ? '' : 'ghost'}" data-do="o-pay" data-v="${s}">${s}</button>`)}</div></div>
    <div class="panel"><h3>Customer</h3><p style="margin:0">${o.customer.name}<br><a href="mailto:${o.customer.email}">${o.customer.email}</a></p></div>
    <div class="panel"><h3>Ship to</h3><p style="margin:0;line-height:1.6">${o.shipTo.name}<br>${o.shipTo.line1}<br>${o.shipTo.city}, ${o.shipTo.state} ${o.shipTo.pincode}<br>${o.shipTo.phone}</p></div></div></div>`, html`<a class="btn ghost" href="#/orders">← All orders</a>`);
});

// ================= customers =================
R(/^\/customers$/, 'customers', async (_, q) => {
  const { customers, total } = await api(`/api/admin/customers?q=${encodeURIComponent(q.get('q') || '')}`);
  setTimeout(() => $('#cq')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = `#/customers?q=${encodeURIComponent(e.target.value)}`; }), 0);
  return P('Customers', html`<div class="bar"><input id="cq" placeholder="Search name, username or email…" value="${q.get('q') || ''}" style="min-width:300px" aria-label="Search customers"><span class="muted">${total} customers</span></div><div class="panel">${table([{ h: 'Customer', f: (c) => html`<a href="#/customers/${c.id}"><strong>${c.username}</strong></a><div class="muted">${c.email}</div>` }, { h: 'Verified', f: (c) => chip(c.emailVerified ? 'on' : 'pending') }, { h: 'Orders', f: (c) => c.orders }, { h: 'Paid spend', f: (c) => money(c.spent) }, { h: 'Joined', f: (c) => dateFmt(c.createdAt, false) }, { h: 'Status', f: (c) => (c.disabled ? chip('off') : '') }], customers, { empty: 'No customers yet.' })}</div>`);
});
R(/^\/customers\/(\d+)$/, 'customers', async ([id]) => {
  const { customer: c, orders } = await api(`/api/admin/customers/${id}`);
  acts['cu-dis'] = async () => { if (auth.user.role !== 'owner') return toast('Only the owner can disable accounts.', 'err'); await tick(() => api(`/api/admin/users/${c.id}/status`, { method: 'POST', body: { disabled: !c.disabled } }), 'Updated'); };
  return P(c.username, html`<div class="panel"><dl class="kv2"><dt>Email</dt><dd>${c.email} ${chip(c.emailVerified ? 'on' : 'pending')}</dd><dt>Name</dt><dd>${c.fullName || '—'}</dd><dt>Phone</dt><dd>${c.phone || '—'}</dd><dt>Joined</dt><dd>${dateFmt(c.createdAt)}</dd></dl></div>
    <div class="panel"><h3>Orders</h3>${table([{ h: 'Order', f: (o) => html`<a href="#/orders/${o.number}">${o.number}</a>` }, { h: 'Date', f: (o) => dateFmt(o.createdAt) }, { h: 'Status', f: (o) => chip(o.status) }, { h: 'Total', f: (o) => money(o.total) }], orders, { empty: 'No orders.' })}</div>`, html`<a class="btn ghost" href="#/customers">← Customers</a>${auth.user.role === 'owner' ? html`<button class="btn danger" data-do="cu-dis">${c.disabled ? 'Enable account' : 'Disable account'}</button>` : ''}`);
});

// ================= support tickets =================
R(/^\/tickets$/, 'support', async (_, q) => {
  const st = q.get('status') || '';
  const { tickets, counts: c } = await api(`/api/admin/tickets${st ? `?status=${st}` : ''}`);
  return P('Support tickets', html`<div class="tabs"><a href="#/tickets" class="${!st ? 'on' : ''}">All</a>${['open', 'in_progress', 'resolved', 'closed'].map((s) => html`<a href="#/tickets?status=${s}" class="${st === s ? 'on' : ''}">${s.replace('_', ' ')} (${c[s] || 0})</a>`)}</div><div class="panel">${table([{ h: 'Ticket', f: (t) => html`<a href="#/tickets/${t.number}"><strong>${t.subject}</strong></a><div class="muted">${t.number} · ${t.category}</div>` }, { h: 'Customer', f: (t) => t.customer.username }, { h: 'Order', f: (t) => t.orderNumber || '—' }, { h: 'Assigned', f: (t) => t.assignee || '—' }, { h: 'Status', f: (t) => chip(t.status) }, { h: 'Updated', f: (t) => ago(t.updatedAt) }], tickets, { empty: 'No tickets.' })}</div>`);
});
R(/^\/tickets\/([\w-]+)$/, 'support', async ([n], _, main) => {
  const [{ ticket: t }, { staff }] = await Promise.all([api(`/api/admin/tickets/${n}`), api('/api/admin/support-staff')]);
  let image = null;
  main.innerHTML = P(t.subject, html`<div class="cols-3-2"><div><div class="panel">${t.replies.map((r) => html`<div class="msg ${r.isStaff ? 'staff' : ''}"><small>${r.isStaff ? `Staff · ${r.author}` : r.author} · ${dateFmt(r.createdAt)}</small>${r.body.split('\n').map((l) => html`${l}<br>`)}${r.image ? html`<a href="${r.image}" target="_blank" rel="noopener"><img src="${r.image}" alt="Attachment"></a>` : ''}</div>`)}</div>
    <form class="panel" id="rf"><h3>Reply to ${t.customer.username}</h3><label class="fl"><textarea name="body" rows="5" required placeholder="Write your reply…"></textarea></label><div class="mfoot" style="justify-content:space-between"><button type="button" class="btn ghost sm" id="att">Attach image</button><button class="btn gold">Send reply</button></div></form></div>
    <div class="panel"><h3>Details</h3><dl class="kv2"><dt>Ticket</dt><dd>${t.number}</dd><dt>Customer</dt><dd>${t.customer.name || t.customer.username}<br><a href="mailto:${t.customer.email}">${t.customer.email}</a></dd><dt>Category</dt><dd>${t.category}</dd><dt>Order</dt><dd>${t.orderNumber ? html`<a href="#/orders/${t.orderNumber}">${t.orderNumber}</a>` : '—'}</dd></dl>
      <label class="fl" style="margin-top:14px"><span>Status</span><select id="ts">${['open', 'in_progress', 'resolved', 'closed'].map((s) => html`<option value="${s}" ${t.status === s ? 'selected' : ''}>${s.replace('_', ' ')}</option>`)}</select></label>
      <label class="fl" style="margin-top:10px"><span>Assigned to</span><select id="ta"><option value="">Unassigned</option>${staff.map((s) => html`<option value="${s.id}" ${t.assignedTo === s.id ? 'selected' : ''}>${s.username}</option>`)}</select></label></div></div>`, html`<a class="btn ghost" href="#/tickets">← Tickets</a>`).toString();
  $('#att').onclick = async () => { const [f] = await chooseFile(); if (f) { try { image = (await uploadImage(f)).url; toast('Image attached'); } catch (e) { toast(errMsg(e), 'err'); } } };
  $('#rf').onsubmit = async (e) => { e.preventDefault(); try { await api(`/api/admin/tickets/${t.number}/reply`, { method: 'POST', body: { body: e.target.body.value, image } }); toast('Reply sent'); route(); } catch (er) { toast(errMsg(er), 'err'); } };
  const patch = (body) => api(`/api/admin/tickets/${t.number}`, { method: 'PATCH', body }).then(() => toast('Ticket updated')).catch((e) => toast(errMsg(e), 'err'));
  $('#ts').onchange = (e) => patch({ status: e.target.value }); $('#ta').onchange = (e) => patch({ assignedTo: e.target.value ? Number(e.target.value) : null });
});

// ================= analytics =================
const rsFmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
function rangeBar(kind, q) {
  const r = q.get('range') || 'daily', from = q.get('from') || '', to = q.get('to') || '';
  setTimeout(() => $('#rg')?.addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; location.hash = `#/analytics/${kind}?range=${f.range.value}&from=${f.from.value}&to=${f.to.value}`; }), 0);
  return html`<form class="bar" id="rg"><select name="range" aria-label="Group by">${['daily', 'weekly', 'monthly', 'yearly'].map((x) => html`<option value="${x}" ${r === x ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`)}</select><label>From <input type="date" name="from" value="${from}"></label><label>To <input type="date" name="to" value="${to}"></label><button class="btn sm">Apply</button></form>`;
}
R(/^\/analytics\/sales$/, 'analytics', async (_, q) => {
  const d = await api(`/api/admin/analytics/sales?${new URLSearchParams({ range: q.get('range') || 'daily', from: q.get('from') || '', to: q.get('to') || '' })}`); const L = d.series.map((r) => r.bucket);
  return P('Sales analytics', html`${rangeBar('sales', q)}<div class="stats"><div class="stat"><span>Paid revenue</span><strong>${money(d.totals.paid)}</strong></div><div class="stat"><span>Awaiting payment</span><strong>${money(d.totals.pending)}</strong></div><div class="stat"><span>Orders (not cancelled)</span><strong>${d.totals.orders}</strong></div></div>
    <div class="panel"><h3>Revenue</h3>${chart(L, [{ name: 'Paid', color: '#0D0D0D', values: d.series.map((r) => r.paidRevenue / 100) }, { name: 'Awaiting payment', color: '#D4AF37', values: d.series.map((r) => r.pendingRevenue / 100) }], { fmt: rsFmt })}</div>
    <div class="panel"><h3>Orders</h3>${chart(L, [{ name: 'Orders', color: '#0D0D0D', values: d.series.map((r) => r.orders) }, { name: 'Cancelled', color: '#b3261e', values: d.series.map((r) => r.cancelled) }], { type: 'line' })}</div><p class="muted">Cancelled orders are never counted as revenue. Days are grouped in Indian Standard Time.</p>`);
});
R(/^\/analytics\/customers$/, 'analytics', async (_, q) => {
  const d = await api(`/api/admin/analytics/customers?${new URLSearchParams({ range: q.get('range') || 'daily', from: q.get('from') || '', to: q.get('to') || '' })}`);
  const L = [...new Set([...d.customers.map((r) => r.bucket), ...d.orders.map((r) => r.bucket)])].sort(); const at = (a, b) => a.find((r) => r.bucket === b)?.count || 0;
  return P('Customer analytics', html`${rangeBar('customers', q)}<div class="stats"><div class="stat"><span>Total customers</span><strong>${d.total}</strong></div><div class="stat"><span>Email verified</span><strong>${d.verified}</strong></div></div><div class="panel"><h3>Customer & order growth</h3>${chart(L, [{ name: 'New customers', color: '#D4AF37', values: L.map((b) => at(d.customers, b)) }, { name: 'Orders', color: '#0D0D0D', values: L.map((b) => at(d.orders, b)) }], { type: 'line' })}</div>`);
});
R(/^\/analytics\/products$/, 'analytics', async (_, q) => {
  const d = await api(`/api/admin/analytics/products?${new URLSearchParams({ from: q.get('from') || '', to: q.get('to') || '' })}`);
  return P('Product analytics', html`${rangeBar('products', q)}<div class="stats"><div class="stat"><span>Stock value (at selling price)</span><strong>${money(d.stockValue)}</strong></div></div>
    <div class="cols2"><div class="panel"><h3>Best-selling products</h3>${table([{ h: 'Product', f: (r) => r.name }, { h: 'Units', f: (r) => r.units }, { h: 'Revenue', cls: 'right', f: (r) => money(r.revenue) }], d.best, { empty: 'No sales in this period.' })}</div>
      <div class="panel"><h3>Category performance</h3>${chart(d.categories.map((c) => c.name), [{ name: 'Revenue', color: '#0D0D0D', values: d.categories.map((c) => c.revenue / 100) }], { fmt: rsFmt })}</div></div>
    <div class="panel"><h3>Inventory movement</h3>${chart(d.inventoryTrend.map((r) => r.bucket), [{ name: 'Units added', color: '#14532d', values: d.inventoryTrend.map((r) => r.added) }, { name: 'Units removed', color: '#b3261e', values: d.inventoryTrend.map((r) => r.removed) }])}</div>`);
});

// ================= owner: admins, roles, security, audit =================
R(/^\/admins$/, 'owner', async () => {
  const d = await api('/api/admin/admins');
  const permOpts = d.allPermissions.map((p) => [p, p]);
  acts['ad-invite'] = () => formModal({ title: 'Invite an admin', wide: false, fields: [{ name: 'email', label: 'Authorised email', type: 'select', options: d.allowlist, wide: true, help: 'Only addresses in the server’s ADMIN_EMAILS list can be invited. The person gets a one-time link by email and must set their own password.' }, { name: 'permissions', label: 'Permissions', type: 'multi', options: permOpts, wide: true }], values: { permissions: d.defaultPermissions },
    onSubmit: async (v) => { const r = await api('/api/admin/admins/invite', { method: 'POST', body: v }); if (r.devInviteLink) modal('Invitation created (development)', html`<p>Email delivery isn’t configured, so here is the link. In production it is only emailed.</p><input class="inp" readonly value="${r.devInviteLink}" onclick="this.select()">`); else toast('Invitation emailed'); reload(); } });
  acts['ad-edit'] = (b) => { const a = d.admins.find((x) => x.id === Number(b.dataset.id)); formModal({ title: `Permissions — ${a.username}`, wide: false, fields: [{ name: 'permissions', label: 'Permissions', type: 'multi', options: permOpts, wide: true }, { name: 'notifyOrders', label: 'Email me about new orders', type: 'checkbox', wide: true }], values: a, onSubmit: async (v) => { await api(`/api/admin/admins/${a.id}`, { method: 'PATCH', body: v }); toast('Saved'); reload(); } }); };
  acts['ad-del'] = async (b) => { if (confirm('Remove this admin? They keep a customer account but lose all dashboard access immediately.')) await tick(() => api(`/api/admin/admins/${b.dataset.id}`, { method: 'DELETE' }), 'Admin removed'); };
  acts['inv-rev'] = async (b) => tick(() => api(`/api/admin/invites/${b.dataset.id}`, { method: 'DELETE' }), 'Invitation revoked');
  return P('Admin accounts', html`<div class="panel">${table([{ h: 'Account', f: (a) => html`<strong>${a.username}</strong><div class="muted">${a.email}</div>` }, { h: 'Role', f: (a) => chip(a.role) }, { h: 'Permissions', f: (a) => (a.role === 'owner' ? 'Full access' : a.permissions.join(', ') || 'none') }, { h: '', cls: 'right nowrap', f: (a) => (a.role === 'owner' ? '' : html`<button class="btn sm" data-do="ad-edit" data-id="${a.id}">Permissions</button> <button class="btn sm danger" data-do="ad-del" data-id="${a.id}">Remove</button>`) }], d.admins)}</div>
    <div class="panel"><h3>Pending invitations</h3>${table([{ h: 'Email', f: (i) => i.email }, { h: 'Expires', f: (i) => dateFmt(i.expiresAt) }, { h: '', cls: 'right', f: (i) => html`<button class="btn sm danger" data-do="inv-rev" data-id="${i.id}">Revoke</button>` }], d.invites, { empty: 'No pending invitations.' })}</div>
    <div class="warn-box">Registering with an authorised email never grants admin rights by itself. Only an invitation from the owner, accepted through the emailed link, does.</div>`, html`<button class="btn gold" data-do="ad-invite">+ Invite admin</button>`);
});
R(/^\/roles$/, 'owner', async () => {
  const d = await api('/api/admin/admins'); const admins = d.admins.filter((a) => a.role === 'admin');
  acts['perm-toggle'] = async (b) => { const a = admins.find((x) => x.id === Number(b.dataset.id)); const set = new Set(a.permissions); b.checked ? set.add(b.dataset.p) : set.delete(b.dataset.p); try { const r = await api(`/api/admin/admins/${a.id}`, { method: 'PATCH', body: { permissions: [...set] } }); a.permissions = r.admin.permissions; toast('Permission updated'); } catch (e) { b.checked = !b.checked; throw e; } };
  return P('Roles & permissions', html`<div class="panel"><h3>Permission matrix</h3>${!admins.length ? html`<div class="empty-box">No admins yet. Invite one from Admin Accounts.</div>` : html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Permission</th>${admins.map((a) => html`<th>${a.username}</th>`)}</tr></thead><tbody>${d.allPermissions.map((p) => html`<tr><td><strong>${p}</strong></td>${admins.map((a) => html`<td><input type="checkbox" data-do="perm-toggle" data-id="${a.id}" data-p="${p}" ${a.permissions.includes(p) ? 'checked' : ''} aria-label="${a.username} ${p}"></td>`)}</tr>`)}</tbody></table></div>`}</div>
    <div class="panel"><h3>What each role can do</h3><p><strong>Owner</strong> (single account) — everything, including admin accounts, website settings, security settings and audit logs.</p><p><strong>Admin</strong> — only the areas ticked above. Admins can never create or remove admins, change the owner, or touch security settings; the server enforces this on every request.</p></div>`);
});
R(/^\/security$/, 'owner', async (_, __, main) => {
  const d = await api('/api/admin/security');
  const fs = [{ name: 'max_failed_logins', label: 'Failed logins before lockout', type: 'number', min: 3, max: 20 }, { name: 'lockout_minutes', label: 'Lockout duration (minutes)', type: 'number', min: 1 }, { name: 'session_days', label: 'Session length (days)', type: 'number', min: 1, max: 60 }, { name: 'min_password_length', label: 'Minimum password length', type: 'number', min: 8, max: 64 }];
  acts['sec-rev'] = async (b) => tick(() => api('/api/admin/security/revoke-sessions', { method: 'POST', body: b.dataset.u ? { userId: Number(b.dataset.u) } : {} }), 'Sessions revoked');
  main.innerHTML = P('Security settings', html`<div class="cols2"><form class="panel" id="sf3"><h3>Authentication policy</h3>${formHtml(fs, d.security)}<div class="mfoot"><button class="btn gold">Save</button></div></form>
    <div class="panel"><h3>Active staff sessions</h3>${table([{ h: 'User', f: (s) => s.username }, { h: 'IP', f: (s) => s.ip }, { h: 'Last seen', f: (s) => ago(s.lastSeen) }], d.sessions)}<p style="margin-top:12px"><button class="btn danger sm" data-do="sec-rev">Sign out all admins</button></p></div></div>
    <div class="panel"><h3>Built-in protections</h3><p class="muted" style="margin:0">scrypt password hashing · HttpOnly SameSite cookies · CSRF tokens · per-IP and per-account rate limits · account lockout · server-side permission checks · validated image uploads · audit log of every admin action.</p></div>`).toString();
  $('#sf3').onsubmit = async (e) => { e.preventDefault(); try { await api('/api/admin/security', { method: 'PUT', body: collect(e.target, fs) }); toast('Security settings saved'); } catch (er) { showFieldErrors(e.target, er.fields); toast(errMsg(er), 'err'); } };
});
R(/^\/audit$/, 'owner', async (_, q) => {
  const { logs, total } = await api(`/api/admin/audit?q=${encodeURIComponent(q.get('q') || '')}&pageSize=100`);
  setTimeout(() => $('#aq')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = `#/audit?q=${encodeURIComponent(e.target.value)}`; }), 0);
  return P('Audit logs', html`<div class="bar"><input id="aq" placeholder="Filter by action, person or id…" value="${q.get('q') || ''}" style="min-width:300px"><span class="muted">${total} entries</span></div><div class="panel">${table([{ h: 'When', cls: 'nowrap', f: (l) => dateFmt(l.createdAt) }, { h: 'Who', f: (l) => l.actor || 'system' }, { h: 'Action', f: (l) => html`<strong>${l.action}</strong>` }, { h: 'Target', f: (l) => `${l.entity || ''} ${l.entityId || ''}` }, { h: 'Details', f: (l) => (l.meta ? JSON.stringify(l.meta) : '') }, { h: 'IP', f: (l) => l.ip }], logs, { empty: 'No activity yet.' })}</div>`);
});
R(/^\/sections$/, 'sections', async (_, q, main) => builderPage(main, { P, can, acts, reload, tick }));

// ================= boot =================
async function boot() {
  const { path, q } = hashParts();
  if (!auth.user) { await loadMe(); }
  if (!auth.user || !isStaff(auth.user)) {
    if (path === '/setup') return setupScreen();
    if (path === '/accept-invite') return inviteScreen(q.get('token'));
    return loginScreen(auth.user && !isStaff(auth.user) ? 'This account does not have dashboard access.' : '');
  }
  shell(); if (!window.__wi) { window.__wi = true; installWidgetHandlers(document.body); } await refreshCounts(); startStream(); setInterval(refreshCounts, 90_000); route();
}
boot();
