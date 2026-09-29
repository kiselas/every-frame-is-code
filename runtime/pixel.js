// motion-kit pixel runtime: an indexed-color framebuffer with a Pyxel/PICO-8 style API, sprites written as text,
// a 3x5 font, a "Mode 7" perspective floor, palette maps (fade, flash, cycle), a WebGL "quantize to palette + Bayer"
// post pass for ANY canvas, and dithered transitions for runtime/film.js.
// Every call is a pure function of what you pass in: clear the screen, draw the frame from t, flip it. No hidden state
// between frames, so seeking and parallel render workers keep working.
// Classic script, no dependencies:  <script src="../../runtime/pixel.js"></script>  then  Pixel.screen({...}).
// API and recipes: 15-pixel-retro.md. Also usable in Node for everything except flip / post / transitions.
(function (global) {
'use strict';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mulberry32 = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const mk = (w, h) => typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });

// ---------------------------------------------------------------- palettes
// c: hex colors in index order, n: names for Pixel.palette(...).i.<name>. Add your own with Pixel.palette([...hex]).
const PALETTES = {
  pyxel:     { c: '000000 2b335f 7e2072 19959c 8b4852 395c98 a9c1ff eeeeee d4186c d38441 e9c35b 70c6a9 7696de a3a3a3 ff9798 edc7b0', n: 'black navy purple green brown darkblue lightblue white red orange yellow lime cyan gray pink peach' },
  pico8:     { c: '000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa', n: 'black navy purple green brown darkgray lightgray white red orange yellow lime blue lavender pink peach' },
  sweetie16: { c: '1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57', n: 'black purple red orange yellow lime green teal navy blue sky cyan white silver slate dark' },
  gameboy:   { c: '0f380f 306230 8bac0f 9bbc0f', n: 'darkest dark light lightest' },
  cga:       { c: '000000 55ffff ff55ff ffffff', n: 'black cyan magenta white' },
  mono:      { c: '000000 ffffff', n: 'black white' },
};
const paletteCache = {};
const hex2 = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const toHex = c => '#' + c.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

// Pixel.palette('pico8') | Pixel.palette(['#1a1c2c', ...]) | Pixel.palette({ colors, names })
// -> { name, size, rgb, hex, u32, i (name -> index), nearest(r, g, b), css(i) }. Up to 256 colors.
function palette(spec, name) {
  if (spec && spec.rgb) return spec;
  if (typeof spec === 'string' && paletteCache[spec]) return paletteCache[spec];
  let hex, names = [];
  if (typeof spec === 'string') {
    const p = PALETTES[spec]; if (!p) throw new Error(`Pixel.palette: unknown palette "${spec}" (have: ${Object.keys(PALETTES).join(', ')})`);
    hex = p.c.split(' '); names = p.n.split(' '); name = name || spec;
  } else if (Array.isArray(spec)) hex = spec.map(h => h.replace('#', ''));
  else if (spec && spec.colors) { hex = spec.colors.map(h => h.replace('#', '')); names = spec.names || []; }
  else throw new Error('Pixel.palette: give a name, an array of hex colors or { colors, names }');
  if (hex.length > 256) throw new Error('Pixel.palette: at most 256 colors');
  const rgb = hex.map(hex2), u32 = new Uint32Array(256);
  rgb.forEach(([r, g, b], k) => { u32[k] = (0xff << 24 | b << 16 | g << 8 | r) >>> 0; });
  const i = {}; names.forEach((n, k) => { i[n] = k; });
  const pal = {
    name: name || 'custom', size: rgb.length, rgb, hex: rgb.map(toHex), u32, i,
    css: k => toHex(rgb[k]),
    nearest(r, g, b) {                                        // the closest index, redmean-ish weights
      let best = 0, bd = 1e9;
      for (let k = 0; k < rgb.length; k++) {
        const dr = r - rgb[k][0], dg = g - rgb[k][1], db = b - rgb[k][2], d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    },
  };
  if (typeof spec === 'string') paletteCache[spec] = pal;
  return pal;
}
palette.names = Object.keys(PALETTES);
palette.register = (name, hexList, names) => { PALETTES[name] = { c: hexList.map(h => h.replace('#', '')).join(' '), n: (names || []).join(' ') }; delete paletteCache[name]; return palette(name); };

// A ramp of n colors from one hex to another, e.g. a custom 4-shade "ink" palette.
palette.ramp = (from, to, n) => {
  const a = hex2(from.replace('#', '')), b = hex2(to.replace('#', ''));
  return palette(Array.from({ length: n }, (_, k) => toHex(a.map((v, j) => v + (b[j] - v) * k / Math.max(1, n - 1)))));
};
// Two palettes of the same size mixed by t: day -> night, cross-fading the whole look without redrawing anything.
palette.mix = (A, B, t) => {
  A = palette(A); B = palette(B);
  return palette(A.rgb.map((c, k) => toHex(c.map((v, j) => v + (B.rgb[k][j] - v) * t))), 'mix');
};

// ---------------------------------------------------------------- palette maps (256-entry lookup tables)
// Pass one to screen.flip({ map }) / screen.render({ map }): it is applied when the screen is turned into colors, so the
// same indexed picture can fade, flash or shimmer. Drawing-time remapping is screen.pal().
const identityMap = () => { const m = new Uint8Array(256); for (let k = 0; k < 256; k++) m[k] = k; return m; };
// level 0..1: every color steps toward palette index `to` through the colors the palette actually has.
function fadeMap(pal, level, to = 0) {
  pal = palette(pal); const m = identityMap(), t = pal.rgb[to];
  for (let k = 0; k < pal.size; k++) m[k] = level <= 0 ? k : level >= 1 ? to : pal.nearest(...pal.rgb[k].map((v, j) => v + (t[j] - v) * level));
  return m;
}
const flashMap = (pal, idx) => { const m = identityMap(); for (let k = 0; k < palette(pal).size; k++) m[k] = idx; return m; };
// Rotate the colors listed in `list` by `shift` steps (water, fire, marquee lights: the classic palette-cycling trick).
function cycleMap(list, shift) {
  const m = identityMap(), n = list.length, s = ((Math.floor(shift) % n) + n) % n;
  list.forEach((idx, k) => { m[idx] = list[(k + s) % n]; });
  return m;
}
const map = { identity: identityMap, fade: fadeMap, flash: flashMap, cycle: cycleMap };

// ---------------------------------------------------------------- Bayer matrices (ordered dithering)
function bayer(n) {                                            // n = 2, 4, 8, 16 -> flat n*n of 0..n*n-1
  if (n === 2) return [0, 2, 3, 1];
  const h = bayer(n / 2), m = n / 2, out = new Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const q = (y >= m ? 2 : 0) + (x >= m ? 1 : 0), off = [0, 2, 3, 1][q];
    out[y * n + x] = 4 * h[(y % m) * m + (x % m)] + off;
  }
  return out;
}
const BAYER4 = bayer(4), BAYER8 = bayer(8);
// Threshold in (0, 1) for a pixel: an alpha draws there when alpha > threshold.
const bayer4 = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + .5) / 16;
const bayer8 = (x, y) => (BAYER8[(y & 7) * 8 + (x & 7)] + .5) / 64;

