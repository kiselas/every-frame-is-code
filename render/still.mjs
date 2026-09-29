// Full-resolution stills of a page at given timecodes, without rendering a video.
// For checking composition, text size and detail at 1:1 while iterating.
// Usage: node still.mjs <page.html> <outdir> <t1> [t2 ...]        times in seconds, or shot ids (runtime/film.js)
//        a shot id takes the frame at 70% of the shot; id@0.3 takes it at 30%
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const [input, outdir, ...times] = process.argv.slice(2);
if (!input || !outdir || !times.length) { console.error('usage: node still.mjs <page.html> <outdir> <t|shot[@p]> ...'); process.exit(1); }
fs.mkdirSync(outdir, { recursive: true });
const launchOpts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const browser = await chromium.launch({ ...launchOpts, args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
const page = await browser.newPage();
page.on('pageerror', e => console.error('[page]', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
await page.goto(pathToFileURL(path.resolve(input)).href + '?render');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const meta = await page.evaluate(() => window.__meta);
await page.setViewportSize({ width: meta.W, height: meta.H });
const shots = await page.evaluate(() => window.__shots || []);
for (const spec of times) {
  let t = parseFloat(spec);
  if (!/^[\d.]+$/.test(spec)) {
    const [id, p = '0.7'] = spec.split('@'), s = shots.find(x => x.id === id);
    if (!s) { console.error(`no shot ${id}`); continue; }
    t = s.start + (s.end - s.start) * parseFloat(p);
  }
  await page.evaluate(t => window.__draw(t), t);
  const file = path.join(outdir, `still-${spec.replace(/[^\w.@-]/g, '_')}.png`);
  await page.locator('canvas').screenshot({ path: file });
  console.log(`${file}  (t = ${t.toFixed(2)} s)`);
}
await browser.close();
