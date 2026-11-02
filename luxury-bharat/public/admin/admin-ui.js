import { html, raw, esc, api, auth, uploadImage, toast, errMsg, showFieldErrors, inr, $, $$ } from '/js/lib.js';

export const chip = (s) => html`<span class="chip ${String(s).replace(/\s/g, '_')}">${String(s).replace('_', ' ')}</span>`;
export const thumb = (url, size = 44) => url ? html`<img class="th" src="${url}" alt="" width="${size}" height="${size}" loading="lazy">` : html`<span class="th none" style="width:${size}px;height:${size}px"></span>`;

// ---------- form builder ----------
const attr = (f, v) => html`name="${f.name}" ${f.required ? 'required' : ''} ${f.max ? html`maxlength="${f.max}"` : ''} ${f.min != null ? html`min="${f.min}"` : ''} ${f.step ? html`step="${f.step}"` : ''} ${f.ph ? html`placeholder="${f.ph}"` : ''}`;
export function fieldHtml(f, v) {
  const help = f.help ? html`<small class="help">${f.help}</small>` : '';
  const lab = (inner) => html`<label class="fl ${f.wide ? 'wide' : ''}" data-f="${f.name}"><span>${f.label}${f.required ? ' *' : ''}</span>${inner}${help}</label>`;
  switch (f.type) {
    case 'textarea': return lab(html`<textarea ${attr(f)} rows="${f.rows || 4}">${v ?? ''}</textarea>`);
    case 'select': return lab(html`<select ${attr(f)}>${(f.options || []).map((o) => { const [val, l] = Array.isArray(o) ? o : [o, o]; return html`<option value="${val}" ${String(v ?? '') === String(val) ? 'selected' : ''}>${l}</option>`; })}</select>`);
    case 'checkbox': return html`<label class="ck ${f.wide ? 'wide' : ''}" data-f="${f.name}"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> <span>${f.label}</span>${help}</label>`;
    case 'range': return lab(html`<input type="range" ${attr(f)} min="${f.min ?? 0}" max="${f.max ?? 1}" step="${f.step ?? 0.05}" value="${v ?? f.default ?? 0}">`);
    case 'color': return lab(html`<input type="color" name="${f.name}" value="${v || f.default || '#3A3A3A'}">`);
    case 'image': return html`<div class="fl fimg ${f.wide ? 'wide' : ''}" data-f="${f.name}"><span>${f.label}</span><div class="fimg-row"><div class="pv">${thumb(v, 72)}</div><div class="fimg-btns"><input type="hidden" name="${f.name}" value="${v || ''}"><button type="button" class="btn sm" data-a="img-upload">Upload</button><button type="button" class="btn sm ghost" data-a="img-pick">Library</button><button type="button" class="btn sm ghost" data-a="img-clear">Remove</button></div></div>${help}</div>`;
    case 'images': return html`<div class="fl wide fimgs" data-f="${f.name}"><span>${f.label}</span><input type="hidden" name="${f.name}" value="${JSON.stringify(v || [])}"><div class="imgs-list"></div><div class="fimg-btns"><button type="button" class="btn sm" data-a="imgs-upload">Upload images</button><button type="button" class="btn sm ghost" data-a="imgs-pick">Add from library</button></div>${help}</div>`;
    case 'multi': return html`<fieldset class="fl multi ${f.wide ? 'wide' : ''}" data-f="${f.name}"><legend>${f.label}</legend><div class="multi-g">${(f.options || []).map(([val, l]) => html`<label class="ck"><input type="checkbox" name="${f.name}" value="${val}" ${(v || []).map(String).includes(String(val)) ? 'checked' : ''}> <span>${l}</span></label>`)}</div>${help}</fieldset>`;
    case 'products': return html`<div class="fl wide picker" data-f="${f.name}"><span>${f.label}</span><input type="hidden" name="${f.name}" value="${JSON.stringify(v || [])}"><div class="pk-sel"></div><input class="pk-q" placeholder="Search products to add…" aria-label="Search products"><div class="pk-res"></div>${help}</div>`;
    default: return lab(html`<input type="${f.type || 'text'}" ${attr(f)} value="${v ?? ''}" ${f.type === 'number' ? '' : ''}>`);
  }
}
export const formHtml = (fields, values = {}) => html`<div class="fgrid">${fields.map((f) => fieldHtml(f, values[f.name]))}</div>`;
export function collect(form, fields) {
  const out = {};
  for (const f of fields) {
    const els = form.elements[f.name]; if (!els) continue;
    if (f.type === 'checkbox') out[f.name] = !!els.checked;
    else if (f.type === 'multi') out[f.name] = $$(`input[name="${f.name}"]:checked`, form).map((x) => x.value);
    else if (f.type === 'images' || f.type === 'products') out[f.name] = JSON.parse(els.value || '[]');
    else if (f.type === 'number' || f.type === 'range') out[f.name] = els.value === '' ? null : Number(els.value);
    else out[f.name] = els.value === '' ? (f.emptyNull === false ? '' : null) : els.value;
  }
  return out;
}
/** Hydrates dynamic widgets (image lists, product pickers) inside a form. Call after inserting the form HTML. */
export function hydrate(form) {
  $$('.fimgs', form).forEach((box) => {
    const inp = $('input[type=hidden]', box), list = $('.imgs-list', box);
    const draw = () => {
      const arr = JSON.parse(inp.value || '[]');
      list.innerHTML = arr.map((im, i) => `<div class="imgs-item" draggable="true" data-i="${i}"><img src="${esc(im.url)}" alt=""><span>${i === 0 ? 'Main' : i + 1}</span><div><button type="button" data-a="imgs-left" aria-label="Move earlier">‹</button><button type="button" data-a="imgs-right" aria-label="Move later">›</button><button type="button" data-a="imgs-del" aria-label="Remove">×</button></div></div>`).join('') || '<p class="muted">No images yet.</p>';
    };
    box._draw = draw; draw();
  });
  $$('.picker', form).forEach(initPicker);
}
export const imgsSet = (box, arr) => { $('input[type=hidden]', box).value = JSON.stringify(arr); box._draw(); box.dispatchEvent(new Event('input', { bubbles: true })); };

