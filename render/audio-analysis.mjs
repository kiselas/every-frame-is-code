// Audio analysis shared by analyze.mjs and beatmap.mjs: decoding through ffmpeg, an onset envelope
// (spectral flux), onset peaks, local tempo, a dynamic-programming beat tracker and loudness.
// No dependencies besides ffmpeg on PATH.
import { spawn } from 'node:child_process';

export function decodePCM(file, sr = 11025) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const parts = [];
    p.stdout.on('data', d => parts.push(d));
    p.on('error', rej);
    p.on('close', c => {
      if (c !== 0) return rej(new Error(`ffmpeg exit ${c} while decoding ${file}`));
      const b = Buffer.concat(parts);
      res(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)));
    });
  });
}

function fft(re, im) {                       // in place, radix-2, length = power of two
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Spectral flux on a log-magnitude spectrum, 100 frames per second by default.
// Returns the full-band envelope and a low-band one (kicks, bass) used to find downbeats.
export function onsetEnvelope(x, sr, { fps = 100, win = 1024 } = {}) {
  const hop = Math.round(sr / fps), n = Math.floor((x.length - win) / hop) + 1;
  const env = new Float32Array(Math.max(0, n)), low = new Float32Array(Math.max(0, n));
  const hann = Float64Array.from({ length: win }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / win));
  const lowBin = Math.round(180 / (sr / win));
  let prev = new Float64Array(win / 2);
  const re = new Float64Array(win), im = new Float64Array(win);
  for (let f = 0; f < n; f++) {
    for (let i = 0; i < win; i++) { re[i] = x[f * hop + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    let s = 0, sl = 0; const cur = new Float64Array(win / 2);
    for (let k = 1; k < win / 2; k++) { const m = Math.log1p(10 * Math.hypot(re[k], im[k])); cur[k] = m; const d = m - prev[k]; if (d > 0) { s += d; if (k <= lowBin) sl += d; } }
    env[f] = s; low[f] = sl; prev = cur;
  }
  return { env, low, fps };
}

// Local peaks above a moving threshold, at least minGap seconds apart
export function onsetPeaks(env, fps, { k = 1.5, minGap = .08, span = .5 } = {}) {
  const w = Math.round(span * fps), out = [];
  let mean = 0; for (const v of env) mean += v; mean /= env.length || 1;
  let last = -1e9;
  for (let i = 1; i < env.length - 1; i++) {
    let s = 0, c = 0; for (let j = Math.max(0, i - w); j < Math.min(env.length, i + w); j++) { s += env[j]; c++; }
    const thr = s / c * k + mean * .2;
    if (env[i] > thr && env[i] >= env[i - 1] && env[i] >= env[i + 1] && i / fps - last >= minGap) { out.push({ t: i / fps, s: env[i] }); last = i / fps; }
  }
  return out;
}

// Tempo of one stretch of the envelope by autocorrelation, folded into [lo, hi] BPM
export function tempoOf(env, fps, a = 0, b = env.length, { lo = 80, hi = 180 } = {}) {
  const seg = env.slice(a, b), n = seg.length; if (n < fps * 2) return null;
  let m = 0; for (const v of seg) m += v; m /= n;
  const ac = lag => { let s = 0; for (let i = lag; i < n; i++) s += (seg[i] - m) * (seg[i - lag] - m); return s / (n - lag); };
  const L0 = Math.floor(60 / hi * fps), L1 = Math.ceil(60 / lo * fps);
  let best = L0, bv = -Infinity;
  for (let L = L0; L <= L1; L++) { const v = ac(L) + .5 * ac(2 * L) + .25 * (L % 2 ? 0 : ac(L / 2)); if (v > bv) { bv = v; best = L; } }
  // parabolic refinement of the peak
  const y0 = ac(best - 1), y1 = ac(best), y2 = ac(best + 1), d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
  return 60 * fps / (best + (Math.abs(d) < 1 ? d : 0));
}

export function localTempo(env, fps, { win = 8, step = 4, lo = 80, hi = 180 } = {}) {
  const out = [];
  for (let t = 0; t + win <= env.length / fps + 1e-9; t += step) { const bpm = tempoOf(env, fps, Math.round(t * fps), Math.round((t + win) * fps), { lo, hi }); if (bpm) out.push({ t: t + win / 2, bpm }); }
  return out;
}

// local tempo as a function of time, linearly interpolated between windows
export function tempoCurve(tempo, fallback = 120) {
  if (!tempo.length) return () => fallback;
  return t => {
    if (t <= tempo[0].t) return tempo[0].bpm;
    for (let i = 1; i < tempo.length; i++) if (t < tempo[i].t) { const a = tempo[i - 1], b = tempo[i], p = (t - a.t) / (b.t - a.t); return a.bpm + (b.bpm - a.bpm) * p; }
    return tempo[tempo.length - 1].bpm;
  };
}

// How firmly events (cuts) are locked to a beat grid. Each event gets a phase 0..1 inside its beat.
// R is the circular concentration of phases (1 = every cut at the same phase, random ≈ 1/sqrt(n)).
// The tracker may put "one" on the offbeat, so the share is counted around the dominant phase:
// random events land within ±0.1 of any phase 20% of the time.
export function gridFit(events, beats) {
  if (beats.length < 2) return null;
  const ph = [];
  for (const t of events) { const i = beats.findIndex(b => b > t); if (i >= 1) ph.push((t - beats[i - 1]) / (beats[i] - beats[i - 1])); }
  if (!ph.length) return null;
  let c = 0, s = 0; for (const p of ph) { c += Math.cos(2 * Math.PI * p); s += Math.sin(2 * Math.PI * p); }
  const R = Math.hypot(c, s) / ph.length, phase = ((Math.atan2(s, c) / (2 * Math.PI)) + 1) % 1;
  const dist = p => { const d = Math.abs(p - phase) % 1; return Math.min(d, 1 - d); };
  return { R, phase, locked: ph.filter(p => dist(p) < .1).length / ph.length, n: ph.length, chanceR: 1 / Math.sqrt(ph.length) };
}

// Ellis-style beat tracking: each frame's score is its onset strength plus the best score one
// beat period earlier, penalized for deviating from the local tempo. Backtrack from the best end.
export function trackBeats(env, fps, tempoAt, { tight = 100 } = {}) {
  const n = env.length; let mean = 0, sd = 0;
  for (const v of env) mean += v; mean /= n; for (const v of env) sd += (v - mean) ** 2; sd = Math.sqrt(sd / n) || 1;
  const o = Float64Array.from(env, v => (v - mean) / sd);
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const P = 60 * fps / tempoAt(i / fps); let best = 0, arg = -1;
    for (let p = Math.round(P / 2); p <= Math.round(P * 2); p++) {
      const j = i - p; if (j < 0) break;
      const v = score[j] - tight * Math.log(p / P) ** 2;
      if (arg < 0 || v > best) { best = v; arg = j; }
    }
    score[i] = o[i] + (arg >= 0 ? best : 0); back[i] = arg;
  }
  const tailFrom = Math.max(0, n - Math.round(60 * fps / tempoAt(n / fps)));
  let i = tailFrom; for (let k = tailFrom; k < n; k++) if (score[k] > score[i]) i = k;
  const beats = []; while (i >= 0) { beats.push(i / fps); i = back[i]; }
  return beats.reverse();
}

// RMS loudness in dBFS per window
export function loudness(x, sr, win = 2) {
  const n = Math.round(win * sr), out = [];
  for (let a = 0; a < x.length; a += n) { let s = 0; const b = Math.min(x.length, a + n); for (let i = a; i < b; i++) s += x[i] * x[i]; out.push({ t: a / sr, db: 10 * Math.log10(s / Math.max(1, b - a) + 1e-12) }); }
  return out;
}

export const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const fmtTime = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
