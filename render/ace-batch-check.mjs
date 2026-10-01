// Summarize an ace-gen.py batch: for each take, loudness, the tempo grid-check.mjs --fit finds vs the requested BPM (and how far
// the take slips against the requested grid over its length), the pulse contrast, beatmap.mjs drift; also writes an MP3 next to each WAV for listening.
// Usage: node render/ace-batch-check.mjs local/ace-out/genres-report.json     (the report written by ace-gen.py)
// fitted: the constant tempo (within +-3 bpm of the request) that puts the pulse on a grid. slip_s: seconds the take drifts from the requested grid by its end.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!Array.isArray(report)) report = report.takes.map(t => ({ name: path.basename(process.argv[2]).replace(/-report\.json$/, ''), bpm: report.bpm, duration: report.duration, ...t }));   // the older single-job report
import { fileURLToPath } from 'node:url';
const R = path.dirname(fileURLToPath(import.meta.url)), outDir = path.dirname(process.argv[2]);
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const rows = [];
for (const t of report) {
  if (!t.ok) { rows.push({ name: t.name, seed: t.seed, note: 'FAILED: ' + t.error }); continue; }
  const wav = path.join(outDir, path.basename(t.files[0])), mp3 = wav.replace(/\.wav$/, '.mp3');
  if (!fs.existsSync(mp3)) run('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-b:a', '192k', mp3]);
  const eb = run('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr;
  const lufs = (/I:\s+(-?[\d.]+) LUFS/.exec(eb.slice(eb.lastIndexOf('Summary'))) || [])[1], lra = (/LRA:\s+([\d.]+) LU/.exec(eb.slice(eb.lastIndexOf('Summary'))) || [])[1];
  const gc = run('node', [path.join(R, 'grid-check.mjs'), wav, '--bpm', String(t.bpm), '--sections', `all:${Math.floor(t.duration / (240 / t.bpm))}`, '--fit']).stdout;
  const fit = /tempo fit: ([\d.]+) bpm .*?contrast ([\d.]+) dB at the fit, (-?[\d.]+) dB at the request/.exec(gc) || [];
  const bm = run('node', [path.join(R, 'beatmap.mjs'), wav, wav.replace(/\.wav$/, '.beats.json')]), bmOut = bm.stdout + bm.stderr;
  const drift = (/drift of the map from the tracked beats: (\d+) ms/.exec(bmOut) || [])[1];
  const fitted = fit[1] ? Number(fit[1]) : null, off = fitted ? fitted - t.bpm : null;
  // over the whole take a tempo that is off by dBpm slips by dBpm / bpm * duration seconds against the requested grid
  rows.push({ name: t.name, seed: t.seed, bpm: t.bpm, fitted: fitted ?? '?', slip_s: off === null ? '?' : Math.abs(off / t.bpm * t.duration).toFixed(2), pulse_dB: fit[2] ?? '?', lufs, lra, drift: drift ? drift + ' ms' : '?', sec: t.seconds });
}
const cols = ['name', 'seed', 'bpm', 'fitted', 'slip_s', 'pulse_dB', 'lufs', 'lra', 'drift', 'sec', 'note'];
console.log(cols.join('\t'));
for (const r of rows) console.log(cols.map(c => r[c] ?? '').join('\t'));
