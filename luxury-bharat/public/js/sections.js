import { html, raw, icons, $$ } from './lib.js';
import { productCard } from './app.js';

const slugId = (s) => `sec-${s.slug || s.id}`;
const cta = (s, cls = 'btn') => (s.ctaText && s.ctaUrl ? html`<a class="${cls}" href="${s.ctaUrl}">${s.ctaText}</a>` : '');
const paras = (t) => String(t || '').split(/\n{2,}/).map((x) => html`<p>${x}</p>`);

function head(s, rail) {
  return html`<div class="wrap sec-head"><div><h2>${s.name}</h2>${s.description ? html`<p>${s.description}</p>` : ''}</div>
    <div style="display:flex;align-items:center;gap:18px">${rail ? html`<div class="rail-ctl"><button data-rail-btn="-1" aria-label="Scroll left">${raw(icons.left)}</button><button data-rail-btn="1" aria-label="Scroll right">${raw(icons.right)}</button></div>` : ''}
    ${s.ctaText && s.ctaUrl ? html`<a class="link" href="${s.ctaUrl}">${s.ctaText}</a>` : ''}</div></div>`;
}

export function categoryCard(c, i) {
  const n = String(i + 1).padStart(2, '0');
  return html`<a class="cat-card ${c.imageFit === 'cover' ? 'cover' : ''} ${c.hoverImage ? 'has-alt' : ''}" style="--bg:${c.bgColor || '#3A3A3A'}" href="/category/${c.slug}" aria-label="${n} ${c.name}">
    <div class="pic">${c.image ? html`<picture>${c.mobileImage ? html`<source media="(max-width: 760px)" srcset="${c.mobileImage}">` : ''}<img class="main" src="${c.image}" alt="" loading="lazy" draggable="false"></picture>` : ''}${c.hoverImage ? html`<img class="alt" src="${c.hoverImage}" alt="" loading="lazy" draggable="false">` : ''}</div>
    <span class="go">${raw(icons.right)}</span>
    <div class="meta"><h3><span class="n">${n} /</span>${c.name}</h3>${c.subtitle ? html`<small>${c.subtitle}</small>` : ''}</div></a>`;
}

export function renderSection(s, { light = true } = {}) {
  const id = slugId(s);
  switch (s.type) {
    case 'category_catalog':
      return html`<section class="sec catalog" id="${id}" style="${s.bgColor ? `background:${s.bgColor}` : ''}">${head(s, true)}<div class="cat-rail" data-rail tabindex="0" aria-label="${s.name}">${(s.categories || []).map(categoryCard)}</div></section>`;
    case 'product_grid':
      return html`<section class="sec ${light ? 'light' : ''}" id="${id}" style="${s.bgColor ? `background:${s.bgColor}` : ''}">${head(s)}<div class="wrap">${(s.products || []).length ? html`<div class="prod-grid">${s.products.map(productCard)}</div>` : html`<p class="muted">No products to show yet.</p>`}</div></section>`;
    case 'product_carousel':
      return html`<section class="sec ${light ? 'light' : ''}" id="${id}" style="${s.bgColor ? `background:${s.bgColor}` : ''}">${head(s, true)}<div class="wrap">${(s.products || []).length ? html`<div class="prod-rail" data-rail>${s.products.map(productCard)}</div>` : html`<p class="muted">No products to show yet.</p>`}</div></section>`;
    case 'featured_collection':
      return html`<section class="sec ${light ? 'light' : ''}" id="${id}"><div class="wrap"><div class="fc"><div class="side" style="--bg:${s.bgColor || '#3A3A3A'}">${s.image ? html`<img src="${s.image}" alt="" loading="lazy">` : ''}<h2 style="font-size:clamp(30px,3.4vw,50px)">${s.name}</h2>${s.description ? html`<p style="margin:0;opacity:.85">${s.description}</p>` : ''}${cta(s, 'btn')}</div>
        <div class="prod-grid">${(s.products || []).length ? s.products.map(productCard) : html`<p class="muted">Add products to this collection from the dashboard.</p>`}</div></div></div></section>`;
    case 'editorial_banner':
      return html`<section id="${id}" class="ed" style="--bg:${s.bgColor || '#3A3A3A'}"><div class="tx"><h2>${s.name}</h2>${s.description ? html`<p>${s.description}</p>` : ''}${cta(s, 'btn')}</div>
        <div class="im ${s.bgImage ? 'cover' : ''}">${s.bgImage || s.image ? html`<picture>${s.mobileImage ? html`<source media="(max-width: 760px)" srcset="${s.mobileImage}">` : ''}<img src="${s.bgImage || s.image}" alt="" loading="lazy"></picture>` : ''}</div></section>`;
    case 'promo_banner':
      return html`<section id="${id}" class="promo" style="${s.bgColor ? `--bg:${s.bgColor}` : ''}"><div><h2>${s.name}</h2>${s.description ? html`<p>${s.description}</p>` : ''}</div>${cta(s, 'btn dark')}</section>`;
    case 'custom_content':
      return html`<section class="sec ${light ? 'light' : ''}" id="${id}" style="${s.bgColor ? `background:${s.bgColor}` : ''}"><div class="wrap"><div class="custom"><h2 style="margin-bottom:22px">${s.name}</h2>${s.image ? html`<img src="${s.image}" alt="" style="margin-bottom:22px" loading="lazy">` : ''}${paras(s.content || s.description)}${cta(s, 'btn dark')}</div></div></section>`;
    default: return html``;
  }
}

