import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const Pixel = req('../pixel.js');
const fx = req('../pixel-fx.js');

const PALS = ['pico8', 'sweetie16', Pixel.palette(['#0b0b16', '#3a2a5e', '#c0407a', '#ff9a5a', '#ffe9b0'])];
const palName = p => typeof p === 'string' ? p : 'custom5';
const TIMES = [.3, 2.2, 5.7, 11.1];
const distinct = px => new Set(px).size;
const mk = (pal, w = 96, h = 54) => Pixel.screen({ w, h, palette: pal });

// The forbidden global: no effect may touch Math.random.
const noRandom = fn => { const r = Math.random; Math.random = () => { throw new Error('Math.random called'); }; try { return fn(); } finally { Math.random = r; } };

test('exports: Pixel.fx and module.exports agree', () => {
  assert.equal(Pixel.fx, fx);
  for (const n of [...fx.names, ...fx.postNames, 'ramp']) assert.equal(typeof fx[n], 'function', n);
  assert.ok(fx.names.length >= 10);
});

test('ramps: recipes and curated lists are valid on every built-in palette', () => {
  for (const pn of Pixel.palette.names) {
    const pal = Pixel.palette(pn);
    for (const name of ['auto', 'lum', ...Object.keys(fx.recipes)]) {
      const r = fx.ramp(pal, name);
      assert.ok(r instanceof Uint8Array && r.length >= 1, `${pn}/${name}`);
      for (const i of r) assert.ok(i < pal.size, `${pn}/${name} index ${i}`);
      for (let k = 1; k < r.length; k++) assert.notEqual(r[k], r[k - 1], `${pn}/${name} has a repeated step`);
    }
  }
  for (const [pn, set] of Object.entries(fx.curated)) for (const [name, list] of Object.entries(set)) for (const i of list) assert.ok(i < Pixel.palette(pn).size, `${pn}/${name}`);
  const lum = fx.ramp('pico8', 'lum'); assert.equal(lum.length, 16); assert.equal(lum[0], 0); assert.equal(lum[15], 7);          // black ... white
  assert.deepEqual([...fx.ramp('pico8', [0, 5, 7])], [0, 5, 7]);
  assert.deepEqual([...fx.ramp('pico8', ['#000000', '#ffffff'])], [0, 7]);
  assert.ok(fx.ramp(mk('pico8'), 'fire').length >= 5);                                                                        // a screen works as well as a palette
  assert.throws(() => fx.ramp('pico8', 'nope'), /unknown ramp/);
  assert.throws(() => fx.ramp('pico8', [0, 99]), /outside/);
  assert.throws(() => fx.plasma(mk('pico8'), 0, { dither: 'bayer3' }), /dither/);
});

for (const pal of PALS) {
  const PN = palName(pal), size = Pixel.palette(pal).size;
  for (const name of fx.names) {
    test(`${name} on ${PN}: deterministic, order-independent, valid indices, not uniform, moves`, () => {
      noRandom(() => {
        const pics = TIMES.map(t => { const s = mk(pal); fx[name](s, t); return s.px.slice(); });
        // (a) same t on a fresh screen gives the same picture, and calling other times in between changes nothing
        const s = mk(pal); for (const t of [7.7, 1.1, TIMES[2]]) fx[name](s, t);
        fx[name](s, TIMES[1]); assert.deepEqual(s.px, pics[1], 'fresh screen vs a screen that drew other times first');
        const again = mk(pal); fx[name](again, TIMES[3]); assert.deepEqual(again.px, pics[3]);
        pics.forEach((px, k) => {
          for (const v of px) assert.ok(v < size, `index ${v} outside the ${size}-color palette at t=${TIMES[k]}`);   // (b)
          assert.ok(distinct(px) >= Math.min(4, size - 2), `${name} t=${TIMES[k]}: only ${distinct(px)} distinct values`);                 // (c)
        });
        for (let a = 0; a < pics.length; a++) for (let b = a + 1; b < pics.length; b++) assert.notDeepEqual(pics[a], pics[b], `t=${TIMES[a]} and t=${TIMES[b]} look the same`);   // (d)
      });
    });
  }
}

test('an explicit ramp is the only set of colors used', () => {
  const R = [0, 8, 9, 10];
  for (const name of fx.names) {
    const s = mk('pico8'); fx[name](s, 3.3, { ramp: R, sky: R, ramps: [R], bg: undefined });
    for (const v of s.px) assert.ok(R.includes(v), `${name} drew index ${v} outside the ramp ${R}`);
  }
});

