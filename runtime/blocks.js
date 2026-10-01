// Blocks: picture components for vertical explainer shorts (1080x1920). Each block draws one claim type from 21-infographics.md with the
// conventions built in: the yardstick appears first and muted, only the datum wears the accent color, labels touch their marks, the chrome is
// still and only the datum moves, the end state holds, units are on screen. A block is a pure function of local time: draw(ctx, s, f, p, area).
// Contract, parameters and the box contract: 23-short-factory.md (section "Blocks"). The file loads in plain Node (UMD): Blocks.list() works
// without a DOM; Film and the canvas are touched only inside draw().
//
//   Blocks.draw(ctx, s, f, pic, area)               pic: { block, ...params } (or an array of them), area: { x, y, w, h } (default pic.area, then f.band)
//   Blocks.register(name, { claim, doc, params, sample, draw(ctx, s, f, p, area) })
//   Blocks.list()                                    [{ name, claim, doc, params, sample }]
//   Blocks.label(ctx, f, kind, text, x, y, opts)     draws a text label and records its box with f.box (kinds: label, number, stamp, name)
//   Blocks.measure(ctx, f, text, opts)               width of a label without drawing it
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Blocks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ---------------------------------------------------------------- math (pure copies of what Film.util has, so the file loads without Film)
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const seg = (t, a, b) => b > a ? clamp((t - a) / (b - a)) : (t >= a ? 1 : 0);
const E = {
  lin: p => p, outCubic: p => 1 - (1 - p) ** 3, inCubic: p => p * p * p, outQuart: p => 1 - (1 - p) ** 4,
  inOutCubic: p => p < .5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2, inOutSine: p => -(Math.cos(Math.PI * p) - 1) / 2,
  outExpo: p => p >= 1 ? 1 : 1 - 2 ** (-10 * p), outBack: (p, k = 1.70158) => 1 + (k + 1) * (p - 1) ** 3 + k * (p - 1) ** 2,
};
function spring(t, zeta = .45, omega = 14) {
  if (t <= 0) return 0;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
}
const FILM = () => {
  const F = typeof Film !== 'undefined' ? Film : (typeof globalThis !== 'undefined' ? globalThis.Film : null);
  if (!F) throw new Error('Blocks: runtime/film.js must be loaded before a block is drawn');
  return F;
};
const rnd = seed => FILM().util.mulberry32(seed);                       // the only source of randomness
const A = (c, a) => FILM().util.alpha(c, a);
const tcol = (T, name) => name === 'ink' ? T.ink : name === 'ok' ? T.ok : name === 'muted' ? T.muted : T.accent;
function lum(c) {
  if (!c || c[0] !== '#') return .5;
  let h = c.slice(1); if (h.length === 3) h = [...h].map(x => x + x).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return .2126 * r + .7152 * g + .0722 * b;
}
const isDark = T => lum(T.bg) < .4;
const fmtNum = (v, dec = 0) => {
  const s = Math.abs(v).toFixed(dec), [i, d] = s.split('.');
  return (v < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (d ? '.' + d : '');
};
const decOf = v => { const m = String(v).match(/\.(\d+)/); return m ? Math.min(2, m[1].length) : 0; };
const toNum = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
const stagger = (p, k, step) => p.at + k * step;                        // the automatic start of the k-th element of a block

// ---------------------------------------------------------------- text: the one way a block writes
function fontOf(f, o, size) {
  const face = o.face || 'mono', wt = o.wt ?? (face === 'display' ? 700 : 600), ls = size * (o.track ?? (face === 'display' ? .01 : .08));
  return { font: FILM().font(size, face === 'display' ? f.type.display : f.type.mono, wt), ls };
}
const defSize = o => o.size ?? (o.face === 'display' ? 48 : 30);
function measure(ctx, f, text, o = {}) {
  const size = defSize(o) * (f.u || 1), { font, ls } = fontOf(f, o, size);
  ctx.save(); ctx.font = font; ctx.letterSpacing = ls + 'px'; const w = ctx.measureText(String(text)).width - ls; ctx.restore();
  return w;
}
// draws text and records its box (in canvas coordinates, whatever the current transform) with f.box.
// opts: size (px at 1080 wide, scaled by f.u), face 'mono'|'display', wt, color, align 'left'|'center'|'right', base 'middle'|'alphabetic'|'top'|'bottom',
//       a (alpha), track (letter spacing, em), typed (0..1: the first part of the text), maxW (shrinks to fit), within ({x,y,w,h}: shifted inside), halo (a color
//       stroked around the letters so they read over lines), nobox (draw without recording a box)
function label(ctx, f, kind, text, x, y, o = {}) {
  text = String(text ?? '');
  const a = o.a === undefined ? 1 : o.a;
  if (!text || a <= .004) return null;
  const u = f.u || 1, base = o.base || 'middle', align = o.align || 'left';
  let size = defSize(o) * u;
  ctx.save();
  const set = sz => { const q = fontOf(f, o, sz); ctx.font = q.font; ctx.letterSpacing = q.ls + 'px'; return q.ls; };
  let ls = set(size), w = ctx.measureText(text).width - ls;
  const maxW = Math.min(o.maxW ?? Infinity, o.within ? o.within.w : Infinity);
  if (w > maxW) { size *= maxW / w; ls = set(size); w = ctx.measureText(text).width - ls; }
  const shown = o.typed !== undefined && o.typed < 1 ? text.slice(0, Math.ceil(text.length * clamp(o.typed))) : text;
  if (!shown) { ctx.restore(); return null; }
  const ws = shown === text ? w : ctx.measureText(shown).width - ls, h = size;
  let x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const top = yy => base === 'middle' ? yy - h / 2 : base === 'top' ? yy : base === 'bottom' ? yy - h : yy - size * .8;
  let yy = y;
  if (o.within) {
    const W = o.within;
    x0 = clamp(x0, W.x, Math.max(W.x, W.x + W.w - w));
    yy = clamp(top(y), W.y, Math.max(W.y, W.y + W.h - h)) - top(0);
  }
  ctx.textAlign = 'left'; ctx.textBaseline = base; ctx.fillStyle = o.color || ctx.fillStyle; ctx.globalAlpha *= a;
  if (o.halo) { ctx.lineJoin = 'round'; ctx.strokeStyle = o.halo; ctx.lineWidth = size * .34; ctx.strokeText(shown, x0, yy); }
  ctx.fillText(shown, x0, yy);
  const yT = top(yy), m = ctx.getTransform();
  ctx.restore();
  const box = { x0, y0: yT, x1: x0 + ws, y1: yT + h, w: ws, h, size };
  if (!o.nobox && f.box) {
    const xs = [], ys = [];
    for (const [px, py] of [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]]) { xs.push(m.a * px + m.c * py + m.e); ys.push(m.b * px + m.d * py + m.f); }
    f.box(kind, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), shown);
  }
  return box;
}
// records a box for something drawn without label() (a sprite, a block of cells), transformed like label() does
function boxOf(ctx, f, kind, x0, y0, x1, y1, text = '') {
  const m = ctx.getTransform(), xs = [], ys = [];
  for (const [px, py] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { xs.push(m.a * px + m.c * py + m.e); ys.push(m.b * px + m.d * py + m.f); }
  f.box(kind, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), text);
}

// ---------------------------------------------------------------- drawing helpers
const roundRect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); };
function polyPath(ctx, pts) { ctx.beginPath(); for (let i = 0; i < pts.length; i += 2) i ? ctx.lineTo(pts[i], pts[i + 1]) : ctx.moveTo(pts[i], pts[i + 1]); }
function arrowHead(ctx, x, y, dx, dy, size, color) {
  const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
  ctx.save(); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * size - uy * size * .5, y - uy * size + ux * size * .5); ctx.lineTo(x - ux * size + uy * size * .5, y - uy * size - ux * size * .5); ctx.closePath(); ctx.fill(); ctx.restore();
}
// diagonal hatching inside a rectangle (the yardstick's texture)
function hatchRect(ctx, x, y, w, h, color, gap, lw) {
  if (w <= 0 || h <= 0) return;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
  for (let d = -h; d < w + h; d += gap) { ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); }
  ctx.stroke(); ctx.restore();
}
// the first fraction q of a polyline, as a new flat array (for dotted/dashed progressive strokes and for a token that follows a path)
function pathLens(pts) { const c = [0]; for (let i = 2; i < pts.length; i += 2) c.push(c[c.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])); return c; }
function pathAt(pts, lens, d) {
  const L = lens[lens.length - 1]; d = clamp(d, 0, L);
  let i = 1; while (i < lens.length - 1 && lens[i] < d) i++;
  const k = (d - lens[i - 1]) / ((lens[i] - lens[i - 1]) || 1);
  return { x: lerp(pts[2 * i - 2], pts[2 * i], k), y: lerp(pts[2 * i - 1], pts[2 * i + 1], k), dx: pts[2 * i] - pts[2 * i - 2], dy: pts[2 * i + 1] - pts[2 * i - 1] };
}
const bez = (a, b, c, d, t) => { const m = 1 - t; return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d; };
const strokeProgress = (ctx, pts, q) => FILM().ink.poly(ctx, pts, q);

// ---------------------------------------------------------------- registry
const registry = new Map();
const COMMON = {
  at: { type: 'seconds', required: false, default: 0, doc: 'when the build starts, in seconds from the start of the shot' },
  dur: { type: 'seconds', required: false, default: 3, doc: 'how long the build takes, in seconds; after it the end state holds' },
  area: { type: 'rect', required: false, default: null, doc: 'override of the picture area { x, y, w, h } in canvas pixels (default: the band of the film)' },
  tone: { type: 'string', required: false, default: 'accent', doc: "the datum's color token: 'accent' | 'ok' | 'ink'" },
};
function register(name, def) {
  if (!name || !def || typeof def.draw !== 'function') throw new Error(`Blocks.register(${name}): a definition needs a draw function`);
  const params = {};
  for (const [k, v] of Object.entries({ ...COMMON, ...(def.params || {}) })) {
    if (!v || !v.type || typeof v.doc !== 'string') throw new Error(`Blocks.register(${name}): parameter "${k}" needs type and doc`);
    params[k] = { type: v.type, required: !!v.required, default: v.default === undefined ? null : v.default, doc: v.doc };
  }
  registry.set(name, { name, claim: def.claim || '', doc: def.doc || '', params, sample: def.sample || null, draw: def.draw });
}
const list = () => [...registry.values()].map(b => JSON.parse(JSON.stringify({ name: b.name, claim: b.claim, doc: b.doc, params: b.params, sample: b.sample })));
function draw(ctx, s, f, pic, area) {
  if (Array.isArray(pic)) { for (const q of pic) draw(ctx, s, f, q, area); return; }
  const b = pic && registry.get(pic.block);
  if (!b) throw new Error(`Blocks.draw: unknown block "${pic && pic.block}" (known: ${[...registry.keys()].join(', ')})`);
  const p = { ...pic };
  for (const [k, v] of Object.entries(b.params)) {
    if (p[k] === undefined || p[k] === null) {
      if (v.required) throw new Error(`block "${b.name}": missing required parameter "${k}"`);
      if (v.default !== null) p[k] = v.default;
    }
  }
  let a = area || p.area || f.band;
  if (a && a.frac && a.x === undefined) { const q = f.band, fr = a.frac; a = { x: q.x + q.w * fr[0], y: q.y + q.h * fr[1], w: q.w * fr[2], h: q.h * fr[3] }; }
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  b.draw(ctx, s, f, p, a);
  ctx.restore();
}

