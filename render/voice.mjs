// Text to a voice-over and the timing of every word, for films that speak.
// Usage: node voice.mjs <script.txt> <out-base> [options]      writes <out-base>.wav, .words.json, .phrases.json
//        node voice.mjs --voices [ru]                          lists Edge voices (optionally of one language)
//
// The script is plain text: one paragraph = one phrase (a subtitle group, a unit of timing), a blank line between paragraphs.
// Each phrase is synthesized on its own (so a changed phrase is the only one that is re-synthesized: results are cached),
// and the phrases are joined with a pause. Write numbers and years as words if the voice reads digits badly.
//
// Options:  --engine edge|openrouter   edge (default): free, needs `pip install edge-tts`; openrouter: needs OPENROUTER_API_KEY
//           --voice NAME               edge: ru-RU-DmitryNeural (default), ru-RU-SvetlanaNeural, ...; openrouter: e.g. onyx
//           --model NAME               openrouter only, e.g. openai/gpt-4o-mini-tts or mistralai/voxtral-mini-tts-2603
//           --rate -5%                 speaking rate (edge); 0 and slightly negative values sound the most natural
//           --gap 0.45                 seconds of silence between phrases (paragraphs)
//           --sentence-gap 0.22        seconds of silence between sentences inside a phrase
//           --max-words 4              longest subtitle group (the phrases.json "groups")
//           --no-cache                 synthesize everything again
//           --no-calibrate             trust the service's word offsets as they are (they run about 0.16 s ahead of the audio)
//
// Output files (times in seconds from the start of the .wav):
//   .words.json    [{ word, start, end, phrase, punct }]       punct: the punctuation that follows the word in the script
//   .phrases.json  [{ text, start, end, words: [i0, i1), groups: [{ text, start, end, words: [i0, i1) }] }]
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };

const python = () => {
  for (const c of [process.env.PYTHON, 'python', 'python3', 'py'].filter(Boolean)) if (spawnSync(c, ['--version']).status === 0) return c;
  throw new Error('python not found: set PYTHON, or use --engine openrouter');
};
const ffmpeg = (...a) => { const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...a]); if (r.status) throw new Error('ffmpeg: ' + r.stderr); };
const duration = f => parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.toString());
// where speech really starts in a file: the end of the leading silence. The service's word offsets run about 0.16 s ahead of its audio
// (measured on Edge), which would put subtitle highlights and "on the word" effects before the voice, so every sentence is re-timed to it.
const onsetOf = f => {
  const t = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'silencedetect=noise=-38dB:d=0.04', '-f', 'null', '-']).stderr.toString();
  const start = /silence_start: (-?[\d.]+)/.exec(t), end = /silence_end: ([\d.]+)/.exec(t);
  return start && parseFloat(start[1]) <= 0.01 && end ? parseFloat(end[1]) : 0;
};

if (args.includes('--voices')) {
  const lang = args[args.indexOf('--voices') + 1];
  const r = spawnSync(python(), ['-m', 'edge_tts', '--list-voices']);
  if (r.status) { console.error(r.stderr.toString() || 'pip install edge-tts'); process.exit(1); }
  console.log(r.stdout.toString().split('\n').filter(l => !lang || lang.startsWith('-') || l.toLowerCase().startsWith(lang.toLowerCase())).join('\n'));
  process.exit(0);
}

const engine = opt('--engine', 'edge'), rate = opt('--rate', '-5%'), gap = parseFloat(opt('--gap', '0.45')), sentenceGap = parseFloat(opt('--sentence-gap', '0.22')), maxWords = parseInt(opt('--max-words', '4'), 10);
const noCache = flag('--no-cache'), calibrate = !flag('--no-calibrate');
const voice = opt('--voice', engine === 'edge' ? 'ru-RU-DmitryNeural' : 'onyx'), model = opt('--model', 'openai/gpt-4o-mini-tts');
const [scriptFile, outBase] = args;
if (!scriptFile || !outBase) { console.error('usage: node voice.mjs <script.txt> <out-base> [--engine edge|openrouter] [--voice NAME] [--rate -5%] [--gap 0.45]\n       node voice.mjs --voices [ru]'); process.exit(1); }