// ---------------------------------------------------------------- noise (Perlin, seeded)
const PERM = (() => { const p = Array.from({ length: 256 }, (_, k) => k), r = mulberry32(1337); for (let k = 255; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [p[k], p[j]] = [p[j], p[k]]; } return new Uint8Array([...p, ...p]); })();
const fadeC = t => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (h, x, y, z) => { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
// noise(x, y, z) in about -1..1, like Pyxel's pyxel.noise; the same numbers every run.
function noise(x, y = 0, z = 0) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fadeC(x), v = fadeC(y), w = fadeC(z), A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z, B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u), L(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
           L(L(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u), L(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v), w);
}
function fbm(x, y = 0, z = 0, oct = 4) { let a = .5, s = 0, f = 1; for (let k = 0; k < oct; k++) { s += a * noise(x * f, y * f, z * f); a *= .5; f *= 2; } return s; }
// Whole-pixel screen shake from trauma 0..1 (squared, like 10-games-juice.md): pass the result to screen.camera().
function shake(t, trauma, maxPx = 4, seed = 0) {
  const s = trauma * trauma * maxPx;
  return [Math.round(noise(t * 24, seed, 0) * 1.6 * s) + 0, Math.round(noise(t * 24, seed + 50, 1) * 1.6 * s) + 0];
}