// ================================================================ bars: magnitude, comparison, ranking
register('bars', {
  claim: 'magnitude, comparison, ranking',
  doc: 'Horizontal bars from zero. Reference bars (the yardstick) build first, muted and hatched; the accented bar grows last and its value counts up. The reference leaves a dashed guide across the other rows. At most 7 items.',
  params: {
    items: { type: 'array', required: true, doc: '[{ label, value, ref?: true, accent?: true, at?: seconds }] at most 7. ref: a yardstick (muted, builds first); accent: the datum (default: the last item that is not a ref); at: start of this bar instead of the automatic stagger' },
    unit: { type: 'string', default: '', doc: 'unit written after every value (KM, %, MB)' },
    max: { type: 'number', doc: 'value at the full length of a bar (default: the largest value)' },
    log: { type: 'boolean', default: false, doc: 'logarithmic lengths (a "LOG SCALE" tag is drawn); use only when a bar would leave the room' },
    order: { type: 'string', default: 'given', doc: "'given' | 'desc': order of the rows; the build order is always refs, others, datum" },
    showValue: { type: 'boolean', default: true, doc: 'write the value at the end of each bar' },
    dur: { type: 'seconds', default: 3, doc: 'length of the whole build, seconds' },
  },
  sample: { block: 'bars', unit: 'KM', items: [{ label: 'MOSCOW - ST PETERSBURG', value: 700, ref: true }, { label: 'MOSCOW - KAZAN', value: 800 }, { label: 'MOSCOW - NOVOSIBIRSK', value: 2800, accent: true }] },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, tone = tcol(T, p.tone);
    const items = p.items.slice(0, 7).map((it, i) => ({ ...it, i, v: Math.max(0, toNum(it.value)), dec: decOf(it.value) }));
    const n = items.length; if (!n) return;
    const vmax = p.max || Math.max(...items.map(i => i.v), 1e-9), unit = p.unit || '';
    // who is the datum, and in what order things arrive: the yardstick, the rest, the datum
    let acc = items.filter(i => i.accent && !i.ref);
    if (!acc.length) { const last = [...items].reverse().find(i => !i.ref); if (last) acc = [last]; }
    const isAcc = new Set(acc), G = 1.1, g = .7;
    const order = [...items.filter(i => i.ref), ...items.filter(i => !i.ref && !isAcc.has(i)), ...acc];
    const step = n > 1 ? clamp((p.dur - G) / (n - 1), .12, .6) : 0;
    order.forEach((it, k) => { it.t0 = it.at ?? stagger(p, k, step); it.g = isAcc.has(it) ? G : g; });
    if (p.order === 'desc') items.sort((a, b) => b.v - a.v);
    // geometry
    const numSz = 46, unitSz = 26, labSz = 28, uw = unit ? measure(ctx, f, unit, { size: unitSz }) + 10 * u : 0;
    const reserve = (p.showValue ? Math.max(...items.map(it => measure(ctx, f, fmtNum(it.v, it.dec), { face: 'display', size: numSz + 6 }) + uw + 18 * u)) : 0) + 6 * u;
    const x0 = area.x + 8 * u, L = Math.max(40 * u, area.w - 8 * u - reserve);
    const tagH = p.log ? 44 * u : 0, rowH = clamp((area.h - tagH) / n, 70 * u, 172 * u), blockH = rowH * n;
    const y0 = area.y + tagH + (area.h - tagH - blockH) * .4, labH = 34 * u, bh = clamp(rowH - 58 * u, 22 * u, 84 * u);
    let lo = 0; if (p.log) lo = Math.min(...items.filter(i => i.v > 0).map(i => i.v), vmax) / 10;
    const lenOf = v => p.log ? (v <= lo ? 0 : Math.log(v / lo) / Math.log(vmax / lo)) * L : clamp(v / vmax) * L;
    const lab = (kind, text, x, y, o) => label(ctx, f, kind, text, x, y, { within: area, ...o });
    if (p.log) lab('label', 'LOG SCALE', area.x + area.w, area.y + 14 * u, { align: 'right', size: 24, color: T.muted });
    // chrome: the zero line (still)
    ctx.fillStyle = A(T.ink, .55); ctx.fillRect(x0 - 2 * u, y0 + labH, 3.5 * u, blockH - labH - (rowH - labH - 6 * u - bh) + 2 * u);
    // the yardstick's guide: a dashed line through the bars of the rows below it (never through their labels)
    items.forEach((it, k) => {
      if (!it.ref) return;
      const q = seg(t, it.t0 + it.g, it.t0 + it.g + .5), gx = x0 + lenOf(it.v);
      if (q <= 0) return;
      ctx.save(); ctx.strokeStyle = A(T.muted, .85); ctx.lineWidth = 2.5 * u; ctx.setLineDash([8 * u, 9 * u]);
      for (let j = k + 1; j < n; j++) {
        const by = y0 + j * rowH + labH + 6 * u, a0 = by - 5 * u, a1 = by + bh + 5 * u, qq = clamp(q * (n - k) - (j - k - 1));
        if (qq > 0) { ctx.beginPath(); ctx.moveTo(gx, a0); ctx.lineTo(gx, lerp(a0, a1, qq)); ctx.stroke(); }
      }
      ctx.restore();
    });
    items.forEach((it, k) => {
      const rowTop = y0 + k * rowH, by = rowTop + labH + 6 * u, mid = by + bh / 2, kk = seg(t, it.t0, it.t0 + it.g), e = E.outCubic(kk);
      const datum = isAcc.has(it), color = it.ref ? T.muted : datum ? tone : T.ink, len = lenOf(it.v) * e;
      lab('label', it.label, x0, rowTop + labH / 2, { size: labSz, wt: datum ? 700 : 600, color: it.ref ? T.muted : T.ink, a: seg(t, it.t0 - .1, it.t0 + .25), maxW: area.w - 12 * u });
      if (len > .5) {
        if (it.ref) {
          ctx.save(); hatchRect(ctx, x0, by, len, bh, A(T.muted, .6), 11 * u, 2.5 * u);
          ctx.strokeStyle = T.muted; ctx.lineWidth = 3 * u; ctx.strokeRect(x0 + 1.5 * u, by + 1.5 * u, len - 3 * u, bh - 3 * u); ctx.restore();
        } else { ctx.fillStyle = datum ? color : A(color, .9); ctx.fillRect(x0, by, len, bh); }
      }
      if (p.showValue && kk > 0) {
        const nb = lab('number', fmtNum(it.v * e, it.dec), x0 + len + 14 * u, mid, { face: 'display', size: datum ? numSz + 6 : numSz, color, a: seg(kk, 0, .12) });
        if (unit && nb) lab('label', unit, nb.x1 + 10 * u, mid + 4 * u, { size: unitSz, color: T.muted, a: seg(kk, 0, .12) });
      }
    });
  },
});

// ================================================================ counter: magnitude
register('counter', {
  claim: 'magnitude',
  doc: 'One large number counting up, with its unit. With ref, a muted hatched bar of the reference value is drawn first and the number\'s own bar grows against it at the same scale.',
  params: {
    value: { type: 'number', required: true, doc: 'the number to count to' },
    from: { type: 'number', default: 0, doc: 'start of the count (must be > 0 with log)' },
    unit: { type: 'string', default: '', doc: 'unit written after the number (KM, LINES)' },
    format: { type: 'string', default: 'int', doc: "'int' (grouped digits), 'plain', or a number of decimals: 1, 2" },
    log: { type: 'boolean', default: false, doc: 'count and draw the bars in log space (a LOG SCALE tag appears)' },
    ref: { type: 'object', doc: '{ label, value, at? }: the yardstick, drawn first in the same encoding and scale' },
    label: { type: 'string', doc: 'what is measured (mono line above the number, or over its bar when there is a ref)' },
    dur: { type: 'seconds', default: 2.4, doc: 'seconds the count takes (the yardstick adds 0.95 s before it)' },
  },
  sample: { block: 'counter', value: 2813, unit: 'KM', label: 'MOSCOW - NOVOSIBIRSK', ref: { label: 'MOSCOW - ST PETERSBURG', value: 700 } },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, tone = tcol(T, p.tone), to = toNum(p.value), from = toNum(p.from);
    const ref = p.ref && p.ref.value != null ? p.ref : null, fm = p.format;
    const dec = typeof fm === 'number' ? fm : (fm === 'plain' || fm === 'int') ? decOf(to) : parseInt(fm, 10) || 0;
    const txt = v => (fm === 'plain' ? (dec ? v.toFixed(dec) : String(Math.round(v))) : fmtNum(v, dec));
    const t0 = p.at + (ref ? .95 : 0), k = seg(t, t0, t0 + p.dur), e = E.outExpo(k);
    const value = p.log && from > 0 && to > 0 ? Math.exp(lerp(Math.log(from), Math.log(to), e)) : lerp(from, to, e);
    const lab = (kind, text, x, y, o) => label(ctx, f, kind, text, x, y, { within: area, ...o });
    // the number: digits in fixed cells so it does not jitter; sized to fit the width with its unit
    const unit = p.unit || '', final = txt(to), ref100 = { face: 'display', size: 100 };
    const cell100 = measure(ctx, f, '0', ref100) / u, w100 = [...final].reduce((a, ch) => a + (/\d/.test(ch) ? cell100 : measure(ctx, f, ch, ref100) / u), 0);
    const unitSz = 36, uw = unit ? measure(ctx, f, unit, { size: unitSz }) + 18 * u : 0;
    const barsH = ref ? 290 * u : 0, labelH = p.label && !ref ? 52 * u : 0, avail = area.h - barsH - labelH - 30 * u;
    let size = Math.min(300, (area.w - 14 * u - uw) / (w100 / 100) / u, avail / (.8 * u)) ; size = Math.max(size, 60);
    const nh = size * .8 * u, total = labelH + nh + (ref ? 36 * u + barsH : 0);
    let y = area.y + Math.max(0, (area.h - total) * .42);
    const x0 = area.x + 8 * u;
    if (labelH) lab('label', p.label, x0, y + 16 * u, { size: 28, color: T.muted, a: seg(t, p.at, p.at + .4), typed: seg(t, p.at, p.at + .7) });
    y += labelH;
    const base = y + nh, cell = cell100 * size / 100 * u, fs = size, a = seg(t, t0 - .25, t0);
    let x = x0;
    const str = txt(value);
    for (const ch of [...str]) {
      const isD = /\d/.test(ch), wch = isD ? cell : measure(ctx, f, ch, { face: 'display', size: fs });
      if (ch !== ' ') label(ctx, f, 'number', ch, x + (isD ? (cell - measure(ctx, f, ch, { face: 'display', size: fs })) / 2 : 0), base, { face: 'display', size: fs, base: 'alphabetic', color: tone, a, nobox: true, track: 0 });
      x += wch;
    }
    if (a > 0) boxOf(ctx, f, 'number', x0, base - nh, Math.min(x0 + [...final].reduce((q, ch) => q + (/\d/.test(ch) ? cell : measure(ctx, f, ch, { face: 'display', size: fs })), 0), area.x + area.w), base, final);
    if (unit) lab('label', unit, x0 + [...final].reduce((q, ch) => q + (/\d/.test(ch) ? cell : measure(ctx, f, ch, { face: 'display', size: fs })), 0) + 18 * u, base - 2 * u, { size: unitSz, base: 'alphabetic', color: T.muted, a: seg(t, p.at, p.at + .5) });
    if (!ref) return;
    // the yardstick and the number's bar, one scale
    const rv = toNum(ref.value), vmax = Math.max(to, rv), lo = p.log ? Math.min(to, rv, from > 0 ? from : Infinity) / 10 : 0;
    const refTxt = txt(rv) + (unit ? ' ' + unit : ''), refW = measure(ctx, f, refTxt, { size: 28 }) + 16 * u;
    const L = area.w - 16 * u - refW, lenOf = v => p.log ? (v <= lo ? 0 : Math.log(v / lo) / Math.log(vmax / lo)) * L : clamp(v / vmax) * L;
    const by0 = base + 44 * u, bh = 52 * u, rowH = 128 * u;
    if (p.log) lab('label', 'LOG SCALE', area.x + area.w, area.y + 14 * u, { align: 'right', size: 24, color: T.muted });
    ctx.fillStyle = A(T.ink, .55); ctx.fillRect(x0 - 2 * u, by0 + 28 * u, 3.5 * u, rowH + bh + 12 * u);
    const kr = E.outCubic(seg(t, p.at, p.at + .8)), lr = lenOf(rv) * kr;
    lab('label', ref.label || '', x0 + 6 * u, by0 + 15 * u, { size: 26, color: T.muted, a: seg(t, p.at, p.at + .3) });
    if (lr > .5) {
      hatchRect(ctx, x0, by0 + 32 * u, lr, bh, A(T.muted, .6), 11 * u, 2.5 * u);
      ctx.strokeStyle = T.muted; ctx.lineWidth = 3 * u; ctx.strokeRect(x0 + 1.5 * u, by0 + 32 * u + 1.5 * u, lr - 3 * u, bh - 3 * u);
      lab('label', refTxt, x0 + lr + 14 * u, by0 + 32 * u + bh / 2, { size: 28, color: T.muted, a: seg(kr, 0, .15) });
    }
    const dy = by0 + rowH;
    if (p.label) lab('label', p.label, x0 + 6 * u, dy + 15 * u, { size: 26, color: T.ink, a: seg(t, t0 - .2, t0 + .2) });
    const gq = seg(t, p.at + .8, p.at + 1.3);
    if (gq > 0) {
      ctx.save(); ctx.strokeStyle = A(T.muted, .8); ctx.lineWidth = 2.5 * u; ctx.setLineDash([8 * u, 9 * u]); ctx.beginPath();
      const gx = x0 + lenOf(rv), a0 = dy + 32 * u - 5 * u; ctx.moveTo(gx, a0); ctx.lineTo(gx, lerp(a0, dy + 32 * u + bh + 5 * u, E.outCubic(gq))); ctx.stroke(); ctx.restore();
    }
    const ld = lenOf(Math.max(value, p.log ? lo : 0));
    if (k > 0 && ld > .5) { ctx.fillStyle = tone; ctx.fillRect(x0, dy + 32 * u, ld, bh); }
  },
});

