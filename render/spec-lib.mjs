// The pure parts of the short factory's tools (23-short-factory.md): the spec linter, the caption cues (SRT/VTT), the cover time, the post text.
// Used by lint-spec.mjs, post.mjs, new.mjs, make.mjs and the tests. Nothing here touches the filesystem, except loadBlocksMeta (it loads runtime/blocks.js).
//
//   lintSpec(spec, { voice, blocks, voiceText }) -> { errors, warnings, info }     entries { rule, shot?, message, fix }
//     voice      { words, phrases } from render/voice.mjs, or null/undefined when it is not synthesized yet (the timing checks are skipped, with an info)
//     blocks     Blocks.list() metadata [{ name, claim, params: { name: { type, required } } }], or null (the block checks are skipped, with an info)
//     voiceText  the text of voice.txt, optional: TODO in it is an error, and its paragraph count stands in for the phrase count when there is no voice
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Timing = require('../runtime/timing.js');

// ---------------------------------------------------------------- vocabulary
export const CLAIMS = ['magnitude', 'comparison', 'change', 'part', 'ranking', 'mechanism', 'structure', 'location', 'identity', 'typographic'];
export const TRANSITIONS = ['cut', 'push-up', 'push-down', 'dip', 'flash', 'punch', 'fade', 'zoom', 'iris', 'wipe'];
export const SFX_KINDS = ['stamp', 'impact', 'whoosh', 'tick', 'riser', 'ping', 'print'];
export const HUD_KINDS = ['rail', 'counter', 'none'];

// The table of chapter 20: the promise, the length in seconds, the text budget in words (statements and captions), and a plausible number of shots.
export const GENRES = [
  { name: 'how-it-works', promise: 'You will understand X', length: [30, 60], words: [100, 150], shots: [6, 10] },
  { name: 'one-life', promise: 'This person did X, and here is how', length: [40, 60], words: [120, 160], shots: [7, 10] },
  { name: 'one-number', promise: 'This number will surprise you', length: [20, 45], words: [60, 100], shots: [4, 7] },
  { name: 'timeline', promise: 'How we got here, fast', length: [45, 60], words: [120, 160], shots: [6, 10] },
  { name: 'versus', promise: 'A against B', length: [20, 40], words: [60, 100], shots: [4, 7] },
  { name: 'myth-vs-fact', promise: 'What you believe is wrong', length: [30, 50], words: [90, 130], shots: [6, 9] },
  { name: 'countdown', promise: 'N things, best last', length: [30, 60], words: [50, 100], shots: [6, 9] },
  { name: 'process', promise: 'Do X in N steps', length: [20, 45], words: [32, 70], shots: [5, 8] },
  { name: 'statement', promise: 'Read this', length: [10, 25], words: [20, 50], shots: [3, 6] },
  { name: 'teaser', promise: 'There is a longer thing', length: [10, 20], words: [15, 30], shots: [4, 6] },
  { name: 'loop', promise: 'Watch this turn', length: [5, 15], words: [0, 6], shots: [1, 3] },
];
export const genreByName = name => GENRES.find(g => g.name === name);

// ---------------------------------------------------------------- small helpers
const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const arr = x => x == null ? [] : Array.isArray(x) ? x : [x];
const hasTodo = s => typeof s === 'string' && s.includes('TODO');
const isNum = x => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const round = (x, k = 2) => +x.toFixed(k);
const isHttpUrl = s => { try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };

/** Words of a statement or a caption: the markup (| and *) is not text; a dash alone is not a word. */
export const wordsOf = text => String(text ?? '').replace(/[|*]/g, ' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
/** The lines of a statement: `|` breaks a line, `*` marks the payoff. */
export const linesOf = text => String(text ?? '').split('|').map(l => l.replace(/\*/g, '').replace(/\s+/g, ' ').trim());
/** The numbers (runs of digits, with a decimal part) written in a text. */
export const numbersIn = text => String(text ?? '').match(/\d+(?:[.,]\d+)*/g) || [];

/** Every object with a string `block` in a picture (layers, and the sub-pictures of `split`), depth first. */
export function collectBlocks(pic, out = []) {
  if (Array.isArray(pic)) pic.forEach(p => collectBlocks(p, out));
  else if (isObj(pic)) { if (typeof pic.block === 'string') out.push(pic); for (const v of Object.values(pic)) if (v && typeof v === 'object') collectBlocks(v, out); }
  return out;
}
/** Only the layers of the picture itself, not what is nested in them. */
const layersOf = pic => arr(pic).filter(p => isObj(p) && typeof p.block === 'string');

/** The statements of a shot: say.text, and the lines of a `type` block (the picture that is the text itself). */
export function statementsOf(shot) {
  const out = [];
  for (const s of arr(shot.say)) if (isObj(s) && typeof s.text === 'string') out.push({ text: s.text, kind: 'say', say: s });
  for (const b of collectBlocks(shot.picture)) if (b.block === 'type' && Array.isArray(b.lines)) out.push({ text: b.lines.map(l => l && l.text).filter(Boolean).join(' '), kind: 'type' });
  return out;
}
export const captionsOf = shot => [...arr(shot.say).filter(isObj).map(s => s.caption), shot.caption].filter(c => typeof c === 'string' && c.trim());

// ---------------------------------------------------------------- the blocks library
/** Blocks.list() of runtime/blocks.js, or null when the library cannot be loaded (it may not exist yet). */
export function loadBlocksMeta() {
  try {
    const B = require('../runtime/blocks.js');
    const lib = B && typeof B.list === 'function' ? B : B && B.Blocks;
    const list = lib && typeof lib.list === 'function' ? lib.list() : null;
    return Array.isArray(list) && list.length ? list : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- anchors
function anchorSyntax(a) {
  const keys = Object.keys(a).filter(k => k[0] === '$');
  if (keys.length !== 1) return 'an anchor has exactly one of $word, $phrase, $beat, $shot';
  const k = keys[0], allowed = { $word: ['$word', 'n', 'off'], $phrase: ['$phrase', 'at', 'off'], $beat: ['$beat', 'off'], $shot: ['$shot', 'off'] }[k];
  if (!allowed) return `unknown anchor "${k}" (use $word, $phrase, $beat, $shot)`;
  const extra = Object.keys(a).filter(x => !allowed.includes(x));
  if (extra.length) return `${k} anchor: unexpected key "${extra[0]}" (allowed: ${allowed.slice(1).join(', ')})`;
  if (a.off !== undefined && !isNum(a.off)) return `${k} anchor: "off" must be a number of seconds`;
  if (k === '$word' && !(typeof a.$word === 'string' && a.$word.trim())) return '$word needs the word as a non-empty string';
  if (k === '$word' && a.n !== undefined && !(Number.isInteger(a.n) && a.n >= 1)) return '$word anchor: "n" must be an integer >= 1';
  if (k === '$phrase' && !(Number.isInteger(a.$phrase) && a.$phrase >= 0)) return '$phrase needs a phrase index (an integer >= 0)';
  if (k === '$phrase' && a.at !== undefined && !(a.at === 'start' || a.at === 'end' || isNum(a.at))) return '$phrase anchor: "at" is "start", "end" or seconds';
  if (k === '$beat' && !isNum(a.$beat)) return '$beat needs a beat number';
  if (k === '$shot' && !(a.$shot === 'start' || a.$shot === 'end')) return '$shot is "start" or "end"';
  return null;
}
function* anchorsIn(o, p = '') {
  if (Timing.isAnchor(o)) { yield [p, o]; return; }
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) yield* anchorsIn(o[i], `${p}[${i}]`); }
  else if (isObj(o)) for (const [k, v] of Object.entries(o)) yield* anchorsIn(v, p ? `${p}.${k}` : k);
}
function* todosIn(o, p = '') {
  if (typeof o === 'string') { if (hasTodo(o)) yield p; return; }
  if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) yield* todosIn(o[i], `${p}[${i}]`); }
  else if (isObj(o)) for (const [k, v] of Object.entries(o)) if (k !== 'note') yield* todosIn(v, p ? `${p}.${k}` : k);
}