// ---------------------------------------------------------------- sprites written as text
// Pixel.sprite(['..aa..', '.abba.', ...]) or one multiline string. Characters are palette indices in base 36
// (0-9 then a-z: a = 10 ... f = 15), '.' or ' ' is transparent, `legend` maps any other character to an index.
// Result: { w, h, data } with 255 = transparent. Spell a sprite out and you never need an image editor.
function sprite(src, legend = {}) {
  let rows;
  if (Array.isArray(src)) rows = src.slice();
  else {                                                        // a template literal: drop blank edge lines, then dedent
    rows = String(src).split('\n').map(r => r.replace(/\s+$/, ''));
    while (rows.length && !rows[0]) rows.shift(); while (rows.length && !rows[rows.length - 1]) rows.pop();
    const lead = Math.min(...rows.filter(Boolean).map(r => r.match(/^ */)[0].length));
    rows = rows.map(r => r.slice(lead));
  }
  const w = Math.max(...rows.map(r => r.length)), h = rows.length, data = new Uint8Array(w * h).fill(255);
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) {
    const ch = r[x]; if (ch === '.' || ch === ' ') continue;
    const v = legend[ch] !== undefined ? legend[ch] : parseInt(ch, 36);
    if (!(v >= 0 && v < 255)) throw new Error(`Pixel.sprite: character "${ch}" at ${x},${y} is not a palette index (use 0-9 a-z or the legend)`);
    data[y * w + x] = v;
  } });
  return { w, h, data };
}
// A wide strip split into frames of fw pixels: Pixel.frames(strip, 8) -> [sprite, ...]
function frames(src, fw, legend) {
  const s = src.data ? src : sprite(src, legend), n = Math.floor(s.w / fw), out = [];
  for (let k = 0; k < n; k++) out.push(cut(s, k * fw, 0, fw, s.h));
  return out;
}
function cut(s, sx, sy, w, h) { const data = new Uint8Array(w * h).fill(255); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (sx + x < s.w && sy + y < s.h) data[y * w + x] = s.data[(sy + y) * s.w + sx + x]; return { w, h, data }; }
function flipSprite(s, axis = 'x') { const data = new Uint8Array(s.data.length); for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) data[y * s.w + x] = s.data[(axis === 'y' ? s.h - 1 - y : y) * s.w + (axis === 'x' ? s.w - 1 - x : x)]; return { w: s.w, h: s.h, data }; }
function recolor(s, m) { const data = s.data.map(v => v === 255 ? 255 : (typeof m === 'function' ? m(v) : m[v] ?? v)); return { w: s.w, h: s.h, data }; }
// A 1-pixel outline in color `c` around the opaque shape: sprites stay readable on any background.
function outline(s, c, diag = false) {
  const w = s.w + 2, h = s.h + 2, data = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) data[(y + 1) * w + x + 1] = s.data[y * s.w + x];
  const src = data.slice(), at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? 255 : src[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (src[y * w + x] === 255) {
    if (at(x - 1, y) !== 255 || at(x + 1, y) !== 255 || at(x, y - 1) !== 255 || at(x, y + 1) !== 255 || (diag && (at(x - 1, y - 1) !== 255 || at(x + 1, y - 1) !== 255 || at(x - 1, y + 1) !== 255 || at(x + 1, y + 1) !== 255))) data[y * w + x] = c;
  }
  return { w, h, data };
}

// ---------------------------------------------------------------- font: 3x5, 4 px advance, 6 px line
const FONT_ROWS = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001010010', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '111101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  ' ': '000000000000000', '.': '000000000000010', ',': '000000000010100', ':': '000010000010000', ';': '000010000010100', '!': '010010010000010',
  '?': '111001011000010', '-': '000000111000000', '+': '000010111010000', '=': '000111000111000', '/': '001001010100100', '\\': '100100010001001',
  '(': '010100100100010', ')': '010001001001010', "'": '010010000000000', '"': '101101000000000', '*': '000101010101000', '<': '001010100010001',
  '>': '100010001010100', '_': '000000000000111', '%': '101001010100101', '#': '101111101111101', '[': '110100100100110', ']': '011001001001011',
  '^': '010101000000000', '~': '000011110000000', '|': '010010010010010', '█': '111111111111111', '▶': '100110111110100', '@': '111101111100011',
};
const FONT = {}; for (const [ch, bits] of Object.entries(FONT_ROWS)) FONT[ch] = [0, 1, 2, 3, 4].map(r => parseInt(bits.slice(r * 3, r * 3 + 3), 2));
const textWidth = (str, scale = 1, spacing = 1) => str.length ? (str.length * (3 + spacing) - spacing) * scale : 0;

// ---------------------------------------------------------------- Mode 7 camera: project a world point
// Same camera as screen.blt3d (pos, rot, fov, and the rectangle it draws into), so billboards (sprites standing on the floor,
// coins, a hero) land exactly where the floor is. Returns { x, y, dist, scale } or null when the point is behind the camera;
// scale is 1 at distance `ref` (default the camera height) and shrinks as 1 / dist: multiply a sprite's scale by it.
function project(wx, wy, wz, opts = {}) {
  const [ox, oy, oz] = opts.pos || [0, 0, 16], [pitch = 30, yaw = 0, roll = 0] = (opts.rot || []).map(d => d * Math.PI / 180);
  const [bx = 0, by = 0, bw = 160, bh = 90] = opts.rect || [];
  const tanH = Math.tan((opts.fov || 60) * Math.PI / 360), tanV = tanH * bh / bw;
  const dx0 = wx - ox, dy0 = wy - oy, dz = wz - oz, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const dx = dx0 * cy - dy0 * sy, dy = dx0 * sy + dy0 * cy;             // undo yaw
  const up = dx, vp = -sp * dy - cp * dz, w = cp * dy - sp * dz;         // camera space: right, down, forward
  if (w <= 1e-4) return null;
  const u = (up * cr + vp * sr) / w, v = (-up * sr + vp * cr) / w, dist = Math.hypot(dx0, dy0, dz);
  return { x: bx + (u / (2 * tanH) + .5) * bw, y: by + (v / (2 * tanV) + .5) * bh, dist, scale: (opts.ref ?? Math.abs(oz)) / dist };
}

