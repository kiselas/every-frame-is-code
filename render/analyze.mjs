// Breaks a reference video down into what can be learned from it: shots and their lengths, cutting
// pace over time, tempo of the music, whether cuts land on beats, loudness dips (pauses before peaks),
// contact sheets every 0.5 s and one frame from the middle of every shot.
// Usage: node analyze.mjs <video> [outdir] [--scene 0.15]
// Writes outdir/report.md, outdir/analysis.json, outdir/sheet-NN.png, outdir/shots-NN.png.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { decodePCM, onsetEnvelope, onsetPeaks, localTempo, tempoCurve, trackBeats, gridFit, loudness, median, fmtTime } from './audio-analysis.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const SCENE = parseFloat(opt('--scene', '0.15'));
const [input, outArg] = args;
if (!input) { console.error('usage: node analyze.mjs <video> [outdir] [--scene 0.15]'); process.exit(1); }
const out = path.resolve(outArg || path.basename(input).replace(/\.[^.]+$/, '') + '-analysis');
fs.mkdirSync(out, { recursive: true });

function run(cmd, argv) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '', se = ''; p.stdout.on('data', d => so += d); p.stderr.on('data', d => se += d);
    p.on('error', rej); p.on('close', c => c === 0 ? res({ so, se }) : rej(new Error(`${cmd} exit ${c}\n${se.slice(-2000)}`)));
  });
}
const FONT = process.env.FONTFILE ? `:fontfile=${process.env.FONTFILE}` : process.platform === 'win32' ? ":fontfile='C\\:/Windows/Fonts/consola.ttf'" : '';
const label = `drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=16:fontcolor=yellow:box=1:boxcolor=black@0.6${FONT}`;

// --- probe
const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', input])).so);
const vs = probe.streams.find(s => s.codec_type === 'video'), hasAudio = probe.streams.some(s => s.codec_type === 'audio');
const [fn, fd] = vs.r_frame_rate.split('/').map(Number), FPS = fn / (fd || 1), DUR = parseFloat(probe.format.duration);
console.log(`${input}: ${fmtTime(DUR)}, ${vs.width}x${vs.height} @ ${FPS.toFixed(2)} fps${hasAudio ? ', audio' : ''}`);

// --- cuts
process.stdout.write('detecting cuts... ');
const { se } = await run('ffmpeg', ['-hide_banner', '-i', input, '-an', '-vf', `select='gt(scene,${SCENE})',showinfo`, '-f', 'null', '-']);
const raw = [...se.matchAll(/pts_time:([\d.]+)/g)].map(m => parseFloat(m[1]));
// flashes and fast transitions trigger several detections in a row: keep the first of a burst
const cuts = []; for (const t of raw) if (t > .2 && (!cuts.length || t - cuts[cuts.length - 1] > .2)) cuts.push(t);
const bounds = [0, ...cuts, DUR], shots = bounds.slice(0, -1).map((a, i) => ({ n: i + 1, start: a, end: bounds[i + 1], len: bounds[i + 1] - a }));
console.log(`${shots.length} shots`);

// --- audio
let audio = null;
if (hasAudio) {
  process.stdout.write('analyzing audio... ');
  const sr = 11025, x = await decodePCM(input, sr), { env, fps } = onsetEnvelope(x, sr, { win: 512 });
  const onsets = onsetPeaks(env, fps), tempo = localTempo(env, fps), loud = loudness(x, sr, 2);
  const beats = trackBeats(env, fps, tempoCurve(tempo)), fit = gridFit(cuts, beats);
  const med = median(loud.map(l => l.db));
  audio = {
    tempo: tempo.map(q => ({ t: +q.t.toFixed(1), bpm: +q.bpm.toFixed(1) })), loudness: loud.map(l => ({ t: l.t, db: +l.db.toFixed(1) })),
    beats: beats.map(b => +b.toFixed(3)), onsets: onsets.map(o => +o.t.toFixed(3)),
    beatLock: fit && { R: +fit.R.toFixed(3), phase: +fit.phase.toFixed(2), locked: +fit.locked.toFixed(3), chanceR: +fit.chanceR.toFixed(3) },
    dips: loud.filter(l => l.db < med - 6 && l.t + 2 < DUR).map(l => ({ t: l.t, db: +l.db.toFixed(1) })), medianDb: +med.toFixed(1),
  };
  console.log(`${beats.length} beats`);
}

