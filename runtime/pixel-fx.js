// motion-kit demoscene effects: classic per-pixel effects as pure functions of (x, y, t) -> palette index, on a Pixel.screen.
// Every effect is stateless: the same t in gives the same picture out, so seeking and parallel render workers keep working.
// Each one computes a value 0..1 per pixel, adds a Bayer threshold, and picks a color from a RAMP (palette indices, dark -> light).
// They write straight into screen.px (fast) and therefore ignore camera, clip, pal() and dither(); pass { x, y, w, h } to fill only a
// rectangle of the screen. Shared options: ramp, speed, scale, dither ('none' | 'bayer4' | 'bayer8', default bayer4), seed.
// Classic script, no dependencies besides runtime/pixel.js:  <script src="../../runtime/pixel-fx.js"></script>  then  Pixel.fx.plasma(scr, t).
// API and recipes: 17-demoscene.md. Also usable in Node.
(function (global) {
'use strict';

const Pixel = global.Pixel || (typeof require === 'function' ? require('./pixel.js') : null);
if (!Pixel) throw new Error('pixel-fx.js: load runtime/pixel.js first');

const TAU = Math.PI * 2;
const floor = Math.floor, sqrt = Math.sqrt, abs = Math.abs, min = Math.min, max = Math.max;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const fract = v => v - floor(v);

// ---------------------------------------------------------------- fast sine (4096-entry table: invisible at 4-8 colors)
const LUT = new Float32Array(4096); for (let k = 0; k < 4096; k++) LUT[k] = Math.sin(k / 4096 * TAU);
const KS = 4096 / TAU;
const sin = a => LUT[(a * KS) & 4095];
const cos = a => LUT[(a * KS + 1024) & 4095];

// reusable float buffers (per slot), so the frame loop allocates nothing
const pool = {};
const fbuf = (slot, n) => { let a = pool[slot]; if (!a || a.length < n) a = pool[slot] = new Float32Array(n); return a; };

// ---------------------------------------------------------------- ramps
// A ramp is a Uint8Array of palette indices, dark -> light. Effects map their 0..1 value onto it.
// Named recipes are lists of target colors; on any palette each target snaps to the nearest palette color (consecutive
// duplicates dropped). pico8 and sweetie16 have hand-picked index lists that look better than the nearest-color guess.
const RECIPES = {
  fire:    ['#0a0004', '#4b0a2a', '#b01e2e', '#f0602a', '#ffa62b', '#ffe066', '#ffffff'],
  ice:     ['#040816', '#0d2a5c', '#1f63c0', '#47b4ff', '#a6ecff', '#ffffff'],
  sunset:  ['#10062a', '#4b1a6b', '#b02a7a', '#ff5a5a', '#ffa060', '#ffe6a0'],
  toxic:   ['#02100a', '#0a4a2a', '#1e9a3a', '#7ee030', '#e8ff70', '#ffffff'],
  ocean:   ['#02121f', '#063a5c', '#0c7a96', '#40c6b8', '#a8f0d0', '#f4ffe8'],
  land:    ['#0b2a2a', '#145a3a', '#3f8f3a', '#9ac04a', '#d9c98a', '#ffffff'],
  mono:    ['#000000', '#555555', '#aaaaaa', '#ffffff'],
  rainbow: ['#1a1040', '#2a4ad8', '#20c0e0', '#40e070', '#f0e040', '#f07a30', '#e02a6a', '#8a2ab0'],   // meant to wrap (cyclic)
};
const CURATED = {
  pico8: {
    fire: [0, 1, 2, 8, 9, 10, 7], ice: [0, 1, 13, 12, 6, 7], sunset: [1, 2, 8, 14, 9, 15], toxic: [0, 1, 3, 11, 10, 7],
    ocean: [0, 1, 12, 3, 11, 7], land: [1, 3, 11, 10, 15, 7], mono: [0, 1, 5, 13, 6, 7], rainbow: [1, 12, 3, 11, 10, 9, 8, 14, 2],
  },
  sweetie16: {
    fire: [0, 1, 2, 3, 4, 12], ice: [0, 8, 9, 10, 11, 12], sunset: [8, 1, 2, 3, 4], toxic: [0, 7, 6, 5, 4, 12],
    ocean: [0, 8, 7, 6, 11, 12], land: [8, 7, 6, 5, 4, 13, 12], mono: [0, 15, 14, 13, 12], rainbow: [8, 9, 10, 11, 6, 5, 4, 3, 2, 1],
  },
};
const lum = c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
const rampCache = new WeakMap();
const isScreen = p => p && p.px && p.w && p.palette;

// Pixel.fx.ramp(palette | screen, spec) -> Uint8Array of palette indices, dark -> light.
// spec: undefined | 'auto' (up to 8 colors spread over the palette's luminance), 'lum' (every color sorted by luminance), a recipe name
// (fire ice sunset toxic ocean land mono rainbow, or one you add to Pixel.fx.recipes), an array of indices, or an array of hex colors.
function ramp(pal, spec) {
  pal = Pixel.palette(isScreen(pal) ? pal.palette : pal);
  if (spec instanceof Uint8Array) return spec;
  if (Array.isArray(spec)) {
    if (!spec.length) throw new Error('Pixel.fx.ramp: empty ramp');
    return Uint8Array.from(spec, v => {
      if (typeof v === 'string') { const h = v.replace('#', ''); return pal.nearest(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)); }
      if (!(v >= 0 && v < pal.size)) throw new Error(`Pixel.fx.ramp: index ${v} is outside the ${pal.size}-color palette`);
      return v | 0;
    });
  }
  const name = spec || 'auto';
  let byPal = rampCache.get(pal); if (!byPal) rampCache.set(pal, byPal = {});
  if (byPal[name]) return byPal[name];
  let out;
  const order = [...Array(pal.size).keys()].sort((a, b) => lum(pal.rgb[a]) - lum(pal.rgb[b]));
  if (name === 'lum') out = Uint8Array.from(order);
  else if (name === 'auto') {
    if (order.length <= 8) out = Uint8Array.from(order);
    else {
      const lo = lum(pal.rgb[order[0]]), hi = lum(pal.rgb[order[order.length - 1]]), pick = [];
      for (let k = 0; k < 8; k++) {                            // the palette color closest to each of 8 evenly spaced luminances
        const target = lo + (hi - lo) * k / 7; let best = order[0], bd = 1e9;
        for (const i of order) { const d = abs(lum(pal.rgb[i]) - target); if (d < bd) { bd = d; best = i; } }
        if (pick[pick.length - 1] !== best) pick.push(best);
      }
      out = Uint8Array.from(pick);
    }
  } else if (CURATED[pal.name] && CURATED[pal.name][name]) out = Uint8Array.from(CURATED[pal.name][name]);
  else if (RECIPES[name]) {
    const pick = []; for (const c of RECIPES[name]) { const i = ramp(pal, [c])[0]; if (pick[pick.length - 1] !== i) pick.push(i); }
    out = Uint8Array.from(pick);
  } else throw new Error(`Pixel.fx.ramp: unknown ramp "${name}" (have: auto, lum, ${Object.keys(RECIPES).join(', ')})`);
  return byPal[name] = out;
}

// ---------------------------------------------------------------- quantizer: value 0..1 + Bayer threshold -> ramp color
const bay = (n, sz) => Float32Array.from(Pixel.bayer(n), b => (b + .5) / (n * n));
const TH = { none: [Float32Array.of(.5), 0, 0], bayer4: [bay(4), 3, 2], bayer8: [bay(8), 7, 3] };
// Returns q(v, x, y) -> palette index. Not cyclic: v is clamped to the ramp. Cyclic: v wraps around the ramp (plasma, kaleido).
function quant(rp, dither, cyclic) {
  const d = TH[dither || 'bayer4']; if (!d) throw new Error(`Pixel.fx: dither is none | bayer4 | bayer8, got "${dither}"`);
  const th = d[0], mask = d[1], sh = d[2], n = rp.length, nm = n - 1;
  if (cyclic) return (v, x, y) => { let i = floor(v * n + th[((y & mask) << sh) | (x & mask)]) % n; if (i < 0) i += n; return rp[i]; };
  return (v, x, y) => { let f = v * nm; f = f < 0 ? 0 : f > nm ? nm : f; const i = (f + th[((y & mask) << sh) | (x & mask)]) | 0; return rp[i > nm ? nm : i]; };
}

// ---------------------------------------------------------------- shared prologue: region, ramp, quantizer, time
function prep(scr, t, o, defRamp, defCyclic) {
  if (!isScreen(scr)) throw new Error('Pixel.fx: first argument must be a Pixel.screen');
  const x0 = max(0, floor(o.x || 0)), y0 = max(0, floor(o.y || 0));
  const x1 = min(scr.w, o.w == null ? scr.w : x0 + floor(o.w)), y1 = min(scr.h, o.h == null ? scr.h : y0 + floor(o.h));
  if (x1 <= x0 || y1 <= y0) return null;
  const rp = ramp(scr, o.ramp ?? defRamp), cyc = o.cyclic ?? defCyclic ?? false;
  return {
    px: scr.px, S: scr.w, x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, hh: (y1 - y0) / 2, hw: (x1 - x0) / 2,
    ramp: rp, cyc, q: quant(rp, o.dither, cyc), T: t * (o.speed ?? 1), sc: o.scale ?? 1, sd: (o.seed || 0) * 1.37,
  };
}

// ---------------------------------------------------------------- value noise texture, tiling, baked once per seed (by look, not by time)
const NM = 255, noiseTexes = new Map();
function noiseTex(seed) {
  let tex = noiseTexes.get(seed); if (tex) return tex;
  tex = new Float32Array(65536);
  const rnd = Pixel.mulberry32(seed * 7919 + 13), oct = [[4, .5], [8, .27], [16, .15], [32, .08]];
  for (const [C, amp] of oct) {
    const lat = Float32Array.from({ length: C * C }, rnd);
    for (let y = 0; y < 256; y++) {
      const gy = y * C / 256, iy = floor(gy), fy = gy - iy, sy = fy * fy * (3 - 2 * fy), ya = (iy % C) * C, yb = ((iy + 1) % C) * C;
      for (let x = 0; x < 256; x++) {
        const gx = x * C / 256, ix = floor(gx), fx = gx - ix, sx = fx * fx * (3 - 2 * fx), xa = ix % C, xb = (ix + 1) % C;
        const a = lat[ya + xa], b = lat[ya + xb], c = lat[yb + xa], d = lat[yb + xb];
        tex[y * 256 + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
  }
  let lo = 9, hi = -9; for (let k = 0; k < 65536; k++) { if (tex[k] < lo) lo = tex[k]; if (tex[k] > hi) hi = tex[k]; }
  for (let k = 0; k < 65536; k++) tex[k] = (tex[k] - lo) / (hi - lo);
  if (noiseTexes.size > 8) noiseTexes.clear();
  noiseTexes.set(seed, tex); return tex;
}
function samp(T, u, v) {                                       // bilinear, wraps every 256 texels
  const iu = floor(u), iv = floor(v), fu = u - iu, fv = v - iv;
  const x0 = iu & NM, x1 = (x0 + 1) & NM, y0 = (iv & NM) << 8, y1 = ((iv + 1) & NM) << 8;
  const a = T[y0 + x0], b = T[y0 + x1], c = T[y1 + x0], d = T[y1 + x1];
  return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
}

// ---------------------------------------------------------------- polar grid (angle, radius) for tunnel and kaleido, cached by size
// The grid is twice the region so the tunnel's vanishing point can sway by whole pixels without any atan2 in the frame loop.
const polarCache = new Map();
function polar(rw, rh) {
  const key = rw + 'x' + rh; let g = polarCache.get(key); if (g) return g;
  const W = rw * 2, H = rh * 2, ang = new Float32Array(W * H), rad = new Float32Array(W * H), inv = new Float32Array(W * H), hh = rh / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - rw + .5) / hh, dy = (y - rh + .5) / hh, r = sqrt(dx * dx + dy * dy) + 1e-4, k = y * W + x;
    ang[k] = Math.atan2(dy, dx); rad[k] = r; inv[k] = 1 / r;
  }
  if (polarCache.size > 4) polarCache.clear();
  polarCache.set(key, g = { W, ang, rad, inv }); return g;
}

// ---------------------------------------------------------------- the effects
const fx = {};

// 1. plasma: four sines (two separable, one diagonal, one radial). opts: bands (ramp cycles per value range, 2.2), cyclic (true)
fx.plasma = (scr, t, o = {}) => {
  const c = prep(scr, t, o, 'rainbow', true); if (!c) return scr;
  const { px, S, x0, y0, w, h, hh, hw, q, T, sc, sd } = c, bands = o.bands ?? 1.5;
  const A = fbuf(0, w), B = fbuf(1, w), C = fbuf(2, w), D = fbuf(3, w);
  const cxo = .9 * sin(T * .37 + sd), cyo = .6 * cos(T * .29 + sd * 1.3);
  for (let i = 0; i < w; i++) { const X = (i + .5 - hw) / hh; A[i] = sin(X * 2.6 * sc + T * 1.3 + sd); B[i] = sin(X * 2.1 * sc); C[i] = cos(X * 2.1 * sc); D[i] = (X - cxo) * (X - cxo); }
  for (let j = 0; j < h; j++) {
    const Y = (j + .5 - h / 2) / hh, s2 = sin(Y * 3.1 * sc + T * 1.1 + sd), ph = Y * 2.1 * sc + T * .7, sb = sin(ph), cb = cos(ph), dy2 = (Y - cyo) * (Y - cyo);
    const y = y0 + j, row = y * S + x0, drift = T * .05;
    for (let i = 0; i < w; i++) {
      const v = (A[i] + s2 + (B[i] * cb + C[i] * sb) + sin(sqrt(D[i] + dy2) * 4.2 * sc - T * 1.7)) * .125 + .5;
      px[row + i] = q(v * bands + drift, x0 + i, y);
    }
  }
  return scr;
};

// 2. tunnel: angle + depth lookup with a checker texture and a dark vanishing point. opts: segments (12), spin, twist, sway (0..1), lights
fx.tunnel = (scr, t, o = {}) => {
  const c = prep(scr, t, o, 'ice'); if (!c) return scr;
  const { px, S, x0, y0, w, h, q, T, sc, sd } = c, segN = Math.round(o.segments ?? 16), seg = segN / TAU, spin = o.spin ?? .12, twist = o.twist ?? .5, sway = o.sway ?? .5;
  const g = polar(w, h), W = g.W, ang = g.ang, rad = g.rad, inv = g.inv;
  const swx = Math.round(sway * w * .12 * sin(T * .43 + sd)), swy = Math.round(sway * h * .12 * cos(T * .31 + sd)), cxi = w >> 1, cyi = h >> 1;
  const tw = twist * sin(T * .25), depthK = 2.6 * sc, fwd = T * 1.5, rot = T * spin * segN;
  for (let j = 0; j < h; j++) {
    const y = y0 + j, row = y * S + x0, grow = (j - cyi + swy + h) * W + (-cxi + swx + w);
    for (let i = 0; i < w; i++) {
      const k = grow + i, r = rad[k], iv = inv[k];
      const u = ang[k] * seg + rot + iv * tw, v = iv * depthK + fwd;
      const fu = u - floor(u), fv = v - floor(v), cell = (floor(u) + floor(v)) & 1;
      let val = cell ? .55 : .2;
      val += .22 * (fv < .12 ? 1 : 0) - .1 * (fu < .06 ? 1 : 0) + (fv - .5) * .12;
      const fog = r * 1.5, al = iv < 2.5 ? 0 : iv > 5 ? 1 : (iv - 2.5) / 2.5; val = val * (1 - al) + .26 * al;                 // cells thinner than 2 px melt into a flat tone
      val *= fog > 1 ? 1 : fog * (2 - fog);                         // dark toward the vanishing point
      if (o.lights !== false) val += .25 * max(0, sin(iv * 2.2 - T * 5)) * (cell ? 1 : 0) * clamp01(r * 1.2);
      px[row + i] = q(val, x0 + i, y);
    }
  }
  return scr;
};

// 3. rotozoom: a tiling that rotates and zooms. opts: tex (a Pixel.sprite; its own palette indices are drawn as they are), tiles (tiles across the height at zoom 1),
// spin, zoom (pulse depth 0..1)
fx.rotozoom = (scr, t, o = {}) => {
  const c = prep(scr, t, o, 'sunset'); if (!c) return scr;
  const { px, S, x0, y0, w, h, hh, hw, q, T, sc, sd, ramp: rp } = c, tex = o.tex, tiles = (o.tiles ?? (tex ? 3 : 5)) * sc;
  const ang = T * (o.spin ?? .35) + sd, zoom = 1 + (o.zoom ?? .45) * sin(T * .6 + sd), ca = cos(ang), sa = sin(ang), kz = tiles * .5 * zoom;
  const du = ca * kz / hh, dv = sa * kz / hh, ox = T * .3, oy = T * .2, tw = tex ? tex.w : 0, th = tex ? tex.h : 0;
  for (let j = 0; j < h; j++) {
    const X0 = (.5 - hw) / hh, Y = (j + .5 - h / 2) / hh, y = y0 + j, row = y * S + x0;
    let u = (X0 * ca - Y * sa) * kz + ox, v = (X0 * sa + Y * ca) * kz + oy;
    for (let i = 0; i < w; i++, u += du, v += dv) {
      const iu = floor(u), iv = floor(v), fu = u - iu, fv = v - iv;
      if (tex) { const cc = tex.data[((fv * th) | 0) * tw + ((fu * tw) | 0)]; px[row + i] = cc === 255 ? rp[0] : cc; continue; }
      let val = ((iu + iv) & 1) ? .78 : .34;
      val += (fu < .1 || fv < .1) ? .18 : (fu > .9 || fv > .9) ? -.14 : 0;
      val += .1 * fu * fv;
      px[row + i] = q(val, x0 + i, y);
    }
  }
  return scr;
};

// 4. copper: horizontal color bars that wave and pass in front of one another. opts: count (6), thickness (bar half-height, fraction of the height, .07),
// bend (how much the bars sag sideways, .05), ramps (one ramp spec per bar, cycled; default fire/ice/toxic/sunset), ramp (one ramp for all bars), bg (index)
const COPPER_DEFAULT = ['fire', 'ice', 'toxic', 'sunset'];
fx.copper = (scr, t, o = {}) => {
  const c = prep(scr, t, o, 'fire'); if (!c) return scr;
  const { px, S, x0, y0, w, h, hh, hw, T, sc, sd } = c, n = o.count ?? 8, bw = max(2, (o.thickness ?? .075) * h), bend = (o.bend ?? .05) * hh * sc;
  const specs = o.ramp ? [o.ramp] : o.ramps || COPPER_DEFAULT, qs = specs.map(s => quant(ramp(scr, s), o.dither, false));
  const bg = o.bg ?? ramp(scr, specs[0])[0];
  for (let j = 0; j < h; j++) px.fill(bg, (y0 + j) * S + x0, (y0 + j) * S + x0 + w);
  const phase = o.phase ?? .55, mid = h / 2, amp = h * .36, order = Array.from({ length: n }, (_, k) => k).sort((a, b) => cos(T * 1.1 + a * phase + sd) - cos(T * 1.1 + b * phase + sd));
  const bx = fbuf(0, w); for (let i = 0; i < w; i++) bx[i] = sin((i + .5 - hw) / hh * 2 * sc + T * 1.3);
  for (const k of order) {
    const cy = mid + amp * sin(T * 1.1 + k * phase + sd), q = qs[k % qs.length], kb = k * .4, ck = cos(kb), sk = sin(kb) * .5, ibw = 1 / bw;
    const ya = max(0, floor(cy - bw - bend * 1.6 - 1)), yb = min(h - 1, Math.ceil(cy + bw + bend * 1.6 + 1));
    for (let j = ya; j <= yb; j++) {
      const y = y0 + j, row = y * S + x0;
      for (let i = 0; i < w; i++) {
        const d = abs(j + .5 - (cy + bend * (bx[i] * ck + sk))) * ibw;
        if (d < 1) px[row + i] = q((1 - d) ** 1.3, x0 + i, y);
      }
    }
  }
  return scr;
};

// 5. metaballs: blobs on Lissajous paths, glow outside the iso line, bright core inside. opts: count (5), radius (.3), bands (posterize into n steps, 0 = smooth)
fx.metaballs = (scr, t, o = {}) => {
  const c = prep(scr, t, o, 'toxic'); if (!c) return scr;
  const { px, S, x0, y0, w, h, hh, hw, q, T, sc, sd } = c, n = min(8, max(1, o.count ?? 5)), rr = (o.radius ?? .34) * sc, bands = o.bands ?? 0;
  const bx = fbuf(0, w * n), by = fbuf(1, n), r2 = fbuf(2, n);
  for (let k = 0; k < n; k++) {
    const cx = 1.05 * sin(T * (.5 + .13 * k) + k * 1.7 + sd), cy = .5 * sin(T * (.7 + .11 * k) + k * 2.3 + sd * .7), r = rr * (.7 + .3 * sin(k * 3.1 + T * .8));
    r2[k] = r * r; by[k] = cy;
    for (let i = 0; i < w; i++) { const X = (i + .5 - hw) / hh - cx; bx[k * w + i] = X * X; }
  }
  const dy2 = fbuf(3, n);
  for (let j = 0; j < h; j++) {
    const Y = (j + .5 - h / 2) / hh, y = y0 + j, row = y * S + x0;
    for (let k = 0; k < n; k++) { const dy = Y - by[k]; dy2[k] = dy * dy + .002; }
    for (let i = 0; i < w; i++) {
      let f = 0; for (let k = 0; k < n; k++) f += r2[k] / (bx[k * w + i] + dy2[k]);
      let v = f < 1 ? .5 * f * f : .62 + .38 * min(1, (f - 1) / 2.2);
      if (bands) v = floor(v * bands) / (bands - 1);
      px[row + i] = q(v, x0 + i, y);
    }
  }
  return scr;
};

// 6. starfield: stars fly toward the camera; star k's position at time t is a formula of (k, seed, t). opts: count (~ area / 90), trail (streak length in steps, 0),
// bg (index, or false to draw the stars over what is on the screen), spread (how far off-axis stars appear, 1), size (px of the nearest stars, 2)
const starCache = new Map();
fx.starfield = (scr, t, o = {}) => {
  const c = prep(scr, t, o, 'mono'); if (!c) return scr;
  const { px, S, x0, y0, w, h, hh, hw, T, ramp: rp } = c, cnt = o.count ?? Math.round(w * h / 32), seed = o.seed || 0, key = seed + ':' + cnt;
  let st = starCache.get(key);
  if (!st) {
    const r = Pixel.mulberry32(seed * 6151 + 99), a = new Float32Array(cnt * 4);
    for (let k = 0; k < cnt; k++) { a[k * 4] = r() * 2 - 1; a[k * 4 + 1] = r() * 2 - 1; a[k * 4 + 2] = r(); a[k * 4 + 3] = .55 + r() * .9; }
    if (starCache.size > 8) starCache.clear();
    starCache.set(key, st = a);
  }
  const bg = o.bg === undefined ? rp[0] : o.bg;
  if (bg !== false) for (let j = 0; j < h; j++) px.fill(bg, (y0 + j) * S + x0, (y0 + j) * S + x0 + w);
  const nm = rp.length - 1, trail = o.trail ?? 3, spread = (o.spread ?? 1) * 3.2 * c.sc, big = o.size ?? 2, rate = T;
  for (let k = 0; k < cnt; k++) {
    const dx = st[k * 4], dy = st[k * 4 + 1], ph = st[k * 4 + 2], sp = st[k * 4 + 3];
    for (let s = 0; s <= trail; s++) {
      const z = fract(ph - (T - s * .025) * .3 * sp + 4096);                  // 1 far ... 0 near
      const proj = (1 - z) / (z + .09) * .32 * spread, sx = x0 + hw + dx * proj * hh, sy = y0 + h / 2 + dy * proj * hh * .9;
      const xi = floor(sx), yi = floor(sy);
      if (xi < x0 || yi < y0 || xi >= x0 + w || yi >= y0 + h) continue;
      const col = rp[min(nm, Math.round(min(1, .25 + (1 - z) * 1.6) * nm * (1 - s * .3)))];
      px[yi * S + xi] = col;
      if (s === 0 && z < .13 && big > 1) { if (xi + 1 < x0 + w) px[yi * S + xi + 1] = col; if (yi + 1 < y0 + h) { px[(yi + 1) * S + xi] = col; if (xi + 1 < x0 + w) px[(yi + 1) * S + xi + 1] = col; } }
    }
  }
  return scr;
};

// 7. fire: stateless flames. Baked tiling noise scrolls upward, a vertical falloff shapes the heat, the ramp colors it. opts: rise (scroll speed, 1),
// height (how far up the flames reach, 1), turbulence (1), taper (0..1: narrow the flames toward the sides, 0)
fx.fire = (scr, t, o = {}) => {
  const c = prep(scr, t, o, 'fire'); if (!c) return scr;
  const { px, S, x0, y0, w, h, hh, hw, q, T, sc, sd } = c, tex = noiseTex(o.seed || 0), rise = 60 * (o.rise ?? 1), turb = o.turbulence ?? 1, reach = o.height ?? 1, taper = o.taper ?? 0;
  const k = 34 * sc, off = (o.seed || 0) * 41, env = fbuf(0, w), tx = fbuf(1, w);
  for (let i = 0; i < w; i++) { const X = (i + .5 - hw) / hh; tx[i] = X * k + off; env[i] = 1 - taper * clamp01(abs(X) / (hw / hh)) ** 1.5; }
  for (let j = 0; j < h; j++) {
    const yb = (h - j - .5) / h, ty = (j + .5 - h / 2) / hh * k + T * rise * .5, y = y0 + j, row = y * S + x0;
    const heat = 1.1 - yb / (.95 * reach);
    for (let i = 0; i < w; i++) {
      const u = tx[i], n1 = samp(tex, u, ty), n2 = samp(tex, u * 2 + 31 + n1 * 9, ty * 2 - T * rise * .35 + n1 * 5);
      const n = n1 * .6 + n2 * .4;
      px[row + i] = q((heat * env[i] * 1.15 + (n - .5) * 1.7 * turb - .18), x0 + i, y);
    }
  }
  return scr;
};

// 8. moire: two moving ring (or line) patterns interfere. opts: mode ('rings' | 'lines'), frequency (rings per screen height, 9)
fx.moire = (scr, t, o = {}) => {
  const c = prep(scr, t, o, 'ocean'); if (!c) return scr;
  const { px, S, x0, y0, w, h, hh, hw, q, T, sc, sd } = c, lines = o.mode === 'lines', f = (o.frequency ?? 7) * sc / 2;
  const A = fbuf(0, w), B = fbuf(1, w), Cc = fbuf(2, w), D = fbuf(3, w);
  if (!lines) {
    const ax = .55 * sin(T * .31 + sd), ay = .3 * cos(T * .23), bxo = -.5 * cos(T * .27 + 1), byo = -.3 * sin(T * .19 + sd);
    for (let i = 0; i < w; i++) { const X = (i + .5 - hw) / hh; A[i] = (X - ax) * (X - ax); B[i] = (X - bxo) * (X - bxo); }
    for (let j = 0; j < h; j++) {
      const Y = (j + .5 - h / 2) / hh, ya = (Y - ay) * (Y - ay), yb = (Y - byo) * (Y - byo), y = y0 + j, row = y * S + x0;
      for (let i = 0; i < w; i++) {
        const p = sin(sqrt(A[i] + ya) * f * TAU) * sin(sqrt(B[i] + yb) * f * TAU);
        px[row + i] = q(.5 + .55 * p + .12 * sin(((i + .5 - hw) / hh) * 1.2 + T * .5), x0 + i, y);
      }
    }
  } else {
    const a1 = T * .11 + sd, a2 = -T * .09 + 1.3, c1 = cos(a1), s1 = sin(a1), c2 = cos(a2), s2 = sin(a2), tri = v => { const a = abs(fract(v) * 2 - 1); return clamp01((a - .3) * 3); };
    for (let j = 0; j < h; j++) {
      const Y = (j + .5 - h / 2) / hh, y = y0 + j, row = y * S + x0;
      for (let i = 0; i < w; i++) {
        const X = (i + .5 - hw) / hh, l = tri((X * c1 + Y * s1) * f * 1.6) * tri((X * c2 + Y * s2) * f * 1.6);
        px[row + i] = q(l * .8 + .1 + .1 * sin(X * 1.4 + T * .5), x0 + i, y);
      }
    }
  }
  return scr;
};

// 9. voxel (extra): Comanche-style heightmap flyover from the baked noise texture. opts: ramp (terrain, 'land'), sky (ramp, 'sunset'), horizon (0..1, .4),
// height (mountain height, 1), far (draw distance, 110), fog (where the haze starts, 0..1 of far, .35)
fx.voxel = (scr, t, o = {}) => {
  const c = prep(scr, t, o, 'land'); if (!c) return scr;
  const { px, S, x0, y0, w, h, q, T, sc, sd } = c, tex = noiseTex(o.seed || 0), skyQ = quant(ramp(scr, o.sky ?? 'sunset'), o.dither, false), bay8 = TH.bayer8[0];
  const hor = h * (o.horizon ?? .4), far = o.far ?? 110, hs = 30 * (o.height ?? 1), proj = h * .5, kz = 1.5 * sc, fogAt = far * (o.fog ?? .35);
  const relief = v => clamp01((v - .22) * 1.55), H = (x, y) => max(relief(samp(tex, x * kz, y * kz)), .1);
  const dxp = 6 + 70 * .17 * cos(T * .17 + sd), dyp = 20 + 50 * .13 * cos(T * .13 + 1 + sd);          // the flight path and its derivative: heading follows the path
  const cx = 6 * T + 70 * sin(T * .17 + sd), cy = 20 * T + 50 * sin(T * .13 + 1 + sd), heading = Math.atan2(dyp, dxp), ch = cos(heading), sh = sin(heading);
  let camH = 0; for (const z of [0, 5, 10, 16, 24]) camH = max(camH, H(cx + ch * z, cy + sh * z) * hs);      // fly above the ridge ahead
  camH += 9;
  const skyAt = (j, xa, ya) => skyQ(clamp01(1 - (hor - j) / hor) ** 1.6, xa, ya);
  for (let i = 0; i < w; i++) {
    const a = heading + ((i + .5) / w - .5) * 1.15, dx = cos(a), dy = sin(a), xa = x0 + i;
    let ybuf = h;
    for (let z = 1; z < far && ybuf > 0; z += .2 + z * .02) {
      const mx = cx + dx * z, my = cy + dy * z, hv = H(mx, my), ys = hor + (camH - hv * hs) * proj / z;
      if (ys >= ybuf) continue;
      const v = clamp01(hv * .95 + .04 + (hv - H(mx + .6, my + .4)) * 2.5), fa = clamp01((z - fogAt) / (far - fogAt)), top = max(0, Math.ceil(ys));
      for (let j = top; j < ybuf; j++) {
        const ya = y0 + j;
        px[ya * S + xa] = fa > 0 && fa > bay8[((ya & 7) << 3) | (xa & 7)] ? skyAt(j, xa, ya) : q(v, xa, ya);
      }
      ybuf = top;
    }
    for (let j = 0; j < ybuf; j++) px[(y0 + j) * S + xa] = skyAt(j, xa, y0 + j);      // the sky, only where the terrain did not cover it
  }
  return scr;
};

// 10. kaleido (extra): the polar plane folded into n mirrored wedges, filled with a plasma. opts: segments (6), spin (.2), cyclic (true)
fx.kaleido = (scr, t, o = {}) => {
  const c = prep(scr, t, o, 'rainbow', true); if (!c) return scr;
  const { px, S, x0, y0, w, h, q, T, sc, sd } = c, n = o.segments ?? 6, sector = TAU / n, rot = T * (o.spin ?? .2) + sd, g = polar(w, h), W = g.W, ang = g.ang, rad = g.rad;
  const cxi = w >> 1, cyi = h >> 1, base = (h - cyi) * W + (w - cxi), bands = o.bands ?? 1.6;
  for (let j = 0; j < h; j++) {
    const y = y0 + j, row = y * S + x0, grow = base + j * W;
    for (let i = 0; i < w; i++) {
      const k = grow + i - 0, r = rad[k];
      let a = ang[k] + rot; a -= floor(a / sector) * sector; a = abs(a - sector / 2);
      const X = r * cos(a), Y = r * sin(a);
      const v = (sin(X * 5 * sc + T * 1.1) + sin(Y * 6 * sc - T * 1.4) + sin((X + Y) * 3.5 * sc + T * .8) + sin(r * 4 * sc - T * 1.9)) * .125 + .5;
      px[row + i] = q(v * bands + T * .04, x0 + i, y);
    }
  }
  return scr;
};

// 11. twister (extra): a square bar twisting around a vertical axis, one row at a time, four shaded faces. opts: twist (turns per screen height, .6), radius (.42 of the height), bg (index, or false to draw over the screen)
fx.twister = (scr, t, o = {}) => {
  const c = prep(scr, t, o, 'sunset'); if (!c) return scr;
  const { px, S, x0, y0, w, h, hh, q, T, sc, sd } = c, tw = (o.twist ?? .6) * TAU * (.6 + .4 * sin(T * .3 + sd)), R = (o.radius ?? .42) * h * sc, bg = o.bg === undefined ? c.ramp[0] : o.bg;
  if (bg !== false) for (let j = 0; j < h; j++) px.fill(bg, (y0 + j) * S + x0, (y0 + j) * S + x0 + w);
  for (let j = 0; j < h; j++) {
    const Y = (j + .5 - h / 2) / hh, y = y0 + j, cx = x0 + w / 2 + sin(Y * 1.1 + T * .8) * w * .12, th = Y * tw + T * 1.5;
    for (let f = 0; f < 4; f++) {
      const a0 = th + f * TAU / 4, a1 = a0 + TAU / 4, xa = cx + R * sin(a0) * .8, xb = cx + R * sin(a1) * .8;
      if (xb <= xa) continue;
      const shade = .5 + .5 * cos((a0 + a1) / 2 + .6), xs = max(x0, Math.ceil(xa - .5)), xe = min(x0 + w, Math.ceil(xb - .5));
      for (let x = xs; x < xe; x++) px[y * S + x] = q(x - xs < 1 ? shade * .55 : shade * (.75 + .25 * (x - xa) / (xb - xa)), x, y);
    }
  }
  return scr;
};

// ---------------------------------------------------------------- post / overlay effects (they work on what is already on the screen)
let rowScratch = new Uint8Array(1024);

// wobble: per-scanline horizontal sine displacement (water, heat haze, raster wobble). Reads each row from a copy, so nothing accumulates.
// opts: amp (max shift in px, 3), freq (waves per region height, 3), speed (waves per second, .5), grow ('none' | 'down' | 'up': amplitude grows toward that edge),
// edge ('wrap' | 'clamp', wrap), harmonic (extra second sine, 0..1, .3), x y w h (region)
fx.wobble = (scr, t, o = {}) => {
  const c = prep(scr, t, { ...o, ramp: [0] }, [0]); if (!c) return scr;
  const { px, S, x0, y0, w, h, sd } = c, amp = o.amp ?? 3, freq = o.freq ?? 3, ph = t * (o.speed ?? .5) * TAU + sd, grow = o.grow || 'none', wrap = (o.edge || 'wrap') === 'wrap', harm = o.harmonic ?? .3;
  if (rowScratch.length < w) rowScratch = new Uint8Array(w);
  const sc = rowScratch;
  for (let j = 0; j < h; j++) {
    const p = j / h, g = grow === 'down' ? p : grow === 'up' ? 1 - p : 1;
    const off = Math.round(amp * g * (sin(p * freq * TAU + ph) + harm * sin(p * freq * 2.7 * TAU - ph * 1.3)) / (1 + harm));
    if (!off) continue;
    const a = (y0 + j) * S + x0; sc.set(px.subarray(a, a + w));
    for (let i = 0; i < w; i++) {
      let s = i - off;
      if (wrap) { if (s < 0) s += w; else if (s >= w) s -= w; } else s = s < 0 ? 0 : s >= w ? w - 1 : s;
      px[a + i] = sc[s];
    }
  }
  return scr;
};

// sinescroll: a text scroller whose letters ride a sine wave, in the built-in 3x5 font (upper case).
// opts: speed (px per second, 40), scale (font scale, ~ height / 40), amp (wave height in px, ~ height / 9), wave (waves across the width, 1.1), wavespeed (waves per second, .7),
// mode ('column': every pixel column has its own phase, smooth | 'letter'), loop (true: the message re-enters after leaving), line (the wave's center line, in px from the region's top; default the middle),
// color (fixed index) or ramp/cycle (colors cycled left to right, cycle = ramp sweeps per second, .6), outline (index, default the darkest ramp color; false for none), spacing (1), x y w h
fx.sinescroll = (scr, t, text, o = {}) => {
  const c = prep(scr, t, o, 'rainbow'); if (!c) return scr;
  const { px, S, x0, y0, x1, y1, w, h, sd, ramp: rp } = c, str = String(text).toUpperCase(), FONT = Pixel.FONT;
  const sc = o.scale ?? max(1, Math.round(h / 40)), sp = o.spacing ?? 1, adv = (3 + sp) * sc, n = str.length, total = n * adv, amp = o.amp ?? h / 9;
  const off = t * (o.speed ?? 40), wave = (o.wave ?? 1.1) * TAU / w, wph = t * (o.wavespeed ?? .7) * TAU + sd, column = (o.mode || 'column') === 'column';
  const period = total + w, cy = y0 + (o.line ?? h / 2) - 2.5 * sc, cycle = o.cycle ?? .6, nr = rp.length;
  const shadow = o.outline === undefined ? rp[0] : o.outline, color = o.color, lo = (nr * .3) | 0;
  const colorAt = xs => { if (color !== undefined) return color; const a = abs(fract((xs - x0) / w * .8 + t * cycle) * 2 - 1); return rp[min(nr - 1, lo + ((a * (nr - lo)) | 0))]; };
  const plot = (x, y, col) => { if (x >= x0 && x < x1 && y >= y0 && y < y1) px[y * S + x] = col; };
  const glyphPass = (gx, g, letterY, shade) => {
    for (let b = 0; b < 3; b++) for (let s = 0; s < sc; s++) {
      const xs = gx + b * sc + s; if (xs < x0 || xs >= x1) continue;
      const dy = column ? Math.round(amp * sin((xs - x0) * wave + wph)) : letterY, col = shade ? shadow : colorAt(xs);
      for (let r = 0; r < 5; r++) if (g[r] & (4 >> b)) for (let j = 0; j < sc; j++) { const yy = Math.round(cy) + dy + r * sc + j; if (shade) { for (let oy = -1; oy <= 1; oy++) for (let oxx = -1; oxx <= 1; oxx++) plot(xs + oxx, yy + oy, col); } else plot(xs, yy, col); }
    }
  };
  for (const pass of shadow === false ? [0] : [1, 0]) {                   // shadows of all letters first, then the letters
    for (let k = 0; k < n; k++) {
      let lx = w + k * adv - off; if (o.loop !== false) lx = ((lx + total) % period + period) % period - total;
      if (lx > w || lx + adv < 0) continue;
      glyphPass(x0 + Math.round(lx), FONT[str[k]] || FONT['?'], Math.round(amp * sin((lx + 1.5 * sc) * wave + wph)), pass === 1);
    }
  }
  return scr;
};

fx.ramp = ramp; fx.recipes = RECIPES; fx.curated = CURATED; fx.quant = quant;
fx.names = ['plasma', 'tunnel', 'rotozoom', 'copper', 'metaballs', 'starfield', 'fire', 'moire', 'voxel', 'kaleido', 'twister'];
fx.postNames = ['wobble', 'sinescroll'];
Pixel.fx = fx;
if (typeof module !== 'undefined' && module.exports) module.exports = fx;
})(typeof window !== 'undefined' ? window : globalThis);
