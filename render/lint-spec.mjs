// Lint a short's spec before anything is rendered: required fields, claims, phrases, anchors, blocks, budgets, facts, the genre card.
// Usage: node lint-spec.mjs <spec.json> [--voice out/voice] [--json]
//   --voice BASE   the voice files BASE.words.json and BASE.phrases.json (default: <spec folder>/out/voice); without them the timing checks are skipped
//   --json         print the result { errors, warnings, info } as JSON instead of text
// Exit code: 1 on any error, 0 otherwise, 2 when the spec cannot be read. The rules are listed in 23-short-factory.md, "Spec lint".
import fs from 'node:fs';
import path from 'node:path';
import { lintSpec, loadBlocksMeta } from './spec-lib.mjs';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const asJson = flag('--json'), voiceOpt = opt('--voice', null), [specFile] = args;
if (!specFile || specFile.startsWith('--')) { console.error('usage: node lint-spec.mjs <spec.json> [--voice out/voice] [--json]'); process.exit(2); }

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
let spec;
try { spec = readJson(specFile); } catch (e) { console.error(`${specFile}: ${e.code === 'ENOENT' ? 'no such file' : 'not valid JSON: ' + e.message}`); process.exit(2); }
if (spec && spec.spec && spec.timing && !spec.shots) spec = spec.spec;                       // spec.resolved.json wraps the spec

const specDir = path.dirname(path.resolve(specFile));
const base = path.resolve(voiceOpt || path.join(specDir, 'out', 'voice'));
let voice = null;
if (fs.existsSync(base + '.words.json') && fs.existsSync(base + '.phrases.json')) {
  try { voice = { words: readJson(base + '.words.json'), phrases: readJson(base + '.phrases.json') }; }
  catch (e) { console.error(`${base}.*.json: ${e.message}`); process.exit(2); }
} else if (voiceOpt) { console.error(`no voice files at ${base}.words.json / .phrases.json`); process.exit(2); }

let voiceText = null;
if (spec && spec.voice) {
  const f = path.resolve(specDir, spec.voice.file || 'voice.txt');
  if (fs.existsSync(f)) voiceText = fs.readFileSync(f, 'utf8');
}

const result = lintSpec(spec, { voice, blocks: loadBlocksMeta(), voiceText });
if (asJson) console.log(JSON.stringify(result, null, 2));
else {
  const line = (sev, f) => {
    console.log(`${sev.padEnd(5)} [${f.rule}]${f.shot ? ' ' + f.shot + ':' : ''} ${f.message}`);
    if (f.fix) console.log(`        fix: ${f.fix}`);
  };
  result.errors.forEach(f => line('error', f));
  result.warnings.forEach(f => line('warn', f));
  result.info.forEach(f => line('info', f));
  console.log(`\n${specFile}: ${result.errors.length} error(s), ${result.warnings.length} warning(s), ${result.info.length} note(s)${voice ? '' : '  (no voice timings)'}`);
}
process.exit(result.errors.length ? 1 : 0);
