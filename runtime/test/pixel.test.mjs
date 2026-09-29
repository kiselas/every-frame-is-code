import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const Pixel = createRequire(import.meta.url)('../pixel.js');

test('palettes: names, size, nearest', () => {
  const p = Pixel.palette('pyxel');
  assert.equal(p.size, 16); assert.equal(p.hex[1], '#2b335f'); assert.equal(p.i.red, 8);
  assert.equal(p.nearest(0, 0, 0), 0); assert.equal(p.nearest(250, 250, 250), 7);
  assert.throws(() => Pixel.palette('nope'), /unknown palette/);
  assert.equal(Pixel.palette.ramp('#000000', '#ffffff', 5).size, 5);
  assert.equal(Pixel.palette.mix('gameboy', 'gameboy', .5).hex[0], '#0f380f');
});

test('bayer matrices are permutations', () => {
  for (const n of [2, 4, 8, 16]) { const b = Pixel.bayer(n); assert.deepEqual([...b].sort((x, y) => x - y), Array.from({ length: n * n }, (_, k) => k)); }
  assert.deepEqual(Pixel.bayer(4).slice(0, 4), [0, 8, 2, 10]);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const t = Pixel.bayer8(x, y); assert.ok(t > 0 && t < 1); }
});

test('sprite from text: indices, transparency, dedent, legend', () => {
  const s = Pixel.sprite(`
    .a.
    b.f
  `);
  assert.equal(s.w, 3); assert.equal(s.h, 2);
  assert.deepEqual([...s.data], [255, 10, 255, 11, 255, 15]);
  assert.equal(Pixel.sprite(['#.'], { '#': 3 }).data[0], 3);
  assert.throws(() => Pixel.sprite(['?']), /not a palette index/);
  const fr = Pixel.frames(['0123', '4567'], 2); assert.equal(fr.length, 2); assert.deepEqual([...fr[1].data], [2, 3, 6, 7]);
  const m = Pixel.mirror(Pixel.sprite(['012'])); assert.deepEqual([...m.data], [2, 1, 0]);
  const o = Pixel.outline(Pixel.sprite(['1']), 9); assert.equal(o.w, 3); assert.equal(o.data[4], 1); assert.equal(o.data[1], 9); assert.equal(o.data[0], 255);
});

test('primitives, clip, camera, pal, dither', () => {
  const s = Pixel.screen({ w: 16, h: 16, palette: 'pico8' });
  s.cls(0).rect(2, 2, 4, 3, 7);
  assert.equal(s.pget(2, 2), 7); assert.equal(s.pget(5, 4), 7); assert.equal(s.pget(6, 4), 0); assert.equal(s.pget(5, 5), 0);
  s.cls(0).clip(0, 0, 8, 8).rect(4, 4, 10, 10, 3).clip();
  assert.equal(s.pget(7, 7), 3); assert.equal(s.pget(8, 8), 0);
  s.cls(0).camera(2, 2).pset(5, 5, 9).camera();
  assert.equal(s.pget(3, 3), 9);
  s.cls(0).pal(7, 8).pset(1, 1, 7).pal().pset(2, 1, 7);
  assert.equal(s.pget(1, 1), 8); assert.equal(s.pget(2, 1), 7);
  s.cls(0).dither(.5).rect(0, 0, 8, 8, 7).dither();
  let on = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) on += s.pget(x, y) === 7 ? 1 : 0;
  assert.equal(on, 32);                                          // alpha .5 = exactly half of an 8x8 block
  s.cls(0).circ(8, 8, 3, 5); assert.equal(s.pget(8, 8), 5); assert.equal(s.pget(8, 11), 5); assert.equal(s.pget(11, 11), 0);
  s.cls(0).line(0, 0, 15, 15, 2); assert.equal(s.pget(7, 7), 2);
  s.cls(0).tri(1, 1, 10, 1, 1, 10, 4); assert.equal(s.pget(2, 2), 4); assert.equal(s.pget(9, 9), 0);
  s.cls(0).rectb(1, 1, 5, 5, 6).fill(3, 3, 11); assert.equal(s.pget(3, 3), 11); assert.equal(s.pget(1, 1), 6); assert.equal(s.pget(8, 8), 0);
});

