import crypto from 'node:crypto';
import { GET, POST, PUT, DEL, HttpError, bad, notFound, v, limit, rupees, safeEqual } from '../lib/http.js';
import { get, all, run, tx, now, J } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { getSetting, notify, genNumber, publicProducts } from '../lib/core.js';
import { sendMail, emailHtml, fireAndForget } from '../lib/mail.js';
import { config } from '../config.js';

export const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
export const ORDER_FLOW = ['pending', 'confirmed', 'packed', 'shipped', 'delivered'];
const MAX_LINE_QTY = 10;

// ---------- pricing: the ONLY place totals are calculated. Client-supplied prices are never read. ----------
export function validateCoupon(code, subtotal) {
  const c = get('SELECT * FROM coupons WHERE code=?', code);
  const t = now();
  if (!c || !c.active) throw bad('That coupon code is not valid.', { coupon: 'Invalid code' });
  if ((c.starts_at && c.starts_at > t) || (c.ends_at && c.ends_at < t)) throw bad('That coupon is not active right now.', { coupon: 'Not active' });
  if (c.max_uses != null && c.used_count >= c.max_uses) throw bad('That coupon has been fully redeemed.', { coupon: 'Fully redeemed' });
  if (subtotal < c.min_subtotal) throw bad(`Add items worth ${rupees(c.min_subtotal)} or more to use this coupon.`, { coupon: 'Minimum not met' });
  const discount = c.type === 'percent' ? Math.floor((subtotal * Math.min(c.value, 100)) / 100) : Math.min(c.value, subtotal);
  return { coupon: c, discount };
}
export function priceLines(lines, couponCode) {
  const merged = new Map();
  for (const l of lines) { const id = Number(l.productId ?? l.id), q = Math.floor(Number(l.qty)); if (Number.isInteger(id) && id > 0 && q > 0) merged.set(id, Math.min((merged.get(id) || 0) + q, MAX_LINE_QTY)); }
  const rows = merged.size ? all(`SELECT * FROM products WHERE status='active' AND id IN (${[...merged.keys()].map(() => '?').join(',')})`, ...merged.keys()) : [];
  const pub = new Map(publicProducts(rows).map((p) => [p.id, p]));
  const items = []; let subtotal = 0, list = 0;
  for (const r of rows) {
    const qty = merged.get(r.id), unit = r.discount_price ?? r.price, available = r.stock >= qty;
    items.push({ product: pub.get(r.id), qty, unitPrice: unit, lineTotal: unit * qty, available, maxQty: Math.min(r.stock, MAX_LINE_QTY) });
    subtotal += unit * qty; list += r.price * qty;
  }
  let discount = 0, coupon = null, couponError = null;
  if (couponCode) { try { const r = validateCoupon(String(couponCode).trim(), subtotal); discount = r.discount; coupon = r.coupon.code; } catch (e) { couponError = e.message; } }
  const store = getSetting('store');
  const after = subtotal - discount;
  const shipping = !items.length || after >= store.free_shipping_above ? 0 : store.shipping_flat;
  return { items, itemCount: items.reduce((n, i) => n + i.qty, 0), listTotal: list, subtotal, productSavings: list - subtotal, couponDiscount: discount, coupon, couponError, shipping, total: after + shipping, allAvailable: items.every((i) => i.available) };
}