async function initPicker(box) {
  const inp = $('input[type=hidden]', box), sel = $('.pk-sel', box), q = $('.pk-q', box), res = $('.pk-res', box);
  const names = (box._names ||= new Map());
  const drawSel = () => {
    const ids = JSON.parse(inp.value || '[]');
    sel.innerHTML = ids.map((id) => `<span class="pk-chip" data-id="${id}">${esc(names.get(id) || `#${id}`)} <button type="button" data-a="pk-del" aria-label="Remove">×</button></span>`).join('') || '<p class="muted">Nothing picked — the section will use its source rule or linked categories.</p>';
  };
  box._draw = drawSel;
  const ids0 = JSON.parse(inp.value || '[]');
  for (const id of ids0) if (!names.has(id)) api(`/api/admin/products/${id}`).then((d) => { names.set(id, d.product.name); drawSel(); }).catch(() => {});
  drawSel();
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
    if (!q.value.trim()) { res.innerHTML = ''; return; }
    const d = await api(`/api/admin/products?status=active&q=${encodeURIComponent(q.value)}&pageSize=8`);
    res.innerHTML = d.products.map((p) => { names.set(p.id, p.name); return `<button type="button" class="pk-row" data-a="pk-add" data-id="${p.id}">${p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : ''}<span>${esc(p.name)}</span><small>${esc(inr(p.discountPrice ?? p.price))}</small></button>`; }).join('') || '<p class="muted">No active products match.</p>';
  }, 250); });
}

