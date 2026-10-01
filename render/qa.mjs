// Automatic reviewer for vertical social videos: the rules of chapters 19-21 as checks, with a report.
// Usage: node qa.mjs <film.html> [--video film.mp4] [--spec spec.json] [--out qa] [--step 0.25] [--strict]
//   film.html  a page built on the render contract and runtime/film.js (window.__draw, window.__film, window.__meta); a page made by
//              the factory also exposes window.__short = { spec, timing }, but nothing here depends on it
//   --video    the rendered mp4: adds frame 0, dead stretches, black and frozen frames, loudness and the contact sheet
//   --spec     the factory's spec.json (defaults to window.__short.spec): the genre, the claim types and the facts
//   --out      output directory (default ./qa): report.md, report.json, sheet.png (with --video), poster/
//   --step     seconds between the frames drawn for the box checks (default 0.25)
//   --strict   warnings fail too
// Exit code: 0 pass, 1 fail (any FAIL; with --strict any WARN too), 2 tool error. Chrome: CHROME_PATH or the installed Chrome;
// ffmpeg, ffprobe and (for the contact sheet) bash on PATH. The pure analysis is in qa-lib.mjs.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import * as Q from './qa-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELP = 'usage: node qa.mjs <film.html> [--video film.mp4] [--spec spec.json] [--out qa] [--step 0.25] [--strict]';
const AN_FPS = 10, AN_SHORT = 108;      // frames for the difference series: 10 per second, 108 px on the short side

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args.splice(i, 2)[1]; if (v === undefined || v.startsWith('--')) fail(`${n} needs a value\n${HELP}`); return v; };
function fail(msg) { console.error(msg); process.exit(2); }

if (flag('--help') || flag('-h')) { console.log(HELP); process.exit(0); }
const strict = flag('--strict');
const videoArg = opt('--video', null), specArg = opt('--spec', null), outDir = path.resolve(opt('--out', 'qa'));
const step = parseFloat(opt('--step', '0.25'));
const [input] = args;
if (!input) fail(HELP);
if (!(step > 0)) fail('--step must be a positive number of seconds');
if (!fs.existsSync(input)) fail(`no such page: ${input}`);
if (videoArg && !fs.existsSync(videoArg)) fail(`no such video: ${videoArg}`);
if (specArg && !fs.existsSync(specArg)) fail(`no such spec: ${specArg}`);

function run(cmd, argv, o = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], ...o });
    const so = [], se = []; p.stdout.on('data', d => so.push(d)); p.stderr.on('data', d => se.push(d));
    p.on('error', e => rej(new Error(e.code === 'ENOENT' ? `${cmd} not found on PATH` : e.message)));
    p.on('close', c => c === 0 ? res({ out: Buffer.concat(so), err: Buffer.concat(se).toString() }) : rej(new Error(`${cmd} exit ${c}\n${Buffer.concat(se).toString().slice(-1200)}`)));
  });
}

// ------------------------------------------------------------------ the page: what it draws
// Runs inside the page (self-contained). Describes the film: size, margins, shots, the voice-over.
function describe() {
  const f = window.__film, m = window.__meta;
  if (!f) return { noFilm: true, W: m.W, H: m.H, FPS: m.FPS, duration: m.DURATION, portrait: m.H > m.W, margin: { x: Math.round(m.W * .065), y: Math.round(m.H * .1), yb: Math.round(m.H * .1) }, shots: (window.__shots || []).map(s => ({ id: s.id, start: s.start, end: s.end, chapter: s.chapter, in: null, tr: null, says: [] })), voice: null };
  const short = window.__short, ph = short && short.timing && short.timing.phrases;
  let spec = null; try { spec = short && short.spec ? JSON.parse(JSON.stringify(short.spec)) : null; } catch { /* a spec with functions */ }
  return {
    W: f.W, H: f.H, FPS: f.FPS, duration: f.DURATION, portrait: f.portrait, margin: { ...f.margin },
    shots: f.shots.map(s => ({
      id: s.id, start: s.start, end: s.end, chapter: s.chapter,
      in: s.in ? (typeof s.in === 'string' ? s.in : s.in.type) : null,
      tr: s.tr ? { t0: s.tr.t0, t1: s.tr.t1, type: s.tr.type } : null,
      says: (s.says || []).map(x => ({ text: x.text, caption: x.caption ?? null })),
    })),
    voice: f.voice ? { words: f.voice.words.map(w => ({ word: w.word, start: w.start, end: w.end, punct: w.punct || '' })) } : null,
    phrases: ph ? ph.map(p => ({ start: p.start, end: p.end })) : null,
    spec,
  };
}

