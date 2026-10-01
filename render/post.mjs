// The files for the post of a finished short: captions, cover, post text, an upload-size export.
// Usage: node post.mjs <outdir> [--no-export] [--video FILE] [--crop-y 100]
//   --no-export    skip exports/<id>-upload.mp4 (the re-encode takes a while)
//   --video FILE   the film to take the cover from and to re-encode (default <outdir>/<id>.mp4, or the only .mp4 in <outdir>)
//   --crop-y N     top of the 1080x1350 crop of the cover, in pixels of the 1080x1920 frame (default 100: keeps the HUD, drops the bottom UI zone)
//
// Reads, in <outdir>:
//   spec.resolved.json   (written by make.mjs: { spec, timing } or the bare spec), else spec.json, else ../spec.json
//   voice.words.json, voice.phrases.json   (render/voice.mjs; not needed for a silent film, "voice": null)
//   <id>.mp4
// Writes into <outdir>:
//   captions.srt, captions.vtt          the voice's subtitle groups, shifted by spec.voice.offset; every cue lasts >= 0.8 s and never overlaps the next
//   cover.jpg (1080x1920), cover-1080x1350.jpg    the frame at spec.post.cover = { shot, at } (default: the hook shot at 2.0 s)
//   post.md                              the hook first, the description, the sources, the tags, the title, an alt text
//   exports/<id>-upload.mp4              -crf 22 -preset medium, +faststart, aac 160k
// Exit code: 0 done, 2 an input is missing or ffmpeg failed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildPostMd, coverTime, groupsOf, toSrt, toVtt } from './spec-lib.mjs';

const Timing = createRequire(import.meta.url)('../runtime/timing.js');
const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const noExport = flag('--no-export'), videoOpt = opt('--video', null), cropY = parseInt(opt('--crop-y', '100'), 10);
const [outArg] = args;
if (!outArg) { console.error('usage: node post.mjs <outdir> [--no-export] [--video FILE] [--crop-y 100]'); process.exit(2); }

const fail = msg => { console.error('post: ' + msg); process.exit(2); };
const out = path.resolve(outArg);
if (!fs.existsSync(out)) fail(`the folder ${out} does not exist`);
const exists = f => fs.existsSync(f);
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fail(`${f}: not valid JSON (${e.message})`); } };

// ---- inputs
const specCandidates = [path.join(out, 'spec.resolved.json'), path.join(out, 'spec.json'), path.join(out, '..', 'spec.json')];
const specFile = specCandidates.find(exists);
if (!specFile) fail(`no spec: looked for\n  ${specCandidates.join('\n  ')}`);
let spec = readJson(specFile);
if (spec && spec.spec && !spec.shots) spec = spec.spec;
if (!spec || !Array.isArray(spec.shots) || !spec.id) fail(`${specFile} is not a spec (no id or shots)`);

let voice = null;
if (spec.voice) {
  const w = path.join(out, 'voice.words.json'), p = path.join(out, 'voice.phrases.json');
  if (!exists(w) || !exists(p)) fail(`the film has a voice but ${exists(w) ? '' : w + ' '}${exists(p) ? '' : p} ${(!exists(w) && !exists(p)) ? 'are' : 'is'} missing (run render/voice.mjs, or render/make.mjs)`);
  voice = { words: readJson(w), phrases: readJson(p) };
}

let video = videoOpt ? path.resolve(videoOpt) : path.join(out, spec.id + '.mp4');
if (!videoOpt && !exists(video)) {
  const mp4s = fs.readdirSync(out).filter(f => f.toLowerCase().endsWith('.mp4'));
  if (mp4s.length === 1) video = path.join(out, mp4s[0]);
}
if (!exists(video)) fail(`the film ${video} does not exist (render it first: node render/make.mjs ...)`);

// ---- timing and the cover time
let T, cover;
try { T = Timing.resolve(spec, voice); cover = coverTime(spec, T); } catch (e) { fail(e.message); }

const run = (cmd, a) => { const r = spawnSync(cmd, a, { encoding: 'utf8' }); if (r.error) fail(`${cmd}: ${r.error.message} (is it on PATH?)`); if (r.status) fail(`${cmd} failed:\n${(r.stderr || '').trim().split('\n').slice(-6).join('\n')}`); return r.stdout; };
const written = [];
const record = f => written.push(f);

// ---- captions
if (voice) {
  const groups = groupsOf(voice.phrases), offset = (spec.voice && spec.voice.offset) || 0;
  fs.writeFileSync(path.join(out, 'captions.srt'), toSrt(groups, { offset })); record('captions.srt');
  fs.writeFileSync(path.join(out, 'captions.vtt'), toVtt(groups, { offset })); record('captions.vtt');
} else console.log('silent film: no captions.srt/.vtt (the statements are the text)');

// ---- cover: the frame at the cover time, 1080x1920, and a 4:5 crop
const probe = parseFloat(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]));
const t = Math.max(0, Math.min(cover.t, (Number.isFinite(probe) ? probe : cover.t) - 0.05));
run('ffmpeg', ['-y', '-v', 'error', '-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920', '-q:v', '2', path.join(out, 'cover.jpg')]); record('cover.jpg');
run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(out, 'cover.jpg'), '-vf', `crop=1080:1350:0:${Math.max(0, Math.min(570, cropY))}`, '-q:v', '2', path.join(out, 'cover-1080x1350.jpg')]); record('cover-1080x1350.jpg');

// ---- post.md
fs.writeFileSync(path.join(out, 'post.md'), buildPostMd(spec, { duration: T.duration, cover: { ...cover, t } })); record('post.md');

// ---- the upload export
if (!noExport) {
  fs.mkdirSync(path.join(out, 'exports'), { recursive: true });
  const dest = path.join('exports', spec.id + '-upload.mp4');
  run('ffmpeg', ['-y', '-v', 'error', '-i', video, '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '160k', path.join(out, dest)]);
  record(dest.replace(/\\/g, '/'));
}

// ---- report
const size = f => { const b = fs.statSync(path.join(out, f)).size; return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; };
console.log(`post files for "${spec.id}" in ${out}  (spec: ${path.relative(out, specFile) || specFile}, film: ${path.basename(video)}, ${T.duration.toFixed(1)} s)`);
console.log(`cover: shot "${cover.shot}" at ${t.toFixed(2)} s`);
for (const f of written) console.log('  ' + f.padEnd(34) + size(f).padStart(9));
if (noExport) console.log('  (export skipped: --no-export)');