// ---------- modal ----------
export function modal(title, bodyTpl, { wide = false, onClose } = {}) {
  const m = document.createElement('div'); m.className = 'mdl';
  m.innerHTML = html`<div class="mdl-c ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}"><header><h3>${title}</h3><button class="x" data-a="mdl-x" aria-label="Close">×</button></header><div class="mdl-b">${bodyTpl}</div></div>`.toString();
  const close = () => { m.remove(); onClose?.(); };
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-a="mdl-x"]')) close(); });
  document.body.append(m); m.querySelector('input,select,textarea,button.btn')?.focus();
  return { el: m, close };
}
export function confirmBox(msg) { return Promise.resolve(window.confirm(msg)); }

/** Opens a modal form. onSubmit(values) may throw an ApiError, which is shown inline. */
export function formModal({ title, fields, values = {}, submit = 'Save', wide = true, onSubmit, extra }) {
  const m = modal(title, html`<form class="mform" novalidate>${formHtml(fields, values)}${extra || ''}<div class="mfoot"><button type="button" class="btn ghost" data-a="mdl-x">Cancel</button><button class="btn" type="submit">${submit}</button></div></form>`, { wide });
  const form = $('form', m.el); hydrate(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const b = $('button[type=submit]', form); b.disabled = true; showFieldErrors(form);
    try { await onSubmit(collect(form, fields)); m.close(); } catch (err) { showFieldErrors(form, err.fields); toast(errMsg(err), 'err'); } finally { b.disabled = false; }
  });
  return m;
}

// ---------- media picker ----------
export async function pickMedia() {
  return new Promise((resolve) => {
    let done = false; const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal('Image library', html`<div class="media-grid" id="mp"><p class="muted">Loading…</p></div>`, { wide: true, onClose: () => finish(null) });
    api('/api/admin/media?pageSize=100').then((d) => { $('#mp', m.el).innerHTML = d.media.map((x) => `<button type="button" class="media-item" data-url="${esc(x.url)}"><img src="${esc(x.thumbUrl || x.url)}" alt="" loading="lazy"></button>`).join('') || '<p class="muted">No images uploaded yet.</p>'; });
    m.el.addEventListener('click', (e) => { const b = e.target.closest('.media-item'); if (b) { finish(b.dataset.url); m.close(); } });
  });
}
export function chooseFile(multiple = false) {
  return new Promise((resolve) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/jpeg,image/png,image/webp,image/gif'; i.multiple = multiple; i.onchange = () => resolve([...i.files]); i.click(); });
}
/** Global delegated handlers for image fields and pickers (installed once). */
export function installWidgetHandlers(root) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
    const imgBox = b.closest('.fimg'), listBox = b.closest('.fimgs'), pk = b.closest('.picker');
    try {
      if (a === 'img-upload') { const [f] = await chooseFile(); if (!f) return; const m = await uploadImage(f); setImg(imgBox, m.url); }
      else if (a === 'img-pick') { const u = await pickMedia(); if (u) setImg(imgBox, u); }
      else if (a === 'img-clear') setImg(imgBox, '');
      else if (a === 'imgs-upload') { const fs = await chooseFile(true); const inp = $('input[type=hidden]', listBox); const arr = JSON.parse(inp.value || '[]'); for (const f of fs) { const m = await uploadImage(f); arr.push({ url: m.url, alt: '' }); } imgsSet(listBox, arr); }
      else if (a === 'imgs-pick') { const u = await pickMedia(); if (u) { const inp = $('input[type=hidden]', listBox); imgsSet(listBox, [...JSON.parse(inp.value || '[]'), { url: u, alt: '' }]); } }
      else if (['imgs-left', 'imgs-right', 'imgs-del'].includes(a)) {
        const inp = $('input[type=hidden]', listBox), arr = JSON.parse(inp.value || '[]'), i = Number(b.closest('.imgs-item').dataset.i);
        if (a === 'imgs-del') arr.splice(i, 1); else { const j = a === 'imgs-left' ? i - 1 : i + 1; if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]]; }
        imgsSet(listBox, arr);
      } else if (a === 'pk-add') { const inp = $('input[type=hidden]', pk), ids = JSON.parse(inp.value || '[]'), id = Number(b.dataset.id); if (!ids.includes(id)) { ids.push(id); inp.value = JSON.stringify(ids); pk._names.set(id, $('span', b).textContent); pk._draw(); pk.dispatchEvent(new Event('input', { bubbles: true })); } }
      else if (a === 'pk-del') { const inp = $('input[type=hidden]', pk), id = Number(b.closest('.pk-chip').dataset.id); inp.value = JSON.stringify(JSON.parse(inp.value).filter((x) => x !== id)); pk._draw(); pk.dispatchEvent(new Event('input', { bubbles: true })); }
    } catch (err) { toast(errMsg(err), 'err'); }
  });
}
function setImg(box, url) { $('input[type=hidden]', box).value = url; $('.pv', box).innerHTML = thumb(url, 72).toString(); box.dispatchEvent(new Event('input', { bubbles: true })); }

