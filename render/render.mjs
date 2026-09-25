// Покадровый рендер HTML-анимации в MP4.
// Использование: node render.mjs <input.html> [out.mp4] [--from 0] [--to DURATION] [--voice voice.wav]
// Страница должна выставлять window.__meta = {W,H,FPS,DURATION}, window.__draw(t), window.__ready = true.
// Необязательно: window.__renderAudio() -> base64 WAV.
// Chrome: по умолчанию установленный Google Chrome; другой путь через CHROME_PATH.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const from = parseFloat(opt('--from', '0'));
const toArg = opt('--to', null);
const voice = opt('--voice', null);
const [input, out = 'out.mp4'] = args;
if (!input) { console.error('usage: node render.mjs <input.html> [out.mp4] [--from s] [--to s] [--voice file.wav]'); process.exit(1); }

const launchOpts = process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH }
  : { channel: 'chrome' };
const browser = await chromium.launch({ ...launchOpts, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });

await page.goto(pathToFileURL(path.resolve(input)).href + '?render');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const { W, H, FPS, DURATION } = await page.evaluate(() => window.__meta);
await page.setViewportSize({ width: W, height: H });
const to = toArg ? parseFloat(toArg) : DURATION;

// звук
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-'));
const audioInputs = [];
const hasAudio = await page.evaluate(() => typeof window.__renderAudio === 'function');
if (hasAudio) {
  process.stdout.write('rendering audio... ');
  const b64 = await page.evaluate(() => window.__renderAudio());
  const wav = path.join(tmp, 'music.wav');
  fs.writeFileSync(wav, Buffer.from(b64, 'base64'));
  audioInputs.push(wav);
  console.log('ok');
}
if (voice) audioInputs.push(path.resolve(voice));

const ffArgs = ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
for (const a of audioInputs) ffArgs.push('-ss', String(from), '-i', a);
if (audioInputs.length === 2) ffArgs.push('-filter_complex', '[1:a][2:a]amix=inputs=2:normalize=0[a]', '-map', '0:v', '-map', '[a]');
ffArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart');
if (audioInputs.length) ffArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
ffArgs.push(path.resolve(out));

const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'ignore', 'inherit'] });
const ffDone = new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));

const canvas = page.locator('canvas').first();
const first = Math.round(from * FPS), last = Math.round(to * FPS);
const t0 = Date.now();
for (let i = first; i < last; i++) {
  await page.evaluate(t => window.__draw(t), i / FPS);
  const png = await canvas.screenshot({ type: 'png' });
  if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
  if ((i - first) % FPS === 0) {
    const done = i - first + 1, total = last - first, el = (Date.now() - t0) / 1000;
    process.stdout.write(`\rframe ${done}/${total}  eta ${Math.round(el / done * (total - done))}s   `);
  }
}
ff.stdin.end();
await ffDone;
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ndone: ${out}`);