// ================================================================ rail: change, location in time
register('rail', {
  claim: 'change, location in time',
  doc: 'A horizontal timeline: spans are bars on the axis, marks are flags placed by date. The axis is chrome (still); spans grow and flags rise from left to right, or each at its own time. Overlapping spans stack in lanes.',
  params: {
    span: { type: 'array', required: true, doc: '[a, b]: the dates at the two ends of the axis' },
    marks: { type: 'array', default: [], doc: '[{ t, label?, accent?, at?: seconds }]: a flag at date t with the year written big and the label under it; at: the time the flag rises (default: when the build sweep reaches t)' },
    spans: { type: 'array', default: [], doc: "[{ a, b, label?, style: 'solid' | 'hatch', accent?, at?: seconds, dur?: seconds }]: a bar between two dates; at/dur: it grows from at for dur (default 0.8 s) instead of with the sweep" },
    cursor: { type: 'object', doc: 'a date (number) or { from?, to, at?, dur? }: an accent playhead on the axis with its date written on top' },
    title: { type: 'string', doc: 'a muted mono line at the top left of the area' },
    dur: { type: 'seconds', default: 3.2, doc: 'length of the left-to-right sweep that places everything without its own at' },
  },
  sample: { block: 'rail', span: [1911, 1973], title: 'ONE LIFE', spans: [{ a: 1911, b: 1973, label: 'LIFE', style: 'solid' }, { a: 1942, b: 1945, label: 'WAR', style: 'hatch' }], marks: [{ t: 1911, label: 'BORN' }, { t: 1932, label: 'STUDENT' }, { t: 1952, label: 'COURSE', accent: true }, { t: 1973, label: 'DIED' }] },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, tone = tcol(T, p.tone), [a, b] = p.span, short = area.h < 460;
    const x0 = area.x + 10 * u, x1 = area.x + area.w - 10 * u, xOf = v => lerp(x0, x1, (v - a) / (b - a)), frac = v => clamp((v - a) / (b - a));
    const lab = (kind, text, x, y, o) => label(ctx, f, kind, text, x, y, { within: area, ...o });
    const big = area.h >= 620, yearSz = short ? 40 : big ? 64 : 52, labSz = big ? 28 : 26, fh = (short ? 46 : big ? 104 : 84) * u, laneH = (short ? 34 : big ? 58 : 44) * u;
    const sweep = seg(t, p.at, p.at + p.dur);
    const yText = v => String(Math.round(v * 100) / 100);
    // lanes for spans
    const spans = (p.spans || []).map((q, i) => ({ ...q, i })).sort((m, n) => m.a - n.a || (n.b - n.a) - (m.b - m.a)), ends = [];
    for (const q of spans) { let l = ends.findIndex(e => e <= q.a); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = q.b; q.lane = l; }
    const lanes = ends.length;
    const axisY = area.y + area.h * (short ? .5 : .5) + (lanes > 1 ? (lanes - 1) * (laneH + 6 * u) * .35 : 0);
    const topEdge = lanes ? axisY - laneH / 2 - (lanes - 1) * (laneH + 6 * u) : axisY - 4 * u, botEdge = lanes ? axisY + laneH / 2 : axisY + 4 * u;
    const baseUp = topEdge - 12 * u, baseDn = botEdge + 12 * u, gap = 8 * u;
    const cursorOn = p.cursor != null, headTop = area.y + (p.title ? 62 * u : 6 * u) + (cursorOn ? 54 * u : 0);
    const plan = (inl, fh) => {
      const nUp = Math.max(1, Math.floor((baseUp - headTop) / (fh + gap))), nDn = Math.max(1, Math.floor((area.y + area.h - baseDn) / (fh + gap)));
      // flags: marks (year + label) and labels of spans that do not fit inside their bar; collision-free slots above and below the axis
      const flags = [], outs = [], clashes = { n: 0 };
      for (const m of (p.marks || [])) {
        const yw = measure(ctx, f, yText(m.t), { face: 'display', size: yearSz }), lw = m.label ? measure(ctx, f, m.label, { size: labSz }) : 0;
        flags.push({ kind: 'mark', m, x: xOf(m.t), w: inl ? yw + (lw ? 12 * u + lw : 0) : Math.max(yw, lw) });
      }
      for (const q of spans) {
        if (!q.label) continue;
        const lw = measure(ctx, f, q.label, { size: labSz }), barW = (xOf(q.b) - xOf(q.a)) - 20 * u;
        q.inside = q.style !== 'hatch' && lw <= barW;
      }
      if (!(p.marks || []).some(m => m.t === a)) flags.push({ kind: 'end', end: 0, v: a, x: x0, w: measure(ctx, f, yText(a), { size: labSz }), noPole: true });
      if (!(p.marks || []).some(m => m.t === b)) flags.push({ kind: 'end', end: 1, v: b, x: x1, w: measure(ctx, f, yText(b), { size: labSz }), noPole: true });
      flags.sort((m, n) => m.x - n.x);
      const placed = [], hit = (A_, B_) => A_.x0 < B_.x1 + gap && A_.x1 > B_.x0 - gap && A_.y0 < B_.y1 + gap && A_.y1 > B_.y0 - gap;
      for (const fl of flags) {
        const textH = fl.kind === 'mark' ? fh : 34 * u, slots = [];
        for (let L = 0; L < Math.max(nUp, nDn); L++) { if (L < nUp) slots.push([-1, L]); if (L < nDn) slots.push([1, L]); }
        if (fl.kind === 'end' || fl.kind === 'span') slots.sort((m, n) => (m[0] === 1 ? 0 : 1) - (n[0] === 1 ? 0 : 1) || m[1] - n[1]);      // end labels and span names prefer below the axis
        let best = null, bestN = Infinity;
        for (const [dir, L] of slots) {
          const flip = fl.noPole ? false : fl.x + 12 * u + fl.w > x1 + 4 * u;
          const bx0 = fl.noPole ? clamp(fl.x - fl.w / 2, area.x, area.x + area.w - fl.w) : flip ? fl.x - 12 * u - fl.w : fl.x + 12 * u;
          const by0 = dir < 0 ? baseUp - L * (fh + gap) - textH : baseDn + L * (fh + gap);
          const box = { x0: bx0, x1: bx0 + fl.w, y0: by0, y1: by0 + textH };
          const pole = fl.noPole ? null : { x0: fl.x - 2 * u, x1: fl.x + 2 * u, y0: dir < 0 ? by0 : axisY, y1: dir < 0 ? axisY : by0 + textH };
          const nClash = placed.filter(o_ => hit(box, o_.box) || (pole && hit(pole, o_.box)) || (o_.pole && hit(box, o_.pole))).length;
          if (nClash < bestN) { bestN = nClash; best = { dir, L, box, pole, flip }; }
          if (!nClash) break;
        }
        clashes.n += bestN; Object.assign(fl, best); placed.push(fl);
      }
      // names of spans that do not fit in their bar: right above or below the bar, shifted sideways to a free place
      for (const q of spans) {
        if (!q.label || q.inside) continue;
        const lw = measure(ctx, f, q.label, { size: labSz }), xa = xOf(q.a), xb = xOf(q.b), yTop = axisY - laneH / 2 - q.lane * (laneH + 6 * u) - 6 * u, yBot = axisY - laneH / 2 - q.lane * (laneH + 6 * u) + laneH + 6 * u;
        let best = null, bestN = Infinity;
        for (const dir of lanes === 1 ? [1, -1] : q.lane === 0 ? [1] : [-1]) for (const al of [0, -1, 1]) {      // with stacked lanes only the outer sides are free
          const cx = (xa + xb) / 2, bx0 = clamp(al === 0 ? cx - lw / 2 : al < 0 ? xb - lw : xa, area.x, area.x + area.w - lw), y0 = dir < 0 ? yTop - 32 * u : yBot, box = { x0: bx0, x1: bx0 + lw, y0, y1: y0 + 32 * u };
          const tight = (A_, B_) => A_.x0 < B_.x1 + 2 && A_.x1 > B_.x0 - 2 && A_.y0 < B_.y1 + 2 && A_.y1 > B_.y0 - 2, n_ = placed.filter(o_ => tight(box, o_.box) || (o_.pole && tight(box, o_.pole))).length;
          if (n_ < bestN) { bestN = n_; best = box; }
          if (!n_) break;
        }
        clashes.n += bestN; outs.push([q, best]); placed.push({ box: best });
      }
      return { flags, outs, inl, fh, clashes: clashes.n };
    };
    // a short area first tries flags on one line (46 px); if they collide, the stacked, narrower form (year over label)
    let P = plan(short, fh);
    if (short && P.clashes) { const P2 = plan(false, 84 * u); if (P2.clashes < P.clashes) P = P2; }
    const flags = P.flags; for (const [q, box] of P.outs) q.out = box;
    // chrome: axis and ticks
    ctx.strokeStyle = A(T.ink, .6); ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(x0, axisY); ctx.lineTo(x1, axisY); ctx.stroke();
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000], stepV = nice.find(v => (b - a) / v <= 18) || 1000;
    ctx.strokeStyle = A(T.ink, .38); ctx.lineWidth = 1.5 * u; ctx.beginPath();
    for (let v = Math.ceil(a / stepV) * stepV; v <= b; v += stepV) { const x = xOf(v); ctx.moveTo(x, axisY - 7 * u); ctx.lineTo(x, axisY + 7 * u); }
    ctx.stroke(); ctx.strokeStyle = A(T.ink, .6); ctx.lineWidth = 3 * u; ctx.beginPath();
    for (const x of [x0, x1]) { ctx.moveTo(x, axisY - 12 * u); ctx.lineTo(x, axisY + 12 * u); }
    ctx.stroke();
    if (p.title) lab('label', p.title, area.x + 8 * u, area.y + 30 * u, { size: 28, color: T.muted, a: seg(t, p.at, p.at + .4), typed: seg(t, p.at, p.at + .8) });
    // poles first (under the bars), then bars, then dots and text
    for (const fl of flags) {
      if (fl.kind !== 'mark') continue;
      const m = fl.m, tm = m.at ?? (p.at + p.dur * frac(m.t)), q = E.outCubic(seg(t, tm, tm + .45));
      if (q <= 0) continue;
      ctx.strokeStyle = m.accent ? tone : A(T.ink, .75); ctx.lineWidth = 3 * u; ctx.beginPath();
      const yEnd = fl.dir < 0 ? fl.box.y0 : fl.box.y1; ctx.moveTo(fl.x, axisY); ctx.lineTo(fl.x, lerp(axisY, yEnd, q)); ctx.stroke();
    }
    for (const q of spans) {
      const xa = xOf(q.a), xb = xOf(q.b), own = q.at != null, tm = own ? q.at : p.at + p.dur * frac(q.a);
      const k = own ? E.outCubic(seg(t, tm, tm + (q.dur ?? .8))) : seg(t, tm, tm + Math.max(.2, p.dur * (frac(q.b) - frac(q.a))));
      const w = (xb - xa) * k; if (w <= .5) continue;
      const yy = axisY - laneH / 2 - q.lane * (laneH + 6 * u);
      if (q.style === 'hatch') {
        hatchRect(ctx, xa, yy, w, laneH, A(T.muted, .7), 9 * u, 2.5 * u);
        ctx.strokeStyle = T.muted; ctx.lineWidth = 3 * u; ctx.strokeRect(xa + 1.5 * u, yy + 1.5 * u, w - 3 * u, laneH - 3 * u);
      } else { ctx.fillStyle = q.accent ? tone : A(T.ink, .92); ctx.fillRect(xa, yy, w, laneH); }
      if (q.label && k >= 1) {
        const la = seg(t, tm + (own ? (q.dur ?? .8) : 0), tm + (own ? (q.dur ?? .8) : 0) + .3);
        if (q.inside) {                                         // inside the bar, on the side where no dot of a mark sits
          const lw = measure(ctx, f, q.label, { size: labSz }), mx = (p.marks || []).map(m => xOf(m.t)), xs_ = [xa + 14 * u, (xa + xb - lw) / 2, xb - 14 * u - lw];
          const x_ = xs_.find(x => !mx.some(m => m > x - 16 * u && m < x + lw + 16 * u)) ?? xs_[0];
          lab('label', q.label, x_, yy + laneH / 2, { size: labSz, color: T.bg, a: la });
        }
        else lab('label', q.label, q.out.x0, (q.out.y0 + q.out.y1) / 2, { size: labSz, color: T.ink, a: la, halo: T.bg });
      }
    }
    for (const fl of flags) {
      if (fl.kind === 'mark') {
        const m = fl.m, tm = m.at ?? (p.at + p.dur * frac(m.t)), q = seg(t, tm, tm + .45); if (q <= 0) continue;
        const pop = E.outBack(seg(t, tm, tm + .3)), col = m.accent ? tone : T.ink;
        ctx.fillStyle = T.bg; ctx.beginPath(); ctx.arc(fl.x, axisY, 15 * u * pop, 0, TAU); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(fl.x, axisY, 10.5 * u * pop, 0, TAU); ctx.fill();
        const ta = seg(q, .35, .85), bx = fl.flip ? fl.box.x1 : fl.box.x0, al = fl.flip ? 'right' : 'left';
        if (P.inl) {
          const nb = lab('number', yText(m.t), bx, (fl.box.y0 + fl.box.y1) / 2, { face: 'display', size: yearSz, color: col, align: al, a: ta, base: 'middle' });
          if (m.label) lab('label', m.label, fl.flip ? fl.box.x0 : bx + (nb ? nb.w : 0) + 12 * u, (fl.box.y0 + fl.box.y1) / 2 + 3 * u, { size: labSz, color: T.ink, align: 'left', a: ta });
        } else {
          lab('number', yText(m.t), bx, fl.box.y0 + yearSz * .5 * u, { face: 'display', size: yearSz, color: col, align: al, a: ta });
          if (m.label) lab('label', m.label, bx, fl.box.y0 + yearSz * .5 * u + 42 * u, { size: labSz, color: T.ink, align: al, a: ta });
        }
      } else {
        lab('label', yText(fl.v), (fl.box.x0 + fl.box.x1) / 2, (fl.box.y0 + fl.box.y1) / 2, { align: 'center', size: labSz, color: T.muted, a: seg(t, p.at, p.at + .4) });
      }
    }
    // the playhead
    if (cursorOn) {
      const c = typeof p.cursor === 'object' ? p.cursor : { to: p.cursor }, c0 = c.from ?? c.to, ca = c.at ?? p.at, cd = c.dur ?? 1.2;
      const v = lerp(c0, c.to, E.inOutCubic(seg(t, ca, ca + cd))), cx = xOf(clamp(v, a, b)), top = area.y + (p.title ? 44 * u : 6 * u);
      ctx.strokeStyle = tone; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(cx, top + 50 * u); ctx.lineTo(cx, axisY + 18 * u); ctx.stroke();
      ctx.fillStyle = tone; ctx.beginPath(); ctx.moveTo(cx, top + 62 * u); ctx.lineTo(cx - 9 * u, top + 46 * u); ctx.lineTo(cx + 9 * u, top + 46 * u); ctx.closePath(); ctx.fill();
      lab('number', yText(v), cx, top + 22 * u, { face: 'display', size: 44, color: tone, align: 'center', a: seg(t, ca - .2, ca + .2) });
    }
  },
});