test('text and blt', () => {
  const s = Pixel.screen({ w: 32, h: 16 });
  s.text(1, 1, 'A', 7); assert.equal(s.pget(2, 1), 7); assert.equal(s.pget(1, 1), 0);
  assert.equal(Pixel.textWidth('AB'), 7);
  const spr = Pixel.sprite(['12', '34']);
  s.cls(0).blt(spr, 4, 4); assert.equal(s.pget(4, 4), 1); assert.equal(s.pget(5, 5), 4);
  s.cls(0).blt(spr, 4, 4, { flipX: true }); assert.equal(s.pget(4, 4), 2);
  s.cls(0).blt(spr, 4, 4, { scale: 2 }); assert.equal(s.pget(7, 7), 4); assert.equal(s.pget(4, 4), 1);
  s.cls(0).blt(Pixel.sprite(['1.']), 0, 0); assert.equal(s.pget(1, 0), 0);
});

test('blt3d draws a floor below the horizon, sky above', () => {
  const s = Pixel.screen({ w: 32, h: 24 });
  s.cls(0).blt3d(0, 0, 32, 24, (x, y) => (Math.floor(x / 8) + Math.floor(y / 8)) & 1 ? 5 : 6, { pos: [0, 0, 10], rot: [10, 0, 0], sky: 1 });
  assert.equal(s.pget(16, 0), 1);                                // sky
  assert.ok([5, 6].includes(s.pget(16, 23)));                    // ground
  const rows = new Set(); for (let y = 0; y < 24; y++) rows.add(s.pget(16, y)); assert.ok(rows.has(5) && rows.has(6));
});

test('palette maps', () => {
  const m = Pixel.fadeMap('pico8', 1, 0); assert.equal(m[7], 0);
  const half = Pixel.fadeMap('pico8', .5, 0); assert.ok(half[7] !== 7 && half[7] !== 0);
  assert.equal(Pixel.fadeMap('pico8', 0, 0)[7], 7);
  assert.equal(Pixel.cycleMap([1, 2, 3], 1)[1], 2); assert.equal(Pixel.cycleMap([1, 2, 3], 1)[3], 1); assert.equal(Pixel.cycleMap([1, 2, 3], -1)[1], 3);
  assert.equal(Pixel.flashMap('pico8', 7)[3], 7);
});

test('noise is deterministic and bounded', () => {
  let lo = 9, hi = -9; for (let k = 0; k < 2000; k++) { const v = Pixel.noise(k * .173, k * .071, k * .011); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo >= -1.2 && hi <= 1.2 && hi - lo > 1);
  assert.equal(Pixel.noise(1.5, 2.5, 3.5), Pixel.noise(1.5, 2.5, 3.5));
  const [dx, dy] = Pixel.shake(1.23, 0); assert.equal(dx, 0); assert.equal(dy, 0);
  assert.ok(Number.isInteger(Pixel.shake(1.23, 1)[0]));
});

test('project() agrees with blt3d', () => {
  const cam = { pos: [3, -5, 20], rot: [25, 15, 4], fov: 70 };
  const s = Pixel.screen({ w: 160, h: 90 });
  const hit = (x, y) => Math.floor(x) === 10 && Math.floor(y) === 20;
  s.cls(0).blt3d(0, 0, 160, 90, (x, y) => hit(x, y) ? 9 : 5, { ...cam, sky: 1 });
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) if (s.pget(x, y) === 9) { sx += x + .5; sy += y + .5; n++; }
  assert.ok(n > 4, 'the marked texel is visible');
  const p = Pixel.project(10.5, 20.5, 0, { ...cam, rect: [0, 0, 160, 90] });
  assert.ok(Math.abs(p.x - sx / n) < 1.2 && Math.abs(p.y - sy / n) < 1.2, `${p.x},${p.y} vs ${sx / n},${sy / n}`);
  assert.equal(Pixel.project(0, -100, 0, { ...cam, rect: [0, 0, 160, 90] }), null);     // behind the camera
  const near = Pixel.project(3, 5, 0, { ...cam, rect: [0, 0, 160, 90] }), far = Pixel.project(3, 60, 0, { ...cam, rect: [0, 0, 160, 90] });
  assert.ok(near.scale > far.scale && near.y > far.y);
});

test('text outline draws around the glyph', () => {
  const s = Pixel.screen({ w: 16, h: 12, palette: 'pico8' });
  s.text(4, 4, 'I', 7, { outline: 1 });
  assert.equal(s.pget(4, 4), 7); assert.equal(s.pget(3, 4), 1); assert.equal(s.pget(4, 3), 1); assert.equal(s.pget(9, 9), 0);
});

test('post() rejects palettes over 32 colors', () => {
  const big = Pixel.palette(Array.from({ length: 40 }, (_, k) => '#' + k.toString(16).padStart(2, '0').repeat(3)));
  assert.throws(() => Pixel.post({ palette: big }), /at most 32/);
});