// ---------------------------------------------------------------- the linter
export function lintSpec(spec, { voice = null, blocks = null, voiceText = null } = {}) {
  const errors = [], warnings = [], info = [];
  const put = (list, rule, shot, message, fix = '') => list.push({ rule, ...(shot ? { shot } : {}), message, fix });
  const err = (rule, shot, message, fix) => put(errors, rule, shot, message, fix);
  const warn = (rule, shot, message, fix) => put(warnings, rule, shot, message, fix);
  const note = (rule, shot, message, fix) => put(info, rule, shot, message, fix);
  const result = () => ({ errors, warnings, info });

  if (!isObj(spec)) { err('required', null, 'the spec is not a JSON object', 'start from a template: node render/new.mjs <id> --genre <genre>'); return result(); }

  // ---- required fields, genre
  if (typeof spec.id !== 'string' || !/^[a-z0-9-]+$/.test(spec.id)) err('required', null, `"id" is missing or not [a-z0-9-]+ (${JSON.stringify(spec.id)})`, 'set "id": "my-video" (it names the output folder)');
  for (const k of ['title', 'thesis', 'hook']) if (typeof spec[k] !== 'string' || !spec[k].trim()) err('required', null, `"${k}" is missing`, `write ${k === 'hook' ? 'the question the first 2 seconds ask' : k === 'thesis' ? 'one concrete sentence' : 'the title'}`);
  const genre = genreByName(spec.genre);
  if (!spec.genre) err('required', null, '"genre" is missing', `one of: ${GENRES.map(g => g.name).join(', ')}`);
  else if (!genre) err('genre', null, `unknown genre "${spec.genre}"`, `one of: ${GENRES.map(g => g.name).join(', ')}`);
  if (!Array.isArray(spec.shots) || !spec.shots.length) { err('required', null, '"shots" is missing or empty', 'add the shots: node render/new.mjs shows a skeleton'); return result(); }
  const shots = spec.shots;
  const voiced = !!spec.voice;
  const name = (s, i) => (s && typeof s.id === 'string' && s.id) || `#${i}`;

  // ---- facts
  const facts = Array.isArray(spec.facts) ? spec.facts : [];
  if (spec.facts !== undefined && !Array.isArray(spec.facts)) err('facts', null, '"facts" must be an array', 'facts: [{ "id": "f1", "text": "...", "source": "https://..." }]');
  const factIds = new Set();
  facts.forEach((f, k) => {
    const label = isObj(f) && f.id ? `fact "${f.id}"` : `fact #${k}`;
    if (!isObj(f) || typeof f.id !== 'string' || !f.id) return err('facts', null, `${label}: no "id"`, 'give every fact an id');
    if (factIds.has(f.id)) err('facts', null, `${label}: the id is used twice`, 'ids must be unique');
    factIds.add(f.id);
    if (typeof f.text !== 'string' || !f.text.trim()) err('facts', null, `${label}: no "text"`, 'state the fact in one sentence');
    if (!hasTodo(f.source) && !isHttpUrl(f.source)) err('fact-source', null, `${label}: "source" is not an http(s) URL (${JSON.stringify(f.source)})`, 'a number with no source is an opinion: give the page that says it');
  });

  // ---- per-shot structure: ids, claims, phrases, transitions, energy, sfx, say
  const seen = new Set(), used = new Set();
  const phraseCount = voice && Array.isArray(voice.phrases) ? voice.phrases.length : (typeof voiceText === 'string' ? voiceText.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(Boolean).length : null);
  let nextPhrase = 0;
  const inTypes = new Set();
  shots.forEach((s, i) => {
    const id = name(s, i);
    if (!isObj(s)) return err('shot', id, 'a shot is not an object', 'every shot is { id, phrases, claim, say, picture, ... }');
    if (typeof s.id !== 'string' || !s.id) err('required', id, 'the shot has no "id"', 'give it a short unique label');
    else if (seen.has(s.id)) err('shot-id', id, `the shot id "${s.id}" is used twice`, 'ids must be unique (they name stills and --shot)');
    seen.add(s.id);
    if (!s.claim) err('required', id, 'the shot has no "claim"', `one of: ${CLAIMS.join(', ')} (21-infographics.md)`);
    else if (!CLAIMS.includes(s.claim)) err('claim', id, `unknown claim "${s.claim}"`, `one of: ${CLAIMS.join(', ')}`);
    // phrases: covered in order, each used once
    if (s.phrases !== undefined) {
      const ph = s.phrases;
      if (!voiced) err('phrases', id, 'the shot has "phrases" but the film is silent ("voice": null)', 'remove "phrases" and use "dur" or "beats", or give the film a voice');
      else if (!Array.isArray(ph) || ph.length < 1 || ph.length > 2 || !ph.every(x => Number.isInteger(x) && x >= 0) || (ph.length === 2 && ph[0] > ph[1])) err('phrases', id, `"phrases" must be [a] or [a, b] with 0 <= a <= b (got ${JSON.stringify(ph)})`, 'phrases: [3] or [3, 4]');
      else {
        const a = ph[0], b = ph[ph.length - 1];
        if (a < nextPhrase) err('phrases', id, `phrase ${a} is already used or out of order (the previous shot ends at phrase ${nextPhrase - 1})`, 'the shots take the voice phrases in order, each once');
        else if (a > nextPhrase) err('phrases', id, `phrase${a - nextPhrase > 1 ? 's' : ''} ${a - nextPhrase > 1 ? nextPhrase + '..' + (a - 1) : nextPhrase} not covered by any shot`, `cover it: phrases: [${nextPhrase}${a - 1 > nextPhrase ? ', ' + (a - 1) : ''}] on a shot, or fix the numbers`);
        if (phraseCount !== null && b >= phraseCount) err('phrases', id, `phrase ${b} does not exist (the voice has ${phraseCount})`, `the last phrase is ${phraseCount - 1}`);
        nextPhrase = Math.max(nextPhrase, b + 1);
      }
    }
    // transitions
    if (s.in !== undefined) {
      const t = isObj(s.in) ? s.in.type : s.in;
      if (!TRANSITIONS.includes(t)) err('transition', id, `unknown transition ${JSON.stringify(t)}`, `one of: ${TRANSITIONS.join(', ')}`);
      else if (i > 0) inTypes.add(t);
    } else if (i > 0) inTypes.add('cut');
    // energy
    if (s.energy !== undefined && !(isNum(s.energy) && s.energy >= 0 && s.energy <= 1)) err('energy', id, `"energy" must be a number from 0 to 1 (got ${JSON.stringify(s.energy)})`, 'quiet 0.1-0.3, build 0.5-0.7, peak 0.9');
    // sfx
    arr(s.sfx).forEach(e => {
      if (!isObj(e) || !SFX_KINDS.includes(e.kind)) err('sfx', id, `unknown sfx kind ${JSON.stringify(isObj(e) ? e.kind : e)}`, `one of: ${SFX_KINDS.join(', ')}`);
    });
    // say
    arr(s.say).forEach(say => {
      if (!isObj(say) || typeof say.text !== 'string') err('say', id, '"say" must be an object with a "text"', 'say: { "text": "ONE|*IDEA*", "payoff": { "$word": "..." } }');
    });
    // facts of the shot
    if (s.facts !== undefined) {
      if (!Array.isArray(s.facts)) err('facts', id, '"facts" of a shot is a list of fact ids', 'facts: ["f1", "f2"]');
      else s.facts.forEach(f => { if (!factIds.has(f)) err('fact-ref', id, `the shot lists fact "${f}", which is not in "facts"`, 'add it to the facts with its source, or fix the id'); else used.add(f); });
    }
  });
  if (voiced && phraseCount !== null && nextPhrase < phraseCount && shots.some(s => s && s.phrases)) err('phrases', null, `phrase${phraseCount - nextPhrase > 1 ? 's' : ''} ${phraseCount - nextPhrase > 1 ? nextPhrase + '..' + (phraseCount - 1) : nextPhrase} at the end of the voice not covered by any shot`, `give the last shot phrases: [.., ${phraseCount - 1}] or add a shot`);
  if (voiced && !shots.some(s => s && s.phrases) && phraseCount) note('phrases', null, 'no shot has "phrases": the film is laid on dur/beats and the voice is only played over it', 'give the shots phrases to lay them on the voice');

  // ---- timing (needs the voice for a spoken film)
  let T = null;
  if (voiced && !(voice && Array.isArray(voice.words) && Array.isArray(voice.phrases))) {
    note('voice', null, 'no voice timings loaded: phrase bounds, anchors, the word budget and the cut-dependent checks are skipped', 'run render/voice.mjs (or render/make.mjs) first, then lint with --voice out/voice');
  } else {
    try { T = Timing.resolve(voiced ? spec : { ...spec, shots: shots.map(s => isObj(s) ? { ...s, phrases: undefined } : s) }, voiced ? voice : null); }
    catch (e) { const m = /shot "([^"]+)"/.exec(e.message); err('timing', m && m[1], e.message, 'check the phrases of this shot and of its neighbours (a shot cannot end before it starts)'); }
  }

  // ---- anchors
  let missedVoice = false;
  shots.forEach((s, i) => {
    if (!isObj(s)) return;
    const id = name(s, i);
    for (const part of ['say', 'picture', 'sfx', 'set']) {
      for (const [p, a] of anchorsIn(s[part], part)) {
        const bad = anchorSyntax(a);
        if (bad) { err('anchor-syntax', id, `${p}: ${bad}`, 'see "Anchors" in 23-short-factory.md'); continue; }
        if (hasTodo(a.$word)) continue;                                       // a placeholder: the TODO finding covers it
        if (!voiced && ('$word' in a || '$phrase' in a)) { err('anchor', id, `${p}: ${('$word' in a) ? '$word "' + a.$word + '"' : '$phrase'} in a silent film (no voice to anchor on)`, 'use seconds, $beat or $shot'); continue; }
        if (!T) { if (voiced && ('$word' in a || '$phrase' in a)) missedVoice = true; continue; }
        let t; try { t = T.anchor(i, a); } catch (e) { err('anchor', id, `${p}: ${e.message}`, '$word must be a word the voice says (case, punctuation, e/yo ignored); write numbers as in voice.txt, or anchor on a neighbouring word'); continue; }
        const key = p.split('.').pop();
        if (['start', 'payoff', 'out', 'at'].includes(key) && s.phrases && (t < -0.05 || t > T.shots[i].dur + 0.05)) warn('anchor-range', id, `${p} resolves to ${round(t)} s, outside the shot (0 .. ${round(T.shots[i].dur)} s)`, 'the word is spoken in another shot: move the anchor or the shot boundary');
      }
    }
  });
  if (missedVoice) note('anchor', null, 'the $word and $phrase anchors were not resolved (no voice timings)', 'lint again with the voice');

  // ---- statements
  const defSize = Math.round(((spec.format && spec.format.W) || 1080) * 0.087), size = (spec.style && spec.style.statementSize) || defSize;
  const maxLine = Math.max(8, Math.floor(16 * defSize / size));
  const stmtWords = shots.map(s => isObj(s) ? statementsOf(s).reduce((n, st) => n + wordsOf(st.text).length, 0) : 0);
  const capWords = shots.map(s => isObj(s) ? captionsOf(s).reduce((n, c) => n + wordsOf(c).length, 0) : 0);
  shots.forEach((s, i) => {
    if (!isObj(s)) return;
    const id = name(s, i);
    for (const st of statementsOf(s)) {
      if (st.kind !== 'say') continue;
      const n = wordsOf(st.text).length, lines = linesOf(st.text).filter(Boolean);
      if (n > 8) err('statement-words', id, `the statement has ${n} words (at most 8): "${st.text.replace(/\|/g, ' / ')}"`, 'cut words, not pictures: the statement is the claim, not the sentence');
      if (lines.length > 3) err('statement-lines', id, `the statement has ${lines.length} lines (at most 3)`, 'shorten it');
      lines.forEach(l => { if (l.length > maxLine) err('statement-line', id, `the line "${l}" has ${l.length} characters (at most ${maxLine}; the text is shrunk to fit otherwise)`, 'break it with | or choose a shorter word'); });
      if (!st.text.includes('*') && !hasTodo(st.text)) warn('payoff', id, 'the statement has no *payoff* word', 'mark the word the picture\'s decisive move lands on: ONE|*IDEA*');
      if (T && s.phrases) {
        const sh = T.shots[i], say = st.say, start = say.start !== undefined && !hasTodo(JSON.stringify(say.start)) ? safeAnchor(T, i, say.start) : (sh.words && T.words[sh.words[0]] ? T.words[sh.words[0]].start - sh.start : 0.1);
        const out = say.out !== undefined ? safeAnchor(T, i, say.out) : sh.dur;
        if (start !== null && out !== null && out - start < 2 - 1e-6) warn('statement-time', id, `the statement is on screen for ${round(out - start)} s (at least 2 s)`, 'start it earlier, let it stay to the end of the shot, or cut the shot\'s neighbour short');
      }
    }
  });
  function safeAnchor(Tm, i, a) { try { return Tm.anchor(i, a); } catch { return null; } }

  // ---- word budget
  const sumStmt = stmtWords.reduce((a, b) => a + b, 0), sumCap = capWords.reduce((a, b) => a + b, 0);
  const voiceWords = voice && Array.isArray(voice.words) ? voice.words.length : 0;
  if (T) {
    const dur = T.duration;
    if (voiced) {
      const read = sumStmt + voiceWords;       // what a muted viewer reads: the statements and the subtitles (the captions are the source line, read by few)
      if (read > 2.5 * dur) warn('budget', null, `${read} words (statements ${sumStmt} + voice ${voiceWords}) in ${round(dur, 1)} s is ${round(read / dur)} words/s (at most 2.5)`, `cut about ${Math.ceil(read - 2.5 * dur)} words from the statements or the voice text`);
      if (voiceWords > 2.2 * dur) warn('budget-voice', null, `the voice alone is ${round(voiceWords / dur)} words/s (at most 2.2)`, 'shorten voice.txt');
      (voice.phrases || []).forEach((p, k) => {
        const n = p.words ? p.words[1] - p.words[0] : wordsOf(p.text).length, wps = n / Math.max(0.01, p.end - p.start);
        if (Math.round(wps * 10) / 10 > 2.6) warn('voice-pace', null, `phrase ${k} is read at ${round(wps)} words/s (at most 2.6): "${String(p.text).slice(0, 50)}"`, 'shorten the phrase, split it in two, or slow the voice (voice.rate)');
      });
    } else {
      const read = sumStmt + sumCap;
      if (read > 2.5 * dur) warn('budget', null, `${read} words (statements ${sumStmt} + captions ${sumCap}) in ${round(dur, 1)} s is ${round(read / dur)} words/s (at most 2.5)`, `cut about ${Math.ceil(read - 2.5 * dur)} words`);
    }
  }

  // ---- the hook
  const first = shots[0];
  if (isObj(first) && spec.genre !== 'loop') {
    const hid = name(first, 0);
    if (!statementsOf(first).length) err('hook-statement', hid, 'the first shot has no statement (say.text, or a type block)', 'the question must be in words by second 2: a title card is not a hook');
    else if (T) {
      const sh = T.shots[0], says = statementsOf(first).filter(st => st.kind === 'say');
      if (says.length) {
        const st = says[0].say, start = st.start !== undefined && !hasTodo(JSON.stringify(st.start)) ? safeAnchor(T, 0, st.start) : (sh.words && T.words[sh.words[0]] ? T.words[sh.words[0]].start - sh.start : 0.1);
        if (start !== null && start > 2 + 1e-6) err('hook-late', hid, `the first statement starts at ${round(start)} s (by 2 s)`, 'start the statement earlier (say.start)');
      }
    }
    if (T) {
      // how long the hook takes: to the end of its last spoken word (the cut itself sits in the middle of the pause after the phrase, which the author does not control)
      const sh = T.shots[0], lastWord = sh.words && sh.words[1] > sh.words[0] ? T.words[sh.words[1] - 1] : null, took = lastWord ? lastWord.end - sh.start : sh.dur;
      if (took > 3.5 + 1e-6) warn('hook-length', hid, `the hook takes ${round(took)} s (at most 3.5 s)${lastWord ? ' to the end of its last word' : ''}`, 'shorten the first voice phrase or the shot');
    }
  }

  // ---- transitions, HUD
  if (inTypes.size > 5) err('transitions', null, `${inTypes.size} transition types are used (${[...inTypes].join(', ')}); at most 5`, 'a silent viewer reads a cut as grammar: one meaning per type, 3-5 types');
  const hud = spec.hud;
  if (hud !== undefined && !isObj(hud)) err('hud', null, '"hud" must be an object { kind, key, ... }', 'hud: { "kind": "rail", "key": "year", "span": [a, b], "marks": [...] }');
  else if (isObj(hud)) {
    if (!HUD_KINDS.includes(hud.kind)) err('hud', null, `unknown HUD kind ${JSON.stringify(hud.kind)}`, `one of: ${HUD_KINDS.join(', ')}`);
    else if (hud.kind !== 'none') {
      if (typeof hud.key !== 'string' || !hud.key) err('hud', null, 'the HUD has no "key"', 'the name of the value the shots set: hud.key = "year", shots: set: { "year": 1954 }');
      else if (!shots.some(s => isObj(s) && isObj(s.set) && hud.key in s.set)) err('hud-key', null, `no shot sets the HUD value "${hud.key}"`, `add "set": { "${hud.key}": ... } to the shots that change it`);
      if (hud.kind === 'rail' && !(Array.isArray(hud.span) && hud.span.length === 2 && hud.span.every(isNum) && hud.span[0] < hud.span[1])) err('hud', null, 'a rail HUD needs "span": [from, to]', 'hud: { "kind": "rail", "key": "year", "span": [1911, 1973], "marks": [...] }');
    }
  }

  // ---- numbers need facts
  shots.forEach((s, i) => {
    if (!isObj(s)) return;
    const id = name(s, i);
    const texts = [...statementsOf(s).filter(st => st.kind === 'say').map(st => st.text), ...captionsOf(s)];
    if (T && voiced && voice && s.phrases) { const ph = T.shots[i].phrases; for (let k = ph[0]; k <= ph[1]; k++) if (voice.phrases[k]) texts.push(voice.phrases[k].text); }
    const nums = texts.filter(t => !hasTodo(t)).flatMap(numbersIn);        // a placeholder is not a number
    if (nums.length && !(Array.isArray(s.facts) && s.facts.length)) err('number-fact', id, `the shot says ${[...new Set(nums)].slice(0, 5).join(', ')} but lists no fact`, 'add "facts": ["fN"] with the fact and its source URL (a number with no source is an opinion in a bold font)');
  });
  facts.forEach(f => { if (isObj(f) && f.id && factIds.has(f.id) && !used.has(f.id)) warn('fact-unused', null, `fact "${f.id}" is not listed on any shot`, 'list it in a shot\'s "facts" (it feeds the Sources of post.md) or delete it'); });

  // ---- pictures and blocks
  const byName = new Map((blocks || []).map(b => [b.name, b]));
  if (!blocks) note('blocks', null, 'runtime/blocks.js metadata not available: block names and parameters were not checked', 'build the blocks library, or pass Blocks.list() to lintSpec');
  shots.forEach((s, i) => {
    if (!isObj(s)) return;
    const id = name(s, i), pics = collectBlocks(s.picture), layers = layersOf(s.picture);
    if (s.picture === undefined || (Array.isArray(s.picture) && !s.picture.length)) { if (s.claim && s.claim !== 'typographic') warn('no-picture', id, `claim "${s.claim}" but no picture`, 'add a block that proves the claim, or make the shot typographic'); return; }
    if (!layers.length) { err('picture', id, '"picture" must be a block object { "block": "..." } or an array of them', 'picture: { "block": "bars", ... }'); return; }
    if (!blocks) return;
    for (const p of pics) {
      const meta = byName.get(p.block);
      if (!meta) { err('block', id, `unknown block "${p.block}"`, `one of: ${[...byName.keys()].join(', ')}`); continue; }
      const params = isObj(meta.params) ? meta.params : {};
      for (const [k, def] of Object.entries(params)) if (def && def.required && p[k] === undefined) err('block-params', id, `block "${p.block}" needs "${k}"`, `add "${k}"${def.type ? ' (' + def.type + ')' : ''}`);
      const common = new Set(['block', 'at', 'dur', 'area', 'tone']);
      if (Object.keys(params).length) for (const k of Object.keys(p)) if (!common.has(k) && !(k in params)) warn('block-param', id, `block "${p.block}" has no parameter "${k}"`, `known: ${Object.keys(params).join(', ')}`);
    }
    // the shot's claim should be one the picture's block draws
    const metas = layers.map(l => byName.get(l.block)).filter(m => m && m.claim);
    if (s.claim && metas.length && !metas.some(m => String(Array.isArray(m.claim) ? m.claim.join(' ') : m.claim).toLowerCase().includes(s.claim))) warn('block-claim', id, `claim "${s.claim}" but the block${metas.length > 1 ? 's draw' : ' draws'} ${[...new Set(metas.map(m => m.claim))].join(' / ')}`, 'choose the block for the claim (21-infographics.md), or change the claim');
  });

  // ---- genre card
  genreRules();
  function genreRules() {
    if (!genre) return;
    const g = genre.name, all = shots.filter(isObj), blocksOf = s => collectBlocks(s.picture), has = (n, pred = () => true) => all.some(s => blocksOf(s).some(b => b.block === n && pred(b)));
    const where = i => name(shots[i], i);
    const n = shots.length;
    if (n < genre.shots[0] || n > genre.shots[1]) warn('genre-shots', null, `${n} shots; a ${g} film usually has ${genre.shots[0]}-${genre.shots[1]}`, 'split or merge shots');
    if (T) {
      const lo = genre.length[0] * 0.9, hi = genre.length[1] * 1.1;
      if (T.duration < lo || T.duration > hi) warn('genre-length', null, `${round(T.duration, 1)} s; a ${g} film runs ${genre.length[0]}-${genre.length[1]} s`, 'cut or extend the script');
    }
    const textWords = sumStmt + sumCap;
    if (textWords > genre.words[1]) warn('genre-words', null, `${textWords} words of statements and captions; a ${g} film has ${genre.words[0]}-${genre.words[1]}`, 'cut words');
    const needHud = (kinds, why) => { if (!(isObj(hud) && kinds.includes(hud.kind))) err('genre-hud', null, `${g}: ${why}`, `hud: { "kind": "${kinds[0]}", "key": "..." }`); };
    switch (g) {
      case 'how-it-works':
        if (!all.some(s => s.claim === 'mechanism')) err('genre-card', null, 'how-it-works: no shot with claim "mechanism"', 'show the mechanism running: a flow block with a token');
        else if (!has('flow', b => b.token)) warn('genre-card', null, 'how-it-works: no flow block with a "token" (a mechanism is shown by running it)', 'add token: { route: [...], at, dur } to the flow');
        break;
      case 'one-life': needHud(['rail'], 'the through-line is a timeline in the HUD (rail with the year)'); break;
      case 'timeline':
        needHud(['rail'], 'the marker on a rail in the HUD never stops moving');
        if (T && n >= 6) { const mid = T.shots.slice(1, -1), h = Math.floor(mid.length / 2), a = mid.slice(0, h), b = mid.slice(mid.length - h), avg = x => x.reduce((s, y) => s + y.dur, 0) / (x.length || 1); if (h && avg(b) >= avg(a)) warn('timeline-pace', null, 'the pace does not accelerate: the later eras are not shorter than the earlier ones', 'importance decides screen time; speed up toward the present'); }
        break;
      case 'one-number':
        if (!(has('counter', b => b.ref) || has('bars', b => arr(b.items).some(it => it && it.ref)))) err('genre-card', null, 'one-number: no counter with "ref" and no bars with a "ref" item (the number needs a yardstick in the frame)', 'counter: { value, unit, ref: { label, value } }  or  bars: items: [{ ref: true, ... }, { accent: true, ... }]');
        if (isObj(first) && isObj(shots[n - 1]) && !(blocksOf(first).some(b => ['counter', 'bars'].includes(b.block)) && blocksOf(shots[n - 1]).some(b => ['counter', 'bars'].includes(b.block)))) warn('genre-card', where(0), 'one-number: the number should be both the hook and the ending (a counter or bars in the first and in the last shot)', 'bring the number back in the last shot with its meaning');
        break;
      case 'versus': {
        if (!has('split')) err('genre-card', null, 'versus: no split block (two pictures side by side, the same encoding on both sides)', 'picture: { "block": "split", "left": {...}, "right": {...} }');
        const k = all.filter(s => blocksOf(s).some(b => b.block === 'split')).length;
        if (k > 5) warn('genre-card', null, `versus: ${k} split shots; more than 4 criteria (plus the hook and the verdict) kills it`, 'one criterion per shot, at most 4');
        break;
      }
      case 'myth-vs-fact':
        if (isObj(first) && statementsOf(first).some(st => !hasTodo(st.text) && /\bmyth\b|миф/i.test(st.text))) warn('genre-card', where(0), 'myth-vs-fact: the first statement announces a myth (no crack to feel)', 'tell the myth straight; the crack comes later');
        if (!all.some(s => s.claim === 'comparison' || s.claim === 'change')) warn('genre-card', null, 'myth-vs-fact: no comparison/change shot for the crack (a bar that does not reach, a date that is wrong)', 'add a shot where the same picture contradicts itself');
        break;
      case 'countdown': {
        needHud(['rail', 'counter'], 'a visible counter in the HUD (5... 4... 3...)');
        if (T) { const items = all.map((s, i) => ({ s, i })).filter(x => x.s.claim === 'ranking').slice(0, -1); if (items.length >= 3) { const ds = items.map(x => T.shots[x.i].dur); if (Math.max(...ds) / Math.min(...ds) > 1.6) warn('countdown-items', null, 'countdown: items are not of equal length (the viewer learns the form by item two)', 'equal time per item; number one gets double'); } }
        break;
      }
      case 'process':
        needHud(['rail', 'counter'], 'the step number in the HUD');
        all.forEach((s, i) => { if (s.claim !== 'typographic') for (const st of statementsOf(s)) if (st.kind === 'say' && wordsOf(st.text).length > 6) warn('genre-card', where(i), `process: the instruction has ${wordsOf(st.text).length} words (imperative, at most 6)`, 'shorten it'); });
        break;
      case 'statement':
        if (!has('type')) err('genre-card', null, 'statement: no "type" block (the picture is the text itself)', 'picture: { "block": "type", "lines": [{ "text": "...", "tone": "accent" }] }');
        all.forEach((s, i) => { if (s.claim !== 'typographic') warn('genre-card', where(i), 'statement: the shot is not typographic (size, weight, color and motion are the picture)', 'claim: "typographic"'); });
        break;
      case 'teaser':
        if (typeof spec.hook === 'string' && !hasTodo(spec.hook) && !spec.hook.includes('?')) warn('genre-card', null, 'teaser: the hook is not a question (ask the long film\'s question)', 'end the hook with ?');
        break;
      case 'loop':
        if (voiced) err('genre-card', null, 'loop: the film has a voice (a loop is silent)', '"voice": null');
        all.forEach((s, i) => { if (statementsOf(s).length) err('genre-card', where(i), 'loop: the shot has text (a loop has no say, or a single line that stays)', 'remove "say"'); });
        break;
      default: break;
    }
    // the ending calls back to the first frame (rule 9)
    if (n > 1 && isObj(first) && isObj(shots[n - 1])) {
      const a = new Set(collectBlocks(first.picture).map(b => b.block)), b = collectBlocks(shots[n - 1].picture).map(x => x.block);
      if (a.size && b.length && !b.some(x => a.has(x)) && g !== 'loop') note('callback', where(n - 1), 'the last picture uses no block of the first one (the ending should call back to the first frame)', 'rule 9 of the silent contract: return to the opening image, transformed');
    }
  }

  // ---- TODO
  const todo = new Map();
  for (const p of todosIn(spec)) {
    const m = /^shots\[(\d+)\]/.exec(p), key = m ? name(shots[+m[1]], +m[1]) : p.split(/[.[]/)[0];
    if (!todo.has(key)) todo.set(key, { shot: !!m, paths: [] });
    todo.get(key).paths.push(m ? p.replace(/^shots\[\d+\]\.?/, '') : p);
  }
  for (const [key, v] of todo) err('todo', v.shot ? key : null, `${v.shot ? '' : `"${key}": `}${v.paths.length} placeholder${v.paths.length > 1 ? 's' : ''} left: ${v.paths.slice(0, 4).join(', ')}${v.paths.length > 4 ? ', ...' : ''}`, 'replace the TODO text');
  if (typeof voiceText === 'string' && hasTodo(voiceText)) err('todo', null, `voice.txt still has ${(voiceText.match(/TODO/g) || []).length} placeholder(s)`, 'write the voice text (one paragraph per phrase)');

  // ---- summary
  note('summary', null, `${shots.length} shots${T ? ', ' + round(T.duration, 1) + ' s' : ''}; statements ${sumStmt} words, captions ${sumCap}${voiced && voiceWords ? ', voice ' + voiceWords + (T ? ' (' + round(voiceWords / T.duration) + '/s)' : '') : ''}; transitions: ${[...inTypes].join(', ') || 'none'}`);
  return result();
}

