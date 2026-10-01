// One command from a spec to a finished short: lint, voice (cached per sentence), the film page, the render (skipped when nothing changed),
// the automatic review, the post files. The format of the spec and the whole line: 23-short-factory.md.
//
// Usage: node make.mjs <spec.json> [more specs ...] [options]
//   --draft           half-size fast render (draft.mp4), no post files
//   --shot ID[..ID2]  render only one shot or a range (a part, with the voice cut to match is NOT done: use it to look at pictures)
//   --out DIR         output folder (default: <spec dir>/out)
//   --no-render       stop after the page (and the voice): to open film.html in a browser
//   --no-qa, --no-post, --no-lint   skip a step
//   --force           render again even if nothing changed; lint errors do not stop the run
//   --inline          also write film.inline.html, one self-contained file for publishing
//   --strict          the review fails on warnings too
// Exit code: 0 all steps passed, 1 lint errors or a failed review, 2 a tool failed.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..'), runtime = path.join(root, 'runtime');
const require = createRequire(import.meta.url);
const Timing = require('../runtime/timing.js');

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const draft = flag('--draft'), noRender = flag('--no-render'), noQa = flag('--no-qa'), noPost = flag('--no-post'), noLint = flag('--no-lint');
const force = flag('--force'), inline = flag('--inline'), strict = flag('--strict'), shot = opt('--shot', null), outOpt = opt('--out', null);
const specs = args.filter(a => !a.startsWith('--'));
if (!specs.length) { console.error('usage: node make.mjs <spec.json> [more specs] [--draft] [--shot id] [--out dir] [--no-render] [--no-qa] [--no-post] [--force] [--inline] [--strict]'); process.exit(2); }

const step = (name, t0) => console.log(`  ${name.padEnd(8)} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const sh = (cmd, a, o = {}) => new Promise((res, rej) => {
  const p = spawn(cmd, a, { stdio: 'inherit', cwd: o.cwd, shell: false });
  p.on('error', rej); p.on('close', c => res(c));
});
const sha = (...files) => { const h = crypto.createHash('sha1'); for (const f of files) if (fs.existsSync(f)) h.update(fs.readFileSync(f)); return h.digest('hex'); };
const rel = (from, to) => path.relative(from, to).replace(/\\/g, '/');
const exists = f => fs.existsSync(f);

// the Google Fonts stylesheet for the families of the spec (weights that every family used here has: display 700, mono 500 and 600)
const fontsHref = style => {
  if (style.fontsUrl) return style.fontsUrl;
  const fam = (n, w) => `family=${encodeURIComponent(n).replace(/%20/g, '+')}:wght@${w}`;
  return `https://fonts.googleapis.com/css2?${fam(style.display || 'Oswald', '500;700')}&${fam(style.mono || 'IBM Plex Mono', '500;600')}&display=block`;
};

