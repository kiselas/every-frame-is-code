// Frame-by-frame render of an HTML animation to MP4.
// Usage: node render.mjs <input.html> [out.mp4] [options]   (see render/README.md or --help)
// The page must expose window.__meta = {W,H,FPS,DURATION}, window.__draw(t), window.__ready = true.
// Optional: window.__renderAudio() -> base64 WAV.
// Chrome: the installed Google Chrome by default; set CHROME_PATH for another binary.
//
// Speed: frames are captured with CDP Page.captureScreenshot (optimizeForSpeed) instead of an element
// screenshot, which is 3-5x faster per frame, and the timeline is split into chunks that several
// browsers render in parallel. Each chunk is encoded on its own and the chunks are joined without
// re-encoding, so the result is the same as a single-process render.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HELP = `usage: node render.mjs <input.html> [out.mp4] [options]
  --from S, --to S        render a fragment (seconds)
  --workers N|auto        parallel browsers (default: auto = a quarter of the CPU cores, 1 to 6)
  --draft                 fast preview: --scale 0.5 --fps 30 --format jpeg --preset veryfast
  --scale K               capture scale, e.g. 0.5 for a 960x540 draft of a 1080p page
  --fps N                 override the page FPS (the time step is 1/N)
  --format png|jpeg       frame capture format (default png; jpeg is ~2x faster, lossy)
  --quality Q             jpeg quality (default 92)
  --crf N, --preset P     x264 settings (default 18, slow)
  --voice FILE.wav        mix a voice-over into the page audio
  --loudnorm              normalize the final audio to -14 LUFS
  --no-audio              skip window.__renderAudio
  --profile               time every frame, print the slowest ones and where the time goes`;

// --- options ---------------------------------------------------------------
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
if (flag('--help') || flag('-h')) { console.log(HELP); process.exit(0); }
const draft = flag('--draft');
const profile = flag('--profile');
const loudnorm = flag('--loudnorm');
const noAudio = flag('--no-audio');
const from = parseFloat(opt('--from', '0'));
const toArg = opt('--to', null);
const voice = opt('--voice', null);
const scale = parseFloat(opt('--scale', draft ? '0.5' : '1'));
const fpsArg = opt('--fps', draft ? '30' : null);
const format = opt('--format', draft ? 'jpeg' : 'png');
const quality = parseInt(opt('--quality', '92'), 10);
const crf = opt('--crf', '18');
const preset = opt('--preset', draft ? 'veryfast' : 'slow');
const workersArg = opt('--workers', 'auto');
const [input, out = 'out.mp4'] = args;
if (!input || !['png', 'jpeg'].includes(format)) { console.error(HELP); process.exit(1); }

const launchOpts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const chromeArgs = [
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--force-color-profile=srgb', '--hide-scrollbars',
];
const url = pathToFileURL(path.resolve(input)).href + '?render';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-'));

function run(cmd, argv, stdio = ['ignore', 'ignore', 'inherit']) {
  const p = spawn(cmd, argv, { stdio });
  p.done = new Promise((res, rej) => { p.on('error', rej); p.on('close', c => c === 0 ? res() : rej(new Error(`${cmd} exit ${c}`))); });
  return p;
}

async function openPage() {
  const browser = await chromium.launch({ ...launchOpts, args: chromeArgs });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
  page.on('pageerror', e => console.error('[page]', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const meta = await page.evaluate(() => window.__meta);
  await page.setViewportSize({ width: meta.W, height: meta.H });
  const box = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const cdp = await page.context().newCDPSession(page);
  return { browser, page, cdp, meta, clip: { ...box, scale } };
}

// --- first browser: metadata, audio, then it becomes worker 0 ----------------
const first = await openPage();
const { W, H, DURATION } = first.meta;
const FPS = fpsArg ? parseFloat(fpsArg) : first.meta.FPS;
const to = toArg ? parseFloat(toArg) : DURATION;
const f0 = Math.round(from * FPS), f1 = Math.round(to * FPS), total = f1 - f0;
const cores = os.cpus().length;
// All browsers share one GPU: on a laptop iGPU throughput stops growing at 4-6 workers and drops after that.
const workers = Math.max(1, Math.min(workersArg === 'auto' ? Math.max(1, Math.min(6, Math.floor(cores / 4))) : parseInt(workersArg, 10), Math.ceil(total / FPS)));

// chunks: several per worker, so a heavy scene does not leave the other workers idle
const chunkLen = Math.max(FPS, Math.ceil(total / (workers * 4)));
const chunks = [];
for (let a = f0; a < f1; a += chunkLen) chunks.push({ a, b: Math.min(f1, a + chunkLen), file: path.join(tmp, `c${String(chunks.length).padStart(4, '0')}.mp4`) });

const audioInputs = [];
const hasAudio = !noAudio && await first.page.evaluate(() => typeof window.__renderAudio === 'function');
if (hasAudio) {
  process.stdout.write('rendering audio... ');
  const wav = path.join(tmp, 'music.wav');
  fs.writeFileSync(wav, Buffer.from(await first.page.evaluate(() => window.__renderAudio()), 'base64'));
  audioInputs.push(wav); console.log('ok');
}
if (voice) audioInputs.push(path.resolve(voice));

const outW = Math.round(W * scale), outH = Math.round(H * scale);
console.log(`${input}: ${total} frames, ${outW}x${outH} @ ${FPS} fps, ${format}, ${workers} worker(s), ${chunks.length} chunks`);

// --- workers -----------------------------------------------------------------
const times = [];      // [t, drawMs, captureMs] per frame, for the report
let done = 0, next = 0;
const tStart = Date.now();
const shot = { format, clip: null, optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true, ...(format === 'jpeg' ? { quality } : {}) };

async function worker(ctx) {
  const { page, cdp, clip } = ctx;
  const req = { ...shot, clip };
  while (next < chunks.length) {
    const ch = chunks[next++];
    const ff = run('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', format === 'png' ? 'png' : 'mjpeg', '-framerate', String(FPS), '-i', '-',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', crf, '-preset', preset, ch.file], ['pipe', 'ignore', 'inherit']);
    for (let i = ch.a; i < ch.b; i++) {
      const t = i / FPS;
      // No getImageData here, not even for profiling: after a few readbacks Chrome moves the canvas
      // from the GPU to the CPU and every drawImage gets ~50x slower. GPU work finishes inside capture.
      const drawMs = await page.evaluate(t => { const a = performance.now(); window.__draw(t); return performance.now() - a; }, t);
      const c0 = Date.now();
      const { data } = await cdp.send('Page.captureScreenshot', req);
      times.push([t, drawMs, Date.now() - c0]);
      if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
      done++;
    }
    ff.stdin.end(); await ff.done;
  }
  await ctx.browser.close();
}

const progress = setInterval(() => {
  const el = (Date.now() - tStart) / 1000, fps = done / Math.max(el, .001);
  process.stdout.write(`\rframe ${done}/${total}  ${fps.toFixed(1)} fps  eta ${Math.round((total - done) / Math.max(fps, .001))}s   `);
}, 1000);

try {
  const rest = await Promise.all(Array.from({ length: workers - 1 }, openPage));
  await Promise.all([first, ...rest].map(worker));
} catch (e) {
  clearInterval(progress); console.error('\n' + e.message); process.exit(1);
}
clearInterval(progress);
const elapsed = (Date.now() - tStart) / 1000;
console.log(`\rframe ${done}/${total}  ${(done / elapsed).toFixed(1)} fps  ${elapsed.toFixed(1)}s                 `);

// --- join chunks, add audio ------------------------------------------------------
const list = path.join(tmp, 'list.txt');
fs.writeFileSync(list, chunks.map(c => `file '${c.file.replace(/\\/g, '/')}'`).join('\n'));
const ffArgs = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list];
for (const a of audioInputs) ffArgs.push('-ss', String(from), '-t', String(to - from), '-i', a);
ffArgs.push('-map', '0:v');
const af = [];
if (audioInputs.length === 2) af.push('[1:a][2:a]amix=inputs=2:normalize=0');
else if (audioInputs.length === 1) af.push('[1:a]anull');
if (af.length) { ffArgs.push('-filter_complex', af[0] + (loudnorm ? ',loudnorm=I=-14:TP=-1.5:LRA=11' : '') + '[a]', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'); }
ffArgs.push('-c:v', 'copy', '-movflags', '+faststart', path.resolve(out));
await run('ffmpeg', ffArgs).done;
fs.rmSync(tmp, { recursive: true, force: true });

// --- report ------------------------------------------------------------------
const avg = k => times.reduce((s, r) => s + r[k], 0) / times.length;
console.log(`done: ${out}  (${(avg(1) + avg(2)).toFixed(0)} ms per frame per worker: draw call ${avg(1).toFixed(1)} ms, capture ${avg(2).toFixed(0)} ms)`);
if (profile) {
  // "draw" is only the JS side of __draw: the GPU finishes the frame inside the capture call,
  // so the capture column carries the real cost of heavy effects. Rank by the total.
  const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
  const firstOfChunk = new Set(chunks.map(c => c.a / FPS));
  console.log('slowest frames (the first frame of a chunk also pays for encoder start-up and is skipped):');
  for (const [t, d, c] of [...times].filter(r => !firstOfChunk.has(r[0])).sort((a, b) => (b[1] + b[2]) - (a[1] + a[2])).slice(0, 10))
    console.log(`  ${fmt(t)}  total ${(d + c).toFixed(0).padStart(5)} ms  (draw call ${d.toFixed(1)} ms)`);
  const sec = {};
  for (const [t, d, c] of times) { const k = Math.floor(t); (sec[k] ??= []).push(d + c); }
  console.log('mean frame time per second of film, ms:');
  console.log(Object.entries(sec).map(([k, v]) => `${k}s:${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(0)}`).join('  '));
}
