// Sweeps a whole page and reports what its runtime warns about while drawing: statements and captions that were wider than their room
// and had to shrink (runtime/film.js), and any page error or console error. Run it before rendering, especially for vertical films.
// Usage: node textcheck.mjs <page.html> [step=0.5]        exit code 1 when there is anything to report
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [input, stepArg] = process.argv.slice(2);
if (!input) { console.error('usage: node textcheck.mjs <page.html> [step seconds]'); process.exit(2); }
const step = parseFloat(stepArg || '0.5');
const launchOpts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const browser = await chromium.launch({ ...launchOpts, args: ['--force-color-profile=srgb'] });
const page = await browser.newPage();
const found = new Set();
page.on('pageerror', e => found.add(`page error: ${e.message}`));
page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') found.add(`${m.type()}: ${m.text()}`); });
await page.goto(pathToFileURL(path.resolve(input)).href + '?render');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const meta = await page.evaluate(() => window.__meta);
await page.evaluate(({ D, step }) => { for (let t = 0; t < D; t += step) window.__draw(t); window.__draw(D - 1e-3); }, { D: meta.DURATION, step });
await browser.close();
console.log(`${input}: ${meta.W}x${meta.H}, ${meta.DURATION.toFixed(1)} s, every ${step} s: ${found.size ? found.size + ' finding(s)' : 'nothing to report'}`);
for (const f of found) console.log('  ' + f);
process.exit(found.size ? 1 : 0);
