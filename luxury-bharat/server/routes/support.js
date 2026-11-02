import { GET, POST, PATCH, bad, notFound, v, limit, readBody, HttpError, safeDecodeURIComponent } from '../lib/http.js';
import { get, all, run, tx, now } from '../lib/db.js';
import { requireAuth, requirePerm } from '../lib/auth.js';
import { notify, genNumber, audit } from '../lib/core.js';
import { saveUpload, MAX_UPLOAD } from '../lib/images.js';
import { sendMail, emailHtml, fireAndForget } from '../lib/mail.js';
import { config } from '../config.js';

export const TICKET_CATEGORIES = ['Order issue', 'Delivery', 'Payment', 'Returns & refunds', 'Product question', 'Account', 'Other'];
export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

export async function handleImageUpload(ctx) {
  const ct = String(ctx.req.headers['content-type'] || '');
  if (!ct.startsWith('image/')) throw new HttpError(415, 'Send the image as the request body with an image/* content type.');
  const buf = await readBody(ctx.req, MAX_UPLOAD + 1024);
  const m = await saveUpload(buf, { originalName: safeDecodeURIComponent(ctx.req.headers['x-filename'] || ''), userId: ctx.user.id });
  return { media: { id: m.id, url: m.url, thumbUrl: m.thumb_url, width: m.width, height: m.height, bytes: m.bytes } };
}
POST('/api/uploads', requireAuth, limit('upload-cust', 15, 60 * 60_000), handleImageUpload);

// An attachment must be an image this same user uploaded (stops linking to arbitrary files).
const ownedImage = (url, userId) => {
  if (!url) return null;
  if (!get('SELECT 1 FROM media WHERE url=? AND uploaded_by=?', url, userId)) throw bad('Attachment not found. Upload the image again.', { image: 'Invalid attachment' });
  return url;
};
const ticketOut = (t, withReplies) => {
  const u = get('SELECT username,email,full_name FROM users WHERE id=?', t.user_id);
  const out = { id: t.id, number: t.number, category: t.category, subject: t.subject, orderNumber: t.order_number, status: t.status, assignedTo: t.assigned_to, createdAt: t.created_at, updatedAt: t.updated_at, customer: { username: u.username, email: u.email, name: u.full_name } };
  if (t.assigned_to) out.assignee = get('SELECT username FROM users WHERE id=?', t.assigned_to)?.username;
  if (withReplies) out.replies = all('SELECT r.id,r.body,r.image,r.is_staff isStaff,r.created_at createdAt,u.username author FROM ticket_replies r JOIN users u ON u.id=r.user_id WHERE r.ticket_id=? ORDER BY r.id', t.id);
  return out;
};

// ---------- customer ----------
GET('/api/tickets/meta', () => ({ categories: TICKET_CATEGORIES }));
GET('/api/tickets', requireAuth, (ctx) => ({ tickets: all('SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC', ctx.user.id).map((t) => ({ ...ticketOut(t), replyCount: get('SELECT COUNT(*) n FROM ticket_replies WHERE ticket_id=?', t.id).n })) }));
GET('/api/tickets/:number', requireAuth, (ctx) => {
  const t = get('SELECT * FROM tickets WHERE number=? AND user_id=?', ctx.params.number, ctx.user.id);
  if (!t) throw notFound('Ticket not found.');
  return { ticket: ticketOut(t, true) };
});
POST('/api/tickets', requireAuth, limit('ticket', 10, 60 * 60_000), (ctx) => {
  if (!ctx.user.emailVerified) throw new HttpError(403, 'Verify your email to contact support.');
  const category = v.oneOf(ctx.body.category, 'category', TICKET_CATEGORIES);
  const subject = v.str(ctx.body.subject, 'subject', { min: 4, max: 140 });
  const body = v.str(ctx.body.body, 'body', { min: 10, max: 4000 });
  const image = ownedImage(ctx.body.image, ctx.user.id);
  let orderNumber = null;
  if (ctx.body.orderNumber) { const o = get('SELECT number FROM orders WHERE number=? AND user_id=?', String(ctx.body.orderNumber), ctx.user.id); if (!o) throw bad('That order was not found on your account.', { orderNumber: 'Not found' }); orderNumber = o.number; }
  const t = tx(() => {
    const id = Number(run('INSERT INTO tickets(number,user_id,category,subject,order_number,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', genNumber('TK'), ctx.user.id, category, subject, orderNumber, now(), now()).lastInsertRowid);
    run('INSERT INTO ticket_replies(ticket_id,user_id,is_staff,body,image,created_at) VALUES (?,?,0,?,?,?)', id, ctx.user.id, body, image, now());
    return get('SELECT * FROM tickets WHERE id=?', id);
  });
  notify('ticket.new', 'NEW SUPPORT TICKET', `${t.number} · ${ctx.user.username} · ${subject}`, 'ticket', t.id, { number: t.number, category, subject, customer: ctx.user.username }, 'support');
  return { ticket: ticketOut(t, true) };
});
POST('/api/tickets/:number/reply', requireAuth, limit('ticket-reply', 30, 60 * 60_000), (ctx) => {
  const t = get('SELECT * FROM tickets WHERE number=? AND user_id=?', ctx.params.number, ctx.user.id);
  if (!t) throw notFound('Ticket not found.');
  if (t.status === 'closed') throw bad('This ticket is closed. Open a new ticket if you still need help.');
  const body = v.str(ctx.body.body, 'body', { min: 2, max: 4000 });
  const image = ownedImage(ctx.body.image, ctx.user.id);
  const rid = Number(run('INSERT INTO ticket_replies(ticket_id,user_id,is_staff,body,image,created_at) VALUES (?,?,0,?,?,?)', t.id, ctx.user.id, body, image, now()).lastInsertRowid);
  run("UPDATE tickets SET status=CASE WHEN status='resolved' THEN 'open' ELSE status END, updated_at=? WHERE id=?", now(), t.id);
  notify('ticket.reply', 'Customer replied to a ticket', `${t.number} · ${ctx.user.username}`, 'ticket', `${t.id}:${rid}`, { number: t.number }, 'support');
  return { ticket: ticketOut(get('SELECT * FROM tickets WHERE id=?', t.id), true) };
});