// ================================================================ tree: structure
register('tree', {
  claim: 'structure',
  doc: 'A tree that fans out level by level and grows; dots are people/things, a running count sits in the corner, only the listed names are written. Edges draw from the parent to the child and the dot lands when the edge arrives.',
  params: {
    root: { type: 'string', default: '', doc: 'the name of the root (written beside the root dot)' },
    levels: { type: 'array', required: true, doc: '[n1, n2, ...]: how many nodes each level has (children are spread over the parents evenly); 1-4 levels' },
    names: { type: 'array', default: [], doc: '[{ label, level, i?, accent?, at?: seconds }]: a node gets a written name; level 1..N, i the index within the level (default: spread evenly); at: when the name appears (default: when its dot lands)' },
    countLabel: { type: 'string', default: '', doc: 'the word under the running count (e.g. STUDENTS); no count is drawn without it' },
    grow: { type: 'string', default: 'up', doc: "'up' (root at the bottom, leaves on top) | 'down'" },
    count: { type: 'string', default: 'all', doc: "'all': the count is every node below the root; 'last': only the deepest level" },
    dur: { type: 'seconds', default: 3.2, doc: 'seconds the whole growth takes' },
  },
  sample: { block: 'tree', root: 'TEACHER', levels: [5, 18], countLabel: 'STUDENTS', grow: 'up', names: [{ label: 'ERSHOV', level: 1, accent: true }, { label: 'ONE OF 18', level: 2, i: 14 }] },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, tone = tcol(T, p.tone), up = p.grow !== 'down';
    const levels = p.levels.slice(0, 4).map(n => Math.max(1, Math.round(n))), Ln = levels.length, nodeCount = [1, ...levels];
    const lab = (kind, text, x, y, o) => label(ctx, f, kind, text, x, y, { within: area, ...o });
    const padX = 40 * u, W_ = area.w - 2 * padX, cx = area.x + area.w / 2;
    const rootY = up ? area.y + area.h - 92 * u : area.y + 92 * u, leafY = up ? area.y + 96 * u : area.y + area.h - 96 * u;
    const yOf = l => lerp(rootY, leafY, l / Ln);
    // x of every node: leaves evenly spread, parents above the mean of their children
    const xs = nodeCount.map(n => Array.from({ length: n }, (_, j) => area.x + padX + (j + .5) / n * W_));
    const parentOf = (l, j) => Math.min(nodeCount[l - 1] - 1, Math.floor(j * nodeCount[l - 1] / nodeCount[l]));
    for (let l = Ln - 1; l >= 0; l--) {
      const kids = Array.from({ length: nodeCount[l] }, () => []);
      for (let j = 0; j < nodeCount[l + 1]; j++) kids[parentOf(l + 1, j)].push(xs[l + 1][j]);
      kids.forEach((k, j) => { if (k.length) xs[l][j] = k.reduce((q, v) => q + v, 0) / k.length; });
    }
    xs[0][0] = xs[1].reduce((q, v) => q + v, 0) / xs[1].length;
    const spacing = W_ / nodeCount[Ln], rLeaf = clamp(spacing * .3, 4 * u, 13 * u), rOf = l => l === 0 ? 17 * u : lerp(15 * u, rLeaf, l / Ln);
    // timeline of every non-root node
    const levelDur = p.dur / Ln, ed = Math.max(.3, levelDur * .5), tl = [];
    for (let l = 1; l <= Ln; l++) tl[l] = Array.from({ length: nodeCount[l] }, (_, j) => p.at + (l - 1) * levelDur + (j / nodeCount[l]) * levelDur * .5);
    // names: pick the nodes
    const named = new Map(), perLevel = {};
    for (const nm of (p.names || [])) (perLevel[nm.level] = perLevel[nm.level] || []).push(nm);
    for (const [lv, arr] of Object.entries(perLevel)) {
      const l = clamp(+lv, 1, Ln), n = nodeCount[l];
      arr.forEach((nm, k) => { const j = nm.i != null ? clamp(nm.i, 0, n - 1) : clamp(Math.round((k + .5) / arr.length * n - .5), 0, n - 1); named.set(l + ':' + j, { ...nm, l, j }); });
    }
    // edges
    const edgePts = (l, j) => {
      const pj = parentOf(l, j), ax = xs[l - 1][pj], ay = yOf(l - 1), bx = xs[l][j], by = yOf(l), my = (ay + by) / 2, o = [];
      for (let i = 0; i <= 14; i++) { const q = i / 14; o.push(bez(ax, ax, bx, bx, q), bez(ay, my, my, by, q)); }
      return o;
    };
    ctx.lineWidth = 3 * u;
    for (let l = 1; l <= Ln; l++) for (let j = 0; j < nodeCount[l]; j++) {
      const q = E.outCubic(seg(t, tl[l][j], tl[l][j] + ed)); if (q <= 0) continue;
      ctx.strokeStyle = A(T.ink, l === Ln && Ln > 1 ? .5 : .65); strokeProgress(ctx, edgePts(l, j), q);
    }
    // dots
    let counted = 0; const total = p.count === 'last' ? levels[Ln - 1] : levels.reduce((q, v) => q + v, 0);
    ctx.fillStyle = T.ink; ctx.beginPath(); ctx.arc(xs[0][0], rootY, rOf(0), 0, TAU); ctx.fill();
    for (let l = 1; l <= Ln; l++) for (let j = 0; j < nodeCount[l]; j++) {
      const td = tl[l][j] + ed, pop = E.outBack(seg(t, td, td + .28)), nm = named.get(l + ':' + j);
      if (pop > 0 && (p.count === 'last' ? l === Ln : true)) counted++;
      if (pop <= 0) continue;
      ctx.fillStyle = nm && nm.accent ? tone : T.ink;
      ctx.beginPath(); ctx.arc(xs[l][j], yOf(l), rOf(l) * (nm && nm.accent ? 1.5 : 1) * pop, 0, TAU); ctx.fill();
    }
    if (p.root) lab('name', p.root, xs[0][0] + rOf(0) + 16 * u, rootY, { face: 'display', size: 44, color: T.ink, a: seg(t, p.at, p.at + .4), base: 'middle' });
    // names
    for (const nm of named.values()) {
      const { l, j } = nm, nx = xs[l][j], ny = yOf(l), r = rOf(l) * (nm.accent ? 1.5 : 1), td = tl[l][j] + ed, ta = nm.at ?? (td + .1), a = seg(t, ta, ta + .35);
      if (a <= 0) continue;
      const col = nm.accent ? tone : T.ink;
      if (nm.accent) { const q = seg(t, ta, ta + .7); if (q > 0 && q < 1) { ctx.strokeStyle = A(tone, (1 - q) * .7); ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(nx, ny, r * (1 + 2.2 * E.outCubic(q)), 0, TAU); ctx.stroke(); } }
      if (l === Ln) {                                              // leaves are dense: the name stands above (below) the dot, on a leader
        const dy = (up ? -1 : 1) * (r + 44 * u);
        ctx.strokeStyle = A(col, .8 * a); ctx.lineWidth = 2.5 * u; ctx.beginPath(); ctx.moveTo(nx, ny + (up ? -r - 4 * u : r + 4 * u)); ctx.lineTo(nx, ny + dy + (up ? 20 * u : -20 * u)); ctx.stroke();
        lab('name', nm.label, nx, ny + dy, { face: 'display', size: 40, color: col, align: 'center', a });
      } else {                                                     // inner levels: the name on the stem, between the node and its parent
        const dy = (up ? 1 : -1) * (r + 34 * u);
        lab('name', nm.label, nx, ny + dy, { face: 'display', size: 40, color: col, align: 'center', a, halo: T.bg });
      }
    }
    // the running count
    if (p.countLabel) {
      const x = area.x + 8 * u, yb = up ? area.y + area.h - 14 * u : area.y + 118 * u;
      lab('number', String(Math.min(counted, total)), x, yb, { face: 'display', size: 120, color: tone, base: 'alphabetic', a: seg(t, p.at, p.at + .3) });
      lab('label', p.countLabel, x, up ? yb - 118 * u : yb + 34 * u, { size: 26, color: T.muted, a: seg(t, p.at, p.at + .4) });
    }
  },
});

// ================================================================ units: part of a whole, magnitude
register('units', {
  claim: 'part of a whole, magnitude',
  doc: 'A unit pictogram (Isotype): one icon per unit in rows, arriving one at a time while a running count climbs. Groups differ by ink / muted / accent only; unfilled slots stay as outlines, so a part is seen against its whole.',
  params: {
    n: { type: 'number', required: true, doc: 'the total number of slots (10-60 is readable)' },
    perRow: { type: 'number', default: 10, doc: 'icons per row' },
    icon: { type: 'string', default: 'dot', doc: "'dot' | 'square' | 'person'" },
    groups: { type: 'array', default: [], doc: "[{ n, label?, tone?: 'accent'|'ink'|'muted'|'ok', at?: seconds }]: consecutive runs of filled icons; a label is written beside the group's last icon on a leader line; at: when the group starts to arrive (default: after the previous one). Without groups all n icons are filled and accent" },
    unit: { type: 'string', default: '', doc: 'the word after the running count (PEOPLE, SCHEMES)' },
    dur: { type: 'seconds', default: 3, doc: 'seconds for all icons to arrive' },
  },
  sample: { block: 'units', n: 30, perRow: 10, icon: 'person', unit: 'PEOPLE', groups: [{ n: 18, label: 'STUDENTS' }, { n: 6, label: 'TEACHERS' }] },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, tone = tcol(T, p.tone), total = Math.max(1, Math.round(p.n)), perRow = Math.max(1, Math.round(p.perRow)), rows = Math.ceil(total / perRow);
    const lab = (kind, text, x, y, o) => label(ctx, f, kind, text, x, y, { within: area, ...o });
    let groups = (p.groups && p.groups.length ? p.groups : [{ n: total }]).map(g => ({ ...g })), left = total;
    for (const g of groups) { g.n = Math.max(0, Math.min(left, Math.round(g.n))); left -= g.n; }
    const filled = total - left, G = groups.length;
    const defTone = k => G === 1 ? 'accent' : k === G - 1 ? 'accent' : (k % 2 === 0 ? 'muted' : 'ink');
    const colOf = nm => nm === 'accent' ? tone : tcol(T, nm);
    const interval = clamp(p.dur / Math.max(1, filled), .03, .3);
    let idx = 0; const arrive = new Array(total).fill(Infinity), gOf = new Array(total).fill(-1);
    groups.forEach((g, k) => {
      g.tone = g.tone || defTone(k); g.t0 = g.at ?? stagger(p, idx, interval); g.first = idx;
      for (let i = 0; i < g.n; i++) { arrive[idx + i] = g.t0 + i * interval; gOf[idx + i] = k; }
      idx += g.n; g.last = idx - 1;
    });
    // geometry: header (the count), grid, labels column
    const hh = 118 * u, labelled = groups.filter(g => g.label && g.n > 0);
    const numW = labelled.length ? Math.max(...labelled.map(g => measure(ctx, f, String(g.n), { face: 'display', size: 42 }))) : 0;
    const labW = labelled.length ? Math.max(...labelled.map(g => measure(ctx, f, g.label, { size: 26 }))) : 0;
    const colW = labelled.length ? Math.min(area.w * .46, numW + labW + 36 * u) : 0, lblGap = labelled.length ? 30 * u : 0;
    const gh = area.h - hh - 20 * u, cell = Math.min((area.w - colW - lblGap - 8 * u) / perRow, gh / rows, 132 * u);
    const gx = area.x + 4 * u, gy = area.y + hh + 20 * u, gridW = cell * perRow, R = cell * .5;
    const pos = i => [gx + (i % perRow + .5) * cell, gy + (Math.floor(i / perRow) + .5) * cell];
    const shape = (cx, cy, sc, fill) => {
      const r = R * .8 * sc;
      ctx.beginPath();
      if (p.icon === 'square') ctx.roundRect(cx - r * .85, cy - r * .85, r * 1.7, r * 1.7, r * .18);
      else if (p.icon === 'person') { ctx.arc(cx, cy - r * .5, r * .42, 0, TAU); ctx.moveTo(cx + r * .66, cy + r * .9); ctx.lineTo(cx + r * .66, cy + r * .35); ctx.arc(cx, cy + r * .35, r * .66, 0, -Math.PI, true); ctx.lineTo(cx - r * .66, cy + r * .9); ctx.closePath(); }
      else ctx.arc(cx, cy, r * .82, 0, TAU);
      if (fill) ctx.fill(); else ctx.stroke();
    };
    // chrome: the empty slots
    ctx.strokeStyle = A(T.muted, .5); ctx.lineWidth = 2 * u;
    for (let i = 0; i < total; i++) { if (arrive[i] === Infinity || t < arrive[i]) { const [cx, cy] = pos(i); shape(cx, cy, 1, false); } }
    // arrived icons
    let counted = 0, lastTone = null;
    for (let i = 0; i < total; i++) {
      if (arrive[i] === Infinity) continue;
      const q = seg(t, arrive[i], arrive[i] + .3); if (q <= 0) continue;
      counted++; lastTone = groups[gOf[i]].tone;
      const [cx, cy] = pos(i); ctx.fillStyle = colOf(groups[gOf[i]].tone);
      shape(cx, cy, E.outBack(q), true);
    }
    // the running count
    const cc = lastTone ? (lastTone === 'muted' ? T.ink : colOf(lastTone)) : T.ink, nb = lab('number', String(counted), area.x + 6 * u, area.y + hh - 22 * u, { face: 'display', size: 118, base: 'alphabetic', color: cc, a: seg(t, p.at, p.at + .2) || (counted ? 1 : 0) });
    if (p.unit && nb) lab('label', p.unit, nb.x1 + 18 * u, area.y + hh - 24 * u, { size: 30, base: 'alphabetic', color: T.muted, a: seg(t, p.at, p.at + .4) });
    // group labels beside the last icon, on a leader line, pushed apart
    let prevY = -Infinity;
    for (const g of labelled) {
      const ta = g.t0 + (g.n - 1) * interval + .15, a = seg(t, ta, ta + .35); if (a <= 0) { prevY = Math.max(prevY, pos(g.last)[1]); continue; }
      const [ix, iy] = pos(g.last), ly = Math.max(iy, prevY + 54 * u), lx = gx + gridW + lblGap, col = colOf(g.tone);
      ctx.save(); ctx.setLineDash([3 * u, 8 * u]); ctx.strokeStyle = A(col, .85 * a); ctx.lineWidth = 3 * u;
      polyPath(ctx, [ix + R * .9, iy, gx + gridW + 12 * u, iy, lx - 8 * u, ly]); ctx.stroke(); ctx.restore();
      const nbx = lab('number', String(g.n), lx, ly, { face: 'display', size: 42, color: col === T.muted ? T.ink : col, a });
      lab('label', g.label, (nbx ? nbx.x1 : lx) + 12 * u, ly + 3 * u, { size: 26, color: T.ink, a });
      prevY = ly;
    }
  },
});