test('x, y, w, h: only the rectangle is written (and all of it, unless bg is false)', () => {
  const rect = { x: 10, y: 7, w: 20, h: 12 };
  const effects = [...fx.names.map(n => [n, s => fx[n](s, 4.4, rect)]), ['sinescroll', s => fx.sinescroll(s, 4.4, 'HELLO WORLD', { ...rect, speed: 5 })]];
  for (const [name, run] of effects) {
    const s = mk('pico8'); s.px.fill(200); run(s);
    let inside = 0;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const inRect = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h, v = s.px[y * s.w + x];
      if (!inRect) assert.equal(v, 200, `${name} wrote outside the rectangle at ${x},${y}`); else if (v !== 200) inside++;
    }
    assert.ok(inside > 0, `${name} wrote nothing inside the rectangle`);
    if (name !== 'sinescroll') assert.equal(inside, rect.w * rect.h, `${name} did not fill the whole rectangle`);
  }
  const s = mk('pico8'); s.px.fill(200); fx.wobble(s, 1, { x: 100, y: 0, w: 5, h: 5 }); assert.ok(s.px.every(v => v === 200));   // off-screen rectangle: no-op, no throw
});

test('starfield and twister with bg: false draw over what is there', () => {
  for (const name of ['starfield', 'twister']) {
    const s = mk('pico8'); s.px.fill(13); fx[name](s, 4, { bg: false });
    assert.ok(s.px.some(v => v === 13) && s.px.some(v => v !== 13), name);
  }
});

test('starfield is a formula: count, seed and t define it, and trails only add pixels', () => {
  const a = mk('pico8'), b = mk('pico8'), c = mk('pico8');
  fx.starfield(a, 3, { seed: 1 }); fx.starfield(b, 3, { seed: 2 }); fx.starfield(c, 3, { seed: 1, count: 20 });
  assert.notDeepEqual(a.px, b.px); assert.notDeepEqual(a.px, c.px);
  const lit = s => s.px.filter(v => v !== 0).length, t0 = mk('pico8'), t3 = mk('pico8');
  fx.starfield(t0, 3, { trail: 0 }); fx.starfield(t3, 3, { trail: 3 }); assert.ok(lit(t3) > lit(t0));
});

test('rotozoom with a sprite texture draws the sprite own colors', () => {
  const tex = Pixel.sprite(['1234', '5678', '9abc', 'def1']);
  const s = mk('pico8'); fx.rotozoom(s, 2.5, { tex });
  const got = new Set(s.px); for (const v of got) assert.ok(v >= 1 && v <= 15, `index ${v}`);
  assert.ok(got.size >= 10, `only ${got.size} sprite colors seen`);
});

test('dither modes: none uses hard steps, bayer modes mix neighbors', () => {
  const R = [1, 2, 3, 4];
  const pics = ['none', 'bayer4', 'bayer8'].map(d => { const s = mk('pico8', 64, 36); fx.plasma(s, 2, { ramp: R, dither: d, cyclic: false }); return s.px; });
  assert.notDeepEqual(pics[0], pics[1]); assert.notDeepEqual(pics[1], pics[2]);
  // a smooth gradient through the quantizer: bayer4 flips between two neighbors inside a 4x4 cell, none never does
  const q = fx.quant(new Uint8Array([10, 20]), 'bayer4', false), qn = fx.quant(new Uint8Array([10, 20]), 'none', false);
  const seen = new Set(); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(q(.5, x, y));
  assert.deepEqual([...seen].sort(), [10, 20]);
  assert.equal(new Set([qn(.4, 0, 0), qn(.4, 1, 1), qn(.4, 2, 3)]).size, 1);
  assert.equal(q(0, 3, 3), 10); assert.equal(q(1, 0, 0), 20); assert.equal(q(-5, 0, 0), 10); assert.equal(q(9, 1, 2), 20);
});

test('scale changes the picture and works on other sizes (160x90, 320x180, odd size)', () => {
  for (const [w, h] of [[160, 90], [320, 180], [101, 57]]) for (const name of fx.names) {
    const a = mk('pico8', w, h), b = mk('pico8', w, h); fx[name](a, 3, {}); fx[name](b, 3, { scale: 1.7 });
    assert.ok(distinct(a.px) >= 4, `${name} ${w}x${h}`); assert.notDeepEqual(a.px, b.px, `${name} scale ${w}x${h}`);
  }
});