export function renderHero(banners, store) {
  const list = banners.length ? banners : [{ title: store.name.toUpperCase(), subtitle: store.tagline, buttonText: 'EXPLORE COLLECTION', buttonUrl: '/shop', align: 'left', overlay: 0.3, heightVh: 88 }];
  return html`<div class="hero-set" data-hero>${list.map((b, i) => html`<section class="hero ${b.align}" data-slide="${i}" style="min-height:${b.heightVh}vh;--ov:${b.overlay};${i ? 'display:none' : ''}">
    ${b.videoUrl ? html`<div class="hero-bg"><video src="${b.videoUrl}" autoplay muted loop playsinline aria-hidden="true"></video></div>` : b.imageDesktop ? html`<picture class="hero-bg">${b.imageMobile ? html`<source media="(max-width: 760px)" srcset="${b.imageMobile}">` : ''}<img src="${b.imageDesktop}" alt="" ${i ? 'loading="lazy"' : ''}></picture>` : ''}
    <div class="hero-in">${b.badge ? html`<span class="promo-badge">${b.badge}</span>` : ''}<h1>${b.title}</h1>${b.subtitle ? html`<p class="sub">${b.subtitle}</p>` : ''}${b.buttonText && b.buttonUrl ? html`<a class="btn solid" href="${b.buttonUrl}">${b.buttonText}</a>` : ''}</div>
    ${list.length > 1 ? html`<div class="hero-dots">${list.map((_, j) => html`<button class="${j === i ? 'on' : ''}" data-dot="${j}" aria-label="Show slide ${j + 1}"></button>`)}</div>` : ''}</section>`)}</div>`;
}

/** Wires up drag-scroll rails, rail buttons and the hero slideshow inside root. Returns a cleanup fn. */
export function bindSections(root) {
  const timers = []; const ac = new AbortController();
  $$('[data-rail]', root).forEach((rail) => {
    let down = false, sx = 0, sl = 0, moved = false;
    rail.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') return; down = true; moved = false; sx = e.clientX; sl = rail.scrollLeft; });
    window.addEventListener('pointermove', (e) => { if (!down) return; const dx = e.clientX - sx; if (Math.abs(dx) > 4) { moved = true; rail.classList.add('drag'); } if (moved) rail.scrollLeft = sl - dx; }, { signal: ac.signal });
    window.addEventListener('pointerup', () => { if (!down) return; down = false; setTimeout(() => rail.classList.remove('drag'), 0); }, { signal: ac.signal });
    rail.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    const sec = rail.closest('section');
    sec?.querySelectorAll('[data-rail-btn]').forEach((b) => b.addEventListener('click', () => { const card = rail.firstElementChild; rail.scrollBy({ left: Number(b.dataset.railBtn) * ((card?.getBoundingClientRect().width || 300) + 20) * 1.5, behavior: 'smooth' }); }));
    rail.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') rail.scrollBy({ left: 320, behavior: 'smooth' }); if (e.key === 'ArrowLeft') rail.scrollBy({ left: -320, behavior: 'smooth' }); });
  });
  const hero = root.querySelector('[data-hero]');
  if (hero) {
    const slides = $$('[data-slide]', hero); let cur = 0;
    const show = (n) => { cur = (n + slides.length) % slides.length; slides.forEach((s, i) => { s.style.display = i === cur ? '' : 'none'; }); };
    $$('[data-dot]', hero).forEach((d) => d.addEventListener('click', () => show(Number(d.dataset.dot))));
    if (slides.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) timers.push(setInterval(() => show(cur + 1), 7000));
  }
  return () => { timers.forEach(clearInterval); ac.abort(); };
}