// ---------------------------------------------------------------- the screen
// Pixel.screen({ w: 160, h: 90, palette: 'pico8' })
function screen(o = {}) {
  const w = o.w || 160, h = o.h || 90;
  let pal = palette(o.palette || 'pico8');
  const px = new Uint8Array(w * h), pm = identityMap();       // pm: the draw palette, pal(a, b) remaps colors while drawing
  let camX = 0, camY = 0, clipX0 = 0, clipY0 = 0, clipX1 = w, clipY1 = h, dth = 1;
  let cv = null, cx = null, img = null, u32 = null;

  // one pixel through camera, clip, draw palette and dither; the core of every primitive
  const put = (x, y, c) => {
    x = Math.floor(x - camX); y = Math.floor(y - camY);
    if (x < clipX0 || y < clipY0 || x >= clipX1 || y >= clipY1) return;
    if (dth < 1 && dth <= bayer4(x, y)) return;
    px[y * w + x] = pm[c & 255];
  };
  const span = (x0, x1, y, c) => {                            // inclusive horizontal run
    y = Math.floor(y - camY); if (y < clipY0 || y >= clipY1) return;
    x0 = Math.floor(x0 - camX); x1 = Math.floor(x1 - camX);
    if (x0 > x1) [x0, x1] = [x1, x0];
    x0 = Math.max(x0, clipX0); x1 = Math.min(x1, clipX1 - 1); c = pm[c & 255];
    if (dth >= 1) { px.fill(c, y * w + x0, y * w + x1 + 1); return; }
    for (let x = x0; x <= x1; x++) if (dth > bayer4(x, y)) px[y * w + x] = c;
  };
  const ellSpans = (x, y, ew, eh, fn) => {                    // rows of an ellipse inscribed in the box (x, y, ew, eh)
    const rx = ew / 2, ry = eh / 2, mx = x + rx, my = y + ry;
    for (let j = 0; j < eh; j++) {
      const dy = (j + .5 - ry) / ry, dx = Math.sqrt(Math.max(0, 1 - dy * dy)) * rx;
      fn(Math.round(mx - dx), Math.round(mx + dx) - 1, y + j, j);
    }
  };

  const S = {
    w, h, px, get palette() { return pal; }, set palette(p) { pal = palette(p); },
    setPalette(p) { pal = palette(p); return S; },
    // -- state (as in Pyxel)
    pal(a, b) { if (a === undefined) pm.set(identityMap()); else if (Array.isArray(a)) a.forEach((v, k) => { pm[k] = v; }); else pm[a] = b === undefined ? a : b; return S; },
    dither(a) { dth = a === undefined ? 1 : clamp(a); return S; },
    clip(x, y, cw, ch) { if (x === undefined) { clipX0 = clipY0 = 0; clipX1 = w; clipY1 = h; } else { clipX0 = Math.max(0, Math.floor(x)); clipY0 = Math.max(0, Math.floor(y)); clipX1 = Math.min(w, Math.floor(x + cw)); clipY1 = Math.min(h, Math.floor(y + ch)); } return S; },
    camera(x = 0, y = 0) { camX = Math.round(x); camY = Math.round(y); return S; },
    reset() { S.pal().dither().clip().camera(); return S; },
    // -- drawing
    cls(c = 0) { px.fill(c); return S; },
    pset: (x, y, c) => { put(x, y, c); return S; },
    pget: (x, y) => { x = Math.floor(x - camX); y = Math.floor(y - camY); return x < 0 || y < 0 || x >= w || y >= h ? 0 : px[y * w + x]; },
    line(x0, y0, x1, y1, c) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) { put(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
      return S;
    },
    rect(x, y, rw, rh, c) { x = Math.round(x); y = Math.round(y); for (let j = 0; j < rh; j++) span(x, x + rw - 1, y + j, c); return S; },
    rectb(x, y, rw, rh, c) { x = Math.round(x); y = Math.round(y); span(x, x + rw - 1, y, c); if (rh > 1) span(x, x + rw - 1, y + rh - 1, c); for (let j = 1; j < rh - 1; j++) { put(x, y + j, c); put(x + rw - 1, y + j, c); } return S; },
    circ(x, y, r, c) { x = Math.round(x); y = Math.round(y); ellSpans(x - r, y - r, 2 * r + 1, 2 * r + 1, (a, b, yy) => span(a, b, yy, c)); return S; },
    circb(x, y, r, c) { x = Math.round(x); y = Math.round(y); return S.ellib(x - r, y - r, 2 * r + 1, 2 * r + 1, c); },
    elli(x, y, ew, eh, c) { x = Math.round(x); y = Math.round(y); ellSpans(x, y, ew, eh, (a, b, yy) => span(a, b, yy, c)); return S; },
    ellib(x, y, ew, eh, c) {
      x = Math.round(x); y = Math.round(y);
      const outer = [], inner = [];
      ellSpans(x, y, ew, eh, (a, b, yy, j) => { outer[j] = [a, b]; });
      if (ew > 2 && eh > 2) ellSpans(x + 1, y + 1, ew - 2, eh - 2, (a, b, yy, j) => { inner[j + 1] = [a, b]; });
      outer.forEach(([a, b], j) => { const n = inner[j]; if (!n || n[0] > n[1]) span(a, b, y + j, c); else { if (n[0] > a) span(a, n[0] - 1, y + j, c); if (n[1] < b) span(n[1] + 1, b, y + j, c); } });
      return S;
    },
    tri(x0, y0, x1, y1, x2, y2, c) {
      const ys = [y0, y1, y2], top = Math.floor(Math.min(...ys)), bot = Math.ceil(Math.max(...ys)), P = [[x0, y0], [x1, y1], [x2, y2]];
      for (let y = top; y <= bot; y++) {
        const yc = y + .5; let lo = 1e9, hi = -1e9;
        for (let k = 0; k < 3; k++) {
          const [ax, ay] = P[k], [bx, by] = P[(k + 1) % 3];
          if ((yc >= ay && yc < by) || (yc >= by && yc < ay)) { const xx = ax + (bx - ax) * (yc - ay) / (by - ay); lo = Math.min(lo, xx); hi = Math.max(hi, xx); }
        }
        if (lo <= hi) { const a = Math.ceil(lo - .5), b = Math.ceil(hi - .5) - 1; if (a <= b) span(a, b, y, c); }
      }
      return S;
    },
    trib(x0, y0, x1, y1, x2, y2, c) { S.line(x0, y0, x1, y1, c).line(x1, y1, x2, y2, c).line(x2, y2, x0, y0, c); return S; },
    fill(x, y, c) {                                            // flood fill on what is already drawn
      x = Math.floor(x); y = Math.floor(y); if (x < 0 || y < 0 || x >= w || y >= h) return S;
      const from = px[y * w + x], to = pm[c & 255]; if (from === to) return S;
      const st = [x, y];
      while (st.length) { const yy = st.pop(), xx = st.pop(); if (xx < 0 || yy < 0 || xx >= w || yy >= h || px[yy * w + xx] !== from) continue; px[yy * w + xx] = to; st.push(xx + 1, yy, xx - 1, yy, xx, yy + 1, xx, yy - 1); }
      return S;
    },
    // Text in the built-in 3x5 font (upper case; lower case is drawn as upper). opts: scale, spacing, align 'left'|'center'|'right', shadow (color, one pixel down), outline (color, all around: readable on anything), bg (color behind letters)
    text(x, y, str, c, opts = {}) {
      str = String(str).toUpperCase(); const sc = opts.scale || 1, sp = opts.spacing ?? 1, tw = textWidth(str, sc, sp);
      x = Math.round(opts.align === 'center' ? x - tw / 2 : opts.align === 'right' ? x - tw : x); y = Math.round(y);
      const glyphs = (ox, oy, col) => {
        let cxp = ox;
        for (const ch of str) {
          const g = FONT[ch] || FONT['?'];
          for (let r = 0; r < 5; r++) for (let b = 0; b < 3; b++) if (g[r] & (4 >> b)) for (let j = 0; j < sc; j++) span(cxp + b * sc, cxp + b * sc + sc - 1, oy + r * sc + j, col);
          cxp += (3 + sp) * sc;
        }
      };
      if (opts.bg !== undefined) S.rect(x - 1, y - 1, tw + 2, 5 * sc + 2, opts.bg);
      if (opts.outline !== undefined) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (ox || oy) glyphs(x + ox * sc, y + oy * sc, opts.outline);
      if (opts.shadow !== undefined) glyphs(x, y + sc, opts.shadow);
      glyphs(x, y, c);
      return S;
    },
    // Copy a sprite (see Pixel.sprite). opts: sx, sy, w, h (source rect), flipX, flipY, rot (degrees), scale, key (an extra transparent color)
    blt(spr, x, y, opts = {}) {
      const sx = opts.sx || 0, sy = opts.sy || 0, sw = opts.w ?? spr.w - sx, sh = opts.h ?? spr.h - sy, key = opts.key ?? -1, fx = opts.flipX ? -1 : 1, fy = opts.flipY ? -1 : 1;
      const at = (u, v) => { u = Math.floor(u); v = Math.floor(v); return u < 0 || v < 0 || u >= sw || v >= sh ? 255 : spr.data[(sy + v) * spr.w + sx + u]; };
      const out = (dx, dy, v) => { if (v !== 255 && v !== key) put(dx, dy, v); };
      x = Math.round(x); y = Math.round(y);
      if (!opts.rot && !opts.scale) {
        for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) out(x + i, y + j, at(fx < 0 ? sw - 1 - i : i, fy < 0 ? sh - 1 - j : j));
        return S;
      }
      const sc = opts.scale || 1, a = -(opts.rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      const dw = sw * sc, dh = sh * sc, rad = Math.ceil(Math.hypot(dw, dh) / 2), ccx = x + dw / 2, ccy = y + dh / 2;
      for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {           // inverse mapping, nearest neighbor: never smooth
        const ux = (i + .5) * ca - (j + .5) * sa, uy = (i + .5) * sa + (j + .5) * ca;
        const u = ux / sc + sw / 2, v = uy / sc + sh / 2;
        out(Math.floor(ccx) + i, Math.floor(ccy) + j, at(fx < 0 ? sw - u : u, fy < 0 ? sh - v : v));
      }
      return S;
    },
    // "Mode 7": a textured ground plane in perspective, as Pyxel's blt3d. The plane is z = 0, x/y are world units = texels of
    // `tex` (a sprite that repeats, or a function (x, y, dist) => color index for procedural floors). Pixel.project() places sprites on it.
    // opts: pos [x, y, height], rot [pitch, yaw, roll] in degrees (pitch > 0 looks down, yaw > 0 turns right), fov (horizontal, 60),
    // sky (color index above the horizon), fog { color, near, far } (dithered), key, wrap ('repeat' | 'clamp')
    blt3d(x, y, bw, bh, tex, opts = {}) {
      const [ox, oy, oz] = opts.pos || [0, 0, 16], [pitch = 30, yaw = 0, roll = 0] = (opts.rot || []).map(d => d * Math.PI / 180);
      const tanH = Math.tan((opts.fov || 60) * Math.PI / 360), tanV = tanH * bh / bw;
      const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
      const fog = opts.fog, key = opts.key ?? -1, isFn = typeof tex === 'function';
      x = Math.round(x); y = Math.round(y);
      for (let j = 0; j < bh; j++) {
        const v = ((j + .5) / bh - .5) * 2 * tanV;
        for (let i = 0; i < bw; i++) {
          const u = ((i + .5) / bw - .5) * 2 * tanH, ur = u * cr - v * sr, vr = u * sr + v * cr;
          const rx = ur, ry = -sp * vr + cp, rz = -cp * vr - sp;
          const wx = rx * cy + ry * sy, wy = -rx * sy + ry * cy;
          if (rz > -1e-4) { if (opts.sky !== undefined) put(x + i, y + j, opts.sky); continue; }
          const t = oz / -rz, hx = ox + wx * t, hy = oy + wy * t, dist = t * Math.sqrt(1 + ur * ur + vr * vr);
          let c;
          if (isFn) c = tex(hx, hy, dist);
          else {
            let tu = Math.floor(hx), tv = Math.floor(hy);
            if (opts.wrap === 'clamp' && (tu < 0 || tv < 0 || tu >= tex.w || tv >= tex.h)) continue;
            tu = ((tu % tex.w) + tex.w) % tex.w; tv = ((tv % tex.h) + tex.h) % tex.h; c = tex.data[tv * tex.w + tu];
          }
          if (c === 255 || c === key || c === undefined) continue;
          if (fog) { const a = clamp((dist - fog.near) / (fog.far - fog.near)); if (a > bayer8(x + i - camX, y + j - camY)) c = fog.color; }
          put(x + i, y + j, c);
        }
      }
      return S;
    },
    // -- getting it on screen
    toSprite(key) { const data = px.slice(); if (key !== undefined) for (let k = 0; k < data.length; k++) if (data[k] === key) data[k] = 255; return { w, h, data }; },
    get canvas() { if (!cv) { cv = mk(w, h); cx = cv.getContext('2d'); img = cx.createImageData(w, h); u32 = new Uint32Array(img.data.buffer); } return cv; },
    // indexes -> colors on the low-res canvas. opts: map (a palette map), palette (override, e.g. Pixel.palette.mix(a, b, t)), key (index drawn transparent)
    render(opts = {}) {
      const c = S.canvas, pl = opts.palette ? palette(opts.palette) : pal, m = opts.map;
      let lut = pl.u32; if (opts.key !== undefined) { lut = lut.slice(); lut[opts.key] = 0; }           // key: a see-through index (overlays, HUD)
      if (m) for (let k = 0; k < px.length; k++) u32[k] = lut[m[px[k]]]; else for (let k = 0; k < px.length; k++) u32[k] = lut[px[k]];
      cx.putImageData(img, 0, 0); return c;
    },
    // Draw onto a canvas context with nearest-neighbor scaling. opts: x, y, w, h (target box, default the whole canvas), fit ('int' whole-number scale, centered:
    // default | 'contain' | 'cover' | 'stretch'), bg (css color for the bars), map, palette, key. Returns { x, y, w, h, scale }.
    flip(ctx, opts = {}) {
      const c = S.render(opts), X = opts.x ?? 0, Y = opts.y ?? 0, W = opts.w ?? ctx.canvas.width, H = opts.h ?? ctx.canvas.height, fit = opts.fit || 'int';
      let sc = fit === 'int' ? Math.max(1, Math.floor(Math.min(W / w, H / h))) : fit === 'cover' ? Math.max(W / w, H / h) : fit === 'stretch' ? 0 : Math.min(W / w, H / h);
      const dw = fit === 'stretch' ? W : w * sc, dh = fit === 'stretch' ? H : h * sc, dx = Math.round(X + (W - dw) / 2), dy = Math.round(Y + (H - dh) / 2);
      ctx.save(); ctx.imageSmoothingEnabled = false;
      if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(X, Y, W, H); }
      ctx.drawImage(c, dx, dy, dw, dh); ctx.restore();
      return { x: dx, y: dy, w: dw, h: dh, scale: dw / w };
    },
  };
  return S;
}

