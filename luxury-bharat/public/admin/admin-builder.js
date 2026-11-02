import { html, api, toast, errMsg, showFieldErrors, $, $$ } from '/js/lib.js';
import { chip, formHtml, collect, hydrate } from './admin-ui.js';

const TYPES = [['category_catalog', 'Category catalogue (editorial cards)'], ['product_grid', 'Product grid'], ['product_carousel', 'Horizontal product carousel'], ['featured_collection', 'Featured collection'], ['editorial_banner', 'Editorial image banner'], ['promo_banner', 'Promotional banner'], ['custom_content', 'Custom content']];
const SOURCES = [['manual', 'Picked products / linked categories'], ['featured', 'All featured products'], ['trending', 'All trending products'], ['new', 'All new arrivals'], ['bestsellers', 'Best sellers']];
const COMMON = ['name', 'slug', 'type', 'description', 'visible', 'status'];
const SHOW = {
  category_catalog: ['categoryIds', 'bgColor', 'ctaText', 'ctaUrl'],
  product_grid: ['source', 'itemLimit', 'productIds', 'categoryIds', 'bgColor', 'ctaText', 'ctaUrl'],
  product_carousel: ['source', 'itemLimit', 'productIds', 'categoryIds', 'bgColor', 'ctaText', 'ctaUrl'],
  featured_collection: ['source', 'itemLimit', 'productIds', 'categoryIds', 'image', 'bgColor', 'ctaText', 'ctaUrl'],
  editorial_banner: ['image', 'bgImage', 'mobileImage', 'hoverImage', 'bgColor', 'ctaText', 'ctaUrl'],
  promo_banner: ['bgColor', 'ctaText', 'ctaUrl'],
  custom_content: ['content', 'image', 'bgColor', 'ctaText', 'ctaUrl'],
};
let sel = null; // selected section id, or 'new'