// ---------- cart ----------
const dbCart = (uid) => all('SELECT product_id productId, qty FROM cart_items WHERE user_id=?', uid);
GET('/api/cart', requireAuth, (ctx) => priceLines(dbCart(ctx.user.id), ctx.query.coupon));
POST('/api/cart/price', (ctx) => priceLines(Array.isArray(ctx.body.items) ? ctx.body.items.slice(0, 50) : [], ctx.body.coupon));
PUT('/api/cart/items', requireAuth, (ctx) => {
  const id = v.int(ctx.body.productId, 'productId', { min: 1 }), qty = v.int(ctx.body.qty, 'qty', { min: 0, max: MAX_LINE_QTY });
  if (qty === 0) run('DELETE FROM cart_items WHERE user_id=? AND product_id=?', ctx.user.id, id);
  else {
    const p = get("SELECT stock FROM products WHERE id=? AND status='active'", id);
    if (!p) throw notFound('This product is no longer available.');
    if (p.stock < 1) throw new HttpError(409, 'This product is out of stock.');
    run('INSERT INTO cart_items VALUES (?,?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET qty=excluded.qty, updated_at=excluded.updated_at', ctx.user.id, id, Math.min(qty, p.stock), now());
  }
  return priceLines(dbCart(ctx.user.id));
});
DEL('/api/cart/items/:id', requireAuth, (ctx) => { run('DELETE FROM cart_items WHERE user_id=? AND product_id=?', ctx.user.id, Number(ctx.params.id)); return priceLines(dbCart(ctx.user.id)); });
POST('/api/cart/merge', requireAuth, (ctx) => {
  for (const l of (Array.isArray(ctx.body.items) ? ctx.body.items : []).slice(0, 50)) {
    const id = Number(l.id), q = Math.floor(Number(l.qty));
    const p = Number.isInteger(id) && q > 0 ? get("SELECT stock FROM products WHERE id=? AND status='active' AND stock>0", id) : null;
    if (p) run('INSERT INTO cart_items VALUES (?,?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET qty=MIN(?, qty+excluded.qty), updated_at=excluded.updated_at', ctx.user.id, id, Math.min(q, p.stock, MAX_LINE_QTY), now(), Math.min(p.stock, MAX_LINE_QTY));
  }
  return priceLines(dbCart(ctx.user.id));
});
POST('/api/coupons/validate', (ctx) => { const r = priceLines(Array.isArray(ctx.body.items) ? ctx.body.items : [], ctx.body.coupon); if (r.couponError) throw bad(r.couponError, { coupon: r.couponError }); return { coupon: r.coupon, discount: r.couponDiscount, total: r.total }; });

// ---------- inventory primitives (atomic; the only code that changes stock) ----------
export function adjustStock(productId, delta, reason, { refType, refId, actorId } = {}) {
  return tx(() => {
    const r = delta < 0
      ? run('UPDATE products SET stock=stock+?, updated_at=? WHERE id=? AND stock+?>=0', delta, now(), productId, delta)
      : run('UPDATE products SET stock=stock+?, updated_at=? WHERE id=?', delta, now(), productId);
    if (!r.changes) throw new HttpError(409, 'Not enough stock for that change.');
    const p = get('SELECT stock, name, low_stock_threshold FROM products WHERE id=?', productId);
    run('INSERT INTO inventory_movements(product_id,delta,stock_after,reason,ref_type,ref_id,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?)', productId, delta, p.stock, reason, refType ?? null, refId == null ? null : String(refId), actorId ?? null, now());
    return p;
  });
}
function lowStockAlert(productId, stock, threshold, name) {
  if (stock <= threshold) notify('stock.low', stock === 0 ? `Out of stock: ${name}` : `Low stock: ${name}`, `${stock} left (alert at ${threshold}).`, 'product', `${productId}:${Math.floor(Date.now() / 86_400_000)}`, { productId, stock }, 'inventory');
}