// ================================================================ split: comparison (before / after)
register('split', {
  claim: 'comparison (before/after)',
  doc: 'Two sub-pictures side by side at the same scale, each a { block, ... } picture drawn by Blocks.draw in a half-width area, with a header over each. One side can die: at deadAt it freezes and dims, so "before" stands next to "after" and only the after moves.',
  params: {
    left: { type: 'object', required: true, doc: '{ label, pic }: the header and the sub-picture ({ block, ...params }) of the left half' },
    right: { type: 'object', required: true, doc: '{ label, pic } for the right half' },
    dead: { type: 'string', doc: "'left' | 'right': the half that stops and dims at deadAt" },
    deadAt: { type: 'seconds', doc: 'when the dead half freezes (seconds from the start of the shot); default: at + 2.5' },
    divider: { type: 'boolean', default: true, doc: 'a still vertical line between the halves' },
  },
  sample: { block: 'split', dead: 'left', deadAt: 3, left: { label: 'BEFORE', pic: { block: 'columns', cols: 3, rows: 8, base: 8, digits: 4 } }, right: { label: 'AFTER', pic: { block: 'bars', items: [{ label: 'OLD', value: 2, ref: true }, { label: 'NEW', value: 9 }] } } },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, gap = 36 * u, hdr = 78 * u, hw = (area.w - gap) / 2, deadAt = p.deadAt ?? (p.at + 2.5);
    const subs = [['left', area.x], ['right', area.x + hw + gap]];
    if (p.divider) { ctx.strokeStyle = A(T.ink, .35); ctx.lineWidth = 2.5 * u; ctx.beginPath(); ctx.moveTo(area.x + hw + gap / 2, area.y + 4 * u); ctx.lineTo(area.x + hw + gap / 2, area.y + area.h - 4 * u); ctx.stroke(); }
    for (const [side, x] of subs) {
      const sp = p[side]; if (!sp) continue;
      const dead = p.dead === side, k = dead ? E.outCubic(seg(t, deadAt, deadAt + .6)) : 0, a = seg(t, p.at, p.at + .4);
      label(ctx, f, 'label', sp.label || '', x + 4 * u, area.y + 30 * u, { face: 'display', size: 50, color: dead && k > .5 ? T.muted : T.ink, a, maxW: hw - 8 * u, within: area, track: .03 });
      ctx.strokeStyle = dead && k > .5 ? A(T.muted, .8) : T.ink; ctx.lineWidth = 3.5 * u; strokeProgress(ctx, [x + 4 * u, area.y + hdr - 20 * u, x + hw - 4 * u, area.y + hdr - 20 * u], E.outCubic(seg(t, p.at, p.at + .7)));
      if (!sp.pic) continue;
      const s2 = dead ? Object.create(s) : s; if (dead) s2.t = Math.min(t, deadAt);
      ctx.save(); ctx.globalAlpha *= lerp(1, .36, k);
      draw(ctx, s2, f, { tone: p.tone, ...sp.pic }, { x, y: area.y + hdr, w: hw, h: area.h - hdr });
      ctx.restore();
    }
  },
});

// ================================================================ flow: mechanism
register('flow', {
  claim: 'mechanism',
  doc: 'A scheme that draws itself and then runs: nodes are laid out automatically (a column, or one row), edges connect them, loop-backs go around the right side (column) or below the row, and a token runs a route, lighting the node it is in. Optional counters below tick up.',
  params: {
    nodes: { type: 'array', required: true, doc: "[{ id, kind: 'pill' | 'box' | 'diamond', label, letter?, at?: seconds }]: laid out in the given order; letter is a bold mark at the left inside a box; at: when this node appears (default: staggered over dur)" },
    edges: { type: 'array', default: [], doc: '[[from, to, { label?, at?: seconds }]]: an arrow between two node ids; a neighbour in the order is a straight arrow, anything else goes around the side; label is written beside the start of the edge (YES / NO)' },
    token: { type: 'object', doc: '{ route: [ids...], at, dur }: an accent token that runs along the edges of the route (repeating an id makes a loop), seconds from the start of the shot; at defaults to the end of the build, dur to the length of the path' },
    counters: { type: 'array', default: [], doc: '[{ label, from, to, at?, dur? }]: numbers under the scheme that count from -> to (the last one in the accent color)' },
    layout: { type: 'string', default: 'column', doc: "'column' (nodes top to bottom, loop-backs on the right) | 'row' (left to right, loop-backs below the row; works in a short, wide area)" },
    dur: { type: 'seconds', default: null, doc: 'seconds the scheme takes to draw itself (default 0.5 s per node)' },
  },
  sample: {
    block: 'flow', nodes: [{ id: 'S', kind: 'pill', label: 'TASK' }, { id: 'A', kind: 'box', label: 'READ', letter: 'A' }, { id: 'B', kind: 'box', label: 'COUNT', letter: 'B' }, { id: 'D', kind: 'diamond', label: 'DONE?' }, { id: 'E', kind: 'pill', label: 'RESULT' }],
    edges: [['S', 'A'], ['A', 'B'], ['B', 'D'], ['D', 'A', { label: 'NO' }], ['D', 'E', { label: 'YES' }]], token: { route: ['S', 'A', 'B', 'D', 'A', 'B', 'D', 'E'], at: 3.4, dur: 4 },
    counters: [{ label: 'TYPED BY HAND', from: 0, to: 0 }, { label: 'LINES', from: 0, to: 24, at: 4, dur: 2.4 }],
  },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, tone = tcol(T, p.tone), row = p.layout === 'row', LS = 28;
    const nodes = p.nodes.slice(0, 8).map((n, i) => ({ ...n, i, kind: n.kind || 'box', label: n.label || '' })), n = nodes.length; if (!n) return;
    const byId = new Map(nodes.map(q => [q.id, q]));
    const edges = (p.edges || []).map(e => ({ from: byId.get(e[0]), to: byId.get(e[1]), o: e[2] || {} })).filter(e => e.from && e.to);
    const D = p.dur || (.5 * n + .4), counters = (p.counters || []).slice(0, 3), cH = counters.length ? 140 * u : 0;
    const dA = { x: area.x, y: area.y, w: area.w, h: area.h - cH - (cH ? 18 * u : 0) };
    const lab = (kind, text, x, y, o) => label(ctx, f, kind, text, x, y, { within: area, ...o });
    const lw = q => measure(ctx, f, q.label, { size: LS }) + (q.letter ? 56 * u : 0);
    const bypass = edges.filter(e => e.to.i - e.from.i !== 1);
    // ---- layout
    let laneX0 = 0, rowCy = 0, maxH = 0, depthA = 0, depthB = 0;
    if (!row) {
      bypass.sort((a, b) => Math.abs(a.to.i - a.from.i) - Math.abs(b.to.i - b.from.i)).forEach((e, k) => { e.lane = k; });
      const laneSpace = bypass.length ? (84 + bypass.length * 38) * u : 0, maxW = Math.max(120 * u, dA.w - laneSpace - 24 * u);
      const boxLW = Math.max(0, ...nodes.filter(q => q.kind !== 'diamond').map(lw)), dLW = Math.max(0, ...nodes.filter(q => q.kind === 'diamond').map(lw));
      const bw = clamp(boxLW + 90 * u, 230 * u, maxW), dw = clamp(dLW * 1.75 + 70 * u, 220 * u, maxW);
      for (const q of nodes) { q.w = q.kind === 'diamond' ? dw : q.kind === 'pill' ? clamp(lw(q) + 80 * u, 200 * u, bw * .82) : bw; q.h = q.kind === 'diamond' ? clamp(dw * .4, 96 * u, 150 * u) : 84 * u; }
      const sumH = nodes.reduce((a, q) => a + q.h, 0), avail = dA.h - 16 * u, gMin = 34 * u;
      let gap = n > 1 ? (avail - sumH) / (n - 1) : 0, sc = 1;
      if (n > 1 && gap < gMin) { sc = Math.max(.55, (avail - (n - 1) * gMin) / sumH); gap = gMin; } else gap = Math.min(gap, 76 * u);
      nodes.forEach(q => { q.h *= sc; });
      const total = sumH * sc + gap * (n - 1), cx = dA.x + (dA.w - laneSpace) / 2; let y = dA.y + 8 * u + (avail - total) / 2;
      for (const q of nodes) { q.cx = cx; q.cy = y + q.h / 2; y += q.h + gap; }
      laneX0 = cx + Math.max(...nodes.map(q => q.w)) / 2 + 52 * u;
    } else {
      const back = bypass.filter(e => e.to.i <= e.from.i), fwd = bypass.filter(e => e.to.i - e.from.i >= 2);
      back.forEach((e, k) => { e.lane = k; e.side = 1; }); fwd.forEach((e, k) => { e.lane = k; e.side = -1; });
      depthB = back.length ? (44 + back.length * 34) * u : 0; depthA = fwd.length ? (44 + fwd.length * 34) * u : 0;
      const hRoom = dA.h - depthA - depthB - 16 * u, hB = Math.min(84 * u, Math.max(48 * u, hRoom * .55)), dH = Math.min(hB * 1.5, hRoom);
      for (const q of nodes) { q.h = q.kind === 'diamond' ? dH : hB; q.w = q.kind === 'diamond' ? clamp(lw(q) * 1.7 + 60 * u, 210 * u, 400 * u) : clamp(lw(q) + 70 * u, 180 * u, 380 * u); }
      const sumW = nodes.reduce((a, q) => a + q.w, 0), minGap = 56 * u, roomW = dA.w - 20 * u;
      const sc = sumW + (n - 1) * minGap > roomW ? (roomW - (n - 1) * minGap) / sumW : 1;
      nodes.forEach(q => { q.w *= sc; });
      const gap = n > 1 ? Math.min(150 * u, (roomW - sumW * sc) / (n - 1)) : 0, total = sumW * sc + gap * (n - 1); let x = dA.x + (dA.w - total) / 2;
      maxH = Math.max(...nodes.map(q => q.h)); rowCy = dA.y + 8 * u + depthA + (dA.h - 16 * u - depthA - depthB) / 2;
      for (const q of nodes) { q.cx = x + q.w / 2; q.cy = rowCy; x += q.w + gap; }
    }
    const top = q => [q.cx, q.cy - q.h / 2], bot = q => [q.cx, q.cy + q.h / 2], rgt = q => [q.cx + q.w / 2, q.cy], lft = q => [q.cx - q.w / 2, q.cy];
    // ---- edges: polylines and where their label goes
    for (const e of edges) {
      const a = e.from, b = e.to, straight = b.i - a.i === 1;
      if (!row) {
        if (straight) { e.pts = [...bot(a), ...top(b)]; e.lab = [a.cx + 16 * u, (bot(a)[1] + top(b)[1]) / 2, 'left']; }
        else { const lx = laneX0 + e.lane * 38 * u; e.pts = [...rgt(a), lx, a.cy, lx, b.cy, ...rgt(b)]; e.lab = [rgt(a)[0] + 12 * u, a.cy - 22 * u, 'left']; }
      } else if (straight) { e.pts = [...rgt(a), ...lft(b)]; e.lab = [(rgt(a)[0] + lft(b)[0]) / 2, rowCy - 26 * u, 'center']; }
      else {
        const ly = rowCy + e.side * (maxH / 2 + (30 + e.lane * 34) * u), sa = e.side > 0 ? bot : top;
        e.pts = [...sa(a), a.cx, ly, b.cx, ly, ...sa(b)]; e.lab = [a.cx + 14 * u, (sa(a)[1] + ly) / 2, 'left'];
      }
      e.len = pathLens(e.pts);
    }
    // ---- timeline
    nodes.forEach((q, k) => { q.t0 = q.at ?? stagger(p, k, D / n); });
    edges.forEach(e => { e.t0 = e.o.at ?? (Math.max(e.from.t0, e.to.t0) + .2); });
    // ---- the token's path: through node centers and along the edges between them
    const tk = p.token && p.token.route && p.token.route.length > 1 ? p.token : null; let path = null, plen = null, tAt = 0, tDur = 1;
    if (tk) {
      const ids = tk.route.map(id => byId.get(id)).filter(Boolean);
      if (ids.length > 1) {
        path = [ids[0].cx, ids[0].cy];
        for (let i = 1; i < ids.length; i++) {
          const a = ids[i - 1], b = ids[i], e = edges.find(q => q.from === a && q.to === b), seg_ = e ? e.pts : [a.cx, a.cy, b.cx, b.cy];
          path.push(...seg_, b.cx, b.cy);
        }
        plen = pathLens(path); tAt = tk.at ?? (p.at + D + .5); tDur = tk.dur ?? Math.max(2, plen[plen.length - 1] / (450 * u));
      }
    }
    const tProg = path ? seg(t, tAt, tAt + tDur) : 0, tVis = path ? seg(t, tAt - .35, tAt) : 0;
    const tp = path ? pathAt(path, plen, tProg * plen[plen.length - 1]) : null;
    // ---- draw: edges, nodes, token, counters
    ctx.lineWidth = 4 * u; ctx.strokeStyle = T.ink;
    for (const e of edges) {
      const q = E.outCubic(seg(t, e.t0, e.t0 + .45)); if (q <= 0) continue;
      ctx.strokeStyle = T.ink; ctx.lineWidth = 4 * u; strokeProgress(ctx, e.pts, q);
      if (q >= .98) { const m = e.pts.length; arrowHead(ctx, e.pts[m - 2], e.pts[m - 1], e.pts[m - 2] - e.pts[m - 4], e.pts[m - 1] - e.pts[m - 3], 19 * u, T.ink); }
      if (e.o.label) lab('label', e.o.label, e.lab[0], e.lab[1], { size: 26, color: T.muted, align: e.lab[2], a: seg(t, e.t0 + .25, e.t0 + .6) });
    }
    for (const q of nodes) {
      const k = seg(t, q.t0, q.t0 + .45); if (k <= 0) continue;
      const sc = lerp(.86, 1, E.outBack(k)), a = E.outCubic(k);
      let lit = 0;
      if (tp && tVis > 0) {
        const dx = Math.abs(tp.x - q.cx) / (q.w / 2), dy = Math.abs(tp.y - q.cy) / (q.h / 2), dn = q.kind === 'diamond' ? dx + dy : Math.max(dx, dy);
        lit = clamp((1.35 - dn) / .35) * tVis;
      }
      ctx.save(); ctx.globalAlpha *= a; ctx.translate(q.cx, q.cy); ctx.scale(sc, sc);
      const shape = (ox, oy) => {
        if (q.kind === 'diamond') { polyPath(ctx, [ox - q.w / 2, oy, ox, oy - q.h / 2, ox + q.w / 2, oy, ox, oy + q.h / 2]); ctx.closePath(); }
        else roundRect(ctx, ox - q.w / 2, oy - q.h / 2, q.w, q.h, q.kind === 'pill' ? q.h / 2 : 8 * u);
      };
      ctx.fillStyle = A(T.ink, .13); shape(5 * u, 6 * u); ctx.fill();
      ctx.fillStyle = T.card || T.bg; shape(0, 0); ctx.fill();
      if (lit > 0) { ctx.fillStyle = A(tone, .32 * lit); shape(0, 0); ctx.fill(); }
      ctx.strokeStyle = T.ink; ctx.lineWidth = 4 * u; shape(0, 0); ctx.stroke();
      ctx.restore();
    }
    if (tp && tVis > 0) {
      ctx.save(); const L = plen[plen.length - 1];
      for (let i = 5; i >= 1; i--) { const g = pathAt(path, plen, Math.max(0, tProg * L - i * 22 * u)); ctx.fillStyle = A(tone, .09 * (6 - i) * tVis); ctx.beginPath(); ctx.arc(g.x, g.y, (14 - i * 1.4) * u, 0, TAU); ctx.fill(); }
      const pulse = tProg >= 1 ? 0 : 1;
      ctx.fillStyle = tone; ctx.globalAlpha *= tVis; ctx.beginPath(); ctx.arc(tp.x, tp.y, 16 * u * (.4 + .6 * E.outBack(tVis)), 0, TAU); ctx.fill();
      ctx.strokeStyle = T.bg; ctx.lineWidth = 4 * u; ctx.stroke(); void pulse; ctx.restore();
    }
    for (const q of nodes) {
      const k = seg(t, q.t0, q.t0 + .45); if (k <= 0) continue;
      const ta = seg(k, .45, 1), shift = q.letter ? 24 * u : 0;
      lab('label', q.label, q.cx + shift, q.cy, { align: 'center', size: LS, color: T.ink, a: ta, maxW: q.w - 40 * u - (q.letter ? 40 * u : 0) });
      if (q.letter) lab('label', q.letter, q.cx - q.w / 2 + 38 * u, q.cy, { align: 'center', size: 38, color: T.ink, a: ta, wt: 700 });
    }
    if (counters.length) {
      const cw = area.w / counters.length, yb = area.y + area.h - 14 * u;
      ctx.strokeStyle = A(T.ink, .35); ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(area.x, area.y + area.h - cH - 8 * u); ctx.lineTo(area.x + area.w, area.y + area.h - cH - 8 * u); ctx.stroke();
      counters.forEach((c, k) => {
        const at = c.at ?? (p.at + D), a = seg(t, at - .3, at), v = Math.round(lerp(toNum(c.from), toNum(c.to), E.outCubic(seg(t, at, at + (c.dur ?? 2)))));
        const x = area.x + k * cw + 8 * u, last = k === counters.length - 1, col = last && toNum(c.to) !== toNum(c.from) ? tone : T.ink;
        lab('label', c.label || '', x, yb - 112 * u, { size: 26, color: T.muted, a, maxW: cw - 16 * u });
        lab('number', fmtNum(v), x, yb, { face: 'display', size: 84, base: 'alphabetic', color: col, a, maxW: cw - 16 * u });
      });
    }
  },
});