// --- images: contact sheets (2 fps) and the middle frame of every shot
process.stdout.write('contact sheets... ');
await run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-an', '-vf', `fps=2,scale=320:-1,${label},tile=6x5`, path.join(out, 'sheet-%02d.png')]);
const mids = shots.map(s => Math.round((s.start + s.len / 2) * FPS));
for (let k = 0; k < mids.length; k += 48) {
  const sel = mids.slice(k, k + 48).map(n => `eq(n,${n})`).join('+');
  await run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-an', '-vf', `select='${sel}',scale=320:-1,${label},tile=6x8`, '-frames:v', '1', path.join(out, `shots-${String(k / 48 + 1).padStart(2, '0')}.png`)]);
}
console.log('ok');

// --- report
const lens = shots.map(s => s.len), cpm = shots.length / DUR * 60;
const pace = []; for (let a = 0; a < DUR; a += 10) pace.push({ a, n: cuts.filter(t => t >= a && t < a + 10).length });
const bar = (n, k = 1) => '█'.repeat(Math.round(n * k));
const L = [];
L.push(`# Reference analysis: ${path.basename(input)}`, '');
L.push(`| | |`, `|---|---|`);
L.push(`| Length | ${fmtTime(DUR)} |`, `| Frame | ${vs.width}×${vs.height} @ ${FPS.toFixed(2)} fps |`);
L.push(`| Shots | ${shots.length} (scene threshold ${SCENE}) |`, `| Cuts per minute | ${cpm.toFixed(1)} |`);
L.push(`| Shot length | median ${median(lens).toFixed(2)} s, min ${Math.min(...lens).toFixed(2)} s, max ${Math.max(...lens).toFixed(2)} s |`);
if (audio) {
  const bpms = audio.tempo.map(q => q.bpm);
  L.push(`| Tempo | ${Math.round(Math.min(...bpms))}–${Math.round(Math.max(...bpms))} BPM (8 s windows, octave errors possible) |`);
  const bl = audio.beatLock;
  if (bl) L.push(`| Cuts vs beat grid | ${(bl.locked * 100).toFixed(0)}% of cuts within ±10% of one phase of the beat (random: 20%); concentration R = ${bl.R} (random ≈ ${bl.chanceR})${bl.R > 3 * bl.chanceR ? ', cuts follow the music' : ''}${bl.R > 3 * bl.chanceR && bl.phase > .2 && bl.phase < .8 ? `; dominant phase ${bl.phase} of a beat: the tracker probably counted offbeats, or cuts sit on eighth notes` : ''} |`);
}
L.push('', '## Cutting pace (cuts per 10 s)', '', '```');
for (const p of pace) L.push(`${fmtTime(p.a).padStart(8)}  ${String(p.n).padStart(2)} ${bar(p.n)}`);
L.push('```', '');
if (audio) {
  L.push('## Tempo over time', '', '```');
  for (const q of audio.tempo) L.push(`${fmtTime(q.t).padStart(8)}  ${q.bpm.toFixed(1).padStart(6)} BPM`);
  L.push('```', '', '## Loudness (RMS per 2 s)', '', '```');
  for (const l of audio.loudness) L.push(`${fmtTime(l.t).padStart(8)}  ${l.db.toFixed(1).padStart(6)} dB  ${bar(Math.max(0, l.db + 50), .6)}`);
  L.push('```', '');
  L.push(audio.dips.length ? `Dips 6+ dB below the median (${audio.medianDb} dB), usually a pause before a peak or a quiet chapter: ${audio.dips.map(d => fmtTime(d.t)).join(', ')}.` : 'No loudness dips.', '');
}
L.push('## Shots', '', '| # | Start | Length |', '|---|---|---|');
for (const s of shots) L.push(`| ${s.n} | ${fmtTime(s.start)} | ${s.len.toFixed(2)} s |`);
L.push('', '## Images', '', '- `sheet-NN.png`: a frame every 0.5 s, 30 per sheet, with timecodes', '- `shots-NN.png`: the middle frame of every shot, 48 per sheet', '');
L.push('## What to look at next', '', '- Read the sheets in order and write down the grammar: how text is built, where it sits, which word is emphasized and how.',
  '- Find the persistent layer (HUD, frame, counters, a progress bar) and what state it carries across the film.',
  '- For each chapter: its length, its palette, what changes in pace and sound at its boundaries.',
  '- Step through transitions frame by frame: `ffmpeg -ss T -t 1 -i video -vf fps=10,scale=320:-1,tile=6x2 strip.png`.',
  '- Name the through-line: the motif, metric or question that ties the film together.');
fs.writeFileSync(path.join(out, 'report.md'), L.join('\n'));
fs.writeFileSync(path.join(out, 'analysis.json'), JSON.stringify({ input, duration: DUR, fps: FPS, width: vs.width, height: vs.height, cuts, shots, audio }, null, 1));
console.log(`report: ${path.join(out, 'report.md')}`);