// ---------- order creation ----------
const addrSchema = (b, user) => {
  const state = v.str(b.state, 'state', { max: 60 });
  if (!STATES.includes(state)) throw bad('Choose a valid state.', { state: 'Invalid state' });
  const city = v.str(b.city, 'city', { min: 2, max: 60 });
  if (!/^[\p{L}][\p{L} .'-]+$/u.test(city)) throw bad('Enter a valid city name.', { city: 'Invalid city' });
  const line1 = v.str(b.line1, 'line1', { min: 5, max: 200 });
  const pincode = v.str(b.pincode, 'pincode', { max: 6 });
  if (!/^[1-9]\d{5}$/.test(pincode)) throw bad('Enter a valid 6-digit PIN code.', { pincode: 'Invalid PIN code' });
  const phone = v.str(b.phone, 'phone', { max: 10 });
  if (!/^[6-9]\d{9}$/.test(phone)) throw bad('Enter a valid 10-digit Indian mobile number.', { phone: 'Invalid phone number' });
  const name = v.str(b.name || user.fullName || user.username, 'name', { min: 2, max: 80 });
  return { state, city, line1, pincode, phone, name };
};
const staffEmails = () => all("SELECT email FROM users WHERE disabled=0 AND (role='owner' OR (role='admin' AND notify_orders=1 AND id IN (SELECT user_id FROM user_permissions WHERE permission='orders')))").map((r) => r.email);

function orderDetail(o) {
  const items = all('SELECT product_id productId,name,sku,image,list_price listPrice,unit_price unitPrice,qty FROM order_items WHERE order_id=?', o.id);
  const history = all('SELECT status,note,created_at createdAt FROM order_status_history WHERE order_id=? ORDER BY id', o.id);
  const pay = get('SELECT provider,status,provider_order_id providerOrderId FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1', o.id);
  return { id: o.id, number: o.number, status: o.status, paymentMethod: o.payment_method, paymentStatus: o.payment_status, subtotal: o.subtotal, discount: o.discount, shipping: o.shipping, total: o.total, couponCode: o.coupon_code,
    customer: { name: o.customer_name, email: o.email }, shipTo: { name: o.ship_name, phone: o.ship_phone, state: o.ship_state, city: o.ship_city, line1: o.ship_line1, pincode: o.ship_pincode },
    items, history, payment: pay, createdAt: o.created_at, updatedAt: o.updated_at };
}
export { orderDetail };

POST('/api/orders', requireAuth, limit('checkout', 20, 60 * 60_000), async (ctx) => {
  const user = get('SELECT * FROM users WHERE id=?', ctx.user.id);
  if (!user.email_verified) throw new HttpError(403, 'Verify your email address before placing an order. Check your inbox, or resend the link from your account.');
  const addr = addrSchema(ctx.body.address || {}, ctx.user);
  const method = v.oneOf(ctx.body.paymentMethod, 'paymentMethod', ['razorpay', 'test', 'cod']);
  const store = getSetting('store');
  if (method === 'cod' && !store.cod_enabled) throw bad('Cash on delivery is not available.', { paymentMethod: 'Unavailable' });
  if (method === 'test' && config.paymentMode !== 'test') throw bad('Test payments are disabled.', { paymentMethod: 'Unavailable' });
  if (method === 'razorpay' && !(config.razorpay.keyId && config.razorpay.keySecret)) throw bad('Online payments are not configured yet.', { paymentMethod: 'Unavailable' });
  const couponCode = ctx.body.coupon ? String(ctx.body.coupon).trim() : null;

  const created = tx(() => {
    const lines = dbCart(user.id);
    if (!lines.length) throw bad('Your cart is empty.');
    const priced = priceLines(lines, couponCode);
    if (couponCode && priced.couponError) throw bad(priced.couponError, { coupon: priced.couponError });
    if (priced.items.length !== lines.length) throw new HttpError(409, 'Some items in your cart are no longer available. Review your cart and try again.');
    const low = [];
    for (const it of priced.items) {
      // Atomic guard: the UPDATE only succeeds while enough stock remains, so concurrent orders can never oversell.
      const r = run("UPDATE products SET stock=stock-?, sold_count=sold_count+?, updated_at=? WHERE id=? AND status='active' AND stock>=?", it.qty, it.qty, now(), it.product.id, it.qty);
      if (!r.changes) { const left = get('SELECT stock FROM products WHERE id=?', it.product.id)?.stock ?? 0; throw new HttpError(409, left ? `Only ${left} left of “${it.product.name}”. Reduce the quantity and try again.` : `“${it.product.name}” just sold out.`); }
    }
    let number, orderId;
    for (let i = 0; i < 5; i++) {
      number = genNumber('LB');
      try {
        orderId = Number(run('INSERT INTO orders(number,user_id,status,payment_method,payment_status,subtotal,discount,shipping,total,coupon_code,email,customer_name,ship_name,ship_phone,ship_state,ship_city,ship_line1,ship_pincode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          number, user.id, 'pending', method, 'pending', priced.subtotal, priced.couponDiscount, priced.shipping, priced.total, priced.coupon, user.email, user.full_name || user.username, addr.name, addr.phone, addr.state, addr.city, addr.line1, addr.pincode, now(), now()).lastInsertRowid);
        break;
      } catch (e) { if (!String(e.message).includes('UNIQUE') || i === 4) throw e; }
    }
    for (const it of priced.items) {
      run('INSERT INTO order_items(order_id,product_id,name,sku,image,list_price,unit_price,qty) VALUES (?,?,?,?,?,?,?,?)', orderId, it.product.id, it.product.name, it.product.sku, it.product.image, it.product.price, it.unitPrice, it.qty);
      const p = get('SELECT stock,low_stock_threshold FROM products WHERE id=?', it.product.id);
      run('INSERT INTO inventory_movements(product_id,delta,stock_after,reason,ref_type,ref_id,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?)', it.product.id, -it.qty, p.stock, 'order_placed', 'order', number, user.id, now());
      low.push({ id: it.product.id, name: it.product.name, ...p });
    }
    if (priced.coupon) { const r = run('UPDATE coupons SET used_count=used_count+1 WHERE code=? AND (max_uses IS NULL OR used_count<max_uses)', priced.coupon); if (!r.changes) throw bad('That coupon has just been fully redeemed.', { coupon: 'Fully redeemed' }); }
    run('INSERT INTO order_status_history(order_id,status,note,actor_id,created_at) VALUES (?,?,?,?,?)', orderId, 'pending', 'Order placed', user.id, now());
    run('INSERT INTO payments(order_id,provider,amount,status,created_at) VALUES (?,?,?,?,?)', orderId, method, priced.total, 'created', now());
    run('DELETE FROM cart_items WHERE user_id=?', user.id);
    // remember the address for next time
    if (!get('SELECT 1 FROM addresses WHERE user_id=? AND line1=? AND pincode=?', user.id, addr.line1, addr.pincode)) { run('UPDATE addresses SET is_default=0 WHERE user_id=?', user.id); run('INSERT INTO addresses(user_id,full_name,phone,state,city,line1,pincode,is_default,created_at) VALUES (?,?,?,?,?,?,?,1,?)', user.id, addr.name, addr.phone, addr.state, addr.city, addr.line1, addr.pincode, now()); }
    return { orderId, low, number };
  });

  const order = get('SELECT * FROM orders WHERE id=?', created.orderId);
  announceNewOrder(order);
  for (const p of created.low) lowStockAlert(p.id, p.stock, p.low_stock_threshold, p.name);

  const out = { order: orderDetail(order) };
  if (method === 'razorpay') {
    try { out.razorpay = await createRazorpayOrder(order); }
    catch (e) { cancelOrder(order.id, { note: 'Payment gateway error at checkout' }); console.error('[razorpay]', e.message); throw new HttpError(502, 'We could not start the payment. Your order was not placed; please try again.'); }
  }
  return out;
});

function announceNewOrder(o) {
  const items = all('SELECT name,qty,unit_price FROM order_items WHERE order_id=?', o.id);
  const summary = items.map((i) => `${i.qty} × ${i.name}`).join(', ');
  notify('order.new', 'NEW ORDER RECEIVED', `${o.number} · ${o.customer_name} · ${rupees(o.total)}`, 'order', o.id, { number: o.number, customer: o.customer_name, email: o.email, total: o.total, status: o.status, paymentStatus: o.payment_status, paymentMethod: o.payment_method, itemCount: items.length }, 'orders');
  const link = `${config.appUrl}/admin#/orders/${o.number}`;
  const addr = `${o.ship_name}, ${o.ship_line1}, ${o.ship_city}, ${o.ship_state} ${o.ship_pincode} (${o.ship_phone})`;
  for (const to of staffEmails()) {
    fireAndForget(sendMail({ eventKey: `order:${o.id}:new:${to}`, to, subject: `New order ${o.number} — ${rupees(o.total)}`,
      text: `NEW ORDER RECEIVED\nOrder: ${o.number}\nCustomer: ${o.customer_name} <${o.email}>\nTotal: ${rupees(o.total)} (${o.payment_method}, payment ${o.payment_status})\nItems: ${summary}\nShip to: ${addr}\nDashboard: ${link}`,
      html: emailHtml('New order received', [`Order ${o.number}`, `Customer: ${o.customer_name} (${o.email})`, `Total: ${rupees(o.total)} · ${o.payment_method} · payment ${o.payment_status}`, `Items: ${summary}`, `Ship to: ${addr}`], { url: link, label: 'Open in dashboard' }) }));
  }
  fireAndForget(sendMail({ eventKey: `order:${o.id}:confirmation`, to: o.email, subject: `Order ${o.number} received`,
    text: `Thank you for your order ${o.number}.\nTotal: ${rupees(o.total)}\nItems: ${summary}\nTrack it in your account: ${config.appUrl}/account/orders/${o.number}`,
    html: emailHtml('Thank you for your order', [`Order ${o.number}`, `Items: ${summary}`, `Total: ${rupees(o.total)}`], { url: `${config.appUrl}/account/orders/${o.number}`, label: 'Track your order' }) }));
}

// ---------- status transitions & cancellation ----------
export function cancelOrder(orderId, { actorId = null, note = 'Cancelled' } = {}) {
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id=?', orderId);
    if (!o) throw notFound('Order not found.');
    if (o.status === 'cancelled') return o;
    if (o.status === 'delivered') throw bad('A delivered order cannot be cancelled.');
    const r = run("UPDATE orders SET status='cancelled', updated_at=? WHERE id=? AND status NOT IN ('cancelled','delivered')", now(), orderId);
    if (!r.changes) return o;
    if (!o.stock_restored) {
      for (const it of all('SELECT product_id,qty FROM order_items WHERE order_id=?', orderId)) {
        if (!it.product_id) continue;
        run('UPDATE products SET stock=stock+?, sold_count=MAX(sold_count-?,0), updated_at=? WHERE id=?', it.qty, it.qty, now(), it.product_id);
        const p = get('SELECT stock FROM products WHERE id=?', it.product_id);
        run('INSERT INTO inventory_movements(product_id,delta,stock_after,reason,ref_type,ref_id,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?)', it.product_id, it.qty, p.stock, 'order_cancelled', 'order', o.number, actorId, now());
      }
      run('UPDATE orders SET stock_restored=1 WHERE id=?', orderId);
      if (o.coupon_code) run('UPDATE coupons SET used_count=MAX(used_count-1,0) WHERE code=?', o.coupon_code);
    }
    run('INSERT INTO order_status_history(order_id,status,note,actor_id,created_at) VALUES (?,?,?,?,?)', orderId, 'cancelled', note + (o.payment_status === 'paid' ? ' — refund due' : ''), actorId, now());
    return get('SELECT * FROM orders WHERE id=?', orderId);
  });
}

export function transitionOrder(orderId, next, { actorId, note } = {}) {
  const o = get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o) throw notFound('Order not found.');
  if (o.status === next) return o;
  if (next === 'cancelled') return afterTransition(cancelOrder(orderId, { actorId, note: note || 'Cancelled by store' }), next);
  if (o.status === 'cancelled' || o.status === 'delivered') throw bad(`A ${o.status} order cannot change status.`);
  const from = ORDER_FLOW.indexOf(o.status), to = ORDER_FLOW.indexOf(next);
  if (to === -1) throw bad('Unknown status.');
  if (to < from) throw bad('Orders cannot move backwards. Cancel and re-create if needed.');
  tx(() => {
    run('UPDATE orders SET status=?, updated_at=? WHERE id=?', next, now(), orderId);
    run('INSERT INTO order_status_history(order_id,status,note,actor_id,created_at) VALUES (?,?,?,?,?)', orderId, next, note || null, actorId ?? null, now());
    if (next === 'delivered' && o.payment_method === 'cod' && o.payment_status !== 'paid') { run("UPDATE orders SET payment_status='paid' WHERE id=?", orderId); run("UPDATE payments SET status='paid' WHERE order_id=?", orderId); }
  });
  return afterTransition(get('SELECT * FROM orders WHERE id=?', orderId), next);
}
function afterTransition(o, status) {
  fireAndForget(sendMail({ eventKey: `order:${o.id}:status:${status}`, to: o.email, subject: `Order ${o.number} is ${status}`,
    text: `Your order ${o.number} is now ${status}.\nTrack it: ${config.appUrl}/account/orders/${o.number}`,
    html: emailHtml(`Your order is ${status}`, [`Order ${o.number} is now ${status}.`], { url: `${config.appUrl}/account/orders/${o.number}`, label: 'Track your order' }) }));
  return o;
}

/** Cancels online-payment orders that were never paid, returning their stock. Runs every 5 minutes. */
export function expireUnpaidOrders(maxAgeMs = 30 * 60_000) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const stale = all("SELECT id FROM orders WHERE status='pending' AND payment_status='pending' AND payment_method IN ('razorpay','test') AND created_at < ?", cutoff);
  for (const o of stale) { try { cancelOrder(o.id, { note: 'Payment not completed in time' }); } catch (e) { console.error('[expire]', e.message); } }
  return stale.length;
}
setInterval(() => expireUnpaidOrders(), 5 * 60_000).unref();