// ---------------------------------------------------------------- captions: SRT and VTT from the voice's subtitle groups
/** The subtitle groups of the voice (phrases.json): each phrase's own groups, or the phrase itself when it has none. */
export const groupsOf = phrases => (phrases || []).flatMap(p => (p.groups && p.groups.length) ? p.groups : [{ text: p.text, start: p.start, end: p.end }]);

/**
 * Caption cues from groups [{ text, start, end }]: shifted by `offset` (spec.voice.offset), each lasts at least `minDur` seconds
 * and never overlaps the next one (the overlap rule wins when the two meet).
 */
export function buildCues(groups, { offset = 0, minDur = 0.8 } = {}) {
  const cues = (groups || []).filter(g => g && typeof g.text === 'string' && g.text.trim() && isNum(g.start) && isNum(g.end))
    .map(g => ({ text: g.text.trim().replace(/\s+/g, ' '), start: Math.max(0, g.start + offset), end: g.end + offset })).sort((a, b) => a.start - b.start);
  cues.forEach((c, i) => {
    let end = Math.max(c.end, c.start + minDur);
    const next = cues[i + 1];
    if (next && next.start > c.start) end = Math.min(end, next.start);
    c.end = Math.max(end, c.start + 0.04);
  });
  return cues.map(c => ({ text: c.text, start: Math.round(c.start * 1000) / 1000, end: Math.round(c.end * 1000) / 1000 }));
}
export function formatTime(t, sep = ',') {
  const ms = Math.max(0, Math.round(t * 1000)), p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
}
export function toSrt(groups, opts) {
  return buildCues(groups, opts).map((c, i) => `${i + 1}\n${formatTime(c.start, ',')} --> ${formatTime(c.end, ',')}\n${c.text}\n`).join('\n');
}
export function toVtt(groups, opts) {
  return 'WEBVTT\n\n' + buildCues(groups, opts).map(c => `${formatTime(c.start, '.')} --> ${formatTime(c.end, '.')}\n${c.text}\n`).join('\n');
}