test('wobble: shifts whole rows from a copy, keeps each row a rotation of the source, never accumulates', () => {
  const base = mk('pico8', 64, 40); fx.plasma(base, 1); const src = base.px.slice();
  const a = mk('pico8', 64, 40); a.px.set(src); fx.wobble(a, 2.2, { amp: 6, freq: 4 });
  assert.notDeepEqual(a.px, src);
  for (let y = 0; y < 40; y++) {                                                                       // every row is a cyclic shift of the original row
    const row = [...src.subarray(y * 64, y * 64 + 64)], out = [...a.px.subarray(y * 64, y * 64 + 64)];
    assert.ok(Array.from({ length: 64 }, (_, k) => k).some(k => row.every((v, i) => v === out[(i + k) % 64])), `row ${y} is not a rotation`);
  }
  const b = mk('pico8', 64, 40); b.px.set(src); fx.wobble(b, 2.2, { amp: 6, freq: 4 }); assert.deepEqual(a.px, b.px);          // pure
  const c = mk('pico8', 64, 40); c.px.set(src); fx.wobble(c, 3.4, { amp: 6, freq: 4 }); assert.notDeepEqual(a.px, c.px);       // moves with t
  const d = mk('pico8', 64, 40); d.px.set(src); fx.wobble(d, 2.2, { amp: 0 }); assert.deepEqual(d.px, src);                    // amp 0 is a no-op
  const e = mk('pico8', 64, 40); e.px.set(src); fx.wobble(e, 2.2, { amp: 6, freq: 4, edge: 'clamp' });
  assert.ok(new Set(e.px).size <= new Set(src).size);                                                                            // clamp adds no colors
  const g = mk('pico8', 64, 40); g.px.set(src); fx.wobble(g, 2.2, { amp: 8, grow: 'down' });
  assert.deepEqual(g.px.subarray(0, 64), src.subarray(0, 64));                                                          // amplitude grows from zero at the top
  assert.ok(new Set(g.px).size <= 16);
});

test('sinescroll: text moves at speed px/s, rides a sine, stays in bounds, is pure', () => {
  const draw = (t, o = {}) => { const s = mk('pico8', 96, 54); s.px.fill(1); fx.sinescroll(s, t, 'motion kit', { ...o }); return s; };
  const a = draw(2), b = draw(2), c = draw(2.5);
  assert.deepEqual(a.px, b.px); assert.notDeepEqual(a.px, c.px);
  assert.ok(distinct(a.px) >= 3);
  const bounds = s => { let x0 = 99, x1 = -1, y0 = 99, y1 = -1; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.px[y * s.w + x] !== 1) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x0, x1, y0, y1 }; };
  const flat = draw(3, { amp: 0, outline: false, color: 7, scale: 2 }), bf = bounds(flat);
  assert.equal(bf.y1 - bf.y0 + 1, 10);                                                                                          // 5 rows at scale 2, no wave, no outline
  const wavy = draw(3, { amp: 8, outline: false, color: 7, scale: 2, mode: 'column' }), bw = bounds(wavy);
  assert.ok(bw.y1 - bw.y0 > 10 + 6, 'the wave adds height');
  const s0 = draw(1, { amp: 0, outline: false, color: 7, speed: 30, loop: false }), s1 = draw(2, { amp: 0, outline: false, color: 7, speed: 30, loop: false });
  assert.equal(bounds(s0).x0 - bounds(s1).x0, 30, 'moved by exactly speed px in one second');
  const letter = draw(3, { amp: 8, outline: false, color: 7, mode: 'letter' }); assert.notDeepEqual(letter.px, wavy.px);
  // `line` moves the wave's center line; x y w h stay purely the region (y used to collide with it)
  const mid = draw(3, { amp: 0, outline: false, color: 7, scale: 2 }), low = draw(3, { amp: 0, outline: false, color: 7, scale: 2, line: 42 });
  assert.equal(bounds(mid).y0, 27 - 5), assert.equal(bounds(low).y0, 42 - 5);                                                   // centered on 27 (h / 2) and on 42
  assert.equal(bounds(mid).x0, bounds(low).x0);
  const reg = mk('pico8', 96, 54); reg.px.fill(1); fx.sinescroll(reg, 3, 'MOTION KIT', { amp: 0, outline: false, color: 7, scale: 2, y: 20, h: 20 });
  assert.ok(bounds(reg).y0 >= 20 && bounds(reg).y1 < 40 && bounds(reg).y0 === 20 + 10 - 5, 'y is the region top, the text is centered inside it');
  const none = mk('pico8'); none.px.fill(1); fx.sinescroll(none, 1, '', {}); assert.ok(none.px.every(v => v === 1));            // empty text draws nothing
  assert.ok(draw(1, { outline: 0, color: 7 }).px.some(v => v === 0));                                                           // outline color used
});

test('timing: every effect at 320x180 (printed, generous ceiling)', () => {
  const rows = [];
  for (const [name, run] of [...fx.names.map(n => [n, (s, t) => fx[n](s, t)]), ['wobble', (s, t) => fx.wobble(s, t, { amp: 4 })], ['sinescroll', (s, t) => fx.sinescroll(s, t, 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG', {})]]) {
    const s = mk('pico8', 320, 180); for (let k = 0; k < 8; k++) run(s, k * .37);                     // warm up (also bakes the noise textures and polar grids)
    const t0 = process.hrtime.bigint(), N = 60; for (let k = 0; k < N; k++) run(s, 10 + k * .11);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N; rows.push(`${name} ${ms.toFixed(2)} ms`);
    assert.ok(ms < 12, `${name} takes ${ms.toFixed(1)} ms per frame at 320x180`);
  }
  console.log('# timing at 320x180: ' + rows.join(', '));
});
