// Turns a music track into a tempo map the film can be cut to: beats, downbeats and a
// runtime/film.js tempo spec [{bar, bpm}]. With --trim, also writes the track cut so that the first
// downbeat is at 0:00, so the film's bar 1 starts with the music.
// Usage: node beatmap.mjs <track> [out.json] [--trim track-trimmed.wav] [--bpb 4] [--tol 1.5]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { decodePCM, onsetEnvelope, onsetPeaks, localTempo, tempoCurve, trackBeats, loudness, median, fmtTime } from './audio-analysis.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const trim = opt('--trim', null), BPB = parseInt(opt('--bpb', '4'), 10), TOL = parseFloat(opt('--tol', '1.5')) / 100;
const [input, outArg] = args;
if (!input) { console.error('usage: node beatmap.mjs <track> [out.json] [--trim trimmed.wav] [--bpb 4] [--tol 1.5]'); process.exit(1); }
const out = outArg || input.replace(/\.[^.]+$/, '') + '.beats.json';

const sr = 11025, x = await decodePCM(input, sr), DUR = x.length / sr;
const { env, low, fps } = onsetEnvelope(x, sr, { win: 512 });
const tempo = localTempo(env, fps), beats = trackBeats(env, fps, tempoCurve(tempo));
if (beats.length < BPB * 2) { console.error('too few beats found: is this music with a pulse?'); process.exit(1); }

// downbeat: the beat phase (mod bpb) with the most low-end energy (kick and bass land on "one")
const lowAt = t => { const i = Math.round(t * fps); let s = 0; for (let j = Math.max(0, i - 2); j <= Math.min(low.length - 1, i + 2); j++) s += low[j]; return s; };
let phase = 0, best = -1;
for (let k = 0; k < BPB; k++) { let s = 0, n = 0; for (let i = k; i < beats.length; i += BPB) { s += lowAt(beats[i]); n++; } if (s / n > best) { best = s / n; phase = k; } }
const offset = beats[phase], grid = beats.slice(phase).map(b => b - offset);

// tempo per bar, then merge bars into constant-tempo segments
const bars = [];
for (let i = 0; i + BPB < grid.length; i += BPB) bars.push({ bar: i / BPB, bpm: 60 * BPB / (grid[i + BPB] - grid[i]) });
const sm = bars.map((b, i) => ({ bar: b.bar, bpm: median(bars.slice(Math.max(0, i - 1), i + 2).map(q => q.bpm)) }));
const segs = [];
for (const b of sm) {
  const cur = segs[segs.length - 1];
  if (cur && Math.abs(b.bpm - cur.mean) / cur.mean < TOL) { cur.vals.push(b.bpm); cur.mean = median(cur.vals); }
  else segs.push({ bar: b.bar, vals: [b.bpm], mean: b.bpm });
}
const spec = segs.map(s => ({ bar: s.bar, bpm: +s.mean.toFixed(2) }));

// how far the constant-tempo map drifts from the tracked beats
const bpmAtBar = bar => { let v = spec[0].bpm; for (const s of spec) if (bar >= s.bar) v = s.bpm; return v; };
let t = 0, drift = 0; const mapped = [0];
for (let i = 1; i < grid.length; i++) { t += 60 / bpmAtBar(Math.floor((i - 1) / BPB)); mapped.push(t); drift = Math.max(drift, Math.abs(t - grid[i])); }

const loud = loudness(x, sr, 1), medDb = median(loud.map(l => l.db));
const hits = onsetPeaks(env, fps, { k: 2.2, minGap: .4 }).map(o => +(o.t - offset).toFixed(3)).filter(v => v >= 0);
const result = {
  file: path.basename(input), duration: +DUR.toFixed(3), offset: +offset.toFixed(3), beatsPerBar: BPB,
  tempo: spec, bars: Math.floor(grid.length / BPB), maxDriftMs: Math.round(drift * 1000),
  beats: grid.map(b => +b.toFixed(3)), downbeats: grid.filter((_, i) => i % BPB === 0).map(b => +b.toFixed(3)),
  quiet: loud.filter(l => l.db < medDb - 8).map(l => +(l.t - offset).toFixed(1)).filter(v => v >= 0),
  hits,
};
fs.writeFileSync(out, JSON.stringify(result, null, 1));

console.log(`${input}: ${fmtTime(DUR)}, ${beats.length} beats, first downbeat at ${offset.toFixed(3)} s, ${result.bars} bars`);
console.log(`tempo map (film.js): ${JSON.stringify(spec)}`);
console.log(`max drift of the map from the tracked beats: ${result.maxDriftMs} ms${result.maxDriftMs > 40 ? '  (large: the track is not on a steady grid; cut to result.beats instead)' : ''}`);
console.log(`written: ${out}`);

if (trim) {
  await new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', '-ss', String(offset), '-i', input, '-ar', '48000', '-ac', '2', trim], { stdio: 'inherit' });
    p.on('close', c => c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`)));
  });
  console.log(`trimmed track: ${trim} (bar 1 at 0:00; render with --music ${trim})`);
}