// A ready draw() for runtime/film.js shots: Pixel.shot(scr, (scr, s, f) => { scr.cls(0); ... }, flipOpts?)
// Use bg: false on the shot so the runtime doesn't paint the theme background under it.
const shot = (scr, fn, flipOpts) => (ctx, s, f) => { scr.reset(); fn(scr, s, f); scr.flip(ctx, typeof flipOpts === 'function' ? flipOpts(s, f) : flipOpts); };

// ---------------------------------------------------------------- post pass: any canvas -> low-res, palette, Bayer (WebGL)
// const q = Pixel.post({ w: 320, h: 180, palette: 'pico8', dither: 'bayer8', spread: .16 });
// q.apply(sourceCanvas, ctx)      // downsample, add the Bayer threshold, snap to the palette, scale up with nearest neighbor
// Works on a 2D canvas, a Three.js renderer.domElement (create it with preserveDrawingBuffer: true) or the film's own canvas
// (as `post: (ctx, T, f) => q.apply(ctx.canvas, ctx)` it pixelates HUD and everything). One WebGL context each: keep to a few.
function post(o = {}) {
  const w = o.w || 320, h = o.h || 180, pal = palette(o.palette || 'pico8');
  if (pal.size > 32) throw new Error('Pixel.post: at most 32 palette colors');
  const gl = mk(w, h).getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error('Pixel.post: WebGL is not available');
  const cvs = gl.canvas, lo = mk(w, h), lx = lo.getContext('2d');
  const mode = { none: 0, bayer2: 2, bayer4: 4, bayer8: 8 }[o.dither ?? 'bayer4'];
  if (mode === undefined) throw new Error('Pixel.post: dither is none | bayer2 | bayer4 | bayer8');
  const vs = 'attribute vec2 p; varying vec2 uv; void main(){ uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }';
  const fs = `precision highp float; varying vec2 uv; uniform sampler2D src; uniform vec3 pal[32]; uniform int n; uniform float spread, contrast, sat, bright; uniform vec2 size;
    float b2(vec2 a){ a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
    float b4(vec2 a){ return b2(.5 * a) * .25 + b2(a); }
    float b8(vec2 a){ return b4(.5 * a) * .25 + b2(a); }
    void main(){
      vec3 c = texture2D(src, uv).rgb;
      float l = dot(c, vec3(.299, .587, .114)); c = mix(vec3(l), c, sat); c = (c - .5) * contrast + .5 + bright;
      vec2 cell = floor(uv * size);
      float th = ${mode === 0 ? '.5' : mode === 2 ? 'b2(cell) + .125' : mode === 4 ? 'b4(cell) + .03125' : 'b8(cell) + .0078125'};
      c += (th - .5) * spread;
      vec3 best = pal[0]; float bd = 1e9;
      for (int i = 0; i < 32; i++){ if (i >= n) break; vec3 d = c - pal[i]; float dd = 2. * d.r * d.r + 4. * d.g * d.g + 3. * d.b * d.b; if (dd < bd){ bd = dd; best = pal[i]; } }
      gl_FragColor = vec4(best, 1.);
    }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Pixel.post shader: ' + gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const flat = new Float32Array(96); pal.rgb.forEach((c, k) => { flat[k * 3] = c[0] / 255; flat[k * 3 + 1] = c[1] / 255; flat[k * 3 + 2] = c[2] / 255; });
  const U = n => gl.getUniformLocation(prog, n);
  gl.uniform3fv(U('pal'), flat); gl.uniform1i(U('n'), pal.size); gl.uniform2f(U('size'), w, h);
  gl.uniform1f(U('spread'), o.spread ?? .16); gl.uniform1f(U('contrast'), o.contrast ?? 1); gl.uniform1f(U('sat'), o.saturation ?? 1); gl.uniform1f(U('bright'), o.brightness ?? 0);
  gl.viewport(0, 0, w, h);
  // quantize only: returns the low-res WebGL canvas
  const render = src => {
    lx.imageSmoothingEnabled = true; lx.imageSmoothingQuality = 'high'; lx.drawImage(src, 0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lo);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return cvs;
  };
  // quantize and draw onto ctx over its whole canvas (or opts x, y, w, h), nearest-neighbor
  const apply = (src, ctx, opts = {}) => {
    const c = render(src), X = opts.x ?? 0, Y = opts.y ?? 0, W = opts.w ?? ctx.canvas.width, H = opts.h ?? ctx.canvas.height;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, X, Y, W, H); ctx.restore();
  };
  return { canvas: cvs, w, h, palette: pal, render, apply };
}

// ---------------------------------------------------------------- dithered transitions for runtime/film.js
// Film.create({ transitions: Pixel.transitions, shots: [{ id: 'b', in: { type: 'bayer', beats: 1 } }, ...] })
// Each is (ctx, A, B, p, opts, f) like the built-in ones. Options: cell (px per dither cell, default W / 240), ease.
const tileCache = new Map();
let scratch = null;
const bayerTile = (level, cell) => {                          // 8x8 threshold tile at `level` (0..64) of the Bayer matrix, `cell` px per dot
  const key = level * 1000 + cell; let t = tileCache.get(key);
  if (!t) {
    t = mk(8 * cell, 8 * cell); const g = t.getContext('2d'); g.fillStyle = '#000';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (BAYER8[y * 8 + x] < level) g.fillRect(x * cell, y * cell, cell, cell);
    tileCache.set(key, t);
  }
  return t;
};
const scratchFor = A => { if (!scratch || scratch.width !== A.width || scratch.height !== A.height) scratch = mk(A.width, A.height); return scratch; };
const cellOf = (o, A) => Math.max(1, Math.round(o.cell || A.width / 240));
const easeIO = p => p < .5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
const easeOf = (o, p) => (typeof o.ease === 'function' ? o.ease : easeIO)(p);
// B shows through the pixels of `paint(g)` (a mask filled with the Bayer patterns), A is everywhere else
function bayerMask(ctx, A, B, paint) {
  const M = scratchFor(A), g = M.getContext('2d');
  ctx.drawImage(A, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, M.width, M.height);
  paint(g); g.globalCompositeOperation = 'source-in'; g.drawImage(B, 0, 0); g.globalCompositeOperation = 'source-over';
  ctx.drawImage(M, 0, 0);
}
const transitions = {
  // the whole frame dissolves through an 8x8 Bayer screen: 64 steps of pure ordered dither
  bayer(ctx, A, B, p, o = {}) {
    const cell = cellOf(o, A), level = Math.round(clamp(easeOf(o, p)) * 64);
    if (level <= 0) { ctx.drawImage(A, 0, 0); return; } if (level >= 64) { ctx.drawImage(B, 0, 0); return; }
    bayerMask(ctx, A, B, g => { g.fillStyle = g.createPattern(bayerTile(level, cell), 'repeat'); g.fillRect(0, 0, A.width, A.height); });
  },
  // a soft dithered edge sweeps across: dir 'l' (default) | 'r' | 'u' | 'd', soft = width of the dithered band (0.5)
  bayerwipe(ctx, A, B, p, o = {}) {
    const cell = cellOf(o, A), W = A.width, H = A.height, soft = o.soft ?? .5, dir = o.dir || 'l', horiz = dir === 'l' || dir === 'r', e = clamp(easeOf(o, p));
    const strip = cell * 2, n = Math.ceil((horiz ? W : H) / strip);
    bayerMask(ctx, A, B, g => {
      for (let k = 0; k < n; k++) {
        let pos = (k + .5) / n; if (dir === 'r' || dir === 'd') pos = 1 - pos;
        const level = Math.round(clamp((e * (1 + soft) - pos) / soft) * 64); if (level <= 0) continue;
        g.fillStyle = level >= 64 ? '#000' : g.createPattern(bayerTile(level, cell), 'repeat');
        if (horiz) g.fillRect(k * strip, 0, strip, H); else g.fillRect(0, k * strip, W, strip);
      }
    });
  },
  // the frame turns to chunky pixels (cells double up to `max`), the cut hides at the biggest cells, then it resolves
  pixelate(ctx, A, B, p, o = {}) {
    const W = A.width, H = A.height, max = Math.log2(Math.max(2, o.max || H / 8)), q = p < .5 ? easeIO(p * 2) : 1 - easeIO((p - .5) * 2);
    const cell = 2 ** Math.round(q * max), src = p < .5 ? A : B;
    if (cell <= 1) { ctx.drawImage(src, 0, 0); return; }
    const key = `px${cell}x${W}`; let lo = tileCache.get(key);
    if (!lo) { lo = mk(Math.ceil(W / cell), Math.ceil(H / cell)); tileCache.set(key, lo); }
    const g = lo.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.clearRect(0, 0, lo.width, lo.height); g.drawImage(src, 0, 0, lo.width, lo.height);
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(lo, 0, 0, lo.width * cell, lo.height * cell); ctx.restore();
  },
  // squares shrink away from the old frame in a wave and show the new one: order 'diagonal' (default) | 'radial' | 'random' | 'rows'
  squares(ctx, A, B, p, o = {}) {
    const W = A.width, H = A.height, size = Math.round(o.size || H / 9), cols = Math.ceil(W / size), rows = Math.ceil(H / size), order = o.order || 'diagonal', e = easeOf(o, p), spread = .55;
    ctx.drawImage(B, 0, 0); ctx.save(); ctx.imageSmoothingEnabled = false;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const hsh = mulberry32(r * 977 + c * 131 + 7)();
      const d = order === 'radial' ? Math.hypot((c + .5) / cols - .5, (r + .5) / rows - .5) / .72 : order === 'random' ? hsh : order === 'rows' ? (r + hsh * .5) / (rows + .5) : (c / cols + r / rows) / 2;
      const local = clamp((e * (1 + spread) - d) / spread);                  // 0 = whole square of A, 1 = gone
      if (local >= 1) continue;
      const s = size * (1 - local), x = c * size + (size - s) / 2, y = r * size + (size - s) / 2;
      ctx.drawImage(A, c * size, r * size, size, size, x, y, s, s);
    }
    ctx.restore();
  },
};

global.Pixel = {
  screen, shot, palette, palettes: PALETTES, map, sprite, frames, cut, mirror: flipSprite, recolor, outline, FONT, textWidth,
  noise, fbm, shake, project, bayer, bayer4, bayer8, post, transitions, mulberry32,
  fadeMap, flashMap, cycleMap,
};
if (typeof module !== 'undefined' && module.exports) module.exports = global.Pixel;
})(typeof window !== 'undefined' ? window : globalThis);