// ---------- tables, charts ----------
export function table(cols, rows, { empty = 'Nothing here yet.', cls = '' } = {}) {
  if (!rows.length) return html`<div class="empty-box">${empty}</div>`;
  return html`<div class="tbl-wrap"><table class="tbl ${cls}"><thead><tr>${cols.map((c) => html`<th class="${c.cls || ''}">${c.h}</th>`)}</tr></thead><tbody>${rows.map((r) => html`<tr ${r._attr ? raw(r._attr) : ''}>${cols.map((c) => html`<td class="${c.cls || ''}" data-l="${c.h}">${c.f(r)}</td>`)}</tr>`)}</tbody></table></div>`;
}
const nice = (max) => { const p = 10 ** Math.floor(Math.log10(max || 1)); return Math.ceil((max || 1) / p) * p; };
/** Simple accessible SVG chart. series: [{name,color,values[]}], labels: string[]; type: 'bar' | 'line'. */
export function chart(labels, series, { type = 'bar', fmt = (n) => n, height = 240 } = {}) {
  if (!labels.length) return html`<div class="empty-box">No data for this period.</div>`;
  const W = Math.max(560, labels.length * 34), H = height, L = 52, B = 34, T = 12, R = 10;
  const max = nice(Math.max(...series.flatMap((s) => s.values), 1)), iw = W - L - R, ih = H - T - B, step = iw / labels.length;
  const y = (v) => T + ih - (v / max) * ih, x = (i) => L + step * i + step / 2;
  const grid = [0, .25, .5, .75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" class="gl"/><text x="${L - 8}" y="${y(max * f) + 4}" text-anchor="end" class="ax">${esc(fmt(max * f))}</text>`).join('');
  const every = Math.ceil(labels.length / 12);
  const xl = labels.map((l, i) => (i % every ? '' : `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" class="ax">${esc(l.length > 8 ? l.slice(-5) : l)}</text>`)).join('');
  let body = '';
  if (type === 'bar') {
    const bw = Math.min(26, (step * 0.7) / series.length);
    body = series.map((s, si) => s.values.map((v, i) => `<rect x="${x(i) - (bw * series.length) / 2 + si * bw}" y="${y(v)}" width="${bw - 1}" height="${Math.max(0, T + ih - y(v))}" fill="${s.color}" rx="1.5"><title>${esc(labels[i])} · ${esc(s.name)}: ${esc(fmt(v))}</title></rect>`).join('')).join('');
  } else body = series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="2.4" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>${s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.4" fill="${s.color}"><title>${esc(labels[i])} · ${esc(s.name)}: ${esc(fmt(v))}</title></circle>`).join('')}`).join('');
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return raw(`<div class="chart" role="img" aria-label="Chart"><div class="chart-sc"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${grid}${body}${xl}</svg></div>${legend}</div>`);
}
