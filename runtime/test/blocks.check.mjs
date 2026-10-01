// Checks runtime/blocks.js in a browser: every registered block, drawn with its sample parameters (and, when present, every picture of
// examples/lyapunov/spec.json) on a 1080x1920 canvas at several times, in both themes: no exception, boxes recorded after the build, every box
// inside the area, and the output is deterministic (same pixels at the same t, also when frames are drawn out of order). Also checks the
// metadata of Blocks.list() (and that the file loads in plain Node).
// Usage: node runtime/test/blocks.check.mjs        (needs Chrome and `npm install` in render/; CHROME_PATH if Chrome is not in the default place)
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const fails = [], need = (ok, what) => { if (!ok) fails.push(what); };

// ---- 1. plain Node: no DOM, Blocks.list() works and its metadata is complete
const NodeBlocks = createRequire(import.meta.url)(path.join(root, 'runtime/blocks.js'));
const listed = NodeBlocks.list();
const EXPECT = ['bars', 'counter', 'rail', 'tree', 'units', 'split', 'flow', 'columns', 'map', 'card', 'plate', 'type'];
need(EXPECT.every(n => listed.some(b => b.name === n)) && listed.length === EXPECT.length, `list(): the 12 blocks (${listed.map(b => b.name).join(', ')})`);
for (const b of listed) {
  need(b.claim && b.doc && b.doc.length > 40, `${b.name}: claim and doc`);
  for (const k of ['at', 'dur', 'area', 'tone']) need(b.params[k], `${b.name}: common parameter ${k}`);
  for (const [k, v] of Object.entries(b.params)) need(typeof v.type === 'string' && v.type && typeof v.required === 'boolean' && 'default' in v && typeof v.doc === 'string' && v.doc.length > 8, `${b.name}.${k}: type, required, default, doc`);
  need(b.sample && b.sample.block === b.name, `${b.name}: a sample picture`);
  for (const [k, v] of Object.entries(b.params)) if (v.required) need(b.sample && b.sample[k] !== undefined, `${b.name}: the sample gives required "${k}"`);
}
need(listed.find(b => b.name === 'flow').params.layout && listed.find(b => b.name === 'flow').params.nodes.doc.includes('at'), 'flow: layout and per-node at documented');
for (const [n, k] of [['bars', 'items'], ['rail', 'marks'], ['rail', 'spans'], ['tree', 'names'], ['units', 'groups'], ['flow', 'edges'], ['columns', 'glitch'], ['card', 'layers'], ['plate', 'facts'], ['type', 'lines']])
  need(/\bat\b/.test(listed.find(b => b.name === n).params[k].doc), `${n}.${k}: documents the per-element at`);
let threw = false; try { NodeBlocks.draw(null, {}, {}, { block: 'nope' }); } catch { threw = true; } need(threw, 'draw: an unknown block throws');

// ---- 2. the pictures to draw: samples, plus the Lyapunov spec's, with anchors replaced by plain seconds
const pictures = listed.map(b => ({ name: 'sample:' + b.name, pic: b.sample }));
const specFile = path.join(root, 'examples/lyapunov/spec.json');
if (fs.existsSync(specFile)) {
  let k = 0;
  const flat = o => Array.isArray(o) ? o.map(flat) : o && typeof o === 'object' ? (Object.keys(o).some(x => x[0] === '$') ? 1.2 + (k++ * .9) % 4.5 : Object.fromEntries(Object.entries(o).map(([a, b]) => [a, flat(b)]))) : o;
  for (const sh of JSON.parse(fs.readFileSync(specFile, 'utf8')).shots) if (sh.picture) pictures.push({ name: 'lyapunov:' + sh.id, pic: flat(sh.picture), theme: sh.theme });
}

