// Eyes and lint for music: lints a Score and draws a piano roll, a spectrogram and per-section loudness, so that an
// agent that cannot listen can still find musical problems.
// Usage: node music-report.mjs <score.json | film.html> [outdir] [--wav file.wav]
//   score.json  a Score (runtime/music-lint.js documents the format); audio only with --wav
//   film.html   a page built on the render contract: opened with ?render, window.__score is the Score and
//               window.__renderAudio() (base64 WAV) is the audio, unless --wav is given
// Writes outdir/ (default music-report/): report.md, lint.json, piano-roll.png, and with audio audio.wav (film.html only),
// spectrogram.png (ffmpeg showspectrumpic, log frequency, section boundaries and loudness on top). Exit code 1 when the
// lint has error findings, 2 when the tool itself failed, otherwise 0. Chrome: CHROME_PATH or the installed Chrome; ffmpeg on PATH.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const ML = createRequire(import.meta.url)('../runtime/music-lint.js');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const wavArg = opt('--wav', null);
const [input, outArg] = args;
if (!input) { console.error('usage: node music-report.mjs <score.json | film.html> [outdir] [--wav file.wav]'); process.exit(2); }
const out = path.resolve(outArg || 'music-report');
fs.mkdirSync(out, { recursive: true });
const rel = f => path.join(out, f);

function run(cmd, argv) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '', se = ''; p.stdout.on('data', d => so += d); p.stderr.on('data', d => se += d);
    p.on('error', rej); p.on('close', c => c === 0 ? res({ so, se }) : rej(new Error(`${cmd} exit ${c}\n${se.slice(-1500)}`)));
  });
}

