// Text to a voice-over and the timing of every word, for films that speak.
// Usage: node voice.mjs <script.txt> <out-base> [options]      writes <out-base>.wav, .words.json, .phrases.json
//        node voice.mjs --voices [ru]                          lists Edge voices (optionally of one language)
//
// The script is plain text: one paragraph = one phrase (a subtitle group, a unit of timing), a blank line between paragraphs.
// Each phrase is synthesized on its own (so a changed phrase is the only one that is re-synthesized: results are cached),
// and the phrases are joined with a pause. Write numbers and years as words if the voice reads digits badly.
//
// Options:  --engine edge|openrouter   edge (default): free, needs `pip install edge-tts`; openrouter: paid, the key is OPENROUTER_KEY
//                                      (or OPENROUTER_API_KEY) in the environment or in the kit's .env (git-ignored)
//           --voice NAME               edge: ru-RU-DmitryNeural (default), ru-RU-SvetlanaNeural, ...; openrouter: a voice of the model
//                                      (google/gemini-*-tts: Charon, Kore, Fenrir, Orus, Rasalgethi, Schedar, Gacrux, Sulafat ... 30 of them)
//           --model NAME               openrouter only; default google/gemini-3.8-flash-tts. `--models` lists the speech models and prices
//           --style TEXT               openrouter: how to speak, sent as the `instructions` field (never put it inside the text: Gemini reads it aloud)
//           --align whisper|letters    openrouter: word times from a transcription of each sentence (default, about 0.07 cent per 10 s) or
//                                      spread by letter count (free, marked approx)
//           --lang ru|en|...           language of the script for the transcription (default: ru if the script has Cyrillic, else en)
//           --max-cost 0.25            openrouter: stop BEFORE spending if the estimate for the sentences that are not cached exceeds this (USD)
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
// secrets live in the kit's .env (git-ignored): KEY=value lines; values already in the environment win
for (const f of [path.join(here, '..', '.env'), path.resolve('.env')]) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/.exec(l); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2'); }
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

if (args.includes('--models')) {
  const j = await (await fetch('https://openrouter.ai/api/v1/models?output_modalities=speech')).json();
  for (const m of j.data || []) { const pr = m.pricing || {}; console.log(m.id.padEnd(40), pr.completion && +pr.completion ? `per token: in $${(pr.prompt * 1e6).toFixed(2)}/M, audio out $${(pr.completion * 1e6).toFixed(2)}/M` : +pr.prompt ? `$${(pr.prompt * 1e6).toFixed(2)} per million characters` : 'free'); }
  await new Promise(r => setTimeout(r, 150)); process.exit(0);
}
if (args.includes('--voices')) {
  const lang = args[args.indexOf('--voices') + 1];
  const r = spawnSync(python(), ['-m', 'edge_tts', '--list-voices']);
  if (r.status) { console.error(r.stderr.toString() || 'pip install edge-tts'); process.exit(1); }
  console.log(r.stdout.toString().split('\n').filter(l => !lang || lang.startsWith('-') || l.toLowerCase().startsWith(lang.toLowerCase())).join('\n'));
  process.exit(0);
}

const engine = opt('--engine', 'edge'), rate = opt('--rate', '-5%'), gap = parseFloat(opt('--gap', '0.45')), sentenceGap = parseFloat(opt('--sentence-gap', '0.22')), maxWords = parseInt(opt('--max-words', '4'), 10);
const noCache = flag('--no-cache'), calibrate = !flag('--no-calibrate');
const voice = opt('--voice', engine === 'edge' ? 'ru-RU-DmitryNeural' : 'Charon'), model = opt('--model', 'google/gemini-3.8-flash-tts');
const style = opt('--style', ''), alignMode = opt('--align', 'whisper'), maxCost = parseFloat(opt('--max-cost', '0.25')), sttModel = opt('--stt-model', 'openai/whisper-1'), langOpt = opt('--lang', '');
const [scriptFile, outBase] = args;
if (!scriptFile || !outBase) { console.error('usage: node voice.mjs <script.txt> <out-base> [--engine edge|openrouter] [--voice NAME] [--rate -5%] [--gap 0.45]\n       node voice.mjs --voices [ru]'); process.exit(1); }

