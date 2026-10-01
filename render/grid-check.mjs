// Checks that a GENERATED track sits on its bar grid, for an agent that cannot listen. For a track whose tempo you chose
// (strudel-render at a known BPM), not for a found track: for that, use beatmap.mjs.
//   per section : level, low-band level (is there a kick/bass?), kick phase against the ideal grid
//   at the end  : the lag of the kick behind the grid (a sample's own attack), the one-beat gap before a drop, a riser ramp
// Usage: node grid-check.mjs track.wav --bpm 124 --sections intro:8,build:8,drop:16,break:8,drop2:16,outro:8 [--riser build,break] [--fit]
// --fit: for a track from a MODEL (ace-gen.py), whose tempo is only about the requested one: find the constant tempo within +-3 bpm that
//        puts the eighth-note pulse on a grid for the whole track, and check the sections against that tempo.
// Needs ffmpeg on PATH.
import { spawnSync } from 'node:child_process';
import { onsetEnvelope } from './audio-analysis.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const FIT = args.includes('--fit'); if (FIT) args.splice(args.indexOf('--fit'), 1);
let BPM = parseFloat(opt('--bpm', '120')), SECS = opt('--sections', ''), RISERS = (opt('--riser', '') || '').split(',').filter(Boolean);
const file = args[0];
if (!file || !SECS) { console.error('usage: node grid-check.mjs track.wav --bpm 124 --sections intro:8,build:8,drop:16 [--riser build,break]'); process.exit(1); }

let beat = 60 / BPM, bar = beat * 4;
const sr = 16000;
const secs = SECS.split(',').map(s => { const [name, bars] = s.split(':'); return { name, bars: parseInt(bars, 10) }; });
const dec = (af, rate = sr) => {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), ...(af ? ['-af', af] : []), '-f', 'f32le', '-'], { maxBuffer: 1 << 29 });
  if (r.status !== 0) { console.error('ffmpeg failed: ' + (r.stderr || '').toString().slice(0, 300)); process.exit(1); }
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
};
const full = dec(''), low = dec('lowpass=f=120'), high = dec('highpass=f=6000');
const rms = (x, t0, t1) => { const a = Math.floor(t0 * sr), b = Math.min(x.length, Math.floor(t1 * sr)); let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return b > a ? Math.sqrt(s / (b - a)) : 0; };
const db = v => 20 * Math.log10(v || 1e-9);
const win = (x, t) => { const a = Math.floor(t * sr), b = a + Math.floor(.012 * sr); let s = 0; for (let i = a; i < b && i < x.length; i++) s += x[i] * x[i]; return s; };
// the energy of the low band in a 12 ms window at every beat of [t0, t0 + n beats) shifted by `lag`, averaged
const atGrid = (t0, n, lag) => { let s = 0; for (let k = 0; k < n; k++) s += win(low, t0 + k * beat + lag); return s / n; };
// the same on the onset envelope (spectral flux, 100 fps), on the EIGHTH-note grid: in house the offbeat hat is as strong an
// onset as the kick, so the test is "eighths vs the sixteenth positions between them", and the phase is found within half a beat
const { env: onset, fps } = onsetEnvelope(dec('', 11025), 11025, { win: 512 });
const onsetAt = t => { const i = Math.round(t * fps); let s = 0; for (let j = i - 1; j <= i + 1; j++) if (j >= 0 && j < onset.length) s += onset[j]; return s; };
const onsetGrid = (t0, n, lag) => { let s = 0; for (let k = 0; k < 2 * n; k++) s += onsetAt(t0 + k * beat / 2 + lag); return s / (2 * n); };
const phase = (fn, t0, n, span, off) => { let best = -1, lag = 0; for (let ms = Math.round(-span * 1000); ms <= Math.round(span * 1000); ms += 2) { const e = fn(t0, n, ms / 1000); if (e > best) { best = e; lag = ms; } } return { best, lag, mid: fn(t0, n, lag / 1000 + off) }; };

// tempo fit: the contrast of "eighths vs the points halfway between them" over the whole track, for tempos around the requested one
const REQUESTED = BPM;
if (FIT) {
  const contrast = bpm => { beat = 60 / bpm; const n = Math.floor(onset.length / fps / beat) - 2, { best, mid } = phase(onsetGrid, 0, n, beat / 4, beat / 4); return 10 * Math.log10(best / (mid || 1e-12)); };
  let bestBpm = REQUESTED, bestC = -99; for (let b = REQUESTED - 3; b <= REQUESTED + 3.001; b += .05) { const c = contrast(b); if (c > bestC) { bestC = c; bestBpm = b; } }
  const atRequest = contrast(REQUESTED);
  BPM = Math.round(bestBpm * 100) / 100; beat = 60 / BPM; bar = beat * 4;
  console.log(`tempo fit: ${BPM.toFixed(2)} bpm for a request of ${REQUESTED} (pulse contrast ${bestC.toFixed(1)} dB at the fit, ${atRequest.toFixed(1)} dB at the request). Use ${BPM.toFixed(2)} in Film.create({ tempo }).
`);
}