// ---- 3. the browser
const { chromium } = await import(pathToFileURL(path.join(root, 'render/node_modules/playwright-core/index.mjs')).href);
const launch = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const browser = await chromium.launch({ ...launch, args: ['--force-color-profile=srgb'] });
const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
await page.setContent('<canvas id=c></canvas>');
let fonts = 'fallback fonts';
try {                                                         // the real faces when the network allows; the geometry checks hold with a fallback too
  await Promise.race([page.addStyleTag({ url: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600;700&family=Oswald:wght@500;700&display=block&subset=cyrillic,latin' }), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))]);
  fonts = 'web fonts';
} catch { /* offline */ }
for (const f of ['film.js', 'blocks.js']) await page.addScriptTag({ path: path.join(root, 'runtime', f) });

const res = await page.evaluate(async ({ pictures }) => {
  try { await Promise.race([Promise.all(['700 100px "Oswald"', '500 30px "IBM Plex Mono"', '600 30px "IBM Plex Mono"', '700 30px "IBM Plex Mono"'].map(x => document.fonts.load(x, 'ABCabc123АБВГабвг'))), new Promise(r => setTimeout(r, 6000))]); } catch { /* fallback */ }
  const themes = {
    paper: { bg: '#e9e1cd', ink: '#17150f', muted: '#756d5b', accent: '#b3261e', card: '#f7f2e4', ok: '#1d6b4b', hud: '#17150f', texture: 'none' },
    blueprint: { bg: '#1b4a8a', ink: '#eaf1fb', muted: '#93b3dd', accent: '#ff8a50', card: '#1b4a8a', ok: '#7be0a6', hud: '#eaf1fb', texture: 'none' },
  };
  const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920; const ctx = cv.getContext('2d', { willReadFrequently: true });
  const f = Film.create({ W: 1080, H: 1920, FPS: 30, tempo: 120, canvas: document.createElement('canvas'), safe: [.07, .17, .22], type: { display: '"Oswald", sans-serif', mono: '"IBM Plex Mono", monospace' }, themes, shots: [{ id: 'a', bars: 8 }] });
  const sh = f.shots[0], band = f.band;
  const areaOf = pic => { const a = [].concat(pic).map(q => q.area || band); return a.map(x => x.frac ? { x: band.x + band.w * x.frac[0], y: band.y + band.h * x.frac[1], w: band.w * x.frac[2], h: band.h * x.frac[3] } : x); };
  const hash = () => { const d = new Uint32Array(ctx.getImageData(0, 0, 1080, 1920).data.buffer); let h = 2166136261; for (let i = 0; i < d.length; i += 3) h = Math.imul(h ^ d[i], 16777619); return h >>> 0; };
  const frame = (pic, theme, t) => {
    f.boxes.length = 0; const s = f.state(sh, t, themes[theme]);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = themes[theme].bg; ctx.fillRect(0, 0, 1080, 1920);
    Blocks.draw(ctx, s, f, pic);
    return { hash: hash(), boxes: f.boxes.map(b => ({ ...b })) };
  };
  const times = [0, .3, 1, 2, 3, 4, 5.5, 7.5], out = [];
  // warm-up: the very first frame that builds a cached sprite (a stamp) differs from later ones by anti-aliasing on thin edges (Chrome switches the
  // canvas's raster path when a new OffscreenCanvas is created mid-frame), so caches are built once before the comparison; what is compared
  // afterwards is that cached state does not depend on the order of the frames
  for (const { pic, theme } of pictures) for (const th of theme && themes[theme] ? [theme] : ['paper', 'blueprint']) for (const t of times) frame(pic, th, t);
  for (const { name, pic, theme } of pictures) {
    const areas = areaOf(pic), r = { name, errors: [], outside: [], boxes: {}, deterministic: true, blank: false };
    for (const th of theme && themes[theme] ? [theme] : ['paper', 'blueprint']) {
      const first = {}, key = t => th + '@' + t;
      try {
        for (const t of times) { const fr = frame(pic, th, t); first[key(t)] = fr; r.boxes[key(t)] = fr.boxes.length;
          for (const b of fr.boxes) { const inside = areas.some(a => b.x0 >= a.x - 1.5 && b.y0 >= a.y - 1.5 && b.x1 <= a.x + a.w + 1.5 && b.y1 <= a.y + a.h + 1.5); if (!inside) r.outside.push(`${key(t)} ${b.kind} "${String(b.text).slice(0, 24)}" [${b.x0},${b.y0},${b.x1},${b.y1}]`); } }
        // out of order, twice: the same pixels and the same boxes
        for (const t of [...times].reverse().concat([2, 5.5, 0.3, 7.5])) { const fr = frame(pic, th, t), a = first[key(t)]; if (fr.hash !== a.hash || JSON.stringify(fr.boxes) !== JSON.stringify(a.boxes)) r.deterministic = false; }
        if (first[key(0)].hash === first[key(7.5)].hash) r.blank = true;      // nothing happens between the first and the last frame
      } catch (e) { r.errors.push(String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    }
    out.push(r);
  }
  return out;
}, { pictures });
await browser.close();

// ---- 4. verdicts
const rows = [];
for (const r of res) {
  need(!r.errors.length, `${r.name}: no exception (${r.errors[0] || ''})`);
  need(r.outside.length === 0, `${r.name}: every box inside the area (${r.outside.length}: ${r.outside.slice(0, 3).join('; ')})`);
  need(r.deterministic, `${r.name}: deterministic, also out of order`);
  need(!r.blank, `${r.name}: the picture changes between t=0 and t=7.5`);
  const late = Object.entries(r.boxes).filter(([k]) => k.endsWith('@7.5')).map(([, v]) => v);
  need(late.length && late.every(n => n >= 1), `${r.name}: at least one box recorded after the build (${late.join(',')})`);
  rows.push(`${r.name.padEnd(22)} ${r.errors.length ? 'ERROR ' : r.outside.length ? 'OUTSIDE' : r.deterministic ? 'ok     ' : 'NONDET '} boxes@7.5s paper/blueprint: ${late.join('/')}`);
}
need(errors.length === 0, 'no page errors: ' + errors.join('; '));
console.log(`blocks.js: ${listed.length} blocks, ${res.length} pictures, ${fonts}\n` + rows.join('\n'));
if (fails.length) { console.error('\nFAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('\nblocks checks passed');