// Draws the whole film at `step` and records the boxes of every frame. A statement with `out` keeps recording its boxes after it has faded
// out (runtime/film.js draws it at alpha 0); those are dropped here, or the next statement would "overlap" a caption nobody can see.
function sweep({ step, D }) {
  const f = window.__film, fades = [];
  for (const sh of f.shots) for (const sp of sh.says || []) {
    if (typeof sp.out !== 'number') continue;
    const tOut = sh.start + f.state(sh, sh.start).at(sp.out), words = String(sp.text).split(/[\s|]+/).filter(Boolean).length;
    fades.push({ text: sp.text, caption: sp.caption == null ? null : String(sp.caption), start: sh.start, sayGone: tOut + .3 + .03 * words, capGone: tOut + .3 });
  }
  const times = []; for (let t = 0; t < D - 1e-6; t += step) times.push(+t.toFixed(6)); times.push(+(D - 1e-3).toFixed(6));
  return times.map(t => {
    window.__draw(t);
    const boxes = f.boxes.filter(b => !fades.some(x => t >= x.start && ((b.kind === 'say' && b.text === x.text && t >= x.sayGone) || (b.kind === 'caption' && x.caption !== null && b.text === x.caption && t >= x.capGone))))
      .map(b => ({ kind: b.kind, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, text: b.text }));
    return { t, boxes };
  });
}

async function inspectPage(posters) {
  const launchOpts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
  const browser = await chromium.launch({ ...launchOpts, args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
  try {
    const page = await browser.newPage(), logs = [], seen = new Set();
    const add = (type, text) => { const k = type + text; if (!seen.has(k)) { seen.add(k); logs.push({ type, text }); } };
    page.on('pageerror', e => add('pageerror', e.message));
    page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') add(m.type(), m.text()); });
    await page.goto(pathToFileURL(path.resolve(input)).href + '?render');
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => { throw new Error('the page never set window.__ready (is it built on the render contract?)'); });
    const meta = await page.evaluate(() => window.__meta);
    if (!meta) throw new Error('the page has no window.__meta');
    const film = await page.evaluate(describe);
    const samples = film.noFilm ? null : await page.evaluate(sweep, { step, D: film.duration });
    // poster frames: full size, from the page (not the video), so the cover candidate is not a compressed copy
    const files = [];
    await page.setViewportSize({ width: meta.W, height: meta.H });
    for (const p of posters(film.duration)) {
      await page.evaluate(t => window.__draw(t), p.t);
      const file = path.join(outDir, 'poster', p.name);
      await page.locator('canvas').screenshot({ path: file });
      files.push({ ...p, file });
    }
    return { film, samples, logs, posterFiles: files };
  } finally { await browser.close(); }
}

// ------------------------------------------------------------------ the video
async function probe(file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file]);
  const j = JSON.parse(out.toString()), v = (j.streams || []).find(s => s.codec_type === 'video');
  if (!v) throw new Error(`${file} has no video stream`);
  return { w: v.width, h: v.height, hasAudio: (j.streams || []).some(s => s.codec_type === 'audio'), duration: parseFloat(j.format.duration) };
}