console.log(`${file}: ${(full.length / sr).toFixed(2)} s, grid ${BPM} bpm (beat ${beat.toFixed(4)} s, bar ${bar.toFixed(4)} s)\n`);
console.log('section    start s  bars   level dBFS  low dBFS  beat on-grid vs halfway dB');
let b = 0; const lags = [], start = {}, vias = new Set();
for (const s of secs) {
  const t0 = b * bar, t1 = (b + s.bars) * bar; start[s.name] = { t0, t1, bars: s.bars };
  // first the low band (a kick that pulses the sub: the phase is searched over a whole beat, a generated track may start
  // anywhere in the bar), then the onset envelope on eighths (any mix with a pulse: a held bass hides the kick in the low band)
  const lowDb = db(rms(low, t0, t1));
  let { best, lag, mid } = phase(atGrid, t0, s.bars * 4, beat / 2, beat / 2), ratio = 10 * Math.log10(best / (mid || 1e-12)), via = 'low band';
  if (!(lowDb > -30 && ratio > 6)) { ({ best, lag, mid } = phase(onsetGrid, t0, s.bars * 4, beat / 4, beat / 4)); ratio = 10 * Math.log10(best / (mid || 1e-12)); via = 'onsets'; }
  const hasKick = ratio > 3; if (hasKick) { lags.push(lag); vias.add(via); }
  console.log(`${s.name.padEnd(9)} ${t0.toFixed(2).padStart(8)} ${String(s.bars).padStart(5)} ${db(rms(full, t0, t1)).toFixed(1).padStart(10)} ${lowDb.toFixed(1).padStart(9)}  ${hasKick ? ratio.toFixed(1).padStart(8) + '  (lag ' + lag + ' ms, ' + via + ')' : '   no pulse'}`);
  b += s.bars;
}
const lag = lags.length ? lags.sort((x, y) => x - y)[Math.floor(lags.length / 2)] : null;
const shift = lag === null ? 0 : lag < 0 ? lag / 1000 + beat : lag / 1000;                                                   // how much to cut from the start so that a beat lands on 0
if (lag === null) console.log('\nno pulse found on the grid: check the pattern or the --bpm (for a model take: --fit)');
else if (vias.has('onsets')) console.log(`\nthe pulse sits ${lag} ms from the grid, known only modulo an eighth (it was found in the onsets, not in a kick): the downbeat is what "node beatmap.mjs track.wav out.json --trim trimmed.wav" finds`);
else console.log(`\nkick lag behind the grid: ${lag} ms${Math.abs(lag) > 100 ? ' (the track does not start on a beat)' : " (a sample's own attack)"}. ${Math.abs(lag) > 20 ? `Cut the start: ffmpeg -ss ${shift.toFixed(3)} -i track.wav track-shifted.wav` : 'Within one frame: nothing to do.'}`);
// every seam: does the rhythm section (the low band: kick and bass; the full band: also clap, hats, stabs) stop for the last beat?
// A riser and a pad are long sounds that carry over the seam on purpose, so the full band can stay up where only they play.
for (let i = 0; i < secs.length - 1; i++) {
  const s = start[secs[i].name], t = s.t1 - bar;
  const fb = [2, 3].map(k => db(rms(full, t + k * beat + .03, t + (k + 1) * beat))), lb = [2, 3].map(k => db(rms(low, t + k * beat + .03, t + (k + 1) * beat)));
  const gap = lb[0] > -40 && lb[1] < lb[0] - 10 || fb[1] < fb[0] - 6;
  console.log(`seam ${secs[i].name} -> ${secs[i + 1].name}: beat 3 -> beat 4: full ${fb[0].toFixed(1)} -> ${fb[1].toFixed(1)} dBFS, low ${lb[0].toFixed(1)} -> ${lb[1].toFixed(1)} dBFS${gap ? '  (a gap: the rhythm stops)' : ''}`);
}
for (const name of RISERS) {
  const s = start[name]; if (!s) continue; const per = []; for (let k = 0; k < s.bars; k++) per.push(db(rms(high, s.t0 + k * bar, s.t0 + (k + 1) * bar)));
  const m = a => a.reduce((x, y) => x + y, 0) / a.length, n = Math.max(1, Math.floor(per.length / 3)), rise = m(per.slice(-n)) - m(per.slice(0, n));
  console.log(`riser in ${name}: high band per bar ${per.map(v => v.toFixed(0)).join(' ')} dBFS, last third is ${rise.toFixed(1)} dB above the first ${rise >= 3 ? '(rises)' : '(does not rise: a riser restarted or is missing)'}`);
}