const phrases = fs.readFileSync(scriptFile, 'utf8').split(/\r?\n\s*\r?\n/).map(p => p.replace(/\s*\r?\n\s*/g, ' ').trim()).filter(Boolean);
if (!phrases.length) { console.error('the script is empty'); process.exit(1); }
const lang = langOpt || (/[а-яё]/i.test(phrases.join(' ')) ? 'ru' : 'en');
const cacheDir = outBase + '.cache';
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(path.dirname(path.resolve(outBase)), { recursive: true });

// ---------------------------------------------------------------- engines: one phrase -> { mp3, words: [{ word, start, end }], approx }
const run = (cmd, a) => new Promise((res, rej) => { const p = spawn(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'] }); let err = ''; p.stderr.on('data', d => err += d); p.on('close', c => c ? rej(new Error(err.trim() || `${cmd} exited ${c}`)) : res()); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const orKey = () => { const k = process.env.OPENROUTER_KEY || process.env.OPENROUTER_API_KEY; if (!k) throw new Error('put OPENROUTER_KEY=... into the kit\'s .env (or the environment) to use --engine openrouter'); return k; };
async function orPost(url, body, label) {                       // retries what can clear by itself (429, 5xx), never a 400, 401 or 402
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${orKey()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return res;
    if ([429, 502, 503, 524, 529].includes(res.status) && attempt < 4) { await sleep(1000 * (parseFloat(res.headers.get('retry-after')) || 2 ** attempt)); continue; }
    throw new Error(`openrouter ${label} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
const isGemini = /^google\/gemini/.test(model);
const norm = w => w.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
// the speech span of a file: the end of the leading silence and the start of the trailing one
const speechSpan = f => {
  const t = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'silencedetect=noise=-40dB:d=0.05', '-f', 'null', '-']).stderr.toString(), d = duration(f);
  const starts = [...t.matchAll(/silence_start: (-?[\d.]+)/g)].map(m => +m[1]), ends = [...t.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]);
  return { start: starts[0] !== undefined && starts[0] <= 0.01 && ends[0] !== undefined ? ends[0] : 0, end: starts.length && (ends.length < starts.length || ends[ends.length - 1] >= d - 0.02) ? starts[starts.length - 1] : d };
};
// script words -> the recognized words (global alignment on the normalized text): returns [{ start, end }] per script word, or null
function alignToScript(scriptWords, heard) {
  const A = scriptWords.map(norm), B = heard.map(h => norm(h.word)), n = A.length, m = B.length;
  const sim = (a, b) => !a || !b ? -1 : a === b ? 2 : (1 - lev(a, b) / Math.max(a.length, b.length)) >= 0.6 ? 1 : -1;
  const S = Array.from({ length: n + 1 }, () => new Float32Array(m + 1)); for (let i = 1; i <= n; i++) S[i][0] = -i; for (let j = 1; j <= m; j++) S[0][j] = -j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) S[i][j] = Math.max(S[i - 1][j - 1] + sim(A[i - 1], B[j - 1]), S[i - 1][j] - 1, S[i][j - 1] - 1);
  const out = Array(n).fill(null); let i = n, j = m, hit = 0;
  while (i > 0 && j > 0) { if (S[i][j] === S[i - 1][j - 1] + sim(A[i - 1], B[j - 1])) { if (sim(A[i - 1], B[j - 1]) > 0) { out[i - 1] = { start: heard[j - 1].start, end: heard[j - 1].end }; hit++; } i--; j--; } else if (S[i][j] === S[i - 1][j] - 1) i--; else j--; }
  if (hit < 0.7 * n) return null;
  for (let k = 0; k < n; k++) if (!out[k]) {                       // a word nobody heard: between its neighbours, by letter count
    let a = k - 1, b = k + 1; while (a >= 0 && !out[a]) a--; while (b < n && !out[b]) b++;
    const t0 = a >= 0 ? out[a].end : out[b] ? Math.max(0, out[b].start - 0.3) : 0, t1 = b < n ? out[b].start : t0 + 0.3, run = scriptWords.slice(a + 1, b).reduce((s, w) => s + w.length, 0) || 1;
    let at = t0; for (let q = a + 1; q < b; q++) { const len = Math.max(0, t1 - t0) * scriptWords[q].length / run; if (!out[q]) out[q] = { start: at, end: at + len, guessed: true }; at += len; }
  }
  return out;
}

// ---- what a run will cost, before it spends anything (prices from the public models list; Gemini bills tokens, most others characters)
const spend = { tts: 0, stt: 0, calls: 0, chars: 0 };
let prices = null;
async function loadPrices() {
  const j = await (await fetch('https://openrouter.ai/api/v1/models?output_modalities=speech')).json();
  const m = (j.data || []).find(x => x.id === model);
  if (!m) throw new Error(`${model} is not a speech model on OpenRouter now. Try: node voice.mjs --models`);
  prices = { prompt: +m.pricing.prompt || 0, completion: +m.pricing.completion || 0 };
}
const estSeconds = chars => Math.max(1, chars / 11);              // Russian speech runs about 11-12 characters a second
const estTts = chars => prices.completion ? chars / 2.5 * prices.prompt + 25 * estSeconds(chars) * prices.completion : chars * prices.prompt;   // Gemini: ~25 audio tokens a second
const estStt = chars => alignMode === 'whisper' ? estSeconds(chars) * 0.0001 : 0;
const cacheKeyOf = text => crypto.createHash('sha1').update([engine, voice, model, rate, style, alignMode, lang, text].join('\u0001')).digest('hex').slice(0, 16);
const audioOf = base => ['.wav', '.mp3'].map(e => base + e).find(f => fs.existsSync(f));
const isCached = text => { const b = path.join(cacheDir, cacheKeyOf(text)); return !noCache && audioOf(b) && fs.existsSync(b + '.words.json'); };

async function synth(text) {
  const base = path.join(cacheDir, cacheKeyOf(text)), wj = base + '.words.json';
  if (noCache || !audioOf(base) || !fs.existsSync(wj)) {
    if (engine === 'edge') {
      const tf = base + '.txt'; fs.writeFileSync(tf, text, 'utf8');
      try { await run(python(), [path.join(here, 'voice.py'), tf, voice, rate, base]); }
      catch (e) { throw new Error(`edge-tts failed (pip install edge-tts?): ${e.message}`); }
    } else if (engine === 'openrouter') {
      if (!prices) await loadPrices();
      const res = await orPost('https://openrouter.ai/api/v1/audio/speech', { model, input: text, voice, response_format: isGemini ? 'pcm' : 'mp3', ...(style ? { instructions: style } : {}) }, 'speech');
      const ct = res.headers.get('content-type') || '', buf = Buffer.from(await res.arrayBuffer());
      if (!/audio/.test(ct) || !buf.length) throw new Error(`openrouter returned ${ct || 'nothing'} instead of audio: ${buf.toString('utf8').slice(0, 200)}`);
      spend.tts += estTts(text.length); spend.calls++; spend.chars += text.length;
      if (/pcm/.test(ct)) {                                          // raw 16-bit mono PCM, the rate is in the content type: keep it lossless as a wav
        const sr = (/rate=(\d+)/.exec(ct) || [])[1] || '24000', raw = base + '.pcm'; fs.writeFileSync(raw, buf);
        ffmpeg('-f', 's16le', '-ar', sr, '-ac', '1', '-i', raw, base + '.wav'); fs.rmSync(raw);
      } else fs.writeFileSync(base + (/wav/.test(ct) ? '.wav' : '.mp3'), buf);
      const audio = audioOf(base), ws = text.split(/\s+/).filter(Boolean);
      let words = null;
      if (alignMode === 'whisper') {                                 // the words and when they were said, from a transcription of this very file
        const mp3 = spawnSync('ffmpeg', ['-v', 'error', '-i', audio, '-ac', '1', '-ar', '16000', '-b:a', '48k', '-f', 'mp3', '-'], { maxBuffer: 1 << 26 }).stdout;
        const r = await orPost('https://openrouter.ai/api/v1/audio/transcriptions', { model: sttModel, input_audio: { data: mp3.toString('base64'), format: 'mp3' }, language: lang, response_format: 'verbose_json', timestamp_granularities: ['word'] }, 'transcription');
        const j = await r.json(); spend.stt += +(j.usage && j.usage.cost) || 0;
        const al = j.words && j.words.length ? alignToScript(ws, j.words) : null;
        if (al) {
          const sp = speechSpan(audio);                                // whisper chains words end to start: pin the first and the last to the real speech
          words = ws.map((w, k) => ({ word: w.replace(/[.,;:!?…«»"()—–-]+$/g, '').replace(/^[«"(]+/, ''), start: +al[k].start.toFixed(3), end: +al[k].end.toFixed(3), ...(al[k].guessed ? { approx: true } : {}) }));
          words[0].start = +Math.max(words[0].start, sp.start).toFixed(3); words[words.length - 1].end = +Math.min(words[words.length - 1].end, sp.end).toFixed(3);
          if (words[words.length - 1].end <= words[words.length - 1].start) words[words.length - 1].end = +(words[words.length - 1].start + 0.1).toFixed(3);
        } else console.warn(`  (the transcription of "${text.slice(0, 40)}..." does not match the script: word times are spread by letter count)`);
      }
      if (!words) {                                                  // no timings from the speech endpoint: spread the words over the measured speech by letter count, and say so
        const sp = speechSpan(audio), total = ws.reduce((s, w) => s + w.length, 0), d = sp.end - sp.start; let tt = sp.start;
        words = ws.map(w => { const len = d * w.length / total, o = { word: w.replace(/[.,;:!?…«»"()—–-]+$/g, '').replace(/^[«"(]+/, ''), start: +tt.toFixed(3), end: +(tt + len).toFixed(3), approx: true }; tt += len; return o; });
      }
      fs.writeFileSync(wj, JSON.stringify(words));
    } else throw new Error(`unknown engine ${engine}`);
  }
  return { audio: audioOf(base), words: JSON.parse(fs.readFileSync(wj, 'utf8')), cached: !noCache };
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

// ---------------------------------------------------------------- guard
if (engine === 'openrouter') {
  await loadPrices();
  const todo = phrases.flatMap(p => p.split(/(?<=[.!?…])\s+/).filter(Boolean)).filter(s => !isCached(s));
  const est = todo.reduce((s, x) => s + estTts(x.length) + estStt(x.length), 0);
  console.log(`openrouter ${model}, voice ${voice}${style ? `, style "${style}"` : ''}: ${todo.length} sentence(s) to synthesize (${todo.reduce((s, x) => s + x.length, 0)} characters), the rest is cached; estimated cost $${est.toFixed(4)} (limit $${maxCost})`);
  if (est > maxCost) { console.error(`the estimate $${est.toFixed(4)} is above --max-cost $${maxCost}: nothing was spent. Raise --max-cost to go on.`); process.exitCode = 3; await sleep(150); process.exit(3); }   // the pause: on Windows an exit right after fetch trips a libuv assertion
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
    if (calibrate && engine === 'edge' && !ws[0].approx) { const delta = Math.max(-0.05, Math.min(0.4, onsetOf(r.audio) - ws[0].start)); ws = ws.map(w => ({ ...w, start: +(w.start + delta).toFixed(3), end: +(w.end + delta).toFixed(3) })); }
    const cutA = Math.max(0, ws[0].start - LEAD), d = ws[ws.length - 1].end + TAIL - cutA;
    const wav = path.join(cacheDir, `piece-${pieces.length}.wav`);
    ffmpeg('-i', r.audio, '-ss', cutA.toFixed(3), '-t', d.toFixed(3), '-ar', '48000', '-ac', '1', wav);
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
if (allWords.some(w => w.approx)) console.log(`note: ${allWords.filter(w => w.approx).length} of ${allWords.length} word times are approximate (spread by letter count)`);
if (engine === 'openrouter' && spend.calls) {
  const ledger = path.join(cacheDir, 'spend.json'), prev = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : [];
  prev.push({ at: new Date().toISOString(), model, voice, style, calls: spend.calls, chars: spend.chars, tts_estimated_usd: +spend.tts.toFixed(5), stt_usd: +spend.stt.toFixed(5) });
  fs.writeFileSync(ledger, JSON.stringify(prev, null, 1));
  console.log(`spent this run: speech about $${spend.tts.toFixed(4)} (estimated from the price list) + transcription $${spend.stt.toFixed(4)} (reported by the API), ${spend.calls} call(s), ${spend.chars} characters`);
}