// ---------- customer order endpoints ----------
const ownOrder = (ctx) => { const o = get('SELECT * FROM orders WHERE number=? AND user_id=?', ctx.params.number, ctx.user.id); if (!o) throw notFound('Order not found.'); return o; }; // other customers' orders look like they don't exist
GET('/api/orders', requireAuth, (ctx) => ({ orders: all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 100', ctx.user.id).map(orderDetail) }));
GET('/api/orders/:number', requireAuth, (ctx) => ({ order: orderDetail(ownOrder(ctx)) }));
POST('/api/orders/:number/cancel', requireAuth, limit('cancel', 20, 60 * 60_000), (ctx) => {
  const o = ownOrder(ctx);
  if (o.status === 'cancelled') return { order: orderDetail(o) }; // idempotent
  if (!['pending', 'confirmed'].includes(o.status)) throw bad('This order has already been packed or shipped and can no longer be cancelled here. Open a support ticket for help.');
  const done = cancelOrder(o.id, { actorId: ctx.user.id, note: 'Cancelled by customer' });
  afterTransition(done, 'cancelled');
  return { order: orderDetail(done) };
});
GET('/api/account/address', requireAuth, (ctx) => ({ address: get('SELECT full_name name,phone,state,city,line1,pincode FROM addresses WHERE user_id=? ORDER BY is_default DESC, id DESC LIMIT 1', ctx.user.id) || null }));
GET('/api/meta/states', () => ({ states: STATES }));

// ---------- payments ----------
export function markPaid(orderId, provider, { providerOrderId, providerPaymentId } = {}) {
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id=?', orderId);
    if (o.status === 'cancelled') throw bad('This order was cancelled (payment window expired). Please place a new order.');
    if (o.payment_status === 'paid') return o;
    run("UPDATE orders SET payment_status='paid', updated_at=? WHERE id=?", now(), orderId);
    run("UPDATE payments SET status='paid', provider_order_id=COALESCE(?,provider_order_id), provider_payment_id=? WHERE order_id=?", providerOrderId ?? null, providerPaymentId ?? null, orderId);
    run('INSERT INTO order_status_history(order_id,status,note,created_at) VALUES (?,?,?,?)', orderId, o.status, `Payment received (${provider})`, now());
    return get('SELECT * FROM orders WHERE id=?', orderId);
  });
}
POST('/api/orders/:number/test-pay', requireAuth, (ctx) => {
  if (config.paymentMode !== 'test') throw notFound();
  const o = ownOrder(ctx);
  if (o.payment_method !== 'test') throw bad('This order does not use the test payment method.');
  return { order: orderDetail(markPaid(o.id, 'TEST (not a real payment)')) };
});

async function createRazorpayOrder(o) {
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: o.total, currency: 'INR', receipt: o.number }) });
  if (!r.ok) throw new Error(`Razorpay ${r.status}`);
  const j = await r.json();
  run('UPDATE payments SET provider_order_id=?, status=? WHERE order_id=?', j.id, 'pending', o.id);
  return { keyId: config.razorpay.keyId, orderId: j.id, amount: o.total, currency: 'INR' };
}
POST('/api/orders/:number/razorpay/verify', requireAuth, limit('rzp-verify', 20, 15 * 60_000), (ctx) => {
  const o = ownOrder(ctx);
  const { razorpay_payment_id: pid, razorpay_order_id: oid, razorpay_signature: sig } = ctx.body;
  const pay = get("SELECT * FROM payments WHERE order_id=? AND provider='razorpay'", o.id);
  if (!pay || !pay.provider_order_id || pay.provider_order_id !== oid || !pid || !sig || !config.razorpay.keySecret) throw bad('Payment verification failed.');
  const expected = crypto.createHmac('sha256', config.razorpay.keySecret).update(`${oid}|${pid}`).digest('hex');
  if (!safeEqual(expected, String(sig))) throw bad('Payment verification failed.');
  return { order: orderDetail(markPaid(o.id, 'razorpay', { providerOrderId: oid, providerPaymentId: String(pid) })) };
});
