// motion-kit film runtime: a 1-3 minute film as a list of shots on a tempo map.
// Shots are measured in beats, the runtime turns them into seconds, draws transitions between them,
// a HUD that carries state across the film, statement text, counters, themes, line art, a globe,
// a score scheduled on the same tempo map, a live preview and the render contract for render.mjs.
// Classic script, no dependencies:  <script src="../../runtime/film.js"></script>  then  Film.create({...}).
// For publishing, runtime/inline.mjs folds it into one self-contained HTML. API: runtime/README.md.
(function (global) {
'use strict';

// ---------------------------------------------------------------- math
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const smooth = p => p * p * (3 - 2 * p);
const ease = {
  linear: p => p,
  inOutCubic: p => p < .5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2,
  inOutSine: p => -(Math.cos(Math.PI * p) - 1) / 2,
  outCubic: p => 1 - (1 - p) ** 3,
  outQuart: p => 1 - (1 - p) ** 4,
  outExpo: p => p >= 1 ? 1 : 1 - 2 ** (-10 * p),
  inExpo: p => p <= 0 ? 0 : 2 ** (10 * p - 10),
  inCubic: p => p * p * p,
  inOutExpo: p => p <= 0 ? 0 : p >= 1 ? 1 : p < .5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2,
  outBack: (p, s = 1.70158) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2,
};
function spring(t, zeta = .45, omega = 14) {
  if (t <= 0) return 0;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
}
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash1(i, seed = 0) { let h = Math.imul(i ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(seed + 1, 0xC2B2AE35); h ^= h >>> 13; h = Math.imul(h, 0x27D4EB2F); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function noise1(x, seed = 0) { const i = Math.floor(x), f = x - i; return lerp(hash1(i, seed), hash1(i + 1, seed), smooth(f)) * 2 - 1; }

// ---------------------------------------------------------------- color
const _rgb = new Map();
function rgb(c) {
  let v = _rgb.get(c);
  if (!v) { let h = c.slice(1); if (h.length === 3) h = [...h].map(x => x + x).join(''); v = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); _rgb.set(c, v); }
  return v;
}
const isHex = c => typeof c === 'string' && c[0] === '#';
function mix(a, b, p) {
  if (p <= 0 || !isHex(b)) return a; if (p >= 1 || !isHex(a)) return b;
  const A = rgb(a), B = rgb(b);
  return '#' + [0, 1, 2].map(i => Math.round(lerp(A[i], B[i], p)).toString(16).padStart(2, '0')).join('');
}
function alpha(c, a) { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${a})`; }
function mixTheme(A, B, p) {
  if (p <= 0) return A; if (p >= 1) return B;
  const o = {};
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) o[k] = isHex(A[k]) && isHex(B[k]) ? mix(A[k], B[k], p) : (p < .5 ? A[k] : B[k]);
  return o;
}

// ---------------------------------------------------------------- tempo map
// spec: a number (one BPM) or [{bar, bpm, ramp?}]. ramp: true glides the tempo to the next entry's bpm.
function tempoMap(spec, bpb = 4, offset = 0) {
  const segs = (typeof spec === 'number' ? [{ bar: 0, bpm: spec }] : spec.slice()).sort((a, b) => a.bar - b.bar);
  if (segs[0].bar !== 0) segs.unshift({ bar: 0, bpm: segs[0].bpm });
  const P = [];
  const dt = (pc, b) => { const d = b - pc.b0; return Math.abs(pc.k) < 1e-9 ? 60 * d / pc.bpm0 : (60 / pc.k) * Math.log((pc.bpm0 + pc.k * d) / pc.bpm0); };
  let t0 = offset;
  segs.forEach((s, i) => {
    const n = segs[i + 1], b0 = s.bar * bpb, b1 = n ? n.bar * bpb : Infinity;
    const pc = { b0, b1, bpm0: s.bpm, k: s.ramp && n ? (n.bpm - s.bpm) / (b1 - b0) : 0, t0 };
    P.push(pc); if (n) t0 += dt(pc, b1);
  });
  const byBeat = b => { let pc = P[0]; for (const q of P) if (b >= q.b0) pc = q; return pc; };
  const byTime = t => { let pc = P[0]; for (const q of P) if (t >= q.t0) pc = q; return pc; };
  return {
    bpb, offset,
    time: b => { const pc = byBeat(b); return pc.t0 + dt(pc, b); },
    beat: t => { const pc = byTime(t), d = t - pc.t0; return pc.b0 + (Math.abs(pc.k) < 1e-9 ? d * pc.bpm0 / 60 : pc.bpm0 * (Math.exp(pc.k * d / 60) - 1) / pc.k); },
    bpm: b => { const pc = byBeat(b); return pc.bpm0 + pc.k * (b - pc.b0); },
  };
}

// ---------------------------------------------------------------- canvas helpers
const canvas2d = (w, h) => { const c = new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h))); return { c, x: c.getContext('2d') }; };
const font = (size, family, weight = 400, style = '') => `${style} ${weight} ${Math.round(size)}px ${family}`.trim();

// Sprite cache for text: a word is rasterized once per look (font, color, glow, tracking) and then
// drawn with drawImage. Never keyed by time: parallel render workers draw chunks out of order.
const sprites = new Map();
function textSprite(text, fnt, color, glow = null, glowR = 0, tracking = 0) {
  const key = `${fnt}|${color}|${glow}|${glowR}|${tracking}|${text}`;
  let s = sprites.get(key);
  if (s) return s;
  const m = canvas2d(1, 1).x; m.font = fnt; m.letterSpacing = `${tracking}px`;
  const mt = m.measureText(text), asc = Math.ceil(mt.fontBoundingBoxAscent), desc = Math.ceil(mt.fontBoundingBoxDescent);
  const pad = Math.ceil(glowR * 2.5) + 4, w = Math.ceil(mt.width) + pad * 2, h = asc + desc + pad * 2;
  const { c, x } = canvas2d(w, h);
  x.font = fnt; x.letterSpacing = `${tracking}px`; x.textBaseline = 'alphabetic'; x.fillStyle = color;
  if (glow && glowR) { x.shadowColor = glow; x.shadowBlur = glowR; x.fillText(text, pad, pad + asc); x.shadowBlur = glowR * .35; }
  x.fillText(text, pad, pad + asc); x.shadowBlur = 0; x.fillText(text, pad, pad + asc);
  // Freeze the sprite as an ImageBitmap. Drawing a freshly written GPU OffscreenCanvas elsewhere
  // sometimes picked up a half-rasterized glyph (zeros missing their left side or a band),
  // different on every run; the bitmap is a finished, immutable snapshot.
  s = { img: c.transferToImageBitmap(), w: mt.width, pad, asc, desc, h };
  sprites.set(key, s);
  return s;
}
// draw a sprite so that (x, y) is the baseline start of the text, scaled around its center
function drawSprite(ctx, s, x, y, scale = 1, a = 1) {
  if (a <= 0) return;
  ctx.globalAlpha = a;
  if (scale === 1) ctx.drawImage(s.img, x - s.pad, y - s.asc - s.pad);
  else {
    const cx = x + s.w / 2, cy = y - s.asc / 2;
    ctx.drawImage(s.img, cx - (s.w / 2 + s.pad) * scale, cy - (s.asc / 2 + s.pad) * scale, s.img.width * scale, s.img.height * scale);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- line art
// Points are flat arrays [x0, y0, x1, y1, ...]. poly() draws the first p (0..1) of the length.
const ink = {
  poly(ctx, pts, p = 1, closed = false) {
    if (p <= 0 || pts.length < 4) return;
    if (closed) pts = pts.concat(pts[0], pts[1]);
    let L = 0; for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    let left = L * clamp(p);
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) {
      const dx = pts[i] - pts[i - 2], dy = pts[i + 1] - pts[i - 1], d = Math.hypot(dx, dy);
      if (d >= left) { const k = d ? left / d : 0; ctx.lineTo(pts[i - 2] + dx * k, pts[i - 1] + dy * k); break; }
      ctx.lineTo(pts[i], pts[i + 1]); left -= d;
    }
    ctx.stroke();
  },
  line: (x0, y0, x1, y1) => [x0, y0, x1, y1],
  rect: (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h, x, y],
  arc(cx, cy, r, a0, a1, n = 0) {
    n = n || Math.max(8, Math.ceil(Math.abs(a1 - a0) * r / 6));
    const o = []; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); o.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    return o;
  },
  circle: (cx, cy, r, a0 = -Math.PI / 2, n = 0) => ink.arc(cx, cy, r, a0, a0 + TAU, n),
  ellipse(cx, cy, rx, ry, rot = 0, a0 = 0, n = 96) {
    const o = [], c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i <= n; i++) { const a = a0 + TAU * i / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry; o.push(cx + x * c - y * s, cy + x * s + y * c); }
    return o;
  },
  gear(cx, cy, r, teeth = 12, rot = 0, depth = .14) {
    const o = [], n = teeth * 4;
    for (let i = 0; i <= n; i++) { const a = rot + TAU * i / n, rr = (i % 4 < 2) ? r : r * (1 - depth); o.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    return o;
  },
  // parallel hatching inside the current clip region set by pathFn(ctx); p reveals the lines one by one
  hatch(ctx, pathFn, { angle = -Math.PI / 4, gap = 9, p = 1, box = null } = {}) {
    if (p <= 0) return;
    ctx.save(); ctx.beginPath(); pathFn(ctx); ctx.clip();
    const [x0, y0, x1, y1] = box || [0, 0, ctx.canvas.width, ctx.canvas.height];
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2, c = Math.cos(angle), s = Math.sin(angle);
    const n = Math.ceil(2 * R / gap), shown = Math.floor(n * clamp(p));
    ctx.beginPath();
    for (let i = 0; i < shown; i++) { const d = -R + i * gap; ctx.moveTo(cx - s * d - c * R, cy + c * d - s * R); ctx.lineTo(cx - s * d + c * R, cy + c * d + s * R); }
    ctx.stroke(); ctx.restore();
  },
  // 3D: points [x, y, z, ...] through a camera from Film.cam3()
  poly3(ctx, cam, pts3, p = 1, closed = false) { const o = []; for (let i = 0; i < pts3.length; i += 3) { const q = cam(pts3[i], pts3[i + 1], pts3[i + 2]); o.push(q[0], q[1]); } ink.poly(ctx, o, p, closed); },
  box3(w, h, d, x = 0, y = 0, z = 0) {           // edges of a box as a list of 3D polylines
    const X = [x - w / 2, x + w / 2], Y = [y - h / 2, y + h / 2], Z = [z - d / 2, z + d / 2];
    const v = (i, j, k) => [X[i], Y[j], Z[k]];
    const e = [[0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]];
    return e.map(q => [...v(q[0], q[1], q[2]), ...v(q[3], q[4], q[5])]);
  },
};
// camera for simple 3D line art: yaw/pitch in radians, dist = Infinity gives an isometric-style parallel view
function cam3({ x = 960, y = 540, yaw = .6, pitch = .45, scale = 1, dist = Infinity, fov = 900 } = {}) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return (X, Y, Z) => {
    const x1 = X * cy - Z * sy, z1 = X * sy + Z * cy;
    const y2 = Y * cp - z1 * sp, z2 = Y * sp + z1 * cp;
    const k = isFinite(dist) ? fov / (dist - z2) : 1;
    return [x + x1 * k * scale, y - y2 * k * scale, z2];
  };
}

// ---------------------------------------------------------------- globe (orthographic)
// Earth-fixed unit sphere: x = cos(lat)cos(lon), y = cos(lat)sin(lon), z = sin(lat). Altitudes in Earth radii.
const D2R = Math.PI / 180;
function ecef(lon, lat, h = 0) { const r = 1 + h, a = lon * D2R, b = lat * D2R; return [r * Math.cos(b) * Math.cos(a), r * Math.cos(b) * Math.sin(a), r * Math.sin(b)]; }
// a point on a circular orbit: radius R (Earth radii), inclination and ascending node in degrees, phase in radians
function orbitPoint(R, inc, raan, th) {
  const i = inc * D2R, O = raan * D2R, c = Math.cos(th), s = Math.sin(th);
  return [R * (Math.cos(O) * c - Math.sin(O) * s * Math.cos(i)), R * (Math.sin(O) * c + Math.cos(O) * s * Math.cos(i)), R * s * Math.sin(i)];
}
function globe({ x = 960, y = 540, r = 300, lon = 0, lat = 20, roll = 0 } = {}) {
  const l0 = lon * D2R, p0 = lat * D2R, cr = Math.cos(roll), sr = Math.sin(roll);
  const E = [-Math.sin(l0), Math.cos(l0), 0], N = [-Math.sin(p0) * Math.cos(l0), -Math.sin(p0) * Math.sin(l0), Math.cos(p0)], U = [Math.cos(p0) * Math.cos(l0), Math.cos(p0) * Math.sin(l0), Math.sin(p0)];
  const G = {
    x, y, r,
    // any Earth-fixed point -> {x, y, z, vis}; vis is false when the Earth hides it
    p3(X, Y, Z) {
      const a = X * E[0] + Y * E[1] + Z * E[2], b = X * N[0] + Y * N[1] + Z * N[2], d = X * U[0] + Y * U[1] + Z * U[2];
      const u = a * cr - b * sr, v = a * sr + b * cr;
      return { x: x + u * r, y: y - v * r, z: d, vis: d > 0 || u * u + v * v > 1 };
    },
    proj: (lo, la, h = 0) => { const q = ecef(lo, la, h); return G.p3(q[0], q[1], q[2]); },
    outline(ctx) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); },
    disc(ctx) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); },
    // polyline of Earth-fixed 3D points; hidden parts are skipped, or drawn with hiddenAlpha
    path3(ctx, pts, { p = 1, hiddenAlpha = 0 } = {}) {
      const n = Math.max(2, Math.round(pts.length / 3 * clamp(p)));
      const a0 = ctx.globalAlpha;
      for (const pass of hiddenAlpha > 0 ? [0, 1] : [1]) {
        ctx.globalAlpha = a0 * (pass ? 1 : hiddenAlpha);
        ctx.beginPath(); let pen = false;
        for (let i = 0; i < n; i++) {
          const q = G.p3(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
          if (q.vis === !!pass) { pen ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); pen = true; } else pen = false;
        }
        ctx.stroke();
      }
      ctx.globalAlpha = a0;
    },
    grid(ctx, { step = 15, p = 1, n = 72 } = {}) {
      for (let lo = -180; lo < 180; lo += step) { const pts = []; for (let i = 0; i <= n; i++) pts.push(...ecef(lo, -90 + 180 * i / n)); G.path3(ctx, pts, { p }); }
      for (let la = -90 + step; la < 90; la += step) { const pts = []; for (let i = 0; i <= n * 2; i++) pts.push(...ecef(-180 + 360 * i / (n * 2), la)); G.path3(ctx, pts, { p }); }
    },
    land(ctx, { p = 1 } = {}) {
      if (!geo.rings) return;
      const lim = Math.floor(geo.rings.length * clamp(p));
      ctx.beginPath();
      for (let k = 0; k < lim; k++) {
        const ring = geo.rings[k]; let pen = false;
        for (let i = 0; i < ring.length; i += 2) {
          const q = G.proj(ring[i], ring[i + 1]);
          if (q.z > 0) { pen ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); pen = true; } else pen = false;
        }
      }
      ctx.stroke();
    },
  };
  return G;
}
// Coastlines: Natural Earth 110m land from the world-atlas package, decoded from TopoJSON without a library.
const geo = {
  rings: null,
  url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json',
  async load(url = geo.url) {
    if (geo.rings) return geo.rings;
    const topo = await (await fetch(url)).json();
    const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
    const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(([dx, dy]) => (x += dx, y += dy, [x * sx + tx, y * sy + ty])); });
    const ring = idx => { const o = []; idx.forEach((i, n) => { const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse(); (n ? a.slice(1) : a).forEach(q => o.push(q[0], q[1])); }); return o; };
    const rings = [];
    const walk = g => { if (g.type === 'GeometryCollection') g.geometries.forEach(walk); else if (g.type === 'Polygon') g.arcs.forEach(r => rings.push(ring(r))); else if (g.type === 'MultiPolygon') g.arcs.forEach(pl => pl.forEach(r => rings.push(ring(r)))); };
    Object.values(topo.objects).forEach(walk);
    rings.sort((a, b) => b.length - a.length);        // big landmasses first, so land({p}) reveals continents first
    return (geo.rings = rings);
  },
  // equirectangular map inside rect [x, y, w, h] over lon/lat ranges
  flat(ctx, [x, y, w, h], { lon = [-180, 180], lat = [-60, 85], p = 1 } = {}) {
    if (!geo.rings) return;
    const X = lo => x + (lo - lon[0]) / (lon[1] - lon[0]) * w, Y = la => y + (lat[1] - la) / (lat[1] - lat[0]) * h;
    const lim = Math.floor(geo.rings.length * clamp(p));
    ctx.beginPath();
    for (let k = 0; k < lim; k++) { const r = geo.rings[k]; ctx.moveTo(X(r[0]), Y(r[1])); for (let i = 2; i < r.length; i += 2) { if (Math.abs(r[i] - r[i - 2]) > 180) ctx.moveTo(X(r[i]), Y(r[i + 1])); else ctx.lineTo(X(r[i]), Y(r[i + 1])); } }
    ctx.stroke();
    return { X, Y };
  },
};

// ---------------------------------------------------------------- effects
const fx = {
  // radial speed lines from (cx, cy); a = opacity. Seeded, so identical in every worker.
  rays(ctx, cx, cy, a, { n = 90, color = '#ffffff', r0 = 80, seed = 7, width = 2, t = 0 } = {}) {
    if (a <= 0) return;
    const R = Math.hypot(ctx.canvas.width, ctx.canvas.height), rn = mulberry32(seed);
    ctx.save(); ctx.strokeStyle = color; ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const ang = rn() * TAU, len = .25 + rn() * .6, st = r0 + rn() * R * .35 + t * 400 * (.5 + rn());
      ctx.globalAlpha = a * (.25 + rn() * .75); ctx.lineWidth = width * (.4 + rn());
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * st, cy + Math.sin(ang) * st); ctx.lineTo(cx + Math.cos(ang) * (st + len * R), cy + Math.sin(ang) * (st + len * R)); ctx.stroke();
    }
    ctx.restore();
  },
  // expanding ring: the classic "signal" pulse. q = 0..1 progress of one pulse
  ring(ctx, x, y, r0, r1, q, { color = '#fff', width = 2 } = {}) {
    if (q <= 0 || q >= 1) return;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width * (1 - q * .6); ctx.globalAlpha = (1 - q) ** 1.5;
    ctx.beginPath(); ctx.arc(x, y, lerp(r0, r1, ease.outCubic(q)), 0, TAU); ctx.stroke(); ctx.restore();
  },
  // soft glow dot from a cached sprite
  glow(ctx, x, y, r, color, a = 1) {
    const key = `glow|${color}`;
    let s = sprites.get(key);
    if (!s) {
      const { c, x: g } = canvas2d(256, 256), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, alpha(color, 1)); gr.addColorStop(.25, alpha(color, .45)); gr.addColorStop(1, alpha(color, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256); s = { img: c.transferToImageBitmap() }; sprites.set(key, s);
    }
    ctx.globalAlpha = a; ctx.drawImage(s.img, x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1;
  },
};

// ---------------------------------------------------------------- transitions
// Each gets the outgoing (A) and incoming (B) buffers and p = 0..1 over the transition window.
const TRANSITIONS = {
  fade(ctx, A, B, p) { ctx.drawImage(A, 0, 0); ctx.globalAlpha = ease.inOutCubic(p); ctx.drawImage(B, 0, 0); ctx.globalAlpha = 1; },
  dip(ctx, A, B, p, o) {                        // through a color: black = time passes, white = revelation
    ctx.drawImage(p < .5 ? A : B, 0, 0); ctx.globalAlpha = 1 - Math.abs(p * 2 - 1); ctx.fillStyle = o.color || '#000';
    ctx.fillRect(0, 0, A.width, A.height); ctx.globalAlpha = 1;
  },
  flash(ctx, A, B, p, o, f) {                   // the old frame burns to white, the new one comes out of it with rays
    const W = A.width, H = A.height, col = o.color || '#ffffff';
    if (p < .5) { ctx.drawImage(A, 0, 0); ctx.globalAlpha = ease.inExpo(p * 2); ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; return; }
    const q = (p - .5) * 2;
    ctx.drawImage(B, 0, 0);
    fx.rays(ctx, W / 2, H / 2, (1 - q) * .8, { color: o.rays || col, t: q, seed: 3 });
    ctx.globalAlpha = 1 - ease.outCubic(q); ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  },
  punch(ctx, A, B, p, o) {                      // hard cut with a zoom punch, ghosting and rays: for accents on a strong beat
    const W = A.width, H = A.height;
    if (p < .5) { ctx.drawImage(A, 0, 0); return; }
    const q = ease.outCubic((p - .5) * 2), s = 1 + .07 * (1 - q);
    const draw = (sc, a) => { ctx.globalAlpha = a; ctx.drawImage(B, W / 2 - W * sc / 2, H / 2 - H * sc / 2, W * sc, H * sc); };
    draw(s, 1); draw(s * 1.035, .22 * (1 - q)); draw(s * 1.075, .12 * (1 - q)); ctx.globalAlpha = 1;
    fx.rays(ctx, W / 2, H / 2, (1 - q) * .55, { color: o.rays || '#ffffff', t: q, seed: 11 });
  },
  // push and whip slide sideways; `axis: 'y'` slides vertically (dir 1: the old shot leaves upward, the new one comes from below: the swipe of a feed)
  push(ctx, A, B, p, o) {
    const e = ease.inOutExpo(p), d = o.dir || 1, y = o.axis === 'y', S = y ? A.height : A.width, at = k => y ? [0, k] : [k, 0];
    ctx.drawImage(A, ...at(-d * e * S)); ctx.drawImage(B, ...at(d * (1 - e) * S));
  },
  whip(ctx, A, B, p, o) {
    const d = o.dir || 1, e = ease.inOutExpo(p), y = o.axis === 'y', S = y ? A.height : A.width, blur = Math.sin(p * Math.PI), at = k => y ? [0, k] : [k, 0];
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, A.width, A.height);
    for (let i = 0; i < 8; i++) { const k = e + (i / 8 - .5) * .25 * blur; ctx.globalAlpha = .2; ctx.drawImage(A, ...at(-d * k * S)); ctx.drawImage(B, ...at(d * (1 - k) * S)); }
    ctx.globalAlpha = 1;
  },
  // push into a point of the old shot (a window, a pupil, a doorway); the new shot grows out of it.
  // color '#000' reads as "through a dark opening", '#fff' as "into the light"
  zoom(ctx, A, B, p, o) {
    const W = A.width, H = A.height, [cx, cy] = o.at || [W / 2, H / 2], col = o.color || '#000';
    const scaled = (img, px, py, s) => { ctx.save(); ctx.translate(px, py); ctx.scale(s, s); ctx.translate(-px, -py); ctx.drawImage(img, 0, 0); ctx.restore(); };
    if (p < .5) { const q = p * 2; scaled(A, cx, cy, 1 + ease.inExpo(q) * 18); ctx.globalAlpha = ease.inCubic(q); ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    else { const q = (p - .5) * 2; scaled(B, W / 2, H / 2, .6 + ease.outExpo(q) * .4); ctx.globalAlpha = 1 - ease.outCubic(q); ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  },
  iris(ctx, A, B, p, o) {
    const W = A.width, H = A.height, [cx, cy] = o.at || [W / 2, H / 2];
    ctx.drawImage(A, 0, 0); ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, ease.inOutCubic(p) * Math.hypot(W, H), 0, TAU); ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore();
  },
  wipe(ctx, A, B, p, o) {                       // hard-edged wipe with an ink line on the edge
    const W = A.width, H = A.height, sl = Math.min(W, H) * .15, e = ease.inOutCubic(p), x = e * (W + sl * 2) - sl;
    ctx.drawImage(A, 0, 0); ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x + sl, 0); ctx.lineTo(x - sl, H); ctx.lineTo(0, H); ctx.closePath(); ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore();
    ctx.strokeStyle = o.color || '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + sl, 0); ctx.lineTo(x - sl, H); ctx.stroke();
  },
};

// ---------------------------------------------------------------- audio
const audio = (() => {
  const noiseCache = new WeakMap();
  function noise(ac, sec = 1) {
    let m = noiseCache.get(ac); if (!m) noiseCache.set(ac, m = new Map());
    const k = Math.round(sec * 10); if (m.has(k)) return m.get(k);
    const b = ac.createBuffer(1, Math.ceil(ac.sampleRate * sec), ac.sampleRate), d = b.getChannelData(0), r = mulberry32(k + 9);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    m.set(k, b); return b;
  }
  const NOTES = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const hz = n => { if (typeof n === 'number') return n; const m = /^([A-G])([#b]?)(-?\d)$/.exec(n); return 440 * 2 ** ((NOTES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] - 4) * 12) / 12); };
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const I = {
    hz, noise,
    kick(ac, t, out, g = .9) { const o = ac.createOscillator(), v = ac.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + .12); env(v, t, .003, g, .42); o.connect(v).connect(out); o.start(t); o.stop(t + .5); },
    hat(ac, t, out, g = .16, d = .05) { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), v = ac.createGain(); s.buffer = noise(ac, .2); f.type = 'highpass'; f.frequency.value = 7500; env(v, t, .002, g, d); s.connect(f).connect(v).connect(out); s.start(t); s.stop(t + d + .05); },
    clap(ac, t, out, g = .35) { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), v = ac.createGain(); s.buffer = noise(ac, .4); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.2; env(v, t, .004, g, .18); s.connect(f).connect(v).connect(out); s.start(t); s.stop(t + .3); },
    // a clock tick: a short band-passed click with a tiny tonal body
    tick(ac, t, out, g = .22, freq = 3400) {
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), v = ac.createGain(); s.buffer = noise(ac, .1); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 6; env(v, t, .001, g, .025); s.connect(f).connect(v).connect(out); s.start(t); s.stop(t + .06);
      const o = ac.createOscillator(), w = ac.createGain(); o.frequency.value = freq * .5; env(w, t, .001, g * .3, .02); o.connect(w).connect(out); o.start(t); o.stop(t + .05);
    },
    // a sonar/satellite ping: sine with a slow decay and a quiet fifth above
    ping(ac, t, out, { freq = 1318.5, g = .18, d = 1.1 } = {}) {
      [[1, 1], [1.5, .25], [2.01, .12]].forEach(([m, a]) => { const o = ac.createOscillator(), v = ac.createGain(); o.frequency.value = freq * m; env(v, t, .004, g * a, d); o.connect(v).connect(out); o.start(t); o.stop(t + d + .1); });
    },
    pluck(ac, t, out, { note = 'A4', g = .16, d = .5, type = 'triangle' } = {}) { const o = ac.createOscillator(), f = ac.createBiquadFilter(), v = ac.createGain(); o.type = type; o.frequency.value = hz(note); f.type = 'lowpass'; f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(400, t + d); env(v, t, .003, g, d); o.connect(f).connect(v).connect(out); o.start(t); o.stop(t + d + .05); },
    bass(ac, t, out, { note = 'A1', g = .3, d = .4 } = {}) {
      const o = ac.createOscillator(), s = ac.createOscillator(), f = ac.createBiquadFilter(), v = ac.createGain(); o.type = 'sawtooth'; o.frequency.value = hz(note); s.type = 'sine'; s.frequency.value = hz(note);
      f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(160, t + d); env(v, t, .006, g, d); o.connect(f); s.connect(f); f.connect(v).connect(out); o.start(t); s.start(t); o.stop(t + d + .05); s.stop(t + d + .05);
    },
    pad(ac, t, dur, out, { notes = ['A2', 'E3', 'A3', 'C4'], g = .07, open = 1600, att = 1.5 } = {}) {
      const f = ac.createBiquadFilter(), v = ac.createGain(); f.type = 'lowpass'; f.frequency.setValueAtTime(350, t); f.frequency.linearRampToValueAtTime(open, t + dur * .7);
      v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(g, t + Math.min(att, dur / 3)); v.gain.setValueAtTime(g, t + dur - Math.min(1.2, dur / 3)); v.gain.linearRampToValueAtTime(0, t + dur);
      f.connect(v).connect(out);
      notes.forEach((n, i) => [-8, 8].forEach(det => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = det + i * 1.5; o.connect(f); o.start(t); o.stop(t + dur + .05); }));
    },
    riser(ac, t, dur, out, g = .22) { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), v = ac.createGain(); s.buffer = noise(ac, dur + .2); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + dur); v.gain.setValueAtTime(.0001, t); v.gain.exponentialRampToValueAtTime(g, t + dur); v.gain.linearRampToValueAtTime(0, t + dur + .02); s.connect(f).connect(v).connect(out); s.start(t); s.stop(t + dur + .05); },
    impact(ac, t, out, g = .8) {
      I.kick(ac, t, out, g); const s = ac.createBufferSource(), f = ac.createBiquadFilter(), v = ac.createGain(); s.buffer = noise(ac, 2.5); f.type = 'lowpass'; f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(180, t + 1.8);
      env(v, t, .005, g * .45, 2.2); s.connect(f).connect(v).connect(out); s.start(t); s.stop(t + 2.4);
    },
    sub(ac, t, out, { note = 'A0', g = .5, d = 1.6 } = {}) { const o = ac.createOscillator(), v = ac.createGain(); o.frequency.setValueAtTime(hz(note) * 2, t); o.frequency.exponentialRampToValueAtTime(hz(note), t + .25); env(v, t, .01, g, d); o.connect(v).connect(out); o.start(t); o.stop(t + d + .05); },
    whoosh(ac, t, out, { g = .18, d = .5 } = {}) { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), v = ac.createGain(); s.buffer = noise(ac, d + .1); f.type = 'bandpass'; f.Q.value = 1.5; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(3500, t + d * .6); f.frequency.exponentialRampToValueAtTime(900, t + d); v.gain.setValueAtTime(.0001, t); v.gain.exponentialRampToValueAtTime(g, t + d * .55); v.gain.exponentialRampToValueAtTime(.0001, t + d); s.connect(f).connect(v).connect(out); s.start(t); s.stop(t + d + .05); },
  };
  // a reverb send from a seeded impulse response
  I.reverb = (ac, sec = 2.4, decay = 3) => {
    const n = Math.ceil(ac.sampleRate * sec), b = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c), r = mulberry32(31 + c); for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * (1 - i / n) ** decay; }
    const cv = ac.createConvolver(); cv.buffer = b; return cv;
  };
  return I;
})();

function encodeWavBase64(ab) {
  const ch = ab.numberOfChannels, sr = ab.sampleRate, n = ab.length;
  const buf = new ArrayBuffer(44 + n * ch * 2), v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => ab.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2; }
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------------------------------------------------------------- statements
// "EVERY SATELLITE SAYS|ONLY ONE THING: *THE TIME.*"  —  '|' breaks lines, *...* marks the payoff words.
function parseSay(text) {
  const lines = []; let acc = false, n = 0, run = -1, runs = 0;
  for (const l of String(text).split(/\||\n/)) {
    const ws = [];
    for (const tok of l.trim().split(/\s+/).filter(Boolean)) {
      const m = /^(\*?)(.*?)(\*?)([^*]*)$/.exec(tok);
      if (m[1]) acc = true;
      if (acc && run < 0) run = runs++;
      ws.push({ w: m[2] + m[4], acc, i: n++, run: acc ? run : -1 });
      if (m[3]) { acc = false; run = -1; }
    }
    lines.push(ws);
  }
  return { lines, n, runs };
}
// beat (local to the shot) at which word i of a statement appears
function wordBeat(spec, word) { const per = spec.per ?? .5; return (spec.start ?? 0) + word.i * per + (word.run >= 0 ? (word.run + 1) * (spec.gap ?? per) : 0); }

// ---------------------------------------------------------------- film
function create(cfg) {
  const W = cfg.W || 1920, H = cfg.H || 1080, FPS = cfg.FPS || 30, bpb = cfg.beatsPerBar || 4;
  // portrait (Reels, Shorts, TikTok): H > W. `u` scales anything drawn in "1080p pixels" to the short side of the frame.
  const portrait = H > W, u = Math.min(W, H) / 1080;
  const params = new URLSearchParams(location.search), RENDER = params.has('render');
  const tm = tempoMap(cfg.tempo ?? 120, bpb, cfg.offset || 0);
  const themes = cfg.themes || { paper: { bg: '#efe9dc', ink: '#1b1a17', muted: '#6d675c', accent: '#c8321f', line: '#1b1a17' } };
  const type = { display: '"Archivo", sans-serif', mono: '"IBM Plex Mono", monospace', ...(cfg.type || {}) };
  // safe margins as fractions: [sides, top, bottom]; bottom defaults to top. Portrait keeps clear of the platform UI (caption and buttons live at the bottom)
  const safe = cfg.safe || (portrait ? [.07, .1, .22] : [.065, .1]);
  const margin = { x: Math.round(W * safe[0]), y: Math.round(H * safe[1]), yb: Math.round(H * (safe[2] ?? safe[1])) };
  const baseSize = Math.round(portrait ? W * .095 : H * .058), bigSize = Math.round(portrait ? W * .2 : H * .12);   // default statement and counter sizes
  // voice-over (optional): { words: [{ word, start, end, punct? }], phrases?: [{ start, end, groups: [{ words: [i0, i1) }] }], offset, src?, ... }, see the Voice section
  const vc = cfg.voice && { at: 'bc', size: Math.round(portrait ? W * .056 : H * .05), group: 3, highlight: true, box: true, offset: 0, duck: true, duckDb: 12, ...cfg.voice };
  // the picture band: where a shot's picture lives (portrait: under the statement, above the subtitles and the platform UI)
  const band = cfg.band || (portrait
    ? (() => { const y = Math.round(H * .385), bottom = H - margin.yb - (vc ? Math.round(H * .08) : 0), side = Math.max(margin.x, Math.round(W * .11)); return { x: side, y, w: W - side * 2, h: bottom - y }; })()
    : { x: margin.x, y: margin.y, w: W - margin.x * 2, h: H - margin.y - margin.yb });

  // --- compile shots: beats -> seconds, inherited chapter / theme / HUD values
  let cursor = 0, chapter = '', theme = cfg.theme || Object.keys(themes)[0];
  const shots = [], byId = new Map(), hits = [];
  let prevFinal = { ...(cfg.initial || {}) };
  for (const def of cfg.shots) {
    const beats = def.beats ?? (def.bars ?? 1) * bpb;
    if (def.chapter !== undefined) chapter = def.chapter;
    if (def.theme) theme = def.theme;
    if (!themes[theme]) throw new Error(`shot ${def.id}: unknown theme ${theme}`);
    const sh = { ...def, i: shots.length, beats, b0: cursor, b1: cursor + beats, start: tm.time(cursor), end: tm.time(cursor + beats), chapter, themeName: theme, T: themes[theme] };
    cursor += beats;
    sh.hv = {}; sh.hvFinal = { ...prevFinal };
    for (const [k, v] of Object.entries(def.set || {})) {
      const o = v !== null && typeof v === 'object' ? v : { to: v };
      const from = o.from ?? prevFinal[k], num = typeof o.to === 'number' && typeof from === 'number';
      sh.hv[k] = { from, to: o.to, b0: o.b?.[0] ?? 0, b1: o.b?.[1] ?? (num ? (cfg.tween ?? 1) : 0), ease: ease[o.ease || 'inOutCubic'], log: o.log };
      sh.hvFinal[k] = o.to;
    }
    prevFinal = sh.hvFinal;
    sh.says = def.say ? [].concat(def.say).map(sp => typeof sp === 'string' ? { text: sp } : sp) : [];
    // every run of payoff words is a "hit": the score can put an accent exactly where the word lands
    for (const sp of sh.says) {
      sp._parsed = parseSay(sp.text);
      const first = new Map();
      for (const ln of sp._parsed.lines) for (const w of ln) if (w.run >= 0 && !first.has(w.run)) first.set(w.run, w);
      for (const w of first.values()) hits.push({ t: tm.time(sh.b0 + wordBeat(sp, w)), shot: def.id, kind: 'accent', word: w.w });
    }
    if (byId.has(def.id)) throw new Error(`duplicate shot id ${def.id}`);
    byId.set(def.id, sh); shots.push(sh);
  }
  // transition windows are centered on the cut, `beats` long
  shots.forEach((sh, k) => {
    const tr = sh.in && (typeof sh.in === 'string' ? { type: sh.in } : sh.in);
    if (!k || !tr || tr.type === 'cut') return;
    if (!TRANSITIONS[tr.type] && !(cfg.transitions || {})[tr.type]) throw new Error(`shot ${sh.id}: unknown transition ${tr.type}`);
    const half = Math.min((tr.beats ?? 1) / 2, shots[k - 1].beats / 2, sh.beats / 2);
    sh.tr = { ...tr, t0: tm.time(sh.b0 - half), t1: tm.time(sh.b0 + half) };
  });
  const DURATION = cfg.duration ?? shots[shots.length - 1].end + (cfg.tail || 0);
  const chapters = []; shots.forEach(s => { if (!chapters.length || chapters[chapters.length - 1].label !== s.chapter) chapters.push({ label: s.chapter, start: s.start, shot: s.id }); });

  // --- canvas
  const cv = cfg.canvas || document.querySelector('canvas') || document.body.appendChild(document.createElement('canvas'));
  cv.width = W; cv.height = H;
  document.documentElement.style.cssText += ';margin:0;background:#000;overflow:hidden';
  document.body.style.cssText += ';margin:0;background:#000;overflow:hidden';
  cv.style.cssText = RENDER ? `display:block;width:${W}px;height:${H}px` : `display:block;margin:auto;width:min(100vw,${(W / H * 100).toFixed(3)}vh);height:auto;position:absolute;inset:0;margin:auto`;
  const ctx = cv.getContext('2d');
  const bufA = canvas2d(W, H), bufB = canvas2d(W, H);

  function hudValue(key, sh, beat) {
    const sp = sh.hv[key];
    if (!sp) return sh.hvFinal[key];
    const p = sp.b1 > sp.b0 ? sp.ease(clamp((beat - sp.b0) / (sp.b1 - sp.b0))) : (beat >= sp.b0 ? 1 : 0);
    if (typeof sp.to !== 'number' || typeof sp.from !== 'number') return p >= 1 || sp.from === undefined ? sp.to : sp.from;
    return sp.log && sp.from > 0 && sp.to > 0 ? Math.exp(lerp(Math.log(sp.from), Math.log(sp.to), p)) : lerp(sp.from, sp.to, p);
  }

  const f = {
    W, H, FPS, DURATION, bpb, shots, chapters, themes, type, margin, hits, byId, portrait, u, band,
    t: 0, frame: 0, debug: params.has('debug'),
    // what was drawn this frame, for review tools (render/qa.mjs): { kind: 'say'|'caption'|'subtitle'|'hud'|'label'|..., x0, y0, x1, y1, text }
    boxes: [], box(kind, x0, y0, x1, y1, text = '') { f.boxes.push({ kind, x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1), text }); },
    time: b => tm.time(b), beat: t => tm.beat(t), bpm: b => tm.bpm(b),
    bar: n => tm.time(n * bpb),
    shot: id => { const s = byId.get(id); if (!s) throw new Error(`no shot ${id}`); return s; },
    // shot state at global time t (theme override for recaps)
    state(sh, t, T = sh.T) {
      const beat = tm.beat(t) - sh.b0, lt = t - sh.start, dur = sh.end - sh.start;
      return {
        id: sh.id, shot: sh, f, T, t: lt, g: t, dur, beat, beats: sh.beats, frame: f.frame,
        p: clamp(lt / dur),
        seg: (b0, b1) => clamp((beat - b0) / (b1 - b0)),            // progress between two local beats
        sec: (a, b) => clamp((lt - a) / (b - a)),                     // progress between two local seconds
        at: b => tm.time(sh.b0 + b) - sh.start,                       // local beat -> local seconds
        out: (n = 1) => clamp((beat - (sh.beats - n)) / n),          // 0..1 over the last n beats: for exits
        val: k => hudValue(k, sh, beat),
        rnd: seed => mulberry32(seed * 7919 + sh.i),
      };
    },
    value: (key, t = f.t) => { const sh = shots[indexAt(t)]; return hudValue(key, sh, tm.beat(t) - sh.b0); },
    zone(name) {
      const { x: mx, y: my, yb: mb } = margin;
      const Z = { tl: [mx, my, 'left', 'top'], tc: [W / 2, my, 'center', 'top'], tr: [W - mx, my, 'right', 'top'], l: [mx, H / 2, 'left', 'middle'], c: [W / 2, H / 2, 'center', 'middle'], r: [W - mx, H / 2, 'right', 'middle'], bl: [mx, H - mb, 'left', 'bottom'], bc: [W / 2, H - mb, 'center', 'bottom'], br: [W - mx, H - mb, 'right', 'bottom'] };
      return Z[name] || Z.tl;
    },
    say: (c, s, spec) => say(c, s, spec),
    count: (c, s, o) => count(c, s, o),
  };

  function indexAt(t) { let lo = 0, hi = shots.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (shots[m].start <= t) lo = m; else hi = m - 1; } return lo; }

  // --- backgrounds: theme.texture 'paper' | 'grid' | 'none', rendered once per theme
  const bgCache = new Map();
  function background(c, T) {
    const key = `${T.bg}|${T.texture}|${T.ink}`;
    let img = bgCache.get(key);
    if (!img) {
      const { c: cc, x } = canvas2d(W, H), r = mulberry32(5);
      x.fillStyle = T.bg; x.fillRect(0, 0, W, H);
      if (T.texture === 'paper') {
        for (let i = 0; i < 70; i++) { const px = r() * W, py = r() * H, rr = 80 + r() * 420, g = x.createRadialGradient(px, py, 0, px, py, rr), dark = r() < .55; g.addColorStop(0, alpha(dark ? T.ink : '#ffffff', .025 + r() * .03)); g.addColorStop(1, alpha(dark ? T.ink : '#ffffff', 0)); x.fillStyle = g; x.fillRect(px - rr, py - rr, rr * 2, rr * 2); }
        x.strokeStyle = alpha(T.ink, .045); x.lineWidth = 1;
        for (let i = 0; i < 900; i++) { const px = r() * W, py = r() * H, a = r() * TAU, l = 6 + r() * 26; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a + .6) * l * .5, py + Math.sin(a + .6) * l * .5, px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
      } else if (T.texture === 'stars') {
        for (let i = 0; i < 700; i++) { const a = r() ** 3; x.fillStyle = alpha(T.ink, .08 + a * .6); x.fillRect(r() * W, r() * H, a > .5 ? 2 : 1, a > .5 ? 2 : 1); }
      } else if (T.texture === 'grid') {
        const step = Math.round(W / 48); x.lineWidth = 1;
        for (let gx = 0; gx <= W; gx += step) { x.strokeStyle = alpha(T.ink, (gx / step) % 4 ? .028 : .06); x.beginPath(); x.moveTo(gx + .5, 0); x.lineTo(gx + .5, H); x.stroke(); }
        for (let gy = 0; gy <= H; gy += step) { x.strokeStyle = alpha(T.ink, (gy / step) % 4 ? .028 : .06); x.beginPath(); x.moveTo(0, gy + .5); x.lineTo(W, gy + .5); x.stroke(); }
      }
      bgCache.set(key, img = cc);
    }
    c.drawImage(img, 0, 0);
  }

  // --- grain and vignette: tiles and gradient built once
  let grainTiles = null, vignetteImg = null;
  function post(c, T) {
    const g = T.grain ?? .06, v = T.vignette ?? .35;
    if (v > 0) {
      if (!vignetteImg) { const { c: cc, x } = canvas2d(W, H), gr = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.hypot(W, H) * .6); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); x.fillStyle = gr; x.fillRect(0, 0, W, H); vignetteImg = cc; }
      c.globalAlpha = v; c.drawImage(vignetteImg, 0, 0); c.globalAlpha = 1;
    }
    if (g > 0) {
      if (!grainTiles) grainTiles = [0, 1, 2, 3].map(k => { const { c: cc, x } = canvas2d(256, 256), id = x.createImageData(256, 256), r = mulberry32(100 + k); for (let i = 0; i < id.data.length; i += 4) { const n = r() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = n; id.data[i + 3] = 255; } x.putImageData(id, 0, 0); return c.createPattern(cc, 'repeat'); });
      const k = f.frame % 4, pat = grainTiles[k];
      c.save(); c.globalCompositeOperation = 'overlay'; c.globalAlpha = g; c.translate((k * 97) % 256, (k * 57) % 256); c.fillStyle = pat; c.fillRect(-256, -256, W + 512, H + 512); c.restore();
    }
  }

  // --- statements
  const layouts = new WeakMap();
  function say(c, s, spec) {
    if (typeof spec === 'string') spec = { text: spec };
    const parsed = spec._parsed || (spec._parsed = parseSay(spec.text));
    const T = s.T, fam = spec.font || type.display, wt = spec.weight ?? 800;
    const big = spec.accentScale ?? 1.5, lead = spec.leading ?? 1.08;
    const [zx, zy, zAlign, zV] = Array.isArray(spec.at) ? [spec.at[0], spec.at[1], spec.align || 'left', spec.valign || 'top'] : f.zone(spec.at || 'tl');
    const align = spec.align || zAlign;
    const req = spec.size ?? baseSize;
    let L = layouts.get(spec);
    if (!L || L.req !== req || L.zx !== zx || L.align !== align) {
      // room between the zone's anchor and the safe margin on the side the text grows to
      const avail = spec.maxWidth ?? (align === 'center' ? 2 * Math.min(zx - margin.x, W - margin.x - zx) : align === 'right' ? zx - margin.x : W - margin.x - zx);
      const m = canvas2d(1, 1).x;
      const build = size => {
        const tracking = spec.tracking ?? size * .02; m.letterSpacing = `${tracking}px`;
        const rows = parsed.lines.map(ws => {
          const allAcc = ws.length && ws.every(w => w.acc), sz = allAcc ? size * big : size, fnt = font(sz, fam, wt);
          m.font = fnt; const sp = m.measureText(' ').width;
          let x = 0; const items = ws.map(w => { const wd = m.measureText(w.w).width, o = { ...w, x, wd }; x += wd + sp; return o; });
          return { items, width: Math.max(0, x - sp), size: sz, fnt };
        });
        let y = 0; rows.forEach(r => { y += r.size * (y ? lead : .8); r.base = y; });
        return { rows, height: y + size * .25, size, tracking, width: Math.max(0, ...rows.map(r => r.width)) };
      };
      L = build(req);
      // a line wider than the room shrinks the whole statement (one size per statement keeps its look); `fit: false` turns this off
      for (let k = 0; k < 3 && spec.fit !== false && avail > 0 && L.width > avail; k++) {
        const to = Math.max(12, Math.floor(L.size * avail / L.width * .995));
        if (!k) console.warn(`statement "${spec.text.replace(/\|/g, ' / ')}": widest line ${Math.round(L.width)} px > ${Math.round(avail)} px available, size ${L.size} -> ${to}`);
        L = build(to);
      }
      // the caption is one line: it shrinks (once, here) to the same room
      L.cs = spec.captionSize ?? Math.max(15, Math.round(L.size * .27));
      if (spec.caption && spec.fit !== false && avail > 0) {
        m.font = font(L.cs, type.mono, 500); m.letterSpacing = `${L.cs * .2}px`; const cw = m.measureText(String(spec.caption)).width;
        if (cw > avail) { const to = Math.max(10, Math.floor(L.cs * avail / cw * .99)); console.warn(`caption "${spec.caption}": ${Math.round(cw)} px > ${Math.round(avail)} px available, size ${L.cs} -> ${to}`); L.cs = to; }
      }
      L.req = req; L.zx = zx; L.align = align; L.avail = avail;
      layouts.set(spec, L);
    }
    const size = L.size, tracking = L.tracking;
    const oy = zV === 'top' ? zy : zV === 'bottom' ? zy - L.height - (spec.caption ? size * .9 : 0) : zy - L.height / 2;
    const plain = spec.color || T.ink, acc = spec.accentColor || T.accent, glowR = T.glow ? size * .35 : 0;
    const outT = spec.out !== undefined ? s.at(spec.out) : Infinity;
    let x0 = Infinity, x1 = -Infinity, last = 0, shown = false;
    for (const r of L.rows) {
      const rx = align === 'center' ? zx - r.width / 2 : align === 'right' ? zx - r.width : zx;
      x0 = Math.min(x0, rx); x1 = Math.max(x1, rx + r.width);
      for (const w of r.items) {
        const wb = wordBeat(spec, w); last = Math.max(last, wb);
        const tw = s.at(wb), dt = s.t - tw;
        if (dt < 0) continue;
        shown = true;
        const p = ease.outExpo(clamp(dt / .45)), q = clamp((s.t - outT - w.i * .03) / .3);
        const col = w.acc ? acc : plain, spr = textSprite(w.w, r.fnt, col, T.glow ? (w.acc ? acc : T.glow) : null, glowR, tracking);
        const scale = w.acc && spec.pop !== false ? lerp(1.35, 1, spring(dt, .5, 15)) : 1;
        drawSprite(c, spr, rx + w.x, oy + r.base + (1 - p) * r.size * .3 - ease.inCubic(q) * r.size * .4, scale, Math.min(1, p * 1.6) * (1 - q));
      }
    }
    if (spec.caption) {
      const cb = spec.captionAt ?? last + (spec.per ?? .5) * 2, ct = s.at(cb), p = clamp((s.t - ct) / .6), q = clamp((s.t - outT) / .3);
      if (p > 0) {
        const cs = L.cs, txt = String(spec.caption), shown_ = txt.slice(0, Math.ceil(txt.length * p));
        c.save(); c.font = font(cs, type.mono, 500); c.letterSpacing = `${cs * .2}px`; c.fillStyle = spec.captionColor || T.muted; c.globalAlpha = 1 - q;
        c.textAlign = align; c.textBaseline = 'top'; c.fillText(shown_, align === 'center' ? zx : align === 'right' ? zx : x0, oy + L.height + size * .35); c.restore();
        f.box('caption', x0, oy + L.height + size * .35, Math.min(x1 === -Infinity ? x0 : Math.max(x1, x0 + c.measureText(txt).width), W), oy + L.height + size * .35 + cs, txt);
      }
    }
    if (shown && x0 !== Infinity) f.box('say', x0, oy, x1, oy + L.height, spec.text);
    return { x0, y0: oy, x1, y1: oy + L.height };
  }

  // --- counters: digits in fixed cells so the number doesn't jitter while it counts
  const fmts = { int: v => Math.round(v).toLocaleString('en-US'), plain: v => String(Math.round(v)), 1: v => v.toFixed(1), 2: v => v.toFixed(2), 3: v => v.toFixed(3) };
  function count(c, s, o) {
    const [b0, b1] = o.b || [0, 2], p = (o.ease ? ease[o.ease] : ease.outExpo)(s.seg(b0, b1));
    const from = o.from ?? 0, to = o.to;
    const v = o.value !== undefined ? o.value : (o.log && from > 0 && to > 0 ? Math.exp(lerp(Math.log(from), Math.log(to), p)) : lerp(from, to, p));
    const fm = typeof o.format === 'function' ? o.format : fmts[o.format ?? 'int'];
    const str = (o.prefix || '') + fm(v) + (o.suffix || ''), size = o.size ?? bigSize, fnt = font(size, o.font || type.display, o.weight ?? 800);
    const col = o.color || s.T.ink, a = (o.alpha ?? 1) * (b0 > 0 ? s.seg(b0 - .25, b0) : 1);
    const cell = textSprite('0', fnt, col).w;
    const widths = [...str].map(ch => /\d/.test(ch) ? cell : textSprite(ch, fnt, col).w);
    const total = widths.reduce((x, y) => x + y, 0);
    let x = o.align === 'center' ? o.x - total / 2 : o.align === 'right' ? o.x - total : o.x;
    const glow = s.T.glow && o.glow !== false ? col : null;
    [...str].forEach((ch, i) => { const sp = textSprite(ch, fnt, col, glow, glow ? size * .3 : 0); drawSprite(c, sp, x + (widths[i] - sp.w) / 2, o.y, 1, a); x += widths[i]; });
    if (o.unit) { const us = o.unitSize ?? size * .2; c.save(); c.font = font(us, type.mono, 500); c.letterSpacing = `${us * .2}px`; c.fillStyle = o.unitColor || s.T.muted; c.globalAlpha = a; c.textAlign = o.align || 'left'; c.textBaseline = 'top'; c.fillText(o.unit, o.x, o.y + us * .9); c.restore(); }
    return v;
  }

  // --- one frame
  function renderShot(c, k, t, T) {
    const sh = shots[k], s = f.state(sh, t, T || sh.T);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    if (sh.bg !== false) background(c, s.T);
    if (sh.draw) sh.draw(c, s, f);
    for (const sp of sh.says) say(c, s, sp);
    c.restore();
  }
  function frame(t) {
    f.t = t; f.frame = Math.round(t * FPS); f.boxes.length = 0;
    const k = indexAt(t);
    let tr = null, kB = k;
    for (const kk of [k, k + 1]) { const sh = shots[kk]; if (sh && sh.tr && t >= sh.tr.t0 && t < sh.tr.t1) { tr = sh.tr; kB = kk; break; } }
    let T, hudA, sh = shots[k];
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (tr) {
      const p = (t - tr.t0) / (tr.t1 - tr.t0), A = shots[kB - 1], B = shots[kB];
      renderShot(bufA.x, kB - 1, t); renderShot(bufB.x, kB, t);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      (TRANSITIONS[tr.type] || cfg.transitions[tr.type])(ctx, bufA.c, bufB.c, p, tr, f);
      const e = ease.inOutCubic(p);
      T = mixTheme(A.T, B.T, e); hudA = lerp(A.hud === false ? 0 : 1, B.hud === false ? 0 : 1, e);
    } else { renderShot(ctx, k, t); T = sh.T; hudA = sh.hud === false ? 0 : 1; }
    if (cfg.hud && hudA > 0) {
      const cur = shots[k];
      ctx.save(); ctx.globalAlpha = hudA;
      cfg.hud(ctx, { T, alpha: hudA, t, shot: cur, s: f.state(cur, t, T), val: key => f.value(key, t), chapter: cur.chapter, progress: t / DURATION }, f);
      ctx.restore();
    }
    if (vc) drawVoice(ctx, t, T);
    ctx.save(); (cfg.post || post)(ctx, T, f); ctx.restore();
    if (f.debug) debugOverlay(t, k);
  }
  function debugOverlay(t, k) {
    const sh = shots[k], b = tm.beat(t), bar = Math.floor(b / bpb) + 1, bt = Math.floor(b % bpb) + 1;
    ctx.save(); ctx.strokeStyle = 'rgba(255,0,160,.6)'; ctx.setLineDash([8, 8]); ctx.strokeRect(margin.x, margin.y, W - margin.x * 2, H - margin.y - margin.yb); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, H - 34, W, 34); ctx.fillStyle = '#ff4fd8'; ctx.font = '600 18px monospace';
    ctx.fillText(`${sh.id}  ·  ${sh.chapter}  ·  bar ${bar}.${bt}  ·  ${t.toFixed(2)} s  ·  ${Math.round(tm.bpm(b))} bpm  ·  shot ${k + 1}/${shots.length}  ·  frame ${f.frame}`, 14, H - 11); ctx.restore();
  }

  // --- voice-over: subtitles from word timings (a group of words at a time, the spoken word highlighted), lookups, ducking
  const norm = w => String(w).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');
  const vWords = vc ? (vc.words || []).map(w => ({ ...w, start: w.start + vc.offset, end: w.end + vc.offset, n: norm(w.word) })) : [];
  let vGroups = [];
  if (vc && vWords.length) {
    const spans = [];
    if (vc.phrases) for (const ph of vc.phrases) for (const g of (ph.groups || [{ words: ph.words }])) spans.push([g.words[0], g.words[1]]);
    else { const n = typeof vc.group === 'number' ? vc.group : 3; for (let i = 0; i < vWords.length; i += n) spans.push([i, Math.min(vWords.length, i + n)]); }
    vGroups = spans.map(([a, b]) => ({ a, b, start: vWords[a].start, end: vWords[b - 1].end }));
  }
  // stretches of speech (a gap over 0.7 s ends one): the music ducks under them
  const vSpeech = []; vWords.forEach(w => { const l = vSpeech[vSpeech.length - 1]; if (l && w.start - l[1] < .7) l[1] = w.end; else vSpeech.push([w.start, w.end]); });
  if (vc) f.voice = {
    words: vWords, groups: vGroups, speech: vSpeech,
    // film time of the n-th (1-based) occurrence of a spoken word, matched ignoring case, punctuation and e/yo; `from` limits the search to words after that time
    time(word, n = 1, from = -1) {
      const k = norm(word); let c = 0;
      for (const w of vWords) if (w.n === k && w.start >= from && ++c === n) return w.start;
      throw new Error(`voice: the word "${word}" (occurrence ${n}) is not in the voice-over`);
    },
    has: word => vWords.some(w => w.n === norm(word)),
  };
  function drawVoice(c, t, T) {
    let lo = 0, hi = vGroups.length - 1, gi = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (vGroups[m].start - .06 <= t) { gi = m; lo = m + 1; } else hi = m - 1; }
    const g = vGroups[gi]; if (!g || t > g.end + .45) return;
    const words = vWords.slice(g.a, g.b), full = words.map(w => w.word + (w.punct || ''));
    const a = clamp((t - (g.start - .06)) / .14) * (1 - clamp((t - g.end - .2) / .25)), rise = (1 - ease.outCubic(clamp((t - (g.start - .06)) / .18))) * 14;
    const side = portrait ? Math.max(margin.x, Math.round(W * .11)) : margin.x, avail = W - side * 2 - vc.size * 1.1;   // portrait: clear of the button column on both sides, so the plate is centered
    let size = vc.size; c.save();
    const setFont = sz => { c.font = font(sz, vc.font || type.display, vc.weight ?? 700); c.letterSpacing = `${sz * .01}px`; };
    setFont(size); const spW = c.measureText(' ').width;
    let widths = full.map(x => c.measureText(x).width), total = widths.reduce((x, y) => x + y, 0) + spW * (full.length - 1);
    if (total > avail) { size = Math.floor(size * avail / total * .99); setFont(size); widths = full.map(x => c.measureText(x).width); total = widths.reduce((x, y) => x + y, 0) + c.measureText(' ').width * (full.length - 1); }
    const sp = c.measureText(' ').width, padX = size * .55, padY = size * .34, h = size * 1.2 + padY * 2;
    const zone = f.zone(vc.at), cx = Array.isArray(vc.at) ? vc.at[0] : zone[0], bottom = (Array.isArray(vc.at) ? vc.at[1] : zone[1]) - Math.round(size * .3) + rise;   // above the bottom margin, also while it rises into place
    const x0 = cx - total / 2, top = bottom - h;
    c.globalAlpha = a;
    if (vc.box) { c.fillStyle = alpha(T.bg, .88); c.beginPath(); c.roundRect(x0 - padX, top, total + padX * 2, h, size * .3); c.fill(); c.strokeStyle = alpha(T.ink, .16); c.lineWidth = 2; c.stroke(); }
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    let x = x0;
    words.forEach((w, i) => {
      const spoken = t >= w.start && t < w.end + .02, past = t >= w.end;
      c.fillStyle = vc.highlight && spoken ? T.accent : T.ink; c.globalAlpha = a * (past || spoken || !vc.highlight ? 1 : .55);
      c.fillText(full[i], x, top + padY + size * .95); x += widths[i] + sp;
    });
    c.restore();
    f.box('subtitle', x0 - padX, top, x0 + total + padX, top + h, full.join(' '));
  }
  // lower the music under speech by vc.duckDb (default 12 dB); `at` maps film time to the audio clock (-1: before the playback start)
  function duckBus(bus, ac, at, from = 0) {
    if (!vc || !vc.duck || !vSpeech.length) return;
    const base = cfg.gain ?? .9, low = base * 10 ** (-vc.duckDb / 20), g = bus.out.gain, now = ac.currentTime || 0;
    g.setValueAtTime(vSpeech.some(([a, b]) => a - .1 <= from && from < b + .15) ? low : base, now);
    for (const [a, b] of vSpeech) {
      const ta = at(Math.max(0, a - .12)), tb = at(b + .15);
      if (ta >= 0 && ta >= now) g.setTargetAtTime(low, ta, .05);
      if (tb >= 0 && tb >= now) g.setTargetAtTime(base, tb, .25);
    }
  }

  // --- audio: the score reads the same tempo map; at(t) maps film time to the audio context clock
  // bus.out: the music (ducked under the voice); bus.sfx: effects that must not duck (a stamp landing); bus.verb: reverb send
  function buildBus(ac) {
    const master = ac.createGain(), comp = ac.createDynamicsCompressor(), verb = audio.reverb(ac), wet = ac.createGain();
    master.gain.value = cfg.gain ?? .9; comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = .005; comp.release.value = .2;
    wet.gain.value = .35; verb.connect(wet).connect(master); master.connect(comp).connect(ac.destination);
    const sfx = ac.createGain(); sfx.gain.value = cfg.gain ?? .9; sfx.connect(comp);
    return { out: master, sfx, verb, dry: master };
  }
  if (cfg.score) {
    window.__renderAudio = async () => {
      const sr = 48000, oac = new OfflineAudioContext(2, Math.ceil(sr * DURATION), sr);
      const bus = buildBus(oac), at = tg => tg;
      duckBus(bus, oac, at, 0);
      cfg.score(oac, bus, f, at);
      return encodeWavBase64(await oac.startRendering());
    };
  }

  // --- render contract
  window.__meta = { W, H, FPS, DURATION };
  window.__draw = frame;
  window.__shots = shots.map(s => ({ id: s.id, chapter: s.chapter, start: +s.start.toFixed(4), end: +s.end.toFixed(4), beats: s.beats }));
  window.__film = f;
  // Google Fonts (and most hosts) split a family by unicode-range: load(font) with no text fetches only the Latin file, and Cyrillic, Greek
  // or accented text falls back silently. So load each font for the characters the film really draws: every statement and caption,
  // plus `cfg.fontText` for text drawn inside draw() functions.
  const sample = cfg.shots.flatMap(sh => [].concat(sh.say || []).map(sp => typeof sp === 'string' ? sp : `${sp.text} ${sp.caption || ''}`)).join(' ').replace(/[|*]/g, ' ') + ' ' + (cfg.fontText || '') + ' 0123456789';
  const fontLoads = (cfg.fonts || []).map(x => document.fonts.load(x, sample));
  Promise.all([...fontLoads, ...(cfg.assets || [])]).then(() => document.fonts.ready).then(() => {
    window.__ready = true;
    if (!RENDER) preview();
  }).catch(e => { console.error(e); window.__ready = true; });

  // --- live preview: Space play/pause, <- -> previous/next shot, Shift+arrows ±1 s, Home restart,
  // D debug overlay, L loop the current shot, click or S for sound. URL: ?shot=id, ?t=12.5, &loop, &debug
  function preview() {
    const startShot = params.get('shot');
    // film time = offset + (clock - c0) while playing; the clock is the audio context once sound is on,
    // so picture and sound can't drift apart. A suspended context stops its clock, pausing both.
    let offset = startShot ? f.shot(startShot).start : parseFloat(params.get('t') || '0');
    let loop = params.has('loop') ? indexAt(offset + 1e-3) : -1;
    let playing = true, ac = null;
    const clock = () => ac ? ac.currentTime : performance.now() / 1000;
    let c0 = clock();
    const now = () => playing ? Math.max(0, offset + clock() - c0) : offset;
    // the voice-over in the live preview (the render mixes the file with ffmpeg: `render.mjs --voice`); vc.src is a URL or a data: URI
    let voiceBuf = null;
    async function playVoice(ac0, from, acStart) {
      if (!vc || !vc.src) return;
      try {
        voiceBuf ||= await fetch(vc.src).then(r => r.arrayBuffer()).then(b => ac0.decodeAudioData(b));
        if (ac !== ac0) return;                                         // superseded by a seek while decoding
        const src = ac0.createBufferSource(); src.buffer = voiceBuf; src.connect(ac0.destination);
        const lateBy = Math.max(0, ac0.currentTime - acStart), skip = Math.max(0, from - vc.offset) + lateBy;
        src.start(Math.max(ac0.currentTime, acStart + Math.max(0, vc.offset - from)), skip);
      } catch (e) { console.warn('voice-over not played:', e.message); }
    }
    function startAudio() {
      if (!cfg.score && !(vc && vc.src)) return;
      if (ac) ac.close();
      ac = new AudioContext();
      const from = offset, acStart = ac.currentTime + .08, bus = buildBus(ac), at = tg => tg < from - .01 ? -1 : acStart + (tg - from);
      duckBus(bus, ac, at, from);
      if (cfg.score) cfg.score(ac, bus, f, at);
      playVoice(ac, from, acStart);
      c0 = acStart;
      if (!playing) ac.suspend();
    }
    const seek = t => { offset = clamp(t, 0, DURATION - 1e-3); c0 = clock(); if (ac) startAudio(); };
    function toggle() {
      if (playing) { offset = now(); playing = false; if (ac) ac.suspend(); }
      else { playing = true; if (ac) ac.resume().then(() => { c0 = clock(); }); c0 = clock(); }
    }
    addEventListener('keydown', e => {
      const t = now(), cur = indexAt(t);
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (e.code === 'ArrowRight') seek(e.shiftKey ? t + 1 : shots[Math.min(shots.length - 1, cur + 1)].start);
      else if (e.code === 'ArrowLeft') seek(e.shiftKey ? t - 1 : (t - shots[cur].start > .4 ? shots[cur].start : shots[Math.max(0, cur - 1)].start));
      else if (e.code === 'Home') seek(0);
      else if (e.code === 'KeyD') f.debug = !f.debug;
      else if (e.code === 'KeyL') loop = loop >= 0 ? -1 : cur;
      else if (e.code === 'KeyS') { offset = t; startAudio(); }
    });
    addEventListener('click', () => { if (!ac) { offset = now(); startAudio(); } hide(); });
    // a hint for the first seconds; it never exists in render mode
    let hint = null;
    if (!params.has('nohint')) {
      hint = document.createElement('div');
      hint.textContent = cfg.score || (vc && vc.src) ? 'click for sound · space pauses · ← → shots' : 'space pauses · ← → shots';
      hint.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);font:500 13px/1 "IBM Plex Mono",monospace;letter-spacing:.14em;text-transform:uppercase;color:#fff;background:rgba(0,0,0,.55);padding:9px 14px;border-radius:4px;pointer-events:none;transition:opacity .6s;z-index:9';
      document.body.appendChild(hint);
      setTimeout(hide, 7000);
    }
    function hide() { if (hint) { hint.style.opacity = '0'; hint = null; } }
    function tick() {
      let t = now();
      if (loop >= 0 && t >= shots[loop].end) { seek(shots[loop].start); t = offset; }
      if (t >= DURATION) { seek(0); t = 0; }
      frame(t);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  return f;
}

// ---------------------------------------------------------------- recap
// A shot that replays earlier shots, one every `per` beats, frozen at `pose` (0..1) of their length,
// optionally in another theme. Works because every draw() takes its colors from s.T.
function recap(ids, { per = .5, theme = null, pose = .92, label = null, punch = .05 } = {}) {
  return (ctx, s, f) => {
    const idx = Math.floor(s.beat / per);
    if (idx < 0 || idx >= ids.length) return;
    const src = f.shot(ids[idx]), T = theme ? f.themes[theme] : s.T;
    const st = f.state(src, src.start + (src.end - src.start) * pose, T);
    const q = ease.outCubic(clamp((s.beat - idx * per) / per)), k = 1 + punch * (1 - q);
    ctx.save(); ctx.translate(f.W / 2, f.H / 2); ctx.scale(k, k); ctx.translate(-f.W / 2, -f.H / 2);
    src.draw && src.draw(ctx, st, f);
    ctx.restore();
    if (label) {
      const txt = label(src, f), size = Math.round(Math.min(f.W, f.H) * .1), spr = textSprite(txt, font(size, f.type.mono, 600), T.ink, T.glow ? T.ink : null, T.glow ? size * .3 : 0);
      drawSprite(ctx, spr, f.W / 2 - spr.w / 2, f.portrait ? f.H - f.margin.yb - size * 1.3 : f.H * .82);
    }
  };
}

// ---------------------------------------------------------------- standard HUD
// Corner brackets, chapter top left, title top right, two readouts at the bottom, a progress rail with chapter ticks.
// opts: { title, sub: h => string, left: {label, value: h => string}, right: {label, value: h => string, meter: h => 0..1}, rail: true }
function hudFrame(opts = {}) {
  return (ctx, h, f) => {
    const { W, H, u } = f, T = h.T, mx = f.margin.x * .55, my = f.margin.y * .5, myb = f.margin.yb * .5, col = T.hud || T.muted, mono = f.type.mono;
    ctx.strokeStyle = alpha(col, .7); ctx.fillStyle = col; ctx.lineWidth = 1.5 * u;
    const br = 22 * u;
    for (const [x, y, dx, dy] of [[mx, my, 1, 1], [W - mx, my, -1, 1], [mx, H - myb, 1, -1], [W - mx, H - myb, -1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y + dy * br); ctx.lineTo(x, y); ctx.lineTo(x + dx * br, y); ctx.stroke(); }
    const txt = (s, x, y, size, align = 'left', a = 1, wt = 500) => { ctx.font = font(size * u, mono, wt); ctx.letterSpacing = `${size * u * .22}px`; ctx.textAlign = align; ctx.globalAlpha = h.alpha * a; ctx.fillText(s, x, y); ctx.globalAlpha = h.alpha; };
    ctx.textBaseline = 'middle';
    const x0 = mx + 28 * u, x1 = W - mx - 28 * u;
    if (h.chapter) txt(String(h.chapter).toUpperCase(), x0, my + 18 * u, 15);
    if (opts.title) txt(opts.title.toUpperCase(), x1, my + 18 * u, 15, 'right');
    if (opts.sub) txt(opts.sub(h, f), x1, my + 42 * u, 12, 'right', .6);
    const yb = H - myb - 20 * u;
    if (opts.left) { txt(opts.left.label.toUpperCase(), x0, yb - 30 * u, 11, 'left', .55); txt(opts.left.value(h, f), x0, yb, 22, 'left', 1, 600); }
    if (opts.right) {
      txt(opts.right.label.toUpperCase(), x1, yb - 30 * u, 11, 'right', .55); txt(opts.right.value(h, f), x1, yb, 22, 'right', 1, 600);
      if (opts.right.meter) { const m = clamp(opts.right.meter(h, f)), w = 170 * u, y = yb + 22 * u; ctx.globalAlpha = h.alpha * .35; ctx.fillRect(x1 - w, y, w, 1.5 * u); ctx.globalAlpha = h.alpha; ctx.fillStyle = T.accent; ctx.fillRect(x1 - w, y - 1 * u, w * m, 3.5 * u); ctx.fillStyle = col; }
    }
    if (opts.rail !== false) {
      const w = W * (f.portrait ? .56 : .3), rx = W / 2 - w / 2, ry = yb + 10 * u;
      ctx.globalAlpha = h.alpha * .35; ctx.fillRect(rx, ry, w, 1.5 * u);
      for (const c of f.chapters) { const x = rx + w * c.start / f.DURATION; ctx.fillRect(x, ry - 5 * u, 1.5 * u, 11 * u); }
      ctx.globalAlpha = h.alpha; ctx.fillStyle = T.accent; ctx.fillRect(rx, ry - 1 * u, w * h.progress, 3.5 * u);
      ctx.beginPath(); ctx.moveTo(rx + w * h.progress, ry - 6 * u); ctx.lineTo(rx + w * h.progress - 5 * u, ry - 14 * u); ctx.lineTo(rx + w * h.progress + 5 * u, ry - 14 * u); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.letterSpacing = '0px';
  };
}

global.Film = {
  create, recap, hudFrame, tempoMap, parseSay,
  say: (ctx, s, spec) => s.f.say(ctx, s, spec),        // statement and counter for use inside draw()
  count: (ctx, s, o) => s.f.count(ctx, s, o),
  ink, cam3, globe, ecef, orbitPoint, geo, fx, audio, TRANSITIONS,
  textSprite, drawSprite, font,
  util: { TAU, clamp, lerp, seg, smooth, ease, spring, mulberry32, noise1, hash1, mix, alpha, mixTheme },
};
})(window);
