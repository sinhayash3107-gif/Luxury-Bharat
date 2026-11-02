// Placeholder product illustrations for the demo catalogue (SVG -> WebP via sharp).
// These stand in for real photography; the owner replaces them from Admin → Products / Categories.
const GOLD = '#D4AF37';
const DEFS = `<defs>
<linearGradient id="sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".26"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".30"/></linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2D675"/><stop offset=".5" stop-color="#D4AF37"/><stop offset="1" stop-color="#8E6F17"/></linearGradient>
<radialGradient id="bg" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#FBFAF8"/><stop offset="1" stop-color="#DDD9D2"/></radialGradient></defs>`;
const shaded = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" stroke="rgba(0,0,0,.4)" stroke-width="2" stroke-linejoin="round"/><path d="${d}" fill="url(#sh)"/>${extra}`;
const line = (d, c = 'rgba(0,0,0,.35)', w = 2, dash = '') => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
const stitch = (d) => line(d, GOLD, 2.2, '5 5');

const ART = {
  tee: (c) => shaded('M120 70 L160 55 Q200 92 240 55 L280 70 L350 125 L315 168 L285 148 L285 340 L115 340 L115 148 L85 168 L50 125 Z', c,
    line('M160 55 Q200 100 240 55', 'rgba(0,0,0,.45)', 6) + line('M115 148 L120 70 M285 148 L280 70', 'rgba(0,0,0,.2)') + stitch('M118 330 H282')),
  shirt: (c) => shaded('M115 62 L165 48 L200 84 L235 48 L285 62 L358 252 L320 266 L286 165 L286 348 L114 348 L114 165 L80 266 L42 252 Z', c,
    `<path d="M165 48 L200 98 L200 84Z M235 48 L200 98 L200 84Z" fill="#fff" opacity=".85" stroke="rgba(0,0,0,.3)"/>` + line('M200 98 V348', 'rgba(0,0,0,.35)', 3) +
    [125, 165, 205, 245, 285].map((y) => `<circle cx="206" cy="${y}" r="4" fill="url(#gold)"/>`).join('') + line('M114 165 L120 62 M286 165 L280 62', 'rgba(0,0,0,.2)')),
  jeans: (c) => shaded('M105 50 H295 L318 356 H216 L200 152 L184 356 H82 Z', c,
    `<rect x="105" y="50" width="190" height="24" fill="rgba(0,0,0,.25)"/>` + stitch('M115 84 Q150 128 172 84') + stitch('M285 84 Q250 128 228 84') + stitch('M200 74 V152') +
    `<circle cx="200" cy="62" r="7" fill="url(#gold)"/>` + line('M150 200 L136 350 M250 200 L264 350', 'rgba(255,255,255,.18)', 6) + stitch('M92 346 H178') + stitch('M222 346 H308')),
  trousers: (c) => shaded('M112 50 H288 L298 356 H212 L200 168 L188 356 H102 Z', c,
    `<rect x="112" y="50" width="176" height="20" fill="rgba(0,0,0,.28)"/>` + [135, 175, 225, 265].map((x) => `<rect x="${x - 3}" y="46" width="6" height="30" rx="2" fill="rgba(0,0,0,.35)"/>`).join('') +
    line('M146 80 L140 350 M254 80 L260 350', 'rgba(255,255,255,.22)', 3) + line('M200 70 V168', 'rgba(0,0,0,.35)', 2) + `<circle cx="200" cy="60" r="6" fill="url(#gold)"/>`),
  jacket: (c) => shaded('M108 72 L165 54 Q200 84 235 54 L292 72 L352 132 L342 306 L300 306 L296 178 L292 342 L108 342 L104 178 L100 306 L58 306 L48 132 Z', c,
    `<path d="M165 54 Q200 112 235 54 L246 66 Q200 134 154 66Z" fill="rgba(0,0,0,.35)"/>` + line('M200 112 V342', 'url(#gold)', 5) + line('M200 112 V342', GOLD, 4) +
    `<rect x="100" y="326" width="200" height="16" fill="rgba(0,0,0,.3)"/><rect x="48" y="294" width="52" height="14" fill="rgba(0,0,0,.3)"/><rect x="300" y="294" width="52" height="14" fill="rgba(0,0,0,.3)"/>` +
    line('M125 230 H175 M225 230 H275', 'rgba(0,0,0,.4)', 3) + stitch('M120 180 L112 300 M280 180 L288 300')),
  shoe: (c) => `${shaded('M48 285 Q50 205 105 190 L160 160 Q190 150 205 175 Q225 200 270 205 Q350 212 362 262 L366 288 H48Z', c)}
    <path d="M300 207 Q352 220 362 262 L366 288 H300Z" fill="rgba(0,0,0,.22)"/><path d="M105 190 Q132 208 165 182 L160 160Z" fill="#101010"/>
    <path d="M46 250 Q44 215 70 200 L95 194 L92 252Z" fill="url(#gold)" opacity=".95"/>${line('M178 172 L202 192 M196 164 L222 188 M214 160 L242 188', GOLD, 5)}
    ${shaded('M40 286 H368 Q376 322 346 326 H62 Q36 322 40 286Z', '#F1EEE6')}${line('M60 304 H350', 'rgba(0,0,0,.18)', 2)}`,
  derby: (c) => `${shaded('M52 285 Q54 215 100 200 L150 178 Q185 170 205 190 Q235 215 285 220 Q352 226 364 268 L366 288 H52Z', c)}
    <path d="M100 200 Q130 215 160 192 L150 178Z" fill="#0b0b0b"/>${line('M170 192 L205 214 M186 184 L222 206 M202 178 L240 202', 'rgba(255,255,255,.55)', 3)}${line('M296 222 Q340 232 360 262', 'rgba(0,0,0,.45)', 3)}
    ${shaded('M48 288 H368 Q374 308 352 312 H66 Q44 308 48 288Z', '#1a1a1a')}`,
  jar: (c) => `<rect x="140" y="58" width="120" height="44" rx="7" fill="url(#gold)" stroke="rgba(0,0,0,.35)" stroke-width="2"/>${line('M150 72 H250 M150 86 H250', 'rgba(0,0,0,.18)', 2)}
    ${shaded('M128 112 Q128 102 140 102 H260 Q272 102 272 112 V332 Q272 352 252 352 H148 Q128 352 128 332Z', c)}
    <rect x="148" y="190" width="104" height="92" rx="4" fill="#F5F5F5" stroke="rgba(0,0,0,.3)"/><rect x="148" y="190" width="104" height="10" fill="url(#gold)"/><rect x="148" y="272" width="104" height="10" fill="url(#gold)"/>
    <circle cx="200" cy="236" r="20" fill="none" stroke="${GOLD}" stroke-width="3"/><path d="M190 236 H210 M200 226 V246" stroke="${GOLD}" stroke-width="3"/>`,
  tin: (c) => `${shaded('M108 120 H292 V332 Q292 352 272 352 H128 Q108 352 108 332Z', c)}<ellipse cx="200" cy="120" rx="92" ry="20" fill="url(#gold)" stroke="rgba(0,0,0,.35)" stroke-width="2"/><ellipse cx="200" cy="116" rx="70" ry="13" fill="rgba(0,0,0,.18)"/>
    <rect x="108" y="200" width="184" height="90" fill="#F5F5F5" opacity=".92"/><rect x="108" y="200" width="184" height="8" fill="url(#gold)"/><rect x="108" y="282" width="184" height="8" fill="url(#gold)"/><circle cx="200" cy="245" r="22" fill="none" stroke="${GOLD}" stroke-width="3"/>`,
  watch: (c) => `<rect x="162" y="14" width="76" height="130" rx="14" fill="${c}" stroke="rgba(0,0,0,.4)" stroke-width="2"/><rect x="162" y="256" width="76" height="130" rx="14" fill="${c}" stroke="rgba(0,0,0,.4)" stroke-width="2"/>
    <circle cx="200" cy="200" r="92" fill="url(#gold)" stroke="rgba(0,0,0,.4)" stroke-width="2"/><circle cx="200" cy="200" r="74" fill="#101010"/>
    ${Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return `<line x1="${200 + 62 * Math.sin(a)}" y1="${200 - 62 * Math.cos(a)}" x2="${200 + 70 * Math.sin(a)}" y2="${200 - 70 * Math.cos(a)}" stroke="${GOLD}" stroke-width="${i % 3 ? 2 : 4}"/>`; }).join('')}
    <line x1="200" y1="200" x2="200" y2="150" stroke="#F5F5F5" stroke-width="5" stroke-linecap="round"/><line x1="200" y1="200" x2="236" y2="214" stroke="#F5F5F5" stroke-width="4" stroke-linecap="round"/><circle cx="200" cy="200" r="5" fill="${GOLD}"/><rect x="290" y="190" width="14" height="20" rx="3" fill="url(#gold)"/>`,
  belt: (c) => `${shaded('M30 172 H370 V228 H30Z', c)}${[70, 105, 140, 175, 210].map((x) => `<circle cx="${x}" cy="200" r="5" fill="rgba(0,0,0,.55)"/>`).join('')}${stitch('M36 180 H364 M36 220 H364')}
    <rect x="262" y="146" width="76" height="108" rx="12" fill="none" stroke="url(#gold)" stroke-width="12"/><rect x="262" y="146" width="76" height="108" rx="12" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/><path d="M300 176 V224" stroke="url(#gold)" stroke-width="8" stroke-linecap="round"/>`,
};
export const ART_KINDS = Object.keys(ART);

/** studio=true → soft backdrop + floor shadow (product photo); false → transparent cut-out. */
export function artSvg(kind, color, { studio = false } = {}) {
  const fn = ART[kind] || ART.tee;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="800" height="800">${DEFS}${studio ? '<rect width="400" height="400" fill="url(#bg)"/><ellipse cx="200" cy="372" rx="140" ry="9" fill="#000" opacity=".13"/>' : ''}${fn(color)}</svg>`;
}