// ---------- staff ----------
const sup = requirePerm('support');
GET('/api/admin/tickets', sup, (ctx) => {
  const where = [], p = [];
  if (ctx.query.status && TICKET_STATUSES.includes(ctx.query.status)) { where.push('t.status=?'); p.push(ctx.query.status); }
  if (ctx.query.q) { where.push('(t.subject LIKE ? OR t.number LIKE ? OR u.username LIKE ? OR u.email LIKE ?)'); const q = `%${String(ctx.query.q).slice(0, 60)}%`; p.push(q, q, q, q); }
  const rows = all(`SELECT t.* FROM tickets t JOIN users u ON u.id=t.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT 200`, ...p);
  return { tickets: rows.map((t) => ticketOut(t)), counts: Object.fromEntries(all('SELECT status, COUNT(*) n FROM tickets GROUP BY status').map((r) => [r.status, r.n])) };
});
GET('/api/admin/tickets/:number', sup, (ctx) => {
  const t = get('SELECT * FROM tickets WHERE number=?', ctx.params.number);
  if (!t) throw notFound('Ticket not found.');
  return { ticket: ticketOut(t, true) };
});
POST('/api/admin/tickets/:number/reply', sup, (ctx) => {
  const t = get('SELECT * FROM tickets WHERE number=?', ctx.params.number);
  if (!t) throw notFound('Ticket not found.');
  const body = v.str(ctx.body.body, 'body', { min: 2, max: 4000 });
  const image = ctx.body.image ? (get('SELECT 1 FROM media WHERE url=?', ctx.body.image) ? ctx.body.image : (() => { throw bad('Attachment not found.'); })()) : null;
  const rid = Number(run('INSERT INTO ticket_replies(ticket_id,user_id,is_staff,body,image,created_at) VALUES (?,?,1,?,?,?)', t.id, ctx.user.id, body, image, now()).lastInsertRowid);
  run("UPDATE tickets SET status=CASE WHEN status='open' THEN 'in_progress' ELSE status END, assigned_to=COALESCE(assigned_to,?), updated_at=? WHERE id=?", ctx.user.id, now(), t.id);
  audit(ctx, 'ticket.reply', 'ticket', t.number);
  const cust = get('SELECT email FROM users WHERE id=?', t.user_id);
  fireAndForget(sendMail({ eventKey: `ticket:${t.id}:reply:${rid}`, to: cust.email, subject: `Reply on ticket ${t.number}`, text: `We replied to your ticket "${t.subject}":\n\n${body}\n\nView: ${config.appUrl}/account/tickets/${t.number}`, html: emailHtml('We replied to your ticket', [t.subject, body], { url: `${config.appUrl}/account/tickets/${t.number}`, label: 'View ticket' }) }));
  return { ticket: ticketOut(get('SELECT * FROM tickets WHERE id=?', t.id), true) };
});
PATCH('/api/admin/tickets/:number', sup, (ctx) => {
  const t = get('SELECT * FROM tickets WHERE number=?', ctx.params.number);
  if (!t) throw notFound('Ticket not found.');
  const status = ctx.body.status !== undefined ? v.oneOf(ctx.body.status, 'status', TICKET_STATUSES) : t.status;
  let assigned = t.assigned_to;
  if (ctx.body.assignedTo !== undefined) {
    if (ctx.body.assignedTo === null) assigned = null;
    else {
      const a = get("SELECT id FROM users WHERE id=? AND (role='owner' OR (role='admin' AND id IN (SELECT user_id FROM user_permissions WHERE permission='support')))", Number(ctx.body.assignedTo));
      if (!a) throw bad('That person cannot be assigned tickets.', { assignedTo: 'Invalid assignee' });
      assigned = a.id;
    }
  }
  run('UPDATE tickets SET status=?, assigned_to=?, updated_at=? WHERE id=?', status, assigned, now(), t.id);
  audit(ctx, 'ticket.update', 'ticket', t.number, { status, assigned });
  return { ticket: ticketOut(get('SELECT * FROM tickets WHERE id=?', t.id), true) };
});
GET('/api/admin/support-staff', sup, () => ({ staff: all("SELECT id,username,role FROM users WHERE role='owner' OR (role='admin' AND id IN (SELECT user_id FROM user_permissions WHERE permission='support')) ORDER BY role DESC, username") }));