// ================================================================ columns: identity (the texture of a thing)
register('columns', {
  claim: 'identity (the texture of a thing)',
  doc: 'Scrolling columns of numbers or codes: the picture of "the machine knew only numbers". Fixed seeded values, all columns move together; a glitch turns one cell accent and puts a digit into it that the base does not allow, the kind of slip a scheme would have caught.',
  params: {
    cols: { type: 'number', default: 5, doc: 'number of columns' },
    rows: { type: 'number', default: 11, doc: 'rows visible at once' },
    base: { type: 'number', default: 8, doc: 'number base of the values: 8, 10 or 16' },
    digits: { type: 'number', default: 5, doc: 'digits per value' },
    scroll: { type: 'number', default: 70, doc: 'scroll speed, pixels per second at 1080 px width (upwards)' },
    glitch: { type: 'object', doc: '{ at, col, row, digit? }: at that time the cell at (col, row) of the window turns accent with an illegal digit and keeps scrolling with its column' },
    label: { type: 'string', default: '', doc: 'a muted mono line over the columns (OCTAL CODE)' },
    dur: { type: 'seconds', default: 0.6, doc: 'seconds the label takes to type' },
  },
  sample: { block: 'columns', cols: 5, rows: 9, base: 8, digits: 5, scroll: 70, label: 'MACHINE CODE', glitch: { at: 2, col: 2, row: 4 } },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, tone = tcol(T, p.tone), cols = Math.max(1, p.cols | 0), rows = Math.max(2, p.rows | 0), base = p.base, digits = Math.max(1, p.digits | 0);
    const hdr = p.label ? 72 * u : 0, win = { x: area.x, y: area.y + hdr, w: area.w, h: area.h - hdr }, rowH = win.h / rows, colW = win.w / cols;
    const w100 = measure(ctx, f, '0'.repeat(digits), { size: 100, track: .06 }) / u, size = Math.max(26, Math.min(rowH * .7 / u, colW * .86 / (w100 / 100) / u));
    const speed = p.scroll * u, off = t * speed, b0 = Math.floor(off / rowH), mid = win.y + win.h / 2, range = base ** digits;
    const valueAt = (ar, c) => { const v = Math.floor(rnd((ar * 131 + c * 17 + 5) | 0)() * range); return v.toString(base).toUpperCase().padStart(digits, '0'); };
    if (p.label) label(ctx, f, 'label', p.label, area.x + 8 * u, area.y + 34 * u, { size: 28, color: T.muted, a: seg(t, p.at, p.at + .3), typed: seg(t, p.at, p.at + p.dur), within: area });
    ctx.strokeStyle = A(T.ink, .4); ctx.lineWidth = 2.5 * u; ctx.beginPath(); ctx.moveTo(win.x, win.y); ctx.lineTo(win.x + win.w, win.y); ctx.moveTo(win.x, win.y + win.h); ctx.lineTo(win.x + win.w, win.y + win.h); ctx.stroke();
    const g = p.glitch, gOn = g && t >= g.at, gAbs = g ? Math.floor(g.row) + Math.floor(g.at * speed / rowH) : 0;
    ctx.save(); ctx.beginPath(); ctx.rect(win.x, win.y, win.w, win.h); ctx.clip();
    for (let ar = b0 - 1; ar <= b0 + rows + 1; ar++) {
      const yc = win.y + ar * rowH + rowH / 2 - off, ny = (yc - mid) / (win.h / 2), vis = clamp((1 - Math.abs(ny)) / .3);
      if (vis <= 0) continue;
      for (let c = 0; c < cols; c++) {
        const cx = win.x + (c + .5) * colW; let v = valueAt(ar, c);
        if (gOn && ar === gAbs && c === g.col) {
          const di = g.digit ?? Math.floor(digits / 2), bad = base <= 8 ? '8' : base <= 10 ? 'X' : 'G';
          v = v.slice(0, di) + bad + v.slice(di + 1);
          const q = seg(t, g.at, g.at + .5), k = 1 + .5 * (1 - E.outBack(q)) * 0 + .35 * (1 - E.outCubic(q));
          ctx.fillStyle = A(tone, .18 * vis); ctx.fillRect(cx - colW / 2 + 6 * u, yc - rowH / 2 + 3 * u, colW - 12 * u, rowH - 6 * u);
          ctx.fillStyle = A(tone, vis); ctx.fillRect(cx - colW / 2 + 6 * u, yc - rowH / 2 + 3 * u, 6 * u, rowH - 6 * u);
          ctx.strokeStyle = A(tone, vis * (1 - .3 * q)); ctx.lineWidth = 3 * u; ctx.strokeRect(cx - (colW - 12 * u) / 2 * k, yc - (rowH - 6 * u) / 2 * k, (colW - 12 * u) * k, (rowH - 6 * u) * k);
          label(ctx, f, 'label', v, cx, yc, { align: 'center', size, color: tone, a: vis, track: .06, nobox: true });
        } else label(ctx, f, 'label', v, cx, yc, { align: 'center', size, color: T.ink, a: .78 * vis, wt: 500, track: .06, nobox: true });
      }
    }
    ctx.restore();
    boxOf(ctx, f, 'label', win.x + 2 * u, win.y + 2 * u, win.x + win.w - 2 * u, win.y + win.h - 2 * u, 'columns');
  },
});

