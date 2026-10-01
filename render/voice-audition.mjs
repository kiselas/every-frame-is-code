// Choose a voice by ear for THIS script, for a fraction of a cent per voice: the same few sentences in several voices of the openrouter engine.
// Usage: node voice-audition.mjs <script.txt> [--voices Algieba,Charon,Orus] [--profiles documentary,energetic] [--chars 240] [--out dir]
//                                [--model NAME] [--style TEXT] [--max-cost 0.1]
//   no --voices / --profiles: the voice of every profile in voices.json.  --voices all: all 30 voices of the Gemini models (about 0.4 cent each at 240 characters).
//   The sample is the start of the script, cut at a sentence end near --chars. Writes <out>/<voice>.mp3 (loudness matched, so a louder voice does not win)
//   and <out>/sample.txt; prints each voice with its published character. The result of a listening goes into voices.json (a profile), not into a spec.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const voicesOpt = opt('--voices', ''), profilesOpt = opt('--profiles', ''), chars = parseInt(opt('--chars', '240'), 10), outDir = path.resolve(opt('--out', 'voice-audition'));
const modelOpt = opt('--model', ''), styleOpt = opt('--style', ''), maxCost = opt('--max-cost', '0.1');
const [scriptFile] = args;
if (!scriptFile || scriptFile.startsWith('--')) { console.error('usage: node voice-audition.mjs <script.txt> [--voices A,B | all] [--profiles p1,p2] [--chars 240] [--out dir] [--model NAME] [--style TEXT]'); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(path.join(here, 'voices.json'), 'utf8'));
const characters = Object.fromEntries(Object.entries(cfg.characters).filter(([k]) => !k.startsWith('_')));
let voices;
if (voicesOpt === 'all') voices = Object.keys(characters);
else if (voicesOpt) voices = voicesOpt.split(',').map(s => s.trim()).filter(Boolean);
else voices = [...new Set((profilesOpt ? profilesOpt.split(',').map(s => s.trim()) : Object.keys(cfg.profiles)).map(p => { if (!cfg.profiles[p]) { console.error(`unknown profile "${p}": ${Object.keys(cfg.profiles).join(', ')}`); process.exit(1); } return cfg.profiles[p].voice; }))];

// the sample: whole sentences from the start of the script, near --chars
const text = fs.readFileSync(scriptFile, 'utf8').replace(/\r?\n\s*\r?\n/g, '\n\n');
const sentences = text.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
let sample = '';
for (const s of sentences) { if (sample && sample.length + s.length + 1 > chars * 1.3) break; sample += (sample ? ' ' : '') + s; if (sample.length >= chars) break; }
fs.mkdirSync(outDir, { recursive: true });
const sampleFile = path.join(outDir, 'sample.txt'); fs.writeFileSync(sampleFile, sample + '\n');
console.log(`sample (${sample.length} characters): ${sample.slice(0, 110)}${sample.length > 110 ? '...' : ''}\n${voices.length} voice(s): ${voices.join(', ')}\n`);

let total = 0;
for (const v of voices) {
  const base = path.join(outDir, v);
  const a = [path.join(here, 'voice.mjs'), sampleFile, base, '--engine', 'openrouter', '--voice', v, '--align', 'letters', '--max-cost', maxCost, ...(modelOpt ? ['--model', modelOpt] : []), ...(styleOpt ? ['--style', styleOpt] : [])];
  const r = spawnSync(process.execPath, a, { encoding: 'utf8' }), out = r.stdout + r.stderr;
  if (r.status) { console.log(`${v.padEnd(14)} FAILED: ${out.trim().split('\n').pop().slice(0, 160)}`); continue; }
  const sec = (/\.wav\s+([\d.]+) s/.exec(out) || [])[1], est = +(/estimated cost \$([\d.]+)/.exec(out) || [])[1] || 0; total += est;
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', base + '.wav', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-b:a', '160k', base + '.mp3']);
  const wps = (/([\d.]+) words\/s overall/.exec(out) || [])[1];
  console.log(`${v.padEnd(14)} ${(characters[v] || '?').padEnd(14)} ${String(sec).padStart(5)} s  ${wps ? wps + ' w/s' : ''}  ->  ${path.relative(process.cwd(), base + '.mp3')}`);
}
console.log(`\nestimated cost of this audition: about $${total.toFixed(3)} (the estimate runs ~35% above the real charge).\nPut the winner into render/voices.json as the genre's profile, and mark its status "chosen by ear".`);