async function frames(file, vw, vh) {
  // the short side is AN_SHORT px: a portrait video is 108x192, a landscape one 192x108; area averaging keeps the film grain out of the numbers
  const s = AN_SHORT / Math.min(vw, vh), w = Math.max(2, Math.round(vw * s)), h = Math.max(2, Math.round(vh * s));
  const { out } = await run('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', `fps=${AN_FPS},scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', '-']);
  return Q.analyzeFrames(out, w, h, AN_FPS);
}

// EBU R128 through ffmpeg's ebur128 filter: the summary at the end of its log has the integrated loudness, the range and the true peak
async function loudness(file) {
  const { err } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const sum = err.slice(err.lastIndexOf('Summary:'));
  const num = re => { const m = re.exec(sum); return m ? parseFloat(m[1]) : NaN; };
  const m = { I: num(/I:\s+(-?[\d.]+|-inf)\s+LUFS/), LRA: num(/LRA:\s+(-?[\d.]+)\s+LU/), TP: num(/Peak:\s+(-?[\d.]+|-inf)\s+dBFS/) };
  if (!Number.isFinite(m.I) && !/-inf\s+LUFS/.test(sum)) throw new Error('could not read the ebur128 summary:\n' + err.slice(-600));
  return m;
}

function findBash() {
  if (process.platform !== 'win32') return 'bash';
  // not the WSL launcher in System32: it cannot see Windows paths
  const c = [process.env.BASH, 'C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe'].filter(Boolean);
  return c.find(p => fs.existsSync(p)) || 'bash';
}

async function contactSheet(video, sheet) {
  await run(findBash(), [path.join(HERE, 'contact-sheet.sh').replace(/\\/g, '/'), video.replace(/\\/g, '/'), sheet.replace(/\\/g, '/'), '2']);
}

// ------------------------------------------------------------------ main
async function main() {
  fs.mkdirSync(path.join(outDir, 'poster'), { recursive: true });
  const posters = D => [['poster-15.png', .15, '15% of the film'], ['poster-50.png', .5, '50% of the film'], ['poster-85.png', .85, '85% of the film'], ['cover-2s.png', Math.min(2, D * .5), 'cover candidate']]
    .map(([name, x, note]) => ({ name, t: name.startsWith('cover') ? x : D * x, note }));
  const { film, samples, logs, posterFiles } = await inspectPage(posters);
  const notes = [];
  if (film.noFilm) notes.push('the page has no window.__film (not built on runtime/film.js): box checks are skipped');
  let spec = film.spec || null;
  if (specArg) { try { spec = JSON.parse(fs.readFileSync(specArg, 'utf8')); if (spec && spec.spec && spec.timing) spec = spec.spec; } catch (e) { fail(`cannot read ${specArg}: ${e.message}`); } }

  const checks = [];
  let series = null, loud = null, v = null, sheetFile = null;
  if (videoArg) {
    v = await probe(videoArg);
    if (Math.abs(v.duration - film.duration) > 0.5) notes.push(`the video is ${v.duration.toFixed(2)} s but the page says ${film.duration.toFixed(2)} s: is it the same film?`);
    series = await frames(videoArg, v.w, v.h);
    if (v.hasAudio) loud = await loudness(videoArg);
    try { sheetFile = path.join(outDir, 'sheet.png'); await contactSheet(videoArg, sheetFile); }
    catch (e) { sheetFile = null; notes.push(`no contact sheet: ${e.message.split('\n')[0]}`); }
    if (v.w !== film.W || v.h !== film.H) notes.push(`the video is ${v.w}x${v.h}, the page ${film.W}x${film.H} (a draft?): the frame analysis does not depend on it`);
  }
  const genre = spec && spec.genre;
  checks.push(
    Q.checkFrame0(series), Q.checkHook(samples, film, { genre }), Q.checkDead(series, film), Q.checkSafeZones(samples, film, step), Q.checkOverlap(samples, film, step),
    Q.checkFit(logs), Q.checkStatements(film, samples, step), Q.checkBudget(film), Q.checkPace(film), Q.checkLoudness(loud, !!videoArg, v ? v.hasAudio : true),
    Q.checkBlack(series, film), Q.checkFrozen(series, film),
    Q.checkPoster(posterFiles.map(p => ({ name: 'poster/' + p.name, t: p.t, note: p.note }))), Q.checkFormat(film), Q.checkTransitions(film), Q.checkSpec(spec, film),
  );
  const files = { ...(videoArg ? { video: videoArg } : {}), ...(specArg ? { spec: specArg } : {}), ...(sheetFile ? { sheet: 'sheet.png' } : {}), poster: 'poster' };
  const rep = Q.buildReport({ film, input, files, checks, strict, notes });
  fs.writeFileSync(path.join(outDir, 'report.md'), rep.md + '\n');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rep.json, null, 2) + '\n');

  console.log(`${input}: ${film.W}x${film.H}, ${film.duration.toFixed(1)} s${film.portrait ? '' : ' (landscape: the film\'s own margins are the safe zones)'}`);
  for (const c of Q.sortChecks(checks)) console.log('  ' + Q.summaryLine(c));
  for (const n of notes) console.log('  note: ' + n);
  console.log(`${rep.verdict.result}: ${rep.verdict.fail} fail, ${rep.verdict.warn} warn${strict ? ' (strict)' : ''}. Report: ${path.join(outDir, 'report.md')}`);
  process.exit(rep.verdict.exitCode);
}

main().catch(e => { console.error('qa.mjs: ' + (e && e.message || e)); process.exit(2); });
