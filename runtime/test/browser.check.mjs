// Checks the parts of the runtime that need a browser: the WebGL post pass, flip, the dithered transitions and the offline chiptune render.
// Usage: node runtime/test/browser.check.mjs        (needs Chrome and `npm install` in render/; CHROME_PATH if Chrome is not in the default place)
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const { chromium } = await import(pathToFileURL(path.join(root, 'render/node_modules/playwright-core/index.mjs')).href);
const launch = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const browser = await chromium.launch({ ...launch, args: ['--force-color-profile=srgb'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.setContent('<canvas id=c width=640 height=360></canvas>');
for (const f of ['film.js', 'pixel.js', 'pixel-fx.js', 'chip.js']) await page.addScriptTag({ path: path.join(root, 'runtime', f) });

const res = await page.evaluate(async () => {
  const out = {}, hex = c => '#' + [...c].map(v => v.toString(16).padStart(2, '0')).join('');
  const px = (cv, pts) => pts.map(([x, y]) => [...cv.getContext('2d').getImageData(x, y, 1, 1).data]);
  const mk = (w, h, paint) => { const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); return c; };
  const pts = [[10, 10], [200, 90], [320, 180], [500, 300], [630, 350], [77, 250]];

  // 1. post: only palette colors, deterministic
  const src = mk(640, 360, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#12f'); gr.addColorStop(.5, '#f80'); gr.addColorStop(1, '#fe8'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const pal = Pixel.palette('pico8'), allowed = new Set(pal.hex);
  const q = Pixel.post({ w: 160, h: 90, palette: 'pico8', dither: 'bayer4' });
  const a = mk(640, 360, g => q.apply(src, g)), b = mk(640, 360, g => q.apply(src, g));
  const da = a.getContext('2d').getImageData(0, 0, 640, 360).data, db = b.getContext('2d').getImageData(0, 0, 640, 360).data;
  const seen = new Set(); let same = true;
  for (let i = 0; i < da.length; i += 4) { seen.add(hex(da.subarray(i, i + 3))); if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) same = false; }
  out.postColors = seen.size; out.postOnlyPalette = [...seen].every(c => allowed.has(c)); out.postDeterministic = same;
  const flat = mk(640, 360, g => { g.fillStyle = '#808080'; g.fillRect(0, 0, 640, 360); });
  const q2 = Pixel.post({ w: 160, h: 90, palette: ['#000000', '#ffffff'], dither: 'bayer8', spread: 1 });
  const d2 = mk(640, 360, g => q2.apply(flat, g)).getContext('2d').getImageData(0, 0, 640, 360).data;
  let white = 0; for (let i = 0; i < d2.length; i += 4) white += d2[i] > 128 ? 1 : 0;
  out.midGrayDitherRatio = +(white / (d2.length / 4)).toFixed(2);              // 50% gray through a 2-color Bayer 8 dither: about half white

  // 2. flip: scaled nearest neighbor, palette colors, see-through key
  const scr = Pixel.screen({ w: 4, h: 3, palette: 'pico8' }); scr.cls(8).pset(1, 1, 12);
  const dst = mk(48, 36, () => {}), dg = dst.getContext('2d');
  out.flipScale = scr.flip(dg, {}).scale;
  out.flipRed = hex(px(dst, [[2, 2]])[0].slice(0, 3)) === pal.hex[8];
  const kd = mk(48, 36, () => {}); scr.flip(kd.getContext('2d'), { key: 12 }); out.keyAlpha = px(kd, [[15, 15]])[0][3];

  // 3. transitions: p=0 is A, p=1 is B, the middle is neither; no exceptions
  const A = mk(640, 360, g => { g.fillStyle = '#e33'; g.fillRect(0, 0, 640, 360); }), B = mk(640, 360, g => { g.fillStyle = '#3c3'; g.fillRect(0, 0, 640, 360); });
  out.transitions = {};
  for (const name of Object.keys(Pixel.transitions)) {
    const at = p => { const c = mk(640, 360, () => {}), g = c.getContext('2d'); Pixel.transitions[name](g, A, B, p, {}, null); return px(c, pts); };
    const p0 = at(0), p1 = at(1), pm = at(.5);
    const all = (arr, col) => arr.every(v => Math.abs(v[0] - col[0]) < 6 && Math.abs(v[1] - col[1]) < 6);
    out.transitions[name] = { startsAsA: all(p0, [238, 51, 51]), endsAsB: all(p1, [51, 204, 51]), middleMixed: !all(pm, [238, 51, 51]) || !all(pm, [51, 204, 51]) };
  }

  // 4. chiptune: an offline render is finite, audible and identical twice
  const render = async () => {
    const ac = new OfflineAudioContext(1, 48000 * 3, 48000), o = ac.createGain(); o.connect(ac.destination);
    Chip.play(ac, .1, o, ['T120 @0 O3 L8 [C E G E]4', 'T120 @1 V60 O5 L16 [C E G]8', 'T120 @3 V50 O6 L8 [C R]6']); Chip.sfx.coin(ac, 1.5, o);
    return (await ac.startRendering()).getChannelData(0);
  };
  const r1 = await render(), r2 = await render(); let peak = 0, nan = 0, ident = true;
  r1.forEach((v, i) => { peak = Math.max(peak, Math.abs(v)); if (!Number.isFinite(v)) nan++; if (v !== r2[i]) ident = false; });
  out.chip = { peak: +peak.toFixed(3), nan, identical: ident };
  return out;
});
await browser.close();

const fails = [];
const need = (ok, what) => { if (!ok) fails.push(what); };
need(res.postOnlyPalette, 'post: every output pixel is a palette color'); need(res.postColors > 4, 'post: uses several palette colors'); need(res.postDeterministic, 'post: same input, same output');
need(res.midGrayDitherRatio > .4 && res.midGrayDitherRatio < .6, `post: 50% gray dithers to about half white (got ${res.midGrayDitherRatio})`);
need(res.flipScale === 12, `flip: 4x3 screen onto 48x36 scales 12x (got ${res.flipScale})`); need(res.flipRed, 'flip: pixel color comes from the palette'); need(res.keyAlpha === 0, 'flip: key index is transparent');
for (const [n, t] of Object.entries(res.transitions)) { need(t.startsAsA, `${n}: p=0 shows the old frame`); need(t.endsAsB, `${n}: p=1 shows the new frame`); need(t.middleMixed, `${n}: p=.5 is a mix`); }
need(res.chip.peak > .05 && res.chip.peak < 1 && res.chip.nan === 0 && res.chip.identical, `chip: audible, finite, deterministic (${JSON.stringify(res.chip)})`);
need(errors.length === 0, 'no page errors: ' + errors.join('; '));
console.log(JSON.stringify(res, null, 1));
if (fails.length) { console.error('\nFAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('\nbrowser checks passed');
