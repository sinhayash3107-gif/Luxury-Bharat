import { html, raw, api, auth, loadMe, inr, dateFmt, icons, toast, errMsg, showFieldErrors, uploadImage, $, $$ } from './lib.js';
import { S, actions, headerRefresh, refreshCart, mergeGuestData, loadWishlist, productCard } from './app.js';

const dayLabel = (s) => s.replace('_', ' ');
const statusChip = (s) => html`<span class="status ${s}">${dayLabel(s)}</span>`;

/** Wires a form: validation errors from the server are shown under the matching inputs. */
function wire(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = form.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
    showFieldErrors(form);
    try { await fn(Object.fromEntries(new FormData(form))); }
    catch (err) { showFieldErrors(form, err.fields); toast(errMsg(err), 'err'); }
    finally { if (btn) btn.disabled = false; }
  });
}
const field = (label, name, o = {}) => html`<label class="f"><span>${label}</span><input class="in" name="${name}" type="${o.type || 'text'}" ${o.required === false ? '' : 'required'} autocomplete="${o.ac || 'off'}" ${o.value != null ? html`value="${o.value}"` : ''} ${o.ph ? html`placeholder="${o.ph}"` : ''} ${o.max ? html`maxlength="${o.max}"` : ''} ${o.min ? html`minlength="${o.min}"` : ''} ${o.pattern ? html`pattern="${o.pattern}"` : ''}></label>`;

async function afterAuth(user, csrf, next) {
  auth.user = user; auth.csrf = csrf; await mergeGuestData(); await loadWishlist(); headerRefresh.fn();
  return next || '/account';
}
const requireLogin = (nav, path) => { if (!auth.user) { nav(`/login?next=${encodeURIComponent(path)}`, { replace: true }); return true; } return false; };