// ---------------------------------------------------------------- drawing (runs inside the page; must be self-contained)
function draw(P) {
  const { score, kind, findings, stats, sectionLoud } = P;
  const W = 1920, L = 190, R = 24, PW = W - L - R;
  const bpm = score.bpm || 120, bpb = score.beatsPerBar || 4, T = P.T;
  const X = b => L + (b * 60 / bpm) / T * PW;
  const FONT = '"Segoe UI","DejaVu Sans",Arial,sans-serif';
  const C = { bg: '#12141a', text: '#d7dbe3', dim: '#8a93a3', grid: '#252a35', bar: '#3a4150', band: ['rgba(120,140,190,0.07)', 'rgba(120,140,190,0.15)'], err: '#ff4d4d', warn: '#ffb020', info: '#6aa9ff' };
  const ROLE = { lead: '#ffd23f', arp: '#34d1b6', bass: '#ff6b5c', pad: '#8c9bff', fx: '#d38bff', drums: '#e6e9ef', other: '#9aa4b2' };
  const roleOf = t => t.role || (['bass', 'lead', 'arp', 'pad', 'drum', 'fx'].find(r => String(t.name || '').toLowerCase().includes(r)) || 'other').replace('drum', 'drums');
  const tracks = (score.tracks || []).map(t => ({ t, role: roleOf(t), name: t.name || roleOf(t), events: t.events || [] }));
  const sections = (score.sections || []).map(s => ({ ...s, end: s.b + (s.bars || 1) * bpb })).sort((a, b) => a.b - b.b);
  const chords = score.chords || [];
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SYM = { maj: '', major: '', min: 'm', minor: 'm', m: 'm', dom7: '7' };
  const chordName = c => { const r = typeof c.root === 'string' ? c.root : NAMES[((c.pcs && c.pcs[0]) || 0) % 12]; const q = c.quality == null ? 'maj' : c.quality; return r + (q in SYM ? SYM[q] : q); };

  // rows of the header
  let y = 0;
  const rows = {};
  rows.title = y; y += 34;
  if (kind === 'roll') { rows.legend = y; y += 24; }
  if (sections.length) { rows.sec = y; y += 24; }
  if (kind === 'roll' && chords.length) { rows.chord = y; y += 20; }
  rows.bar = y; y += 18;
  if (kind === 'roll') { rows.lint = y; y += 14; }
  y += 4;
  rows.body = y;

  // body geometry
  const pitchedTr = tracks.filter(t => t.role !== 'drums' && t.role !== 'fx' && t.events.some(e => typeof e.n === 'number'));
  let lo = 200, hi = -1;
  for (const t of pitchedTr) for (const e of t.events) if (typeof e.n === 'number') { lo = Math.min(lo, e.n); hi = Math.max(hi, e.n); }
  if (hi < 0) { lo = 48; hi = 72; }
  lo -= 1; hi += 1;
  const semis = hi - lo + 1, PS = Math.max(5, Math.min(12, Math.floor(440 / semis)));
  const DORDER = ['kick', 'snare', 'clap', 'rim', 'hat', 'ohat', 'tom', 'crash'];
  const hits = [];
  for (const t of tracks) for (const e of t.events) if (typeof e.n !== 'number' && t.role !== 'fx') hits.push({ b: e.b, d: e.d || 0, v: e.v == null ? 0.8 : e.v, voice: e.voice || t.t.voice || 'kick' });
  const lanes = [...new Set(hits.map(h => h.voice))].sort((a, b) => (DORDER.indexOf(a) + 1 || 99) - (DORDER.indexOf(b) + 1 || 99));
  const fxTr = tracks.filter(t => t.role === 'fx');
  const LH = 17;
  let H;
  if (kind === 'roll') {
    rows.pitch = rows.body; const pitchH = pitchedTr.length ? semis * PS : 0;
    rows.drums = rows.pitch + pitchH + (pitchH ? 12 : 0);
    const laneRows = lanes.length + fxTr.length;
    rows.energy = rows.drums + laneRows * LH + (laneRows ? 12 : 0);
    rows.eh = sections.some(s => typeof s.energy === 'number') ? 86 : 0;
    rows.axis = rows.energy + (rows.eh ? rows.eh + 10 : 0);
    H = rows.axis + 30;
  } else {
    rows.specH = 560; rows.axis = rows.body + rows.specH + 4; H = rows.axis + 30;
  }

  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.id = 'cv';
  document.body.replaceChildren(cv); document.body.style.margin = '0';
  const ctx = cv.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  const font = (px, w = '') => ctx.font = `${w} ${px}px ${FONT}`.trim();
  const fit = (s, maxW) => { if (ctx.measureText(s).width <= maxW) return s; while (s.length > 1 && ctx.measureText(s + '\u2026').width > maxW) s = s.slice(0, -1); return s.length > 1 ? s + '\u2026' : ''; };
  const text = (s, x, yy, col = C.text, align = 'left', base = 'alphabetic') => { ctx.fillStyle = col; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, yy); };
  const bodyTop = rows.body, bodyBottom = (kind === 'roll' ? rows.axis : rows.body + rows.specH);

  // title
  font(15, 'bold');
  text(P.title, 12, rows.title + 22);
  font(12);
  text(P.subtitle, W - R, rows.title + 22, C.dim, 'right');

  // legend (roll)
  if (rows.legend != null) {
    font(12); let lx = L, ly = rows.legend + 14;
    for (const t of tracks) {
      const col = ROLE[t.role] || ROLE.other; ctx.fillStyle = col; ctx.fillRect(lx, ly - 9, 12, 12);
      const label = t.name === t.role ? t.name : `${t.name} (${t.role})`; text(label, lx + 17, ly, C.text); lx += 17 + ctx.measureText(label).width + 20;
    }
    text('opacity = velocity', lx + 6, ly, C.dim);
    text('warn', W - R, ly, C.dim, 'right'); text('\u25BC', W - R - 34, ly, C.warn, 'right'); text('error', W - R - 46, ly, C.dim, 'right'); text('\u25BC', W - R - 80, ly, C.err, 'right'); text('lint markers:', W - R - 92, ly, C.dim, 'right');
  }

  // section bands (full body height)
  sections.forEach((s, i) => {
    const x0 = X(s.b), x1 = X(s.end);
    ctx.fillStyle = C.band[i % 2]; ctx.fillRect(x0, bodyTop, x1 - x0, bodyBottom - bodyTop);
  });
  // bar grid
  const barPx = PW / T * (60 / bpm) * bpb, beatPx = barPx / bpb;
  const nBars = Math.ceil(P.length / bpb - 1e-6);
  if (beatPx >= 14) { ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1; for (let bt = 0; bt <= nBars * bpb; bt++) { if (bt % bpb) { const x = Math.round(X(bt)) + .5; ctx.beginPath(); ctx.moveTo(x, bodyTop); ctx.lineTo(x, bodyBottom); ctx.stroke(); } } }
  ctx.strokeStyle = C.bar; ctx.lineWidth = 1;
  for (let k = 0; k <= nBars; k++) { const x = Math.round(X(k * bpb)) + .5; ctx.beginPath(); ctx.moveTo(x, rows.bar + 2); ctx.lineTo(x, bodyBottom); ctx.stroke(); }
  // bar numbers
  font(11);
  const step = [1, 2, 4, 8, 16, 32].find(s => barPx * s >= 30) || 32;
  for (let k = 0; k < nBars; k += step) text(String(k + 1), X(k * bpb) + 3, rows.bar + 14, C.dim);
  text('bar', L - 8, rows.bar + 14, C.dim, 'right');

  // section labels + boundaries
  if (rows.sec != null) {
    font(12, 'bold');
    sections.forEach((s, i) => {
      const x0 = X(s.b), x1 = X(s.end), w = x1 - x0;
      ctx.fillStyle = i % 2 ? 'rgba(120,140,190,0.30)' : 'rgba(120,140,190,0.18)'; ctx.fillRect(x0 + 1, rows.sec, w - 2, 20);
      const e = typeof s.energy === 'number' ? ` \u00B7 e ${s.energy.toFixed(2).replace(/0$/, '')}` : '';
      const full = `${s.name}${e}`; let label = ctx.measureText(full).width <= w - 8 ? full : fit(s.name, w - 8);
      text(label, x0 + 5, rows.sec + 14.5, C.text);
    });
    text('section', L - 8, rows.sec + 14.5, C.dim, 'right');
    ctx.strokeStyle = 'rgba(200,215,255,0.35)'; ctx.setLineDash([4, 3]);
    for (const s of sections) { const x = Math.round(X(s.b)) + .5; ctx.beginPath(); ctx.moveTo(x, bodyTop); ctx.lineTo(x, bodyBottom); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  // chords
  if (rows.chord != null) {
    font(12, 'bold');
    for (const c of chords) {
      const x0 = X(c.b), x1 = X(c.b + (c.d == null ? bpb : c.d)), nm = chordName(c);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x0 + 1, rows.chord, x1 - x0 - 2, 17);
      if (ctx.measureText(nm).width + 6 <= x1 - x0) text(nm, (x0 + x1) / 2, rows.chord + 13, C.text, 'center');
    }
    text('chords', L - 8, rows.chord + 13, C.dim, 'right');
  }
  // lint markers
  if (rows.lint != null) {
    for (const f of findings) {
      if (f.b == null || f.severity === 'info') continue;
      const x = X(f.b), yy = rows.lint + 1;
      ctx.fillStyle = f.severity === 'error' ? C.err : C.warn; ctx.beginPath(); ctx.moveTo(x - 4, yy); ctx.lineTo(x + 4, yy); ctx.lineTo(x, yy + 9); ctx.closePath(); ctx.fill();
    }
    text('lint', L - 8, rows.lint + 9, C.dim, 'right');
  }

  const timeAxis = () => {
    font(11);
    const stepS = [1, 2, 5, 10, 15, 30, 60].find(s => s / T * PW >= 56) || 60;
    ctx.strokeStyle = C.bar; ctx.beginPath(); ctx.moveTo(L, rows.axis + .5); ctx.lineTo(L + PW, rows.axis + .5); ctx.stroke();
    for (let s = 0; s <= T + 1e-6; s += stepS) {
      const x = L + s / T * PW; ctx.beginPath(); ctx.moveTo(x, rows.axis); ctx.lineTo(x, rows.axis + 5); ctx.stroke();
      text(`${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`, x, rows.axis + 18, C.dim, 'center');
    }
    text('time', 12, rows.axis + 18, C.dim);
  };

  if (kind === 'roll') {
    // pitch panel
    if (pitchedTr.length) {
      const y0 = rows.pitch, yOf = n => y0 + (hi - n) * PS;
      const black = [1, 3, 6, 8, 10];
      for (let n = lo; n <= hi; n++) {
        if (black.includes(((n % 12) + 12) % 12)) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(L, yOf(n), PW, PS); }
      }
      font(11);
      for (let n = lo; n <= hi; n++) if (n % 12 === 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.moveTo(L, Math.round(yOf(n) + PS) + .5); ctx.lineTo(L + PW, Math.round(yOf(n) + PS) + .5); ctx.stroke();
        text(`C${n / 12 - 1}`, L - 8, yOf(n) + PS - 1, C.dim, 'right');
      }
      ctx.strokeStyle = C.bar; ctx.strokeRect(L + .5, y0 + .5, PW - 1, semis * PS - 1);
      const order = { pad: 0, arp: 1, bass: 2, other: 3, lead: 4 };
      for (const t of pitchedTr.slice().sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3))) {
        const col = ROLE[t.role] || ROLE.other;
        for (const e of t.events) {
          if (typeof e.n !== 'number') continue;
          const v = e.v == null ? 0.8 : e.v, x0 = X(e.b), w = Math.max(2, X(e.b + (e.d || 0.25)) - x0 - 0.8);
          ctx.globalAlpha = (t.role === 'pad' ? 0.75 : 1) * (0.4 + 0.6 * Math.max(0, Math.min(1, v)));
          ctx.fillStyle = col; ctx.fillRect(x0, yOf(e.n) + (t.role === 'pad' ? 1 : 0), w, PS - 1 - (t.role === 'pad' ? 2 : 0));
        }
      }
      ctx.globalAlpha = 1;
      font(11, 'bold'); text('pitch', 12, y0 + 12, C.dim);
    }
    // drum and fx lanes
    let ly = rows.drums;
    const laneBase = (name, col) => {
      ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(L, ly, PW, LH - 2);
      font(11); text(name, L - 8, ly + 12, col, 'right');
    };
    for (const voice of lanes) {
      laneBase(voice, ROLE.drums);
      ctx.fillStyle = ROLE.drums;
      for (const h of hits) if (h.voice === voice) {
        ctx.globalAlpha = 0.4 + 0.6 * Math.max(0, Math.min(1, h.v));
        ctx.fillRect(X(h.b), ly + 1, Math.max(3, Math.min(10, X(h.b + h.d) - X(h.b))), LH - 4);
      }
      ctx.globalAlpha = 1; ly += LH;
    }
    for (const t of fxTr) {
      laneBase(`${t.name} (fx)`, ROLE.fx); ctx.fillStyle = ROLE.fx;
      for (const e of t.events) { ctx.globalAlpha = 0.4 + 0.6 * (e.v == null ? 0.8 : e.v); ctx.fillRect(X(e.b), ly + 1, Math.max(3, X(e.b + (e.d || 0.25)) - X(e.b)), LH - 4); }
      ctx.globalAlpha = 1; ly += LH;
    }
    // energy strip + density
    if (rows.eh) {
      const y0 = rows.energy, h = rows.eh;
      ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(L, y0, PW, h);
      ctx.strokeStyle = C.bar; ctx.strokeRect(L + .5, y0 + .5, PW - 1, h - 1);
      font(11); text('energy', L - 8, y0 + 12, '#7fb2ff', 'right'); text('density', L - 8, y0 + 26, '#ffd23f', 'right');
      const maxD = Math.max(0.001, ...(stats.sections || []).map(s => s.notesPerBeat));
      sections.forEach((s, i) => {
        if (typeof s.energy !== 'number') return;
        const x0 = X(s.b), x1 = X(s.end), eh = s.energy * (h - 22);
        ctx.fillStyle = 'rgba(80,140,230,0.55)'; ctx.fillRect(x0 + 1, y0 + h - 2 - eh, x1 - x0 - 2, eh);
        ctx.fillStyle = '#9cc4ff'; ctx.fillRect(x0 + 1, y0 + h - 2 - eh, x1 - x0 - 2, 2);
        const sd = (stats.sections || [])[i];
        if (sd) { const yy = y0 + h - 2 - (sd.notesPerBeat / maxD) * (h - 22); ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x0 + 3, yy); ctx.lineTo(x1 - 3, yy); ctx.stroke(); ctx.lineWidth = 1; { font(11); const full = `${sd.notesPerBeat.toFixed(1)} notes/beat`; text(ctx.measureText(full).width <= x1 - x0 - 8 ? full : sd.notesPerBeat.toFixed(1), x0 + 5, y0 + 13, '#ffd23f'); } }
      });
    }
    timeAxis();
  } else {
    // spectrogram: image from ffmpeg (log frequency 20 Hz .. Nyquist, exact axis)
    const img = window.__specImg, y0 = rows.body, h = rows.specH, nyq = P.sampleRate / 2;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const iw = Math.min(PW, P.audioSec / T * PW);
    ctx.drawImage(img, L, y0, iw, h);
    const fy = f => y0 + h * (1 - Math.log(f / 20) / Math.log(nyq / 20));
    font(11);
    for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      if (f > nyq) continue;
      const yy = Math.round(fy(f)) + .5;
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + PW, yy); ctx.stroke();
      text(f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`, L - 8, Math.min(y0 + h - 2, Math.max(y0 + 10, yy + 4)), C.dim, 'right');
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    for (let k = 0; k <= nBars; k++) { const x = Math.round(X(k * bpb)) + .5; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.setLineDash([5, 4]);
    for (const s of sections) { const x = Math.round(X(s.b)) + .5; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.strokeStyle = C.bar; ctx.strokeRect(L + .5, y0 + .5, PW - 1, h - 1);
    // section loudness pills at the bottom of every section
    font(12, 'bold');
    for (const s of sectionLoud || []) {
      const x0 = X(s.b), x1 = X(s.end); if (x1 - x0 < 30) continue;
      const label = s.I == null ? 'silent' : `${s.I.toFixed(1)} LUFS`, tw = ctx.measureText(label).width + 12, cx = Math.min((x0 + x1) / 2, L + PW - tw / 2 - 2);
      if (tw > x1 - x0 + 30) continue;
      ctx.fillStyle = 'rgba(10,12,18,0.82)'; ctx.fillRect(cx - tw / 2, y0 + h - 26, tw, 20);
      text(label, cx, y0 + h - 12, '#ffffff', 'center');
    }
    text('freq', 12, y0 + 14, C.dim);
    timeAxis();
  }
  return { w: W, h: H };
}

// ---------------------------------------------------------------- audio analysis (ffmpeg)
async function probeAudio(wav) {
  const j = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate:format=duration', '-of', 'json', wav])).so);
  return { duration: parseFloat(j.format.duration), sampleRate: 44100 };
}
async function ebur(wav, t0, dur) {
  const seg = t0 == null ? [] : ['-ss', String(t0), '-t', String(dur)];
  const { se } = await run('ffmpeg', ['-hide_banner', '-nostats', ...seg, '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const num = s => s == null || /inf/.test(s) ? null : parseFloat(s);
  const I = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+|-?inf)/.exec(se), LRA = /LRA:\s*(-?[\d.]+)\s*LU/.exec(se), TP = /True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-?inf)/.exec(se);
  let Smax = null;
  for (const m of se.matchAll(/M:\s*(-?[\d.]+)\s+S:\s*(-?[\d.]+)/g)) { const s = parseFloat(m[2]); if (s > -100 && (Smax == null || s > Smax)) Smax = s; }
  let Iv = I ? num(I[1]) : null; if (Iv != null && Iv <= -69.9) Iv = null;
  return { I: Iv, LRA: LRA ? parseFloat(LRA[1]) : null, TP: TP ? num(TP[1]) : null, S: Smax };
}

// ---------------------------------------------------------------- main
let browser;
try {
  const launchOpts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
  let score, wav = wavArg ? path.resolve(wavArg) : null, name = path.basename(input);
  const isHtml = /\.html?$/i.test(input);
  browser = await chromium.launch({ ...launchOpts, args: ['--force-color-profile=srgb', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'] });
  if (isHtml) {
    const page = await browser.newPage();
    page.on('pageerror', e => console.error('[page]', e.message));
    await page.goto(pathToFileURL(path.resolve(input)).href + '?render');
    await page.waitForFunction(() => window.__ready === true || window.__score, null, { timeout: 120000 });
    score = await page.evaluate(() => window.__score);
    if (!score) throw new Error('the page does not expose window.__score (a Score)');
    if (!wav) {
      if (await page.evaluate(() => typeof window.__renderAudio === 'function')) {
        process.stdout.write('rendering audio... ');
        const b64 = await page.evaluate(async () => await window.__renderAudio());
        if (b64) { wav = rel('audio.wav'); fs.writeFileSync(wav, Buffer.from(b64, 'base64')); console.log(wav); }
        else console.log('the page returned no audio');
      } else console.log('note: the page has no window.__renderAudio(): only the piano roll and the lint');
    }
    await page.close();
  } else {
    const j = JSON.parse(fs.readFileSync(input, 'utf8'));
    score = j.score && j.score.tracks ? j.score : j;
  }

  // lint
  const lint = ML.lint(score);
  const bpm = score.bpm || 120, bpb = score.beatsPerBar || 4, secOf = b => b * 60 / bpm;
  fs.writeFileSync(rel('lint.json'), JSON.stringify(lint, null, 2));

  // audio
  let audio = null, sectionLoud = [], overall = null, specRaw = null;
  const sections = (score.sections || []).map(s => ({ ...s, end: s.b + (s.bars || 1) * bpb })).sort((a, b) => a.b - b.b);
  if (wav) {
    const pr = await probeAudio(wav);
    audio = { file: wav, seconds: pr.duration, sampleRate: pr.sampleRate };
    overall = await ebur(wav);
    const segs = sections.length ? sections : [{ name: 'whole', b: 0, end: (lint.stats.length || 1) }];
    for (const s of segs) {
      const t0 = secOf(s.b), t1 = Math.min(secOf(s.end), pr.duration);
      if (t1 - t0 < 0.5) { sectionLoud.push({ name: s.name, b: s.b, end: s.end, I: null, S: null, TP: null, LRA: null, short: true }); continue; }
      sectionLoud.push({ name: s.name, b: s.b, end: s.end, ...await ebur(wav, t0, t1 - t0) });
    }
  }
  const scoreSec = secOf(lint.stats.length);
  const T = Math.max(scoreSec, audio ? audio.seconds : 0, 1);

  // spectrogram raw image
  if (audio) {
    specRaw = rel('.spectrogram-raw.png');
    const wpx = Math.max(200, Math.round((1920 - 190 - 24) * audio.seconds / T));
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-ar', String(audio.sampleRate), '-lavfi',
      `showspectrumpic=s=${wpx}x1536:legend=0:fscale=log:color=intensity:scale=log:drange=100`, '-frames:v', '1', specRaw]);
  }

  // pictures
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('[page]', e.message));
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
  const ok = lint.stats.counts;
  const title = `${name} \u2014 ${bpm} bpm \u00B7 ${lint.stats.key || 'key ?'} \u00B7 ${lint.stats.bars} bars \u00B7 ${lint.stats.seconds.toFixed(1)} s`;
  const subtitle = `lint ${lint.score}/100: ${ok.error} errors, ${ok.warn} warnings, ${ok.info} infos`;
  const shot = async (P, file) => {
    const size = await page.evaluate(draw, P);
    await page.setViewportSize({ width: 1920, height: Math.max(200, size.h) });
    await page.locator('#cv').screenshot({ path: file });
    return file;
  };
  const base = { score, findings: lint.findings, stats: lint.stats, T, length: lint.stats.length, title, subtitle };
  await shot({ ...base, kind: 'roll' }, rel('piano-roll.png'));
  if (audio) {
    const b64 = fs.readFileSync(specRaw).toString('base64');
    const P = { ...base, kind: 'spec', audioSec: audio.seconds, sampleRate: audio.sampleRate, sectionLoud, subtitle: `audio ${audio.seconds.toFixed(1)} s \u00B7 ${overall && overall.I != null ? overall.I.toFixed(1) + ' LUFS' : 'silent'}` };
    // the image is decoded inside the page (window.__specImg) before drawing
    await page.evaluate(async d => { const im = new Image(); im.src = d; await im.decode(); window.__specImg = im; }, 'data:image/png;base64,' + b64);
    const size = await page.evaluate(draw, P);
    await page.setViewportSize({ width: 1920, height: Math.max(200, size.h) });
    await page.locator('#cv').screenshot({ path: rel('spectrogram.png') });
    fs.rmSync(specRaw, { force: true });
  }
  await page.close();

  // report.md
  const f1 = x => x == null ? '-' : x.toFixed(1);
  const beatOf = b => Math.round((((b % bpb) + bpb) % bpb + 1) * 100) / 100;
  const L = [];
  L.push(`# Music report: ${name}`, '', `${lint.stats.key || 'key unknown'}, ${bpm} bpm, ${bpb}/4, ${lint.stats.bars} bars, ${lint.stats.seconds.toFixed(1)} s.`, '',
    `**Lint score ${lint.score} / 100**: ${ok.error} errors, ${ok.warn} warnings, ${ok.info} infos.`, '');
  L.push('## Findings', '');
  if (!lint.findings.length) L.push('No findings.', '');
  for (const sev of ['error', 'warn', 'info']) {
    const list = lint.findings.filter(f => f.severity === sev);
    if (!list.length) continue;
    L.push(`### ${sev === 'error' ? 'Errors' : sev === 'warn' ? 'Warnings' : 'Infos'} (${list.length})`, '', '| bar | beat | track | rule | what to do |', '|---|---|---|---|---|');
    for (const f of list) L.push(`| ${f.bar == null ? '-' : f.bar} | ${f.b == null ? '-' : beatOf(f.b)} | ${f.track || '-'} | ${f.rule} | ${f.message.replace(/\|/g, '/')} |`);
    L.push('');
  }
  L.push('## Summary', '', '```', ML.describe(score), '```', '');
  L.push('## Tracks', '', '| track | role | events | pitch | velocity stdev | unique bars |', '|---|---|---|---|---|---|');
  for (const [n, t] of Object.entries(lint.stats.tracks)) L.push(`| ${n} | ${t.role} | ${t.events} | ${t.minPitch == null ? '-' : ML.noteName(t.minPitch) + '..' + ML.noteName(t.maxPitch)} | ${t.velStdev} | ${t.uniqueBars == null ? '-' : Math.round(t.uniqueBars * 100) + '%'} |`);
  L.push('');
  if (lint.stats.sections.length) {
    L.push('## Sections', '', '| section | bars | energy | notes/beat | layers |' + (audio ? ' LUFS (integrated) | max short-term | true peak dB |' : ''), '|---|---|---|---|---|' + (audio ? '---|---|---|' : ''));
    lint.stats.sections.forEach((s, i) => {
      const m = sectionLoud[i];
      L.push(`| ${s.name} | ${Math.floor(s.b / bpb) + 1}-${Math.floor(s.b / bpb) + s.bars} | ${s.energy == null ? '-' : s.energy} | ${s.notesPerBeat} | ${s.layerCount}: ${s.layers.join(', ')} |` + (audio ? ` ${m && m.I != null ? f1(m.I) : m && m.short ? 'too short' : 'silent'} | ${m ? f1(m.S) : '-'} | ${m ? f1(m.TP) : '-'} |` : ''));
    });
    L.push('');
  }
  if (audio) {
    L.push('## Loudness', '', `Whole track: integrated ${f1(overall.I)} LUFS, loudness range ${f1(overall.LRA)} LU, true peak ${f1(overall.TP)} dBTP, max short-term ${f1(overall.S)} LUFS (${audio.seconds.toFixed(1)} s of audio).`, '',
      'Short-term is measured over 3 s windows, so it is empty for sections shorter than 3 s. The music of a film is usually mixed around -18 to -14 LUFS with true peaks below -1 dBTP; a chorus that is not at least 2 to 3 LU louder than the verse does not feel like a lift.', '');
  } else L.push('## Loudness', '', 'No audio: pass `--wav file.wav`, or a film page that exposes `window.__renderAudio()`.', '');
  L.push('## Images', '', '- `piano-roll.png`: pitch of the pitched tracks by role, one lane per drum voice, chords, sections with energy, lint markers, energy and density strip.');
  if (audio) L.push('- `spectrogram.png`: log-frequency spectrogram with section boundaries and integrated loudness per section.', '- `audio.wav`' + (isHtml && !wavArg ? ': the audio rendered from the page.' : ' is not copied; the analysed file is ' + audio.file));
  L.push('- `lint.json`: the same findings for machines.', '');
  fs.writeFileSync(rel('report.md'), L.join('\n'));

  console.log(`lint ${lint.score}/100: ${ok.error} errors, ${ok.warn} warnings, ${ok.info} infos`);
  for (const f of ['report.md', 'lint.json', 'piano-roll.png', ...(audio ? ['spectrogram.png'] : [])]) console.log('  ' + rel(f));
  await browser.close();
  process.exit(ok.error ? 1 : 0);
} catch (e) {
  console.error(e && e.stack || e);
  try { await browser?.close(); } catch {}
  process.exit(2);
}
