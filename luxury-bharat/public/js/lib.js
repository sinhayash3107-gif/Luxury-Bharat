// Shared by the storefront and the admin dashboard.
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const one = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(one).join('') : v === false || v == null ? '' : esc(v));
/** Tagged template: every interpolated value is HTML-escaped unless it is already a Safe fragment. */
export function html(strings, ...vals) { let out = strings[0]; vals.forEach((v, i) => { out += one(v) + strings[i + 1]; }); return new Safe(out); }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const mount = (el, tpl) => { el.innerHTML = tpl.toString(); };

export const inr = (paise) => '₹' + (Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const dateFmt = (iso, withTime = true) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
export const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return dateFmt(iso, false); };
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export const auth = { user: null, csrf: null };
export class ApiError extends Error { constructor(status, message, fields) { super(message); this.status = status; this.fields = fields || {}; } }
export async function api(path, { method = 'GET', body, raw: rawBody, headers = {} } = {}) {
  const h = { ...headers };
  if (auth.csrf && method !== 'GET') h['X-CSRF-Token'] = auth.csrf;
  let payload;
  if (rawBody) payload = rawBody; else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, { method, headers: h, body: payload, credentials: 'same-origin' }); }
  catch { throw new ApiError(0, 'Network problem. Check your connection and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong.', data.fields);
  return data;
}
export async function loadMe() { const d = await api('/api/me'); auth.user = d.user; auth.csrf = d.csrf; return d.user; }
export async function uploadImage(file) {
  if (!file) return null;
  if (file.size > 8 * 1024 * 1024) throw new ApiError(400, 'Image is larger than 8 MB.');
  const d = await api(auth.user && ['owner', 'admin'].includes(auth.user.role) ? '/api/admin/uploads' : '/api/uploads', { method: 'POST', raw: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) } });
  return d.media;
}
export function toast(msg, kind = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('div'); t.className = `toast ${kind}`; t.textContent = msg; box.append(t);
  setTimeout(() => t.classList.add('out'), 3600); setTimeout(() => t.remove(), 4000);
}
export const errMsg = (e) => (e && e.message) || 'Something went wrong.';
/** Shows field-level server errors under inputs named after the field. */
export function showFieldErrors(form, fields = {}) {
  $$('.field-err', form).forEach((n) => n.remove());
  for (const [k, msg] of Object.entries(fields)) {
    const input = form.elements[k]; if (!input) continue;
    const s = document.createElement('small'); s.className = 'field-err'; s.textContent = msg; input.closest('label,.field')?.append(s) ?? input.after(s);
  }
}
export const icons = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2Z"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};