export function accountRoutes({ route, setPage, navigate }) {
  const shell = (inner, title) => setPage(html`<div class="page-light light"><div class="wrap">${inner}</div></div>`, title);

  actions.resend = async () => { try { await api('/api/auth/resend-verification', { method: 'POST' }); toast('Verification email sent'); } catch (e) { toast(errMsg(e), 'err'); } };
  actions.logout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* already signed out */ }
    await loadMe(); S.wish = new Set(); await refreshCart(); headerRefresh.fn(); toast('Signed out'); navigate('/');
  };

  // ----- auth pages -----
  route(/^\/login\/?$/, ({ query }) => {
    shell(html`<div class="narrow"><h1>Welcome back</h1><p class="muted">Sign in to view orders, saved pieces and support.</p>
      <form id="f" novalidate>${field('Username or email', 'identifier', { ac: 'username' })}${field('Password', 'password', { type: 'password', ac: 'current-password' })}<button class="btn dark solid block" type="submit">Sign in</button></form>
      <p class="alt"><a href="/forgot">Forgot your password?</a></p><p class="alt">New here? <a href="/register${query.get('next') ? `?next=${encodeURIComponent(query.get('next'))}` : ''}">Create an account</a></p></div>`, 'Sign in');
    wire($('#f'), async (d) => { const r = await api('/api/auth/login', { method: 'POST', body: d }); const next = await afterAuth(r.user, r.csrf, query.get('next')); toast(`Welcome back, ${r.user.username}`); navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/account'); });
  });
  route(/^\/register\/?$/, ({ query }) => {
    shell(html`<div class="narrow"><h1>Create your account</h1><p class="muted">We’ll email a link to verify your address — you need it before your first order.</p>
      <form id="f" novalidate>${field('Full name', 'fullName', { required: false, ac: 'name', max: 80 })}${field('Username', 'username', { ac: 'username', min: 3, max: 30 })}${field('Email', 'email', { type: 'email', ac: 'email' })}${field('Password', 'password', { type: 'password', ac: 'new-password', min: 10 })}
      <p class="muted" style="margin-top:-8px;font-size:13px">At least 10 characters, with letters and numbers.</p><button class="btn dark solid block" type="submit">Create account</button></form><p class="alt">Already registered? <a href="/login">Sign in</a></p></div>`, 'Create account');
    wire($('#f'), async (d) => { const r = await api('/api/auth/register', { method: 'POST', body: d }); const next = await afterAuth(r.user, r.csrf, query.get('next')); toast('Account created — check your email to verify it.'); navigate(next); });
  });
  route(/^\/forgot\/?$/, () => {
    shell(html`<div class="narrow"><h1>Reset your password</h1><p class="muted">Enter your email and we’ll send a reset link valid for one hour.</p><form id="f" novalidate>${field('Email', 'email', { type: 'email', ac: 'email' })}<button class="btn dark solid block" type="submit">Send reset link</button></form><div id="done"></div></div>`, 'Forgot password');
    wire($('#f'), async (d) => { const r = await api('/api/auth/forgot', { method: 'POST', body: d }); $('#f').hidden = true; $('#done').innerHTML = html`<div class="note">${r.message}</div>`.toString(); });
  });
  route(/^\/reset\/?$/, ({ query }) => {
    const token = query.get('token') || '';
    shell(html`<div class="narrow"><h1>Choose a new password</h1><form id="f" novalidate>${field('New password', 'password', { type: 'password', ac: 'new-password', min: 10 })}<button class="btn dark solid block" type="submit">Update password</button></form></div>`, 'Reset password');
    wire($('#f'), async (d) => { await api('/api/auth/reset', { method: 'POST', body: { token, password: d.password } }); toast('Password updated. Sign in with your new password.'); navigate('/login'); });
  });
  route(/^\/verify\/?$/, async ({ query }) => {
    shell(html`<div class="narrow"><h1>Verifying…</h1></div>`, 'Verify email');
    try { await api('/api/auth/verify', { method: 'POST', body: { token: query.get('token') } }); if (auth.user) await loadMe(); headerRefresh.fn(); shell(html`<div class="narrow"><h1>Email verified</h1><p>Thank you — your account is ready for orders.</p><a class="btn dark solid" href="/shop">Start shopping</a></div>`, 'Email verified'); }
    catch (e) { shell(html`<div class="narrow"><h1>Link not valid</h1><p>${errMsg(e)}</p><a class="btn dark" href="/account">Go to your account</a></div>`, 'Verify email'); }
  });

  // ----- account area -----
  const acct = (active, inner, title) => {
    const tabs = [['/account', 'Profile'], ['/account/orders', 'Orders'], ['/account/wishlist', 'Wishlist'], ['/account/tickets', 'Support']];
    shell(html`<div class="acct"><nav aria-label="Account">${tabs.map(([h, t]) => html`<a href="${h}" class="${active === h ? 'on' : ''}">${t}</a>`)}${auth.user.role !== 'customer' ? html`<a href="/admin">Dashboard</a>` : ''}<button style="text-align:left;padding:11px 14px;color:#8c1d18" data-act="logout">Sign out</button></nav><div>${inner}</div></div>`, title);
  };
  route(/^\/account\/?$/, ({ }) => {
    if (requireLogin(navigate, '/account')) return;
    const u = auth.user;
    acct('/account', html`<h1 style="font-size:48px;margin-bottom:20px">Hello, ${u.fullName || u.username}</h1>
      ${u.emailVerified ? html`<div class="note" style="margin-bottom:18px">✓ Email verified</div>` : html`<div class="note warn" style="margin-bottom:18px">Your email isn’t verified yet — you can’t place orders until it is. <button class="link" data-act="resend">Resend verification email</button></div>`}
      <div class="card"><h3>Profile</h3><form id="pf" novalidate>${field('Full name', 'fullName', { required: false, value: u.fullName || '', max: 80 })}${field('Username', 'username', { value: u.username, min: 3, max: 30 })}<label class="f"><span>Email</span><input class="in" value="${u.email}" disabled></label>${field('Mobile number', 'phone', { required: false, value: u.phone || '', max: 10, pattern: '[6-9][0-9]{9}', ph: '10-digit number' })}<button class="btn dark solid" type="submit">Save changes</button></form></div>
      <div class="card"><h3>Change password</h3><form id="pw" novalidate>${field('Current password', 'current', { type: 'password', ac: 'current-password' })}${field('New password', 'password', { type: 'password', ac: 'new-password', min: 10 })}<button class="btn dark" type="submit">Update password</button></form></div>`, 'Your account');
    wire($('#pf'), async (d) => { const r = await api('/api/account/profile', { method: 'PATCH', body: d }); auth.user = r.user; headerRefresh.fn(); toast('Profile saved'); });
    wire($('#pw'), async (d) => { const r = await api('/api/account/password', { method: 'POST', body: d }); auth.csrf = r.csrf; $('#pw').reset(); toast('Password updated'); });
  });
  route(/^\/account\/orders\/?$/, async () => {
    if (requireLogin(navigate, '/account/orders')) return;
    const { orders } = await api('/api/orders');
    acct('/account/orders', html`<h1 style="font-size:44px;margin-bottom:18px">Your orders</h1>${!orders.length ? html`<div class="card empty"><h3>No orders yet</h3><p class="muted">When you place an order it will show up here.</p><a class="btn dark" href="/shop">Start shopping</a></div>` :
      html`<div class="card">${orders.map((o) => html`<div class="order-row"><div><a href="/account/orders/${o.number}"><strong>${o.number}</strong></a><div class="muted">${dateFmt(o.createdAt)} · ${o.items.reduce((n, i) => n + i.qty, 0)} items</div></div>${statusChip(o.status)}<strong>${inr(o.total)}</strong></div>`)}</div>`}`, 'Your orders');
  });
  const orderView = (o, { confirm = false } = {}) => html`${confirm ? html`<div class="note" style="margin-bottom:18px"><strong>Thank you — order ${o.number} is placed.</strong> We’ve emailed you the details.</div>` : ''}
    <h1 style="font-size:40px;margin-bottom:6px">Order ${o.number}</h1><p class="muted">Placed ${dateFmt(o.createdAt)}</p>
    <div style="display:flex;gap:10px;margin:14px 0 20px">${statusChip(o.status)}<span class="status ${o.paymentStatus}">payment ${o.paymentStatus}${o.paymentMethod === 'test' ? ' (test)' : ''}${o.paymentMethod === 'cod' ? ' · cash on delivery' : ''}</span></div>
    ${o.paymentMethod === 'test' && o.paymentStatus === 'pending' && o.status !== 'cancelled' ? html`<div class="note warn" style="margin-bottom:18px"><strong>Test payment mode.</strong> No real money moves. <button class="btn dark solid" style="margin-left:10px;min-height:38px" data-act="testpay" data-n="${o.number}">Complete test payment</button></div>` : ''}
    ${o.status === 'cancelled' && o.paymentStatus === 'paid' ? html`<div class="note warn" style="margin-bottom:18px">This order was cancelled. Your refund will be processed by our team — contact support if you need an update.</div>` : ''}
    <div class="card"><h3>Items</h3>${o.items.map((i) => html`<div class="line" style="grid-template-columns:64px 1fr auto"><img src="${i.image || ''}" alt="" style="width:64px;height:80px"><div><div class="nm">${i.name}</div><div class="muted">${inr(i.unitPrice)} × ${i.qty}</div></div><strong>${inr(i.unitPrice * i.qty)}</strong></div>`)}
      <div class="sum" style="margin-top:14px"><div><span>Subtotal</span><span>${inr(o.subtotal)}</span></div>${o.discount ? html`<div class="save"><span>Discount ${o.couponCode ? `(${o.couponCode})` : ''}</span><span>−${inr(o.discount)}</span></div>` : ''}<div><span>Shipping</span><span>${o.shipping ? inr(o.shipping) : 'Free'}</span></div><div class="tot"><span>Total</span><span>${inr(o.total)}</span></div></div></div>
    <div class="card"><h3>Delivery address</h3><p style="margin:0;line-height:1.7">${o.shipTo.name}<br>${o.shipTo.line1}<br>${o.shipTo.city}, ${o.shipTo.state} ${o.shipTo.pincode}<br>Phone ${o.shipTo.phone}</p></div>
    <div class="card"><h3>Tracking</h3><ul class="timeline">${[...o.history].reverse().map((h) => html`<li><strong style="text-transform:capitalize">${h.status}</strong>${h.note ? html` — <span class="muted">${h.note}</span>` : ''}<div class="muted" style="font-size:13px">${dateFmt(h.createdAt)}</div></li>`)}</ul></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">${['pending', 'confirmed'].includes(o.status) ? html`<button class="btn dark" data-act="cancel-order" data-n="${o.number}">Cancel order</button>` : ''}<a class="btn dark" href="/account/tickets/new?order=${o.number}">Get help with this order</a></div>`;
  async function showOrder(n, opts = {}) {
    const { order } = await api(`/api/orders/${n}`);
    acct('/account/orders', orderView(order, opts), `Order ${n}`);
    actions.testpay = async (el) => { try { await api(`/api/orders/${el.dataset.n}/test-pay`, { method: 'POST' }); toast('Test payment recorded'); showOrder(n, opts); } catch (e) { toast(errMsg(e), 'err'); } };
    actions['cancel-order'] = async (el) => { if (!confirm('Cancel this order? Items go back into stock.')) return; try { await api(`/api/orders/${el.dataset.n}/cancel`, { method: 'POST' }); toast('Order cancelled'); showOrder(n); } catch (e) { toast(errMsg(e), 'err'); } };
  }
  route(/^\/account\/orders\/([\w-]+)\/?$/, ({ params }) => { if (requireLogin(navigate, location.pathname)) return; return showOrder(params[0]); });
  route(/^\/order\/([\w-]+)\/?$/, ({ params }) => { if (requireLogin(navigate, location.pathname)) return; return showOrder(params[0], { confirm: true }); });
  route(/^\/account\/wishlist\/?$/, async () => {
    if (!auth.user) { const ids = JSON.parse(localStorage.getItem('lb_wish') || '[]'); const items = ids.length ? (await api(`/api/products/by-ids?ids=${ids.join(',')}`)).items : [];
      shell(html`<div style="padding:50px 0 90px"><h1 style="font-size:48px;margin-bottom:8px">Wishlist</h1><p class="muted"><a class="link" href="/login?next=/account/wishlist">Sign in</a> to keep your wishlist across devices.</p>${items.length ? html`<div class="prod-grid" style="margin-top:24px">${items.map(productCard)}</div>` : html`<div class="empty"><h3>Nothing saved yet</h3><a class="btn dark" href="/shop">Browse the collection</a></div>`}</div>`, 'Wishlist'); return; }
    const { items } = await api('/api/wishlist');
    acct('/account/wishlist', html`<h1 style="font-size:44px;margin-bottom:18px">Wishlist</h1>${items.length ? html`<div class="prod-grid">${items.map(productCard)}</div>` : html`<div class="card empty"><h3>Nothing saved yet</h3><p class="muted">Tap the heart on any piece to keep it here.</p><a class="btn dark" href="/shop">Browse the collection</a></div>`}`, 'Wishlist');
  });

  // ----- support tickets -----
  route(/^\/account\/tickets\/?$/, async () => {
    if (requireLogin(navigate, '/account/tickets')) return;
    const { tickets } = await api('/api/tickets');
    acct('/account/tickets', html`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px"><h1 style="font-size:44px">Support</h1><a class="btn dark solid" href="/account/tickets/new">New ticket</a></div>
      ${!tickets.length ? html`<div class="card empty"><h3>No tickets</h3><p class="muted">Need help with an order? Open a ticket and we’ll reply here and by email.</p></div>` : html`<div class="card">${tickets.map((t) => html`<div class="order-row"><div><a href="/account/tickets/${t.number}"><strong>${t.subject}</strong></a><div class="muted">${t.number} · ${t.category} · updated ${dateFmt(t.updatedAt)}</div></div>${statusChip(t.status)}<span class="muted">${t.replyCount} msgs</span></div>`)}</div>`}`, 'Support');
  });
  route(/^\/account\/tickets\/new\/?$/, async ({ query }) => {
    if (requireLogin(navigate, '/account/tickets/new')) return;
    const [meta, os] = await Promise.all([api('/api/tickets/meta'), api('/api/orders')]); let image = null;
    acct('/account/tickets', html`<h1 style="font-size:44px;margin-bottom:18px">Open a ticket</h1><div class="card"><form id="f" novalidate>
      <label class="f"><span>What do you need help with?</span><select class="in" name="category">${meta.categories.map((c) => html`<option ${query.get('order') && c === 'Order issue' ? 'selected' : ''}>${c}</option>`)}</select></label>
      <label class="f"><span>Related order (optional)</span><select class="in" name="orderNumber"><option value="">None</option>${os.orders.map((o) => html`<option value="${o.number}" ${query.get('order') === o.number ? 'selected' : ''}>${o.number} — ${inr(o.total)}</option>`)}</select></label>
      ${field('Subject', 'subject', { max: 140, ph: 'My order hasn’t arrived' })}<label class="f"><span>Describe the problem</span><textarea class="in" name="body" required minlength="10" maxlength="4000"></textarea></label>
      <label class="f"><span>Attach an image (optional)</span><input type="file" id="file" accept="image/jpeg,image/png,image/webp"><small id="fname" class="muted"></small></label><button class="btn dark solid" type="submit">Send ticket</button></form></div>`, 'New ticket');
    $('#file').addEventListener('change', async (e) => { try { const m = await uploadImage(e.target.files[0]); image = m?.url || null; $('#fname').textContent = m ? 'Attached ✓' : ''; } catch (err) { toast(errMsg(err), 'err'); e.target.value = ''; } });
    wire($('#f'), async (d) => { const r = await api('/api/tickets', { method: 'POST', body: { ...d, image } }); toast('Ticket sent'); navigate(`/account/tickets/${r.ticket.number}`); });
  });
  route(/^\/account\/tickets\/([\w-]+)\/?$/, async ({ params }) => {
    if (requireLogin(navigate, location.pathname)) return;
    const load = async () => {
      const { ticket: t } = await api(`/api/tickets/${params[0]}`); let image = null;
      acct('/account/tickets', html`<a class="link" href="/account/tickets">← All tickets</a><h1 style="font-size:36px;margin:14px 0 6px">${t.subject}</h1><p class="muted">${t.number} · ${t.category}${t.orderNumber ? html` · order <a class="link" href="/account/orders/${t.orderNumber}">${t.orderNumber}</a>` : ''}</p><p>${statusChip(t.status)}</p>
        <div class="thread" style="margin:22px 0">${t.replies.map((r) => html`<div class="msg ${r.isStaff ? 'staff' : ''}"><small>${r.isStaff ? 'Luxury Bharat support' : 'You'} · ${dateFmt(r.createdAt)}</small>${r.body.split('\n').map((l) => html`${l}<br>`)}${r.image ? html`<a href="${r.image}" target="_blank" rel="noopener"><img src="${r.image}" alt="Attachment"></a>` : ''}</div>`)}</div>
        ${t.status === 'closed' ? html`<div class="note">This ticket is closed. <a class="link" href="/account/tickets/new">Open a new one</a> if you still need help.</div>` : html`<form id="rf" novalidate><label class="f"><span>Reply</span><textarea class="in" name="body" required maxlength="4000"></textarea></label><label class="f"><span>Attach an image</span><input type="file" id="rfile" accept="image/jpeg,image/png,image/webp"></label><button class="btn dark solid" type="submit">Send reply</button></form>`}`, t.subject);
      $('#rfile')?.addEventListener('change', async (e) => { try { image = (await uploadImage(e.target.files[0]))?.url || null; } catch (err) { toast(errMsg(err), 'err'); e.target.value = ''; } });
      if ($('#rf')) wire($('#rf'), async (d) => { await api(`/api/tickets/${t.number}/reply`, { method: 'POST', body: { body: d.body, image } }); toast('Reply sent'); load(); });
    };
    await load();
  });

  // ----- checkout -----
  route(/^\/checkout\/?$/, async () => {
    if (requireLogin(navigate, '/checkout')) return;
    await refreshCart();
    const [st, addr] = await Promise.all([api('/api/meta/states'), api('/api/account/address')]);
    const pay = S.home.payments, u = auth.user;
    const D = { name: u.fullName || u.username, state: '', city: '', line1: '', pincode: '', phone: u.phone || '', ...(addr.address || {}) };
    let step = 0, method = pay.razorpay ? 'razorpay' : pay.test ? 'test' : pay.cod ? 'cod' : '', coupon = '', busy = false;
    const STEPS = [['State', 'state'], ['City', 'city'], ['Flat / House address', 'line1'], ['PIN code', 'pincode'], ['Phone number', 'phone'], ['Payment']];
    const CHECK = { state: (v) => st.states.includes(v) || 'Choose your state.', city: (v) => /^[\p{L}][\p{L} .'-]+$/u.test(v.trim()) || 'Enter your city.', line1: (v) => v.trim().length >= 5 || 'Enter your flat / house number and street (at least 5 characters).', pincode: (v) => /^[1-9]\d{5}$/.test(v) || 'Enter a 6-digit PIN code.', phone: (v) => /^[6-9]\d{9}$/.test(v) || 'Enter a 10-digit Indian mobile number.' };
    const draw = () => {
      const c = S.cart, key = STEPS[step][1];
      if (!c.items.length) { shell(html`<div class="empty" style="padding:100px 0"><h3>Your bag is empty</h3><a class="btn dark" href="/shop">Continue shopping</a></div>`, 'Checkout'); return; }
      shell(html`<div class="co"><div><h1 style="font-size:20px;font-family:var(--sans);margin-bottom:16px">Checkout</h1>
        ${!u.emailVerified ? html`<div class="note warn" style="margin-bottom:18px">Verify your email before placing an order. <button class="link" data-act="resend">Resend the link</button> — then refresh this page.</div>` : ''}
        <div class="steps">${STEPS.map(([t], i) => html`<button class="${i < step ? 'done' : ''} ${i === step ? 'on' : ''}" data-step="${i}" ${i > step ? 'disabled' : ''}>${i + 1}. ${t}</button>`)}</div>
        ${key ? html`<form class="q-step" id="qf" novalidate><h2>${STEPS[step][0]}</h2>
          ${key === 'state' ? html`<select class="in" name="v" autofocus required aria-label="State"><option value="">Select state</option>${st.states.map((s) => html`<option ${D.state === s ? 'selected' : ''}>${s}</option>`)}</select>` :
            key === 'line1' ? html`<textarea class="in" name="v" rows="3" autofocus aria-label="Flat or house address" placeholder="Flat 4B, Palm Residency, 12 MG Road">${D.line1}</textarea>` :
            html`<input class="in" name="v" value="${D[key]}" autofocus aria-label="${STEPS[step][0]}" ${key === 'pincode' ? 'inputmode="numeric" maxlength="6"' : key === 'phone' ? 'inputmode="numeric" maxlength="10"' : ''} autocomplete="${key === 'city' ? 'address-level2' : key === 'phone' ? 'tel-national' : 'postal-code'}">`}
          <small class="field-err" id="qe" role="alert"></small><div style="display:flex;gap:10px;margin-top:22px">${step ? html`<button type="button" class="btn dark" data-act="co-back">Back</button>` : ''}<button class="btn dark solid" type="submit">${step === 4 ? 'Review & pay' : 'Continue'}</button></div></form>` :
        html`<div class="q-step"><h2>Payment</h2><p class="muted">Delivering to ${D.name}, ${D.line1}, ${D.city}, ${D.state} ${D.pincode} · ${D.phone} <button class="link" data-act="co-back">Edit</button></p>
          ${pay.razorpay ? html`<label class="pay-opt"><input type="radio" name="m" value="razorpay" ${method === 'razorpay' ? 'checked' : ''}><span><strong>Pay online</strong><br><small class="muted">UPI, cards, netbanking — via Razorpay</small></span></label>` : ''}
          ${pay.test ? html`<label class="pay-opt"><input type="radio" name="m" value="test" ${method === 'test' ? 'checked' : ''}><span><strong>Test payment</strong> <span class="status pending">development</span><br><small class="muted">A simulated payment. No real money moves. Not available on the live store.</small></span></label>` : ''}
          ${pay.cod ? html`<label class="pay-opt"><input type="radio" name="m" value="cod" ${method === 'cod' ? 'checked' : ''}><span><strong>Cash on delivery</strong><br><small class="muted">Pay when your order arrives.</small></span></label>` : ''}
          ${!method ? html`<div class="note warn">Payments aren’t set up yet. The owner needs to enable a payment method in the dashboard.</div>` : ''}
          <div style="display:flex;gap:10px;margin-top:22px"><button class="btn dark" data-act="co-back">Back</button><button class="btn dark solid" data-act="co-place" ${!method || busy || !u.emailVerified ? 'disabled' : ''}>${busy ? 'Placing order…' : `Place order · ${inr(c.total)}`}</button></div></div>`}</div>
        <aside><div class="card"><h3>Order summary</h3>${c.items.map((i) => html`<div class="line" style="grid-template-columns:56px 1fr auto"><img src="${i.product.thumb}" alt="" style="width:56px;height:70px"><div><div class="nm" style="font-size:16px">${i.product.name}</div><div class="muted">Qty ${i.qty}</div>${!i.available ? html`<div class="stock-low">Only ${i.maxQty} left</div>` : ''}</div><strong>${inr(i.lineTotal)}</strong></div>`)}
          <form id="cf" style="display:flex;gap:8px;margin:16px 0"><input class="in" name="c" value="${coupon}" placeholder="Coupon code" aria-label="Coupon code"><button class="btn dark" type="submit" style="padding:0 18px">Apply</button></form>${c.couponError ? html`<small class="field-err">${c.couponError}</small>` : ''}
          <div class="sum">${c.productSavings ? html`<div class="save"><span>Product savings</span><span>${inr(c.productSavings)}</span></div>` : ''}<div><span>Subtotal</span><span>${inr(c.subtotal)}</span></div>${c.couponDiscount ? html`<div class="save"><span>Coupon ${c.coupon}</span><span>−${inr(c.couponDiscount)}</span></div>` : ''}<div><span>Shipping</span><span>${c.shipping ? inr(c.shipping) : 'Free'}</span></div><div class="tot"><span>Total</span><span>${inr(c.total)}</span></div></div></div>
          ${D.state && step > 0 ? html`<div class="card"><h3>Delivery</h3><p style="margin:0;line-height:1.6">${D.name}<br>${D.line1 || '…'}<br>${[D.city, D.state, D.pincode].filter(Boolean).join(', ')}${D.phone ? html`<br>${D.phone}` : ''}</p></div>` : ''}</aside></div>`, 'Checkout');
      $('#qf')?.addEventListener('submit', (e) => { e.preventDefault(); const v = e.target.v.value.trim(); const ok = CHECK[key](v); if (ok !== true) { $('#qe').textContent = ok; return; } D[key] = v; step++; draw(); $('#qf input, #qf select, #qf textarea')?.focus(); });
      $$('[data-step]').forEach((b) => b.addEventListener('click', () => { step = Number(b.dataset.step); draw(); }));
      $$('input[name=m]').forEach((r) => r.addEventListener('change', () => { method = r.value; }));
      $('#cf').addEventListener('submit', async (e) => { e.preventDefault(); coupon = e.target.c.value.trim(); try { S.cart = await api(`/api/cart${coupon ? `?coupon=${encodeURIComponent(coupon)}` : ''}`); } catch (er) { toast(errMsg(er), 'err'); } draw(); });
    };
    actions['co-back'] = () => { step = Math.max(0, step - 1); draw(); };
    actions['co-place'] = async () => {
      if (busy) return; busy = true; draw();
      try {
        const r = await api('/api/orders', { method: 'POST', body: { address: D, paymentMethod: method, coupon: S.cart.coupon || undefined } });
        await refreshCart();
        if (r.razorpay) return razorpay(r, navigate);
        navigate(`/order/${r.order.number}`);
      } catch (e) { busy = false; toast(errMsg(e), 'err'); await refreshCart(); draw(); }
    };
    draw();
  });
}

// Razorpay Checkout (needs real keys; verified server-side with an HMAC signature before the order is marked paid).
function razorpay(r, navigate) {
  const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  s.onload = () => new window.Razorpay({ key: r.razorpay.keyId, amount: r.razorpay.amount, currency: 'INR', order_id: r.razorpay.orderId, name: S.home.store.name, description: `Order ${r.order.number}`,
    handler: async (resp) => { try { await api(`/api/orders/${r.order.number}/razorpay/verify`, { method: 'POST', body: resp }); } catch (e) { toast(errMsg(e), 'err'); } navigate(`/order/${r.order.number}`); },
    modal: { ondismiss: () => navigate(`/order/${r.order.number}`) }, prefill: { email: auth.user.email } }).open();
  s.onerror = () => { toast('Could not load the payment window.', 'err'); navigate(`/order/${r.order.number}`); };
  document.head.append(s);
}