async function make(specFile) {
  const t00 = Date.now(), specPath = path.resolve(specFile), dir = path.dirname(specPath);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  for (const k of ['id', 'title', 'genre', 'shots']) if (!spec[k]) { console.error(`${specFile}: the spec has no "${k}"`); return 2; }
  const out = path.resolve(outOpt || path.join(dir, 'out')); fs.mkdirSync(out, { recursive: true });
  console.log(`\n== ${spec.id}: ${spec.title}  (${draft ? 'draft' : 'final'}) -> ${out}`);
  const stateFile = path.join(out, '.make.json'), state = exists(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};

  // ---- voice: render/voice.mjs (a cache per sentence inside), files voice.wav / .words.json / .phrases.json in the output folder
  let voice = null, t0 = Date.now();
  if (spec.voice) {
    const v = spec.voice, textFile = path.resolve(dir, v.file || 'voice.txt'), base = path.join(out, 'voice');
    if (!exists(textFile)) { console.error(`the voice text ${textFile} does not exist`); return 2; }
    const a = [path.join(here, 'voice.mjs'), textFile, base];
    for (const [flagName, val] of [['--engine', v.engine], ['--voice', v.voice], ['--model', v.model], ['--rate', v.rate], ['--gap', v.gap], ['--sentence-gap', v.sentenceGap]]) if (val !== undefined) a.push(flagName, String(val));
    const code = await sh(process.execPath, a);
    if (code) { console.error('voice.mjs failed'); return 2; }
    voice = { words: JSON.parse(fs.readFileSync(base + '.words.json', 'utf8')), phrases: JSON.parse(fs.readFileSync(base + '.phrases.json', 'utf8')) };
    step('voice', t0);
  }

  // ---- timing and lint
  t0 = Date.now();
  let T;
  try { T = Timing.resolve(spec, voice); } catch (e) { console.error(`timing: ${e.message}`); return 1; }
  fs.writeFileSync(path.join(out, 'spec.resolved.json'), JSON.stringify({ spec, timing: { duration: T.duration, bpm: T.bpm, shots: T.shots.map(s => ({ id: s.id, start: +s.start.toFixed(3), end: +s.end.toFixed(3), phrases: s.phrases, words: s.words })) } }, null, 1));
  console.log(`  timing   ${T.shots.length} shots, ${T.duration.toFixed(1)} s`);
  if (!noLint) {
    const lintLib = path.join(here, 'spec-lib.mjs');
    if (exists(lintLib)) {
      const { lintSpec, loadBlocksMeta } = await import(pathToFileURL(lintLib).href);
      const r = lintSpec(spec, { voice, blocks: loadBlocksMeta ? loadBlocksMeta() : null });
      for (const [sev, list] of [['error', r.errors], ['warn', r.warnings]]) for (const f of list) console.log(`  ${sev.padEnd(5)} ${f.shot ? f.shot + ': ' : ''}${f.message}${f.fix ? '  -> ' + f.fix : ''}`);
      step('lint', t0);
      if (r.errors.length && !force) { console.error(`${r.errors.length} lint error(s): fix them (or --force)`); return 1; }
    } else console.log('  lint     skipped (render/spec-lib.mjs not found)');
  }

  // ---- the film page
  t0 = Date.now();
  const customBlocks = path.join(dir, 'blocks.js'), page = path.join(out, 'film.html'), r2 = p => rel(out, path.join(runtime, p));
  let previewSrc;
  if (voice) {
    const mp3 = path.join(out, 'voice.preview.mp3');
    if (!exists(mp3) || fs.statSync(mp3).mtimeMs < fs.statSync(path.join(out, 'voice.wav')).mtimeMs) await sh('ffmpeg', ['-y', '-v', 'error', '-i', path.join(out, 'voice.wav'), '-b:a', '64k', mp3]);
    previewSrc = 'data:audio/mpeg;base64,' + fs.readFileSync(mp3).toString('base64');
  }
  // the page gets what draws the film: the post text and the facts are for the files around it, and keeping them out of the page means editing them never re-renders
  const { post: _post, facts: _facts, ...drawn } = spec;
  const pageSpec = voice ? { ...drawn, voice: { ...spec.voice, src: previewSrc } } : drawn;
  const scripts = ['film.js', 'chip.js', 'compose.js', 'timing.js', 'blocks.js', 'short.js'].filter(f => exists(path.join(runtime, f)));
  const html = `<!doctype html>
<html lang="${spec.lang || 'en'}"><head><meta charset="utf-8">
<title>${spec.title.replace(/</g, '&lt;')}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fontsHref(spec.style || {})}" rel="stylesheet">
</head><body><canvas></canvas>
${scripts.map(f => `<script src="${r2(f)}"></script>`).join('\n')}
${exists(customBlocks) ? `<script src="${rel(out, customBlocks)}"></script>\n` : ''}<script>
// generated by render/make.mjs from ${rel(out, specPath)}: edit the spec, not this file
const SPEC = ${JSON.stringify(pageSpec)};
const VOICE = ${JSON.stringify(voice)};
Short.create(SPEC, VOICE);
</script>
</body></html>
`;
  fs.writeFileSync(page, html);
  if (inline) await sh(process.execPath, [path.join(runtime, 'inline.mjs'), page, path.join(out, 'film.inline.html')]);
  step('page', t0);
  if (noRender) { console.log(`  open ${page}`); return 0; }

  // ---- render (skipped when the page, the voice and the runtime are unchanged)
  t0 = Date.now();
  const mp4 = path.join(out, draft ? 'draft.mp4' : `${spec.id}.mp4`);
  const inputs = [page, path.join(out, 'voice.wav'), ...scripts.map(f => path.join(runtime, f)), path.join(here, 'render.mjs'), customBlocks];
  const key = sha(...inputs) + `|${draft}|${shot || ''}`;
  if (!force && exists(mp4) && state[mp4] === key) console.log(`  render   unchanged, ${path.basename(mp4)} is up to date`);
  else {
    const a = [path.join(here, 'render.mjs'), page, mp4];
    if (voice) a.push('--voice', path.join(out, 'voice.wav'));
    a.push('--loudnorm'); if (draft) a.push('--draft'); if (shot) a.push('--shot', shot);
    const code = await sh(process.execPath, a, { cwd: here });
    if (code) { console.error('render failed'); return 2; }
    state[mp4] = key; fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
    step('render', t0);
  }

  // ---- review
  let qaCode = 0;
  if (!noQa && !shot) {
    t0 = Date.now();
    const qa = path.join(here, 'qa.mjs');
    if (exists(qa)) {
      const a = [qa, page, '--video', mp4, '--spec', path.join(out, 'spec.resolved.json'), '--out', path.join(out, draft ? 'qa-draft' : 'qa')]; if (strict) a.push('--strict');
      qaCode = await sh(process.execPath, a, { cwd: here });
      step('review', t0);
    } else {
      qaCode = await sh(process.execPath, [path.join(here, 'textcheck.mjs'), page, '1'], { cwd: here });
      console.log('  review   render/qa.mjs not found: only the text-fit check ran');
    }
  }

  // ---- post files
  if (!noPost && !draft && !shot) {
    const post = path.join(here, 'post.mjs');
    if (exists(post)) { t0 = Date.now(); const code = await sh(process.execPath, [post, out], { cwd: here }); step('post', t0); if (code) return 2; }
    else console.log('  post     skipped (render/post.mjs not found)');
  }
  console.log(`  done in ${((Date.now() - t00) / 1000).toFixed(0)} s: ${mp4}${qaCode ? '   (the review has findings: ' + path.join(out, 'qa', 'report.md') + ')' : ''}`);
  return qaCode ? 1 : 0;
}

let worst = 0;
for (const s of specs) { const c = await make(s); worst = Math.max(worst, c); }
if (specs.length > 1) console.log(`\n${specs.length} specs, worst exit code ${worst}`);
process.exit(worst);
