import { all, run, now } from './db.js';
import { config } from '../config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const emailHtml = (title, bodyLines, cta) => `<div style="font-family:Georgia,serif;background:#F5F5F5;padding:32px"><div style="max-width:560px;margin:auto;background:#0D0D0D;color:#F5F5F5;padding:32px"><div style="color:#D4AF37;font-size:22px;letter-spacing:2px">LUXURY BHARAT</div><h2 style="font-weight:400">${esc(title)}</h2>${bodyLines.map((l) => `<p style="font-family:Arial,sans-serif;line-height:1.6;color:#d8d8d8">${esc(l)}</p>`).join('')}${cta ? `<p><a href="${esc(cta.url)}" style="display:inline-block;background:#D4AF37;color:#0D0D0D;padding:12px 22px;text-decoration:none;font-family:Arial,sans-serif">${esc(cta.label)}</a></p>` : ''}</div></div>`;

/**
 * Sends an email at most once per eventKey (dedupe). Provider = Resend when RESEND_API_KEY is set,
 * otherwise the message is stored in email_log (the "dev outbox") and printed to the console.
 */
export async function sendMail({ eventKey, to, subject, text, html }) {
  const provider = config.resendKey ? 'resend' : 'dev-outbox';
  const ins = run('INSERT OR IGNORE INTO email_log(event_key,to_email,subject,body,provider,status,created_at) VALUES (?,?,?,?,?,?,?)', eventKey, to, subject, text, provider, 'queued', now());
  if (!ins.changes) return { duplicate: true };
  const id = ins.lastInsertRowid;
  if (provider === 'dev-outbox') {
    run("UPDATE email_log SET status='logged' WHERE id=?", id);
    if (!config.prod) console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}\n`);
    return { sent: false, provider };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text, html }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    run("UPDATE email_log SET status='sent' WHERE id=?", id);
    return { sent: true, provider };
  } catch (e) {
    run("UPDATE email_log SET status='failed', error=? WHERE id=?", String(e.message).slice(0, 300), id);
    console.error('[mail] send failed:', e.message);
    return { sent: false, provider, error: e.message };
  }
}
export const fireAndForget = (p) => p.catch((e) => console.error('[mail] error', e));
export const devOutbox = (n = 50) => all('SELECT id,event_key,to_email,subject,body,status,provider,created_at FROM email_log ORDER BY id DESC LIMIT ?', n);