// ---------------------------------------------------------------- the cover
/**
 * Where the cover frame is: spec.post.cover = { shot, at } (at: seconds inside that shot, or an anchor); default the hook shot at 2.0 s.
 * T = Timing.resolve(spec, voice). Returns { shot, index, local, t } (t: seconds of the film, clamped into the shot).
 */
export function coverTime(spec, T) {
  const cover = (spec.post && spec.post.cover) || {};
  const id = cover.shot ?? spec.shots[0].id, i = T.shots.findIndex(s => s.id === id);
  if (i < 0) throw new Error(`post.cover.shot "${id}" is not a shot of the spec (${T.shots.map(s => s.id).join(', ')})`);
  const sh = T.shots[i];
  let at = cover.at === undefined ? 2.0 : cover.at;
  if (!isNum(at)) at = T.anchor(i, at);
  // keep off the edges of the shot: a transition (up to 0.75 s) is blending the neighbour in there and the frame is half transparent
  const edge = Math.min(0.8, sh.dur / 3), local = clamp(at, edge, Math.max(edge, sh.dur - edge));
  return { shot: id, index: i, local: round(local, 3), t: round(Math.min(sh.start + local, T.duration - 0.05), 3) };
}

// ---------------------------------------------------------------- the post text
const sentenceCase = s => { const t = s.trim(); if (!(t === t.toUpperCase() && /\p{L}/u.test(t))) return t; return t.toLowerCase().replace(/(^|[.!?…]\s+)(\p{L})/gu, (m, a, c) => a + c.toUpperCase()); };   // ALL CAPS statements read as sentences in an alt text
/** An alt text from the shots' statements, in order: "Ya. Ona. ..." */
export function altText(spec, maxChars = 900) {
  const parts = [];
  for (const s of spec.shots || []) for (const st of statementsOf(s)) {
    const t = sentenceCase(linesOf(st.text).join(' ').replace(/\s+/g, ' '));
    if (t) parts.push(/[.!?…]$/.test(t) ? t : t + '.');
  }
  let out = parts.join(' ');
  if (out.length > maxChars) out = out.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
  return out;
}
/** The sources of a post: the facts that shots list, once each, in order of first use. */
export function sourcesOf(spec) {
  const byId = new Map((spec.facts || []).map(f => [f.id, f])), out = [];
  for (const s of spec.shots || []) for (const id of arr(s.facts)) { const f = byId.get(id); if (f && !out.includes(f)) out.push(f); }
  return out;
}
export const hashtag = t => { const w = String(t).replace(/^#/, '').replace(/[^\p{L}\p{N}_]+/gu, ''); return w ? '#' + w : ''; };
/** post.md: the hook first, then the description, the sources, the tags; then the title and the alt text. Plain text, ready to paste. */
export function buildPostMd(spec, { duration = null, cover = null } = {}) {
  const post = spec.post || {}, lines = [];
  lines.push(spec.hook || post.title || spec.title, '');
  if (post.description) lines.push(post.description, '');
  const src = sourcesOf(spec);
  // one line per source page, not per fact: a post is read by a person, and ten facts often come from three pages
  const urls = [...new Set(src.map(f => f.source))];
  if (urls.length) lines.push('Sources:', ...urls.map(u => `- ${u}`), '');
  const tags = (post.tags || []).map(hashtag).filter(Boolean);
  if (tags.length) lines.push(tags.join(' '), '');
  lines.push('---', `Title: ${post.title || spec.title}`, `Alt text: ${altText(spec)}`);
  if (duration) lines.push(`Length: ${round(duration, 1)} s`);
  if (cover) lines.push(`Cover: cover.jpg is the frame at ${round(cover.t, 2)} s (shot ${cover.shot}); cover-1080x1350.jpg is the 4:5 crop`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- JSON for humans (templates, scaffolds)
/** JSON with short objects and arrays on one line and long ones broken: what a spec file should look like when written by a tool. */
export function formatJson(v, indent = 0, width = 118) {
  const defined = x => Object.entries(x).filter(([, y]) => y !== undefined);
  const inline = x => Array.isArray(x) ? '[' + x.map(inline).join(', ') + ']' : isObj(x) ? (defined(x).length ? '{ ' + defined(x).map(([k, y]) => JSON.stringify(k) + ': ' + inline(y)).join(', ') + ' }' : '{}') : JSON.stringify(x);
  const one = inline(v), pad = '  '.repeat(indent);
  if (!v || typeof v !== 'object' || pad.length + one.length <= width) return one;
  const pad1 = '  '.repeat(indent + 1);
  if (Array.isArray(v)) return '[\n' + v.map(x => pad1 + formatJson(x, indent + 1, width)).join(',\n') + '\n' + pad + ']';
  return '{\n' + defined(v).map(([k, x]) => pad1 + JSON.stringify(k) + ': ' + formatJson(x, indent + 1, width)).join(',\n') + '\n' + pad + '}';
}

// ---------------------------------------------------------------- scaffolds
/** Voices and fonts known for a language; any other language is left as a TODO for the author. */
export const LANG_DEFAULTS = {
  ru: { voice: 'ru-RU-DmitryNeural', display: 'Oswald', mono: 'IBM Plex Mono' },
  en: { voice: 'en-US-GuyNeural', display: 'Oswald', mono: 'IBM Plex Mono' },
};
/** A new spec from a genre template: the id, the language, the voice name and the fonts. Returns { spec, notes } (notes: what the author must still set). */
export function scaffoldSpec(template, { id, lang = 'ru' }) {
  const spec = JSON.parse(JSON.stringify(template)), notes = [], known = LANG_DEFAULTS[lang];
  spec.id = id;
  spec.lang = lang;
  if (known) {
    if (spec.voice) spec.voice.voice = known.voice;
    spec.style = { ...spec.style, display: known.display, mono: known.mono };
  } else {
    if (spec.voice) spec.voice.voice = `TODO: voice name for "${lang}" (node render/voice.mjs --voices ${lang})`;
    notes.push(`language "${lang}": set voice.voice (node render/voice.mjs --voices ${lang}) and style.display / style.mono (Google Fonts families that have your script)`);
  }
  return { spec, notes };
}