// ================================================================ map: location
const contourCache = new Map();
function contours(f, area) {
  const key = Math.round(area.w) + 'x' + Math.round(area.h);
  let c = contourCache.get(key); if (c) return c;
  const r = rnd(Math.round(area.w) * 31 + Math.round(area.h)), P = new Path2D(), k = Math.min(area.w, area.h);
  for (let b = 0; b < 4; b++) {
    const cx = r() * area.w, cy = r() * area.h, R = k * (.3 + r() * .35), ph = [r() * TAU, r() * TAU, r() * TAU], sq = .6 + r() * .5;
    for (let ring = 0; ring < 5; ring++) {
      const rr = R * (1 - ring * .19);
      for (let i = 0; i <= 72; i++) {
        const a = i / 72 * TAU, w = 1 + .22 * Math.sin(2 * a + ph[0]) + .13 * Math.sin(3 * a + ph[1]) + .07 * Math.sin(5 * a + ph[2] + ring);
        const x = cx + Math.cos(a) * rr * w, y = cy + Math.sin(a) * rr * w * sq;
        i ? P.lineTo(x, y) : P.moveTo(x, y);
      }
      P.closePath();
    }
  }
  contourCache.set(key, c = P); return c;
}
register('map', {
  claim: 'location',
  doc: 'A route on a map with a distance counter and a scale bar. The reference route (another known distance, drawn to the same scale) is drawn first and muted; then the accent route is laid from A to B while the kilometres count up.',
  params: {
    from: { type: 'object', required: true, doc: '{ label, at: [x, y] }: the start; at is a fraction of the area (0..1)' },
    to: { type: 'object', required: true, doc: '{ label, at: [x, y] } the end' },
    km: { type: 'number', required: true, doc: 'the distance of the route, written and counted up (use the great-circle figure, at most 3 significant digits)' },
    ref: { type: 'object', doc: '{ label, km, at?: [x, y] }: a reference route from the same start; its length on the screen is km/ref.km of the main one, at: its end as fractions of the area' },
    curve: { type: 'number', default: .3, doc: 'how much the route bows (fraction of its length)' },
    unit: { type: 'string', default: 'KM', doc: 'unit of the distance' },
    dur: { type: 'seconds', default: 3.2, doc: 'seconds the route takes to be laid (the reference adds 1.1 s before it)' },
  },
  sample: { block: 'map', from: { label: 'MOSCOW', at: [.18, .22] }, to: { label: 'NOVOSIBIRSK', at: [.8, .78] }, km: 2800, ref: { label: 'ST PETERSBURG', km: 700 } },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, tone = tcol(T, p.tone), lab = (kind, text, x, y, o) => label(ctx, f, kind, text, x, y, { within: area, ...o });
    const pa = [area.x + p.from.at[0] * area.w, area.y + p.from.at[1] * area.h], pb = [area.x + p.to.at[0] * area.w, area.y + p.to.at[1] * area.h];
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    let nx = -uy, ny = ux; if (ny > 0 || (Math.abs(ny) < 1e-6 && nx < 0)) { nx = -nx; ny = -ny; }       // the bow points up
    const inside = (x, y, m = 36 * u) => x > area.x + m && x < area.x + area.w - m && y > area.y + m && y < area.y + area.h - m;
    const ctrl = (a, b, k) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [clamp(mx + nx * k * l, area.x + 20 * u, area.x + area.w - 20 * u), clamp(my + ny * k * l, area.y + 20 * u, area.y + area.h - 20 * u)]; };
    const quad = (a, c, b, N) => { const o = []; for (let i = 0; i <= N; i++) { const q = i / N, m = 1 - q; o.push(m * m * a[0] + 2 * m * q * c[0] + q * q * b[0], m * m * a[1] + 2 * m * q * c[1] + q * q * b[1]); } return o; };
    const C = ctrl(pa, pb, p.curve), route = quad(pa, C, pb, 64), rl = pathLens(route);
    // terrain (chrome)
    ctx.save(); ctx.translate(area.x, area.y); ctx.strokeStyle = A(T.ink, .09); ctx.lineWidth = 2 * u; ctx.stroke(contours(f, area)); ctx.restore();
    // scale bar: a round number of km, at the corner far from the two ends
    const pxKm = len / p.km, nice = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000], bar = [...nice].reverse().find(v => v * pxKm <= area.w * .3) || nice[0], bw = bar * pxKm;
    const left = (pa[0] + pb[0]) / 2 > area.x + area.w / 2 ? 1 : 0, bx = left ? area.x + 10 * u : area.x + area.w - 10 * u - bw, by = area.y + area.h - 40 * u;
    ctx.strokeStyle = A(T.ink, .6); ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(bx, by - 8 * u); ctx.lineTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by - 8 * u); ctx.stroke();
    lab('label', fmtNum(bar) + ' ' + p.unit, bx + bw / 2, by + 24 * u, { align: 'center', size: 26, color: T.muted });
    // the reference route, first
    const ref = p.ref, mainT0 = p.at + (ref ? 1.1 : .25); let pr = null;
    if (ref) {
      if (ref.at) pr = [area.x + ref.at[0] * area.w, area.y + ref.at[1] * area.h];
      else {
        const rLen = ref.km / p.km * len;
        for (const a of [-.9, .9, -.55, .55, -1.3, 1.3, -1.8, 1.8]) { const c = Math.cos(a), s_ = Math.sin(a), x = pa[0] + (ux * c - uy * s_) * rLen, y = pa[1] + (ux * s_ + uy * c) * rLen; if (inside(x, y)) { pr = [x, y]; break; } }
        if (!pr) pr = [clamp(pa[0] - uy * rLen, area.x + 36 * u, area.x + area.w - 36 * u), clamp(pa[1] + ux * rLen, area.y + 36 * u, area.y + area.h - 36 * u)];
      }
      const rq = E.outCubic(seg(t, p.at, p.at + .9)), rc = ctrl(pa, pr, .12), rr = quad(pa, rc, pr, 40);
      ctx.save(); ctx.setLineDash([10 * u, 13 * u]); ctx.strokeStyle = T.muted; ctx.lineWidth = 4 * u; strokeProgress(ctx, rr, rq); ctx.restore();
      if (rq >= .98) {
        const ra = seg(t, p.at + .7, p.at + 1);
        ctx.strokeStyle = T.muted; ctx.lineWidth = 3.5 * u; ctx.fillStyle = T.bg; ctx.beginPath(); ctx.arc(pr[0], pr[1], 10 * u, 0, TAU); ctx.fill(); ctx.stroke();
        const right = pr[0] >= pa[0], lx = pr[0] + (right ? 24 : -24) * u, al = right ? 'left' : 'right';
        lab('label', ref.label || '', lx, pr[1] - 17 * u, { align: al, size: 26, color: T.muted, a: ra, halo: T.bg });
        lab('label', fmtNum(ref.km) + ' ' + p.unit, lx, pr[1] + 17 * u, { align: al, size: 26, color: T.muted, a: ra, halo: T.bg });
      }
    }
    // the route
    const k = seg(t, mainT0, mainT0 + p.dur), e = E.inOutCubic(k), L = rl[rl.length - 1];
    ctx.strokeStyle = tone; ctx.lineWidth = 7 * u; strokeProgress(ctx, route, e);
    const dot = (pt, a, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pt[0], pt[1], 13 * u * a, 0, TAU); ctx.fill(); };
    dot(pa, E.outBack(seg(t, p.at, p.at + .3)), T.ink);
    const arrived = E.outBack(seg(t, mainT0 + p.dur - .15, mainT0 + p.dur + .25)); if (arrived > 0) dot(pb, arrived, T.ink);
    // the start's name: to the left of the dot when there is room, else on the side the reference route does not take
    const wFrom = measure(ctx, f, p.from.label, { face: 'display', size: 40 }), roomLeft = pa[0] - area.x > wFrom + 34 * u;
    if (roomLeft) lab('name', p.from.label, pa[0] - 24 * u, pa[1], { face: 'display', size: 40, color: T.ink, align: 'right', a: seg(t, p.at, p.at + .35), halo: T.bg });
    else { const up_ = pr ? (pr[1] > pa[1] ? 1 : -1) : (C[1] > pa[1] ? 1 : -1); lab('name', p.from.label, pa[0], pa[1] - up_ * 44 * u, { face: 'display', size: 40, color: T.ink, align: 'center', a: seg(t, p.at, p.at + .35), halo: T.bg }); }
    const arriveUp = C[1] < pb[1] ? 1 : -1;
    lab('name', p.to.label, pb[0], pb[1] + arriveUp * 44 * u, { face: 'display', size: 40, color: T.ink, align: 'center', a: seg(t, mainT0 + p.dur - .1, mainT0 + p.dur + .3), halo: T.bg });
    if (k > 0) { const h = pathAt(route, rl, e * L); ctx.fillStyle = tone; ctx.beginPath(); ctx.arc(h.x, h.y, 19 * u, 0, TAU); ctx.fill(); ctx.strokeStyle = T.bg; ctx.lineWidth = 4 * u; ctx.stroke(); }
    // the distance: on the concave side of the route, in the datum color
    const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], cxn = mid[0] - nx * 70 * u, cyn = mid[1] - ny * 70 * u, da = seg(t, mainT0 - .1, mainT0 + .3);
    const num = lab('number', fmtNum(Math.round(p.km * e)), cxn, cyn, { face: 'display', size: 84, color: tone, align: 'center', a: da });
    if (num) lab('label', p.unit, cxn, num.y1 + 22 * u, { size: 28, color: T.muted, align: 'center', a: da });
  },
});

// ================================================================ card: identity (a prop)
// a rubber stamp as a worn-ink sprite, built once per look (never keyed by time)
const stamps = new Map();
function stampSprite(f, txt, color, size, maxW = 760) {
  const F = FILM(), m = new OffscreenCanvas(1, 1).getContext('2d'); m.font = F.font(size, f.type.display, 700); m.letterSpacing = `${size * .06}px`;
  const full = m.measureText(txt).width + size * .9; if (full > maxW) size = Math.max(24, Math.floor(size * maxW / full));   // a stamp never wider than the card
  const key = `${f.type.display}|${txt}|${color}|${size}`; if (stamps.has(key)) return stamps.get(key);
  const fnt = F.font(size, f.type.display, 700); m.font = fnt; m.letterSpacing = `${size * .06}px`;
  const tw = m.measureText(txt).width, w = Math.ceil(tw + size * .9), h = Math.ceil(size * 1.5), oc = new OffscreenCanvas(w, h), x = oc.getContext('2d');
  x.fillStyle = color; x.strokeStyle = color; x.lineJoin = 'round';
  x.lineWidth = size * .07; x.beginPath(); x.roundRect(size * .05, size * .05, w - size * .1, h - size * .1, size * .12); x.stroke();
  x.lineWidth = size * .022; x.beginPath(); x.roundRect(size * .17, size * .17, w - size * .34, h - size * .34, size * .07); x.stroke();
  x.font = fnt; x.letterSpacing = `${size * .06}px`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, w / 2 + size * .03, h / 2 + size * .05);
  const r = rnd(txt.length * 97 + 3);                                  // worn ink: specks and scratches punched out
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < w * h / 80; i++) { x.globalAlpha = .3 + r() * .7; x.beginPath(); x.arc(r() * w, r() * h, .6 + r() ** 3 * 5, 0, TAU); x.fill(); }
  x.lineWidth = 1.5; for (let i = 0; i < 7; i++) { x.globalAlpha = .5 + r() * .5; x.beginPath(); const px = r() * w, py = r() * h, a = r() * TAU, l = 30 + r() * 120; x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  const sp = { img: oc.transferToImageBitmap(), w, h };
  stamps.set(key, sp); return sp;
}
// word-wrap into at most maxLines lines for a font already set on ctx
function wrapLines(ctx, text, maxW, maxLines) {
  if (text.includes('|')) return text.split('|');
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}
register('card', {
  claim: 'identity (a prop)',
  doc: 'Documents and stamps: a dictionary page, an article, a plain card, drawn as props with worn-ink stamps. A stamp lands (grows out of the screen, hits with a bounce, shakes the page and throws ink); strike draws a slash through the earlier stamps; out removes a stamp or a whole layer. Layers are drawn in order and slide in over the earlier ones.',
  params: {
    layers: { type: 'array', required: true, doc: "[{ kind: 'dictionary' | 'article' | 'plain', title, heading?, meta?, lines?: 9 (gray text bars; 0: only heading and rule), offset?: [x, y], rot?, scale?, dim?, alpha?, at?: seconds (when the layer comes in), enter?: 'fade' | 'drop', stamps?: [{ text, at, tone: 'accent' | 'ok', rot?, size?, pos?: [x, y], out?: { at, dur } }], strike?: { at, dur? }, out?: { at, dur } }]. title: a '|' breaks lines (article); dim: a veil of the page color over the layer (0..1); alpha: transparency; stamp at < 0: already on the card from frame 0, no landing; stamp pos: fraction of the card from its center" },
    dur: { type: 'seconds', default: 1, doc: 'seconds the first layer takes to come in and write itself' },
  },
  sample: { block: 'card', layers: [{ kind: 'article', title: 'WHAT IS THE HARM OF CYBERNETICS?', heading: 'S. SOBOLEV, A. KITOV, A. LYAPUNOV', meta: 'QUESTIONS OF PHILOSOPHY, NO. 4, 1955', offset: [-40, -40], rot: -0.03, scale: .8 }, { kind: 'dictionary', title: 'CYBERNETICS', heading: 'SHORT DICTIONARY', meta: 'MOSCOW, 1954', lines: 6, offset: [30, 60], rot: .02, scale: .82, at: 1.2, stamps: [{ text: 'PSEUDOSCIENCE', at: 2.6, tone: 'accent', rot: -.14, size: 110 }], strike: { at: 4 } }] },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, W0 = 880, H0 = 640, layers = p.layers.slice(0, 4), dark = isDark(T);
    const cw = Math.min(area.w * .9, area.h * .9 * W0 / H0), sc0 = cw / W0, mc = [area.x + area.w / 2, area.y + area.h / 2];
    layers.forEach((L, li) => {
      const at = L.at ?? (li === 0 ? p.at : p.at + li * 1.4), enter = L.enter || (li === 0 ? 'fade' : 'drop'), kind = L.kind || 'plain';
      const k = t - at; if (k < -.05) return;
      // the layer's own motion: coming in, going out
      let dy = 0, ea = 1, es = 1;
      if (enter === 'drop') { const e = spring(k, .62, 12); dy = (1 - clamp(e, 0, 1.12)) * (area.h * .62 + 260 * u); ea = clamp(k / .1); }
      else { const e = E.outCubic(clamp(k / (li === 0 ? .8 : .6))); ea = e; es = lerp(1.06, 1, e); }
      let rotAdd = 0, outA = 1;
      if (L.out) { const q = seg(t, L.out.at, L.out.at + (L.out.dur ?? .8)); dy += E.inCubic(q) * (area.h * .6 + 200 * u); rotAdd = q * .1; outA = 1 - q * q; if (q >= 1) return; }
      const rec = Math.abs(dy) < 1.5 && ea >= .99 && !L.out || (L.out && t < L.out.at);
      // stamps: state at this time
      const st = (L.stamps || []).map((m, mi) => {
        const size = m.size ?? 150, color = m.tone === 'ok' ? T.ok : T.accent;
        const pos = m.pos || [[.05, .16], [-.03, .34], [.06, .05]][mi % 3];
        let sc = 1, a = 1, hit = true, dt = 1e9;
        if (m.at >= 0) { dt = t - m.at; if (dt < 0) { const q = clamp((dt + 1.1) / 1.1); sc = lerp(2, 1, E.inCubic(q)); a = .08 + .3 * q; hit = false; } else sc = 1 + .07 * Math.exp(-dt * 14) * Math.cos(dt * 38); }
        let lift = 0;
        if (m.out) { const q = E.outCubic(seg(t, m.out.at, m.out.at + (m.out.dur ?? 1))); a *= 1 - q; lift = -q * 36; sc *= 1 + .22 * q; }
        return { ...m, mi, size, color, pos, sc, a, hit, dt, lift, born: m.at >= 0 ? m.at : -Infinity };
      });
      // the page shakes under the latest hit
      let sx = 0, sy = 0; for (const m of st) if (m.hit && m.at >= 0 && m.dt < .6) { const amp = 14 * Math.exp(-m.dt * 11); sx += Math.sin(m.dt * 91) * amp; sy += Math.cos(m.dt * 77) * amp; }
      const off = L.offset || [0, 0], rot = (L.rot ?? (li % 2 ? .02 : -.018)) + rotAdd, scale = (L.scale ?? 1) * es * sc0, lu = 1 / u;
      ctx.save();
      ctx.globalAlpha *= clamp(ea * outA * (L.alpha ?? 1));
      ctx.translate(mc[0] + off[0] * u + sx * scale, mc[1] + off[1] * u + dy + sy * scale); ctx.rotate(rot); ctx.scale(scale, scale);
      const x0 = -W0 / 2, y0 = -H0 / 2, tr = k - .15;
      const L_ = (kd, text, x, y, o) => label(ctx, f, kd, text, x, y, { nobox: !rec, ...o, size: (o.size ?? 28) * lu });
      // paper: a hard offset shadow, the sheet, a frame
      ctx.fillStyle = A(T.ink, .16); ctx.fillRect(x0 + 12, y0 + 15, W0, H0);
      ctx.fillStyle = T.card || T.bg; ctx.fillRect(x0, y0, W0, H0);
      ctx.strokeStyle = T.ink; ctx.lineWidth = 3.5; ctx.strokeRect(x0, y0, W0, H0);
      ctx.strokeStyle = A(T.ink, .16); ctx.lineWidth = 2; ctx.strokeRect(x0 + 18, y0 + 18, W0 - 36, H0 - 36);
      // content
      const seed = [...(L.title || 'x')].reduce((q, ch) => (q * 31 + ch.charCodeAt(0)) | 0, 7), rr = rnd(seed), rowsMax = L.lines ?? 9;
      let y = y0 + 56;
      const bars = (yStart, bottom) => {
        const gapMin = 30, n = Math.min(rowsMax, Math.max(0, Math.floor((bottom - yStart) / gapMin) + 1)); if (!n) return;
        const gap = Math.min(44, (bottom - yStart) / Math.max(1, n - 1 || 1));
        for (let i = 0; i < n; i++) { const ww = (W0 - 112) * (i === n - 1 ? .42 : .62 + rr() * .38), q = seg(tr, .55 + i * .07, 1.1 + i * .07); ctx.fillStyle = A(T.ink, .2); ctx.fillRect(x0 + 56, yStart + i * gap, ww * E.outCubic(q), 14); }
      };
      const metaY = y0 + H0 - 46;
      if (kind === 'dictionary') {
        if (L.heading) L_('label', L.heading, x0 + 56, y0 + 52, { size: 28, color: T.muted, a: seg(tr, 0, .5), maxW: W0 - 112 });
        const hh = L.heading ? 78 : 0;
        L_('name', L.title || '', x0 + 56, y0 + 112 + hh, { face: 'display', size: 124, color: T.ink, a: seg(tr, 0, .5), typed: seg(tr, 0, .7), track: .01, maxW: W0 - 112 });
        const ry = y0 + 186 + hh; ctx.strokeStyle = T.ink; ctx.lineWidth = 3.5; strokeProgress(ctx, [x0 + 56, ry, x0 + W0 - 56, ry], E.outCubic(seg(tr, .3, .9)));
        if (rowsMax > 0) bars(ry + 44, metaY - 56);
      } else if (kind === 'article') {
        if (L.meta) L_('label', L.meta, x0 + 44, y0 + 52, { size: 28, color: T.muted, a: seg(tr, 0, .5), maxW: W0 - 88 });
        ctx.font = FILM().font(84, f.type.display, 700); ctx.letterSpacing = '0px';
        let tl = wrapLines(ctx, L.title || '', W0 - 88, 3), size = 84;
        const widest = Math.max(...tl.map(q => ctx.measureText(q).width)); if (widest > W0 - 88) size = 84 * (W0 - 88) / widest;
        tl.forEach((ln, i) => L_('name', ln, x0 + 44, y0 + 150 + i * size * 1.02, { face: 'display', size, color: T.ink, a: seg(tr, .2 + i * .35, .5 + i * .35), typed: seg(tr, .2 + i * .35, .8 + i * .35), track: .01, maxW: W0 - 88 }));
        const ry = y0 + 150 + (tl.length - 1) * size * 1.02 + 36; ctx.strokeStyle = T.ink; ctx.lineWidth = 3.5; strokeProgress(ctx, [x0 + 44, ry, x0 + W0 - 44, ry], E.outCubic(seg(tr, .9, 1.5)));
        let by = ry + 20;
        if (L.heading) { L_('label', L.heading, x0 + 44, by + 26, { size: 28, color: T.ink, a: seg(tr, 1.2, 1.7), maxW: W0 - 88, wt: 600 }); by += 54; }
        if (rowsMax > 0) bars(by + 10, y0 + H0 - 50);
      } else {
        if (L.heading) L_('label', L.heading, x0 + 56, y0 + 52, { size: 28, color: T.muted, a: seg(tr, 0, .5), maxW: W0 - 112 });
        L_('name', L.title || '', x0 + 56, y0 + 150, { face: 'display', size: 96, color: T.ink, a: seg(tr, 0, .5), typed: seg(tr, 0, .7), maxW: W0 - 112 });
        if (rowsMax > 0) bars(y0 + 210, metaY - 56);
      }
      if (L.meta && kind !== 'article') L_('label', L.meta, x0 + 56, metaY, { size: 28, color: T.muted, a: seg(tr, .6, 1.1), maxW: W0 - 112 });
      // stamps
      const mult = !dark, earlier = L.strike ? st.filter(m => m.born < L.strike.at) : [];
      const sdim = L.strike ? 1 - .55 * E.outCubic(seg(t, L.strike.at + .2, L.strike.at + 1)) : 1;
      for (const m of st) {
        const sp = stampSprite(f, m.text, m.color, Math.round(m.size)), cx = m.pos[0] * W0, cy = m.pos[1] * H0 + m.lift, a = m.a * (L.strike && m.born < L.strike.at ? sdim : 1);
        if (a <= .004) continue;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(m.rot ?? -.16); ctx.scale(m.sc, m.sc); ctx.globalAlpha *= a; if (mult) ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(sp.img, -sp.w / 2, -sp.h / 2); ctx.restore();
        if (m.hit && rec && a > .5) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(m.rot ?? -.16); boxOf(ctx, f, 'stamp', -sp.w / 2 * m.sc, -sp.h / 2 * m.sc, sp.w / 2 * m.sc, sp.h / 2 * m.sc, m.text); ctx.restore(); }
        if (m.hit && m.at >= 0 && m.dt < .5) {                       // ink flies from the hit
          const r = rnd(m.mi * 17 + li * 5 + 3), q = E.outCubic(m.dt / .5); ctx.save(); ctx.fillStyle = m.color; ctx.globalAlpha = (1 - q) * .8;
          for (let i = 0; i < 22; i++) { const an = r() * TAU, d = (80 + r() * 330) * q * (m.size / 150), rd = (2 + r() * 6) * (1 - q * .6); ctx.beginPath(); ctx.arc(cx + Math.cos(an) * (sp.w * .4 + d), cy + Math.sin(an) * (sp.h * .3 + d * .5), rd, 0, TAU); ctx.fill(); }
          ctx.restore();
        }
      }
      // the slash through the earlier stamps
      if (L.strike && earlier.length) {
        const q = E.inOutCubic(seg(t, L.strike.at, L.strike.at + (L.strike.dur ?? .6)));
        if (q > 0) {
          let ax0 = Infinity, ay0 = Infinity, ax1 = -Infinity, ay1 = -Infinity;
          for (const m of earlier) { const sp = stampSprite(f, m.text, m.color, Math.round(m.size)), cx = m.pos[0] * W0, cy = m.pos[1] * H0, hw = sp.w / 2 * .9, hh = sp.h / 2 * .9; ax0 = Math.min(ax0, cx - hw); ax1 = Math.max(ax1, cx + hw); ay0 = Math.min(ay0, cy - hh); ay1 = Math.max(ay1, cy + hh); }
          ctx.strokeStyle = T.accent; ctx.lineWidth = 16; strokeProgress(ctx, [ax0, ay1, ax1, ay0], q);
        }
      }
      if (L.dim) { ctx.fillStyle = A(T.card || T.bg, clamp(L.dim) * .75); ctx.fillRect(x0 - 2, y0 - 2, W0 + 16, H0 + 20); }
      ctx.restore();
    });
  },
});