export async function builderPage(main, { P, acts, reload }) {
  const [{ sections }, { categories }] = await Promise.all([api('/api/admin/sections'), api('/api/admin/categories')]);
  const fields = [
    { name: 'name', label: 'Section name', required: true, max: 80 }, { name: 'slug', label: 'Section slug', help: 'Blank = from name.' },
    { name: 'type', label: 'Section type', type: 'select', options: TYPES }, { name: 'source', label: 'Content source', type: 'select', options: SOURCES },
    { name: 'description', label: 'Section description', type: 'textarea', rows: 2, wide: true }, { name: 'content', label: 'Content (blank line = new paragraph)', type: 'textarea', rows: 6, wide: true },
    { name: 'productIds', label: 'Associated products (in display order)', type: 'products' }, { name: 'categoryIds', label: 'Associated categories', type: 'multi', wide: true, options: categories.map((c) => [c.id, (c.parentId ? '↳ ' : '') + c.name]) },
    { name: 'itemLimit', label: 'Max items to show', type: 'number', min: 1, max: 24 }, { name: 'bgColor', label: 'Background colour (hex, optional)', ph: '#3A3A3A' },
    { name: 'image', label: 'Section image', type: 'image' }, { name: 'bgImage', label: 'Background image', type: 'image' }, { name: 'mobileImage', label: 'Mobile image', type: 'image' }, { name: 'hoverImage', label: 'Hover image', type: 'image' },
    { name: 'ctaText', label: 'Button text', max: 40 }, { name: 'ctaUrl', label: 'Button link', ph: '/category/jackets' },
    { name: 'visible', label: 'Visible on the homepage', type: 'checkbox' }, { name: 'status', label: 'Publication status', type: 'select', options: [['draft', 'Draft — not shown to shoppers'], ['published', 'Published']] }];
  const cur = sel === 'new' ? null : sections.find((s) => s.id === sel) || null;
  if (sel !== 'new' && !cur) sel = sections[0]?.id ?? 'new';
  const sec = sel === 'new' ? null : sections.find((s) => s.id === sel);
  const vals = sec || { type: 'product_carousel', source: 'manual', itemLimit: 8, visible: true, status: 'draft', productIds: [], categoryIds: [] };

  main.innerHTML = P('Section builder', html`<p class="muted">Every block on the homepage is a section stored in the database. Drag to reorder; hide, publish or delete without touching code. Published changes appear on the storefront immediately.</p>
    <div class="builder"><div><div class="sec-list" id="sl" role="list">${sections.map((s, i) => html`<div class="sec-row ${s.id === sel ? 'on' : ''} ${!s.visible || s.status !== 'published' ? 'hidden-s' : ''}" role="listitem" draggable="true" data-id="${s.id}"><span class="grip" aria-hidden="true">⋮⋮</span><div class="nm"><b>${s.name}</b><small>${s.type.replace(/_/g, ' ')}</small></div>${chip(s.status)}
        <button class="eye" data-do="sec-eye" data-id="${s.id}" title="${s.visible ? 'Hide from homepage' : 'Show on homepage'}" aria-label="${s.visible ? 'Hide' : 'Show'} ${s.name}">${s.visible ? '👁' : '—'}</button></div>`)}${!sections.length ? html`<p class="muted" style="padding:16px">No sections yet.</p>` : ''}</div>
      <p><button class="btn gold" style="width:100%;justify-content:center" data-do="sec-new">+ New section</button></p></div>
    <div><form class="panel" id="bf" novalidate><div class="ph"><h3>${sec ? `Edit “${sec.name}”` : 'New section'}</h3>${sec ? chip(sec.status) : ''}</div>${formHtml(fields, vals)}
      <div class="mfoot" style="justify-content:space-between"><div>${sec ? html`<button type="button" class="btn danger" data-do="sec-del">Delete</button>` : ''}</div><div style="display:flex;gap:8px"><button class="btn ghost" data-do="sec-save" data-st="draft" type="button">Save as draft</button><button class="btn gold" data-do="sec-save" data-st="published" type="button">Save & publish</button></div></div></form>
      <div class="panel pv-wrap" style="padding:12px"><div class="pv-bar"><strong style="color:#ddd">Preview</strong><button data-do="pv-d" class="on" id="pvd">Desktop</button><button data-do="pv-m" id="pvm">Mobile</button><small style="margin-left:auto">Updates as you type — exactly what shoppers will see.</small></div><iframe id="pvf" class="pv-frame" title="Section preview" src="/preview"></iframe></div></div></div>`).toString();

  const form = $('#bf'); hydrate(form);
  const applyType = () => { const t = form.elements.type.value, show = new Set([...COMMON, ...(SHOW[t] || [])]); fields.forEach((f) => { const w = form.querySelector(`[data-f="${f.name}"]`); if (w) w.hidden = !show.has(f.name); }); };
  applyType();
  const frame = $('#pvf'); let timer, ready = false;
  const preview = async () => {
    try { const v = values(); const { section } = await api('/api/admin/sections/preview', { method: 'POST', body: v }); frame.contentWindow.postMessage({ type: 'render-section', section }, location.origin); }
    catch (e) { frame.contentWindow?.postMessage({ type: 'render-section', section: { type: 'custom_content', name: 'Preview unavailable', content: errMsg(e), slug: 'x' } }, location.origin); }
  };
  const values = () => { const v = collect(form, fields); return { ...v, bgColor: v.bgColor || null }; };
  frame.addEventListener('load', () => { ready = true; preview(); });
  form.addEventListener('input', (e) => { if (e.target.name === 'type' || e.target.closest?.('[data-f="type"]')) applyType(); clearTimeout(timer); timer = setTimeout(() => ready && preview(), 450); });
  form.addEventListener('change', (e) => { if (e.target.name === 'type') applyType(); });

  const save = async (status) => {
    showFieldErrors(form); const v = values(); if (status) v.status = status;
    const r = await api(sec ? `/api/admin/sections/${sec.id}` : '/api/admin/sections', { method: sec ? 'PUT' : 'POST', body: v });
    sel = r.section.id; toast(status === 'published' ? 'Published — live on the storefront' : 'Saved'); reload();
  };
  acts['sec-save'] = async (b) => { try { await save(b.dataset.st); } catch (e) { showFieldErrors(form, e.fields); toast(errMsg(e), 'err'); } };
  acts['sec-new'] = () => { sel = 'new'; reload(); };
  acts['sec-del'] = async () => { if (!confirm(`Delete “${sec.name}”? This cannot be undone.`)) return; await api(`/api/admin/sections/${sec.id}`, { method: 'DELETE' }); sel = null; toast('Section deleted'); reload(); };
  acts['sec-eye'] = async (b, e) => { e.stopPropagation(); const s = sections.find((x) => x.id === Number(b.dataset.id)); await api(`/api/admin/sections/${s.id}`, { method: 'PATCH', body: { visible: !s.visible } }); reload(); };
  acts['pv-d'] = () => { frame.classList.remove('mobile'); $('#pvd').classList.add('on'); $('#pvm').classList.remove('on'); };
  acts['pv-m'] = () => { frame.classList.add('mobile'); $('#pvm').classList.add('on'); $('#pvd').classList.remove('on'); };

  // select a row / drag to reorder
  const list = $('#sl');
  list.addEventListener('click', (e) => { const row = e.target.closest('.sec-row'); if (row && !e.target.closest('[data-do]')) { sel = Number(row.dataset.id); reload(); } });
  let dragId = null;
  list.addEventListener('dragstart', (e) => { const r = e.target.closest('.sec-row'); if (!r) return; dragId = Number(r.dataset.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragId)); });
  list.addEventListener('dragover', (e) => { const r = e.target.closest('.sec-row'); if (!r || dragId == null) return; e.preventDefault(); $$('.drag-over', list).forEach((x) => x.classList.remove('drag-over')); r.classList.add('drag-over'); });
  list.addEventListener('dragleave', (e) => e.target.closest?.('.sec-row')?.classList.remove('drag-over'));
  list.addEventListener('drop', async (e) => {
    const r = e.target.closest('.sec-row'); if (!r || dragId == null) return; e.preventDefault();
    const ids = sections.map((s) => s.id).filter((id) => id !== dragId); ids.splice(ids.indexOf(Number(r.dataset.id)), 0, dragId); dragId = null;
    try { await api('/api/admin/sections/reorder', { method: 'POST', body: { ids } }); toast('Order updated'); reload(); } catch (er) { toast(errMsg(er), 'err'); }
  });
}