const phrases = fs.readFileSync(scriptFile, 'utf8').split(/\r?\n\s*\r?\n/).map(p => p.replace(/\s*\r?\n\s*/g, ' ').trim()).filter(Boolean);
if (!phrases.length) { console.error('the script is empty'); process.exit(1); }
const cacheDir = outBase + '.cache';
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(path.dirname(path.resolve(outBase)), { recursive: true });

// ---------------------------------------------------------------- engines: one phrase -> { mp3, words: [{ word, start, end }], approx }
const run = (cmd, a) => new Promise((res, rej) => { const p = spawn(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'] }); let err = ''; p.stderr.on('data', d => err += d); p.on('close', c => c ? rej(new Error(err.trim() || `${cmd} exited ${c}`)) : res()); });

async function synth(text) {
  const key = crypto.createHash('sha1').update([engine, voice, model, rate, text].join('\u0001')).digest('hex').slice(0, 16);
  const base = path.join(cacheDir, key), mp3 = base + '.mp3', wj = base + '.words.json';
  if (noCache || !fs.existsSync(mp3) || !fs.existsSync(wj)) {
    if (engine === 'edge') {
      const tf = base + '.txt'; fs.writeFileSync(tf, text, 'utf8');
      try { await run(python(), [path.join(here, 'voice.py'), tf, voice, rate, base]); }
      catch (e) { throw new Error(`edge-tts failed (pip install edge-tts?): ${e.message}`); }
    } else if (engine === 'openrouter') {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('set OPENROUTER_API_KEY to use --engine openrouter');
      const res = await fetch('https://openrouter.ai/api/v1/audio/speech', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: text, voice, response_format: 'mp3' }) });
      if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
      fs.writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
      // no word timings from this endpoint: spread the words over the measured duration by letter count, and say so
      const ws = text.split(/\s+/).filter(Boolean), total = ws.reduce((s, w) => s + w.length, 0), d = duration(mp3);
      let t = 0; const words = ws.map(w => { const len = d * w.length / total, o = { word: w.replace(/[.,;:!?…«»"()—–-]+$/g, '').replace(/^[«"(]+/, ''), start: +t.toFixed(3), end: +(t + len).toFixed(3), approx: true }; t += len; return o; });
      fs.writeFileSync(wj, JSON.stringify(words));
    } else throw new Error(`unknown engine ${engine}`);
  }
  return { mp3, words: JSON.parse(fs.readFileSync(wj, 'utf8')), cached: !noCache && fs.existsSync(mp3) };
}

// attach to every word the punctuation that follows it in the script, by walking the text
function withPunct(text, words) {
  let cur = 0;
  return words.map(w => {
    const at = text.toLowerCase().indexOf(w.word.toLowerCase().replace(/[.,;:!?…]+$/g, ''), cur);
    if (at < 0) return { ...w, punct: '' };
    cur = at + w.word.length;
    const m = /^[»")\]]*([.,;:!?…—–]+)?/.exec(text.slice(cur));
    return { ...w, punct: m && m[1] || '' };
  });
}

// subtitle groups: break after sentence-ending punctuation, after a comma once the group has 2+ words, and at maxWords
function groupsOf(words, i0) {
  const groups = []; let start = 0;
  for (let i = 0; i < words.length; i++) {
    const n = i - start + 1, p = words[i].punct, last = i === words.length - 1;
    if (last || n >= maxWords || /[.!?…]/.test(p) || (/[,;:—–]/.test(p) && n >= 2)) { groups.push({ a: start, b: i + 1 }); start = i + 1; }
  }
  // a one-word tail looks bad: merge it back unless that would make the group too long
  if (groups.length > 1 && groups[groups.length - 1].b - groups[groups.length - 1].a === 1 && groups[groups.length - 2].b - groups[groups.length - 2].a < maxWords + 1) { const l = groups.pop(); groups[groups.length - 1].b = l.b; }
  return groups.map(g => ({ text: words.slice(g.a, g.b).map(w => w.word + w.punct).join(' '), start: words[g.a].start, end: words[g.b - 1].end, words: [i0 + g.a, i0 + g.b] }));
}

// ---------------------------------------------------------------- build
// Each phrase is synthesized sentence by sentence. The service pads every file with about a second of silence and pauses about a second
// after each full stop: far too slow for a short film. Each sentence is cut to its first and last word (plus a breath), and the pauses are ours.
const LEAD = 0.04, TAIL = 0.14;
const allWords = [], outPhrases = [], pieces = []; let clock = 0;
for (let k = 0; k < phrases.length; k++) {
  const text = phrases[k], sentences = text.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const phraseStart = clock, i0 = allWords.length, phraseWords = [];
  for (let s = 0; s < sentences.length; s++) {
    const r = await synth(sentences[s]);
    let ws = withPunct(sentences[s], r.words);
    if (calibrate && !ws[0].approx) { const delta = Math.max(-0.05, Math.min(0.4, onsetOf(r.mp3) - ws[0].start)); ws = ws.map(w => ({ ...w, start: +(w.start + delta).toFixed(3), end: +(w.end + delta).toFixed(3) })); }
    const cutA = Math.max(0, ws[0].start - LEAD), d = ws[ws.length - 1].end + TAIL - cutA;
    const wav = path.join(cacheDir, `piece-${pieces.length}.wav`);
    ffmpeg('-i', r.mp3, '-ss', cutA.toFixed(3), '-t', d.toFixed(3), '-ar', '48000', '-ac', '1', wav);
    ws.forEach(w => phraseWords.push({ ...w, start: +(w.start - cutA + clock).toFixed(3), end: +(w.end - cutA + clock).toFixed(3) }));
    const gapAfter = s < sentences.length - 1 ? sentenceGap : (k < phrases.length - 1 ? gap : 0);
    pieces.push({ wav, gapAfter });
    clock += d + gapAfter;
  }
  phraseWords.forEach(w => allWords.push({ ...w, phrase: k }));
  outPhrases.push({ text, start: +phraseStart.toFixed(3), end: +(phraseWords[phraseWords.length - 1].end + TAIL).toFixed(3), words: [i0, allWords.length], groups: groupsOf(phraseWords, i0) });
}

// join: piece, silence, piece, ...; 48 kHz mono
const list = path.join(cacheDir, 'concat.txt'), abs = f => path.resolve(f).replace(/\\/g, '/');   // concat reads paths relative to the list file: make them absolute
const silence = g => { const f = path.join(cacheDir, `silence-${g}.wav`); if (!fs.existsSync(f)) ffmpeg('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(g), f); return f; };
fs.writeFileSync(list, pieces.map(p => `file '${abs(p.wav)}'` + (p.gapAfter ? `\nfile '${abs(silence(p.gapAfter))}'` : '')).join('\n'));
ffmpeg('-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'pcm_s16le', outBase + '.wav');
fs.writeFileSync(outBase + '.words.json', JSON.stringify(allWords, null, 0));
fs.writeFileSync(outBase + '.phrases.json', JSON.stringify(outPhrases, null, 1));

// ---------------------------------------------------------------- report
const total = duration(outBase + '.wav');
console.log(`${outBase}.wav  ${total.toFixed(1)} s, ${allWords.length} words, ${(allWords.length / total).toFixed(2)} words/s overall; engine ${engine}, voice ${voice}${engine === 'edge' ? ', rate ' + rate : ''}`);
console.log('phrase  start   end    words  w/s   text');
outPhrases.forEach((p, k) => {
  const n = p.words[1] - p.words[0];
  console.log(`${String(k + 1).padStart(4)}  ${p.start.toFixed(2).padStart(6)} ${p.end.toFixed(2).padStart(6)}  ${String(n).padStart(4)}  ${(n / (p.end - p.start)).toFixed(2)}  ${p.text.length > 70 ? p.text.slice(0, 67) + '...' : p.text}`);
});
if (allWords.some(w => w.approx)) console.log('note: word times are approximate (spread by letter count); this engine reports none');