// ================================================================ plate: identity (a name)
register('plate', {
  claim: 'identity (a name)',
  doc: 'A typographic name plate: a small line, the name in big letters that rise one by one out of a clip, a rule, the years, and optional facts as key/value rows. Fits the area: in a short area the name shrinks and the facts are left out by the caller.',
  params: {
    title: { type: 'string', required: true, doc: "the name; '|' breaks lines" },
    sub: { type: 'string', default: '', doc: 'a muted mono line above the name (typed on)' },
    years: { type: 'string', default: '', doc: 'dates under the rule, right aligned (1911 - 1973)' },
    facts: { type: 'array', default: [], doc: '[{ k, v, at?: seconds }]: key (accent) and value rows under the years' },
    dur: { type: 'seconds', default: 1.6, doc: 'seconds the name takes to rise (the facts follow at 0.4 s steps)' },
  },
  sample: { block: 'plate', title: 'LYAPUNOV', sub: 'ALEXEY ANDREEVICH', years: '1911 - 1973', facts: [{ k: '1932', v: 'STUDENT OF LUZIN' }, { k: '1952', v: 'FIRST COURSE' }] },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, lines = String(p.title).split('|'), n = lines.length, facts = (p.facts || []).slice(0, 4);
    const subH = p.sub ? 46 * u : 0, yearsH = p.years ? 52 * u : 0, factsH = facts.length ? facts.length * 62 * u + 20 * u : 0, pitch = .94;
    const w100 = Math.max(...lines.map(l => measure(ctx, f, l, { face: 'display', size: 100, track: 0 }))) / u;
    const room = area.h - subH - yearsH - factsH - 36 * u;
    const size = Math.max(40, Math.min(240, (area.w - 6 * u) / (w100 / 100) / u, room / (u * (.82 + pitch * (n - 1)))));
    const total = subH + (.82 + pitch * (n - 1)) * size * u + 26 * u + yearsH + factsH, y0 = area.y + Math.max(0, (area.h - total) * .35), x0 = area.x + 4 * u;
    if (p.sub) label(ctx, f, 'label', p.sub, x0 + 2 * u, y0 + 16 * u, { size: 30, color: T.muted, a: seg(t, p.at, p.at + .3), typed: seg(t, p.at, p.at + .9), within: area });
    let base = y0 + subH + .82 * size * u;
    lines.forEach((ln, li) => {
      const by = base + li * pitch * size * u;
      ctx.save(); ctx.beginPath(); ctx.rect(area.x, by - size * u * .92, area.w, size * u * 1.12); ctx.clip();
      ctx.font = FILM().font(size * u, f.type.display, 700); ctx.letterSpacing = '0px';
      const chars = [...ln];
      chars.forEach((ch, i) => {
        const e = E.outExpo(seg(t, p.at + .1 + li * .25 + i * (p.dur - .7) / Math.max(1, chars.length), p.at + .8 + li * .25 + i * (p.dur - .7) / Math.max(1, chars.length)));
        if (e <= 0 || ch === ' ') return;
        const px = x0 + ctx.measureText(ln.slice(0, i)).width;
        label(ctx, f, 'name', ch, px, by + (1 - e) * size * u * .95, { face: 'display', size, base: 'alphabetic', color: T.ink, track: 0, nobox: true });
      });
      ctx.restore();
      const shown = chars.some((_, i) => t > p.at + .3 + li * .25 + i * (p.dur - .7) / Math.max(1, chars.length));
      if (shown) { const wl = measure(ctx, f, ln, { face: 'display', size, track: 0 }); boxOf(ctx, f, 'name', x0, by - size * u * .8, Math.min(x0 + wl, area.x + area.w), by + size * u * .05, ln); }
    });
    const ry = base + (n - 1) * pitch * size * u + 26 * u;
    ctx.strokeStyle = T.ink; ctx.lineWidth = 5 * u; strokeProgress(ctx, [area.x + 2 * u, ry, area.x + area.w - 2 * u, ry], E.outCubic(seg(t, p.at + .6, p.at + p.dur)));
    if (p.years) label(ctx, f, 'label', p.years, area.x + area.w - 2 * u, ry + 34 * u, { size: 32, color: T.muted, align: 'right', a: seg(t, p.at + p.dur - .3, p.at + p.dur + .3), within: area });
    if (facts.length) {
      const kw = Math.max(...facts.map(q => measure(ctx, f, String(q.k), { size: 30 }))) + 28 * u;
      facts.forEach((q, i) => {
        const ta = q.at ?? (p.at + p.dur + .3 + i * .4), a = seg(t, ta, ta + .35), yy = ry + yearsH + 40 * u + i * 62 * u;
        label(ctx, f, 'label', String(q.k), x0 + 2 * u, yy, { size: 30, color: tcol(T, p.tone), a, within: area });
        label(ctx, f, 'label', String(q.v), x0 + kw, yy, { size: 30, color: T.ink, a, typed: seg(t, ta, ta + .6), maxW: area.w - kw - 8 * u, within: area });
      });
    }
  },
});

// ================================================================ type: typographic
register('type', {
  claim: 'typographic',
  doc: 'The picture is the text itself, for shots with claim "typographic": big lines that rise into place one after another, left aligned (or centered), each fitted to the width.',
  params: {
    lines: { type: 'array', required: true, doc: "[{ text, size?: 110, tone?: 'ink' | 'accent' | 'ok' | 'muted', at?: seconds }]: one line each, top to bottom" },
    align: { type: 'string', default: 'left', doc: "'left' | 'center'" },
    dur: { type: 'seconds', default: 1.8, doc: 'seconds for all lines to arrive (0.45 s apart unless a line has its own at)' },
  },
  sample: { block: 'type', lines: [{ text: 'NO ONE', size: 120 }, { text: 'KNEW THE', size: 120 }, { text: 'WORD', size: 170, tone: 'accent' }] },
  draw(ctx, s, f, p, area) {
    const T = s.T, u = f.u, t = s.t, tone = tcol(T, p.tone), lines = p.lines.slice(0, 6).map(l => typeof l === 'string' ? { text: l } : l), n = lines.length; if (!n) return;
    const step = n > 1 ? Math.min(.45, p.dur / (n - 1)) : 0, center = p.align === 'center';
    const fit = lines.map(l => { const sz = l.size ?? 110, w = measure(ctx, f, l.text, { face: 'display', size: sz, track: .01 }); return Math.min(sz, sz * (area.w - 6 * u) / Math.max(w, 1)); });
    const pitch = fit.map(sz => sz * .98 * u + sz * .16 * u), total = pitch.reduce((a, b) => a + b, 0) - fit[n - 1] * .16 * u;
    let y = area.y + Math.max(0, (area.h - total) * .45);
    lines.forEach((l, i) => {
      const t0 = l.at ?? stagger(p, i, step), q = E.outExpo(seg(t, t0, t0 + .6)), sz = fit[i], col = l.tone === 'accent' ? tone : tcol(T, l.tone || 'ink');
      label(ctx, f, 'name', l.text, center ? area.x + area.w / 2 : area.x + 4 * u, y + .82 * sz * u + (1 - q) * 46 * u, { face: 'display', size: sz, base: 'alphabetic', color: col, a: q, align: center ? 'center' : 'left', track: .01, within: area });
      y += pitch[i];
    });
  },
});

// ---------------------------------------------------------------- public API
return {
  register, list, draw, label, measure,
  get: name => registry.get(name) || null,
  names: () => [...registry.keys()],
  sample: name => { const b = registry.get(name); return b && b.sample ? JSON.parse(JSON.stringify(b.sample)) : null; },
};
});
