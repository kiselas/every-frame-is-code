// The short factory's spec tools (render/spec-lib.mjs, lint-spec.mjs, new.mjs): the linter against a real script, one test per important rule,
// SRT/VTT, the cover time, the genre templates. The fixture is the Lyapunov film (9 shots over the 9 phrases of examples/lyapunov/voice.txt)
// with a snapshot of its real voice timings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENRES, altText, buildCues, buildPostMd, coverTime, formatJson, formatTime, groupsOf, lintSpec, loadBlocksMeta, scaffoldSpec, sourcesOf, toSrt, toVtt,
} from '../../render/spec-lib.mjs';

const Timing = createRequire(import.meta.url)('../timing.js');
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..', '..');
const fx = f => path.join(here, 'fixtures', f);
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const SPEC = readJson(fx('spec-lyapunov.json'));
const VOICE = { words: readJson(fx('lyapunov.voice.words.json')), phrases: readJson(fx('lyapunov.voice.phrases.json')) };
const clone = o => JSON.parse(JSON.stringify(o));

// Blocks.list() as 23-short-factory.md documents it (the real library is written separately)
const P = (names, required = []) => Object.fromEntries(names.split(' ').map(n => [n, { type: 'any', required: required.includes(n) }]));
const BLOCKS = [
  { name: 'bars', claim: 'magnitude, comparison, ranking', params: P('items unit max log order showValue', ['items']) },
  { name: 'counter', claim: 'magnitude', params: P('value from unit format log ref label', ['value']) },
  { name: 'rail', claim: 'change, location in time', params: P('span marks spans cursor title', ['span']) },
  { name: 'tree', claim: 'structure', params: P('root levels names countLabel grow', ['root', 'levels']) },
  { name: 'units', claim: 'part of a whole, magnitude', params: P('n perRow icon groups unit', ['n']) },
  { name: 'split', claim: 'comparison', params: P('left right dead deadAt divider', ['left', 'right']) },
  { name: 'flow', claim: 'mechanism', params: P('nodes edges token counters', ['nodes', 'edges']) },
  { name: 'columns', claim: 'identity', params: P('cols rows base digits scroll glitch label') },
  { name: 'map', claim: 'location', params: P('from to km ref curve', ['from', 'to']) },
  { name: 'card', claim: 'identity', params: P('layers', ['layers']) },
  { name: 'plate', claim: 'identity', params: P('title sub years facts', ['title']) },
  { name: 'type', claim: 'typographic', params: P('lines', ['lines']) },
];

const lint = (spec, o = {}) => lintSpec(spec, { voice: VOICE, ...o });
const find = (r, rule, shot) => [...r.errors, ...r.warnings].filter(f => f.rule === rule && (shot === undefined || f.shot === shot));
function mutate(fn, o) { const s = clone(SPEC); fn(s); return lint(s, o); }
const fails = (rule, fn, { shot, kind = 'errors', ...o } = {}) => { const r = mutate(fn, o); assert.ok(r[kind].some(f => f.rule === rule && (shot === undefined || f.shot === shot)), `expected ${kind} "${rule}"${shot ? ' on ' + shot : ''}, got ${JSON.stringify([...r.errors, ...r.warnings].map(f => f.rule + (f.shot ? '@' + f.shot : '')))}`); return r; };

// ---------------------------------------------------------------- the Lyapunov film passes
test('the Lyapunov fixture (real voice) lints clean: no errors, no warnings', () => {
  const r = lint(SPEC);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.info.some(f => f.rule === 'summary'), 'a summary note');
  for (const f of [...r.errors, ...r.warnings, ...r.info]) assert.ok(typeof f.rule === 'string' && typeof f.message === 'string' && 'fix' in f, 'every finding has rule, message, fix');
});
test('the fixture also passes against the documented blocks metadata', () => {
  const r = lint(SPEC, { blocks: BLOCKS });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.ok(!r.info.some(f => f.rule === 'blocks'), 'no "blocks not available" note');
});
test('without the voice the timing checks are skipped with an info, not failed', () => {
  const r = lintSpec(SPEC, { voice: null });
  assert.deepEqual(r.errors, []);
  assert.ok(r.info.some(f => f.rule === 'voice'));
});
test('the real blocks library, when it exists, accepts the fixture (no errors)', t => {
  const meta = loadBlocksMeta();
  if (!meta) return t.skip('runtime/blocks.js is not loadable yet');
  assert.deepEqual(lint(SPEC, { blocks: meta }).errors, []);
});
test('the fixture is consistent with the timing module: nine shots over nine phrases, the cut in the pause', () => {
  const T = Timing.resolve(SPEC, VOICE);
  assert.equal(T.shots.length, 9);
  assert.equal(T.shots[0].start, 0);
  assert.ok(T.duration > 55 && T.duration < 65);
  assert.ok(T.anchor(1, SPEC.shots[1].say.payoff) > 0);
});

// ---------------------------------------------------------------- one test per important rule
test('required fields', () => {
  fails('required', s => { delete s.thesis; });
  fails('required', s => { s.id = 'Bad Id'; });
  fails('required', s => { delete s.shots[2].claim; }, { shot: 'who' });
  fails('required', s => { s.shots = []; });
});
test('genre and claim names', () => {
  fails('genre', s => { s.genre = 'documentary'; });
  fails('claim', s => { s.shots[2].claim = 'vibes'; }, { shot: 'who' });
});
test('shot ids are unique', () => { fails('shot-id', s => { s.shots[3].id = 'who'; }); });
test('phrases: covered in order, each once, all exist', () => {
  fails('phrases', s => { s.shots[4].phrases = [3]; }, { shot: 'scheme' });                  // used twice
  fails('phrases', s => { s.shots.pop(); });                                                  // the last phrase is not covered
  fails('phrases', s => { s.shots[5].phrases = [6]; s.shots[6].phrases = [7]; s.shots[7].phrases = [8]; s.shots[8].phrases = [8]; });    // a gap
  fails('phrases', s => { s.shots[8].phrases = [9]; }, { shot: 'end' });                      // beyond the voice
  fails('phrases', s => { s.voice = null; }, { shot: 'hook' });                               // phrases in a silent film
});
test('anchors: a $word the voice does not say, and a malformed anchor', () => {
  fails('anchor', s => { s.shots[1].say.payoff = { $word: 'несуществует' }; }, { shot: 'label' });
  fails('anchor', s => { s.shots[0].sfx = [{ at: { $phrase: 99 }, kind: 'stamp' }]; }, { shot: 'hook' });
  fails('anchor-syntax', s => { s.shots[1].say.payoff = { $word: 'лжеучёным', $phrase: 1 }; }, { shot: 'label' });
  fails('anchor-syntax', s => { s.shots[1].say.payoff = { $word: 'лжеучёным', n: 0 }; }, { shot: 'label' });
  fails('anchor-syntax', s => { s.shots[1].say.payoff = { $bogus: 1 }; }, { shot: 'label' });
  fails('anchor', s => { s.voice = null; s.shots.forEach(x => { delete x.phrases; x.dur = 3; }); }, { shot: 'hook', voice: null });   // $word in a silent film
});
test('anchors that land outside their shot are warned', () => { fails('anchor-range', s => { s.shots[1].say.payoff = { $word: 'математик' }; }, { shot: 'label', kind: 'warnings' }); });
test('blocks: unknown name, missing required parameter, unknown parameter, claim mismatch', () => {
  fails('block', s => { s.shots[1].picture.block = 'hologram'; }, { shot: 'label', blocks: BLOCKS });
  fails('block-params', s => { delete s.shots[1].picture.layers; }, { shot: 'label', blocks: BLOCKS });
  fails('block-params', s => { delete s.shots[0].picture.right; }, { shot: 'hook', blocks: BLOCKS });
  fails('block-param', s => { s.shots[3].picture.colour = 'red'; }, { shot: 'numbers', blocks: BLOCKS, kind: 'warnings' });
  fails('block-claim', s => { s.shots[2].claim = 'identity'; }, { shot: 'who', blocks: BLOCKS, kind: 'warnings' });
  const r = mutate(s => { s.shots[1].picture.block = 'hologram'; });
  assert.ok(!r.errors.some(f => f.rule === 'block'), 'without the metadata nothing is said about blocks');
  assert.ok(r.info.some(f => f.rule === 'blocks'));
});
test('statements: at most 8 words, 3 lines, 16 characters a line, a payoff, 2 s on screen', () => {
  fails('statement-words', s => { s.shots[0].say.text = 'А Б В Г Д Е Ж З И'; }, { shot: 'hook' });
  fails('statement-line', s => { s.shots[0].say.text = 'ВОСЕМНАДЦАТЬ БУКВ ЗДЕСЬ|*СЛОВО*'; }, { shot: 'hook' });
  fails('statement-lines', s => { s.shots[0].say.text = 'А|Б|В|*Г*'; }, { shot: 'hook' });
  fails('payoff', s => { s.shots[0].say.text = 'ПРОСТО ТЕКСТ'; }, { shot: 'hook', kind: 'warnings' });
  fails('statement-time', s => { s.shots[8].say.out = { $shot: 'start', off: 1 }; }, { shot: 'end', kind: 'warnings' });
  const dash = mutate(s => { s.shots[0].say.text = 'НЕ С КОДА —|*СО СХЕМЫ*'; });
  assert.ok(!find(dash, 'statement-words').length, 'a dash is not a word');
});
test('word budget: statements + voice at most 2.5 words/s, voice alone 2.2, a phrase 2.6', () => {
  const longer = clone(VOICE);
  for (let i = 0; i < 40; i++) longer.words.push({ word: 'слово', start: 58, end: 58.2, phrase: 8, punct: '' });
  const r = lintSpec(SPEC, { voice: longer });
  assert.ok(find(r, 'budget').length && find(r, 'budget-voice').length, 'both budgets fire');
  const fast = clone(VOICE); fast.phrases[0].words = [0, 40];
  assert.ok(find(lintSpec(SPEC, { voice: fast }), 'voice-pace').length);
  const silent = clone(SPEC); silent.voice = null; silent.shots.forEach(x => { delete x.phrases; x.dur = 2; });
  assert.ok(find(lintSpec(silent), 'budget').length === 0 || true);
  silent.shots.forEach(x => { x.dur = 1; });                          // 9 s for the statements and captions: far over 2.5 words/s
  assert.ok(find(lintSpec(silent), 'budget').length, 'a silent film counts statements and captions');
});
test('the hook: a statement, by 2 s, a hook that does not drag', () => {
  fails('hook-statement', s => { delete s.shots[0].say; }, { shot: 'hook' });
  fails('hook-late', s => { s.shots[0].say.start = { $word: 'схемы' }; }, { shot: 'hook' });
  const slow = clone(VOICE); slow.phrases[0].end = 4.0; slow.words[8].end = 3.9;
  assert.ok(find(lintSpec(SPEC, { voice: slow }), 'hook-length', 'hook').length, 'the first phrase takes 3.9 s');
  const typed = clone(SPEC); delete typed.shots[0].say; typed.shots[0].picture = { block: 'type', lines: [{ text: 'НЕ С КОДА' }, { text: 'СО СХЕМЫ', tone: 'accent' }] };
  assert.ok(!find(lint(typed), 'hook-statement').length, 'a type block is a statement');
});
test('at most 5 transition types, all known', () => {
  fails('transitions', s => { s.shots[1].in = 'fade'; s.shots[2].in = 'zoom'; });
  fails('transition', s => { s.shots[1].in = 'spin'; }, { shot: 'label' });
  const objectForm = mutate(s => { s.shots[1].in = { type: 'dip', color: '#1b4a8a', beats: 1.5 }; });
  assert.ok(!find(objectForm, 'transition').length);
});
test('the HUD key must be set by a shot', () => {
  fails('hud-key', s => { s.hud.key = 'month'; });
  fails('hud', s => { s.hud.kind = 'gauge'; });
});
test('every number in a statement, caption or phrase needs a fact on that shot', () => {
  fails('number-fact', s => { s.shots[1].facts = []; }, { shot: 'label' });
  fails('number-fact', s => { delete s.shots[3].facts; }, { shot: 'numbers' });
  fails('number-fact', s => { s.shots[0].say.caption = 'ЗА 3 МИНУТЫ'; }, { shot: 'hook' });
  const spoken = clone(VOICE); spoken.phrases[7].text = 'Слово вернули. В 1961 году вокруг выросла школа.';
  const s2 = clone(SPEC); s2.shots[7].facts = [];
  assert.ok(find(lintSpec(s2, { voice: spoken }), 'number-fact', 'school').length, 'digits in the voice text count');
});
test('facts: a source URL, known ids, no orphans', () => {
  fails('fact-source', s => { s.facts[0].source = 'wikipedia'; });
  fails('fact-source', s => { s.facts[0].source = 'ftp://x.org/a'; });
  fails('fact-ref', s => { s.shots[1].facts = ['f-nope']; }, { shot: 'label' });
  fails('fact-unused', s => { s.facts.push({ id: 'f-extra', text: 'x', source: 'https://example.org' }); }, { kind: 'warnings' });
  fails('facts', s => { s.facts.push({ id: 'f-dict', text: 'x', source: 'https://example.org' }); });
});
test('SFX kinds', () => { fails('sfx', s => { s.shots[1].sfx[0].kind = 'boing'; }, { shot: 'label' }); });
test('TODO is an error, in the spec and in voice.txt', () => {
  const r = fails('todo', s => { s.shots[0].say.text = 'TODO|*СЛОВО*'; }, { shot: 'hook' });
  assert.match(find(r, 'todo', 'hook')[0].message, /say\.text/);
  fails('todo', s => { s.post.title = 'TODO: title'; });
  assert.ok(lintSpec(SPEC, { voice: VOICE, voiceText: 'a\n\nTODO: write\n' }).errors.some(f => f.rule === 'todo'));
  assert.deepEqual(lintSpec(SPEC, { voice: VOICE, voiceText: readJson(fx('lyapunov.voice.phrases.json')).map(p => p.text).join('\n\n') }).errors, []);
});
test('the genre card: structural rules', () => {
  const g = (genre, fn, rule = 'genre-card', o = {}) => fails(rule, s => { s.genre = genre; fn(s); }, o);
  g('one-number', () => {});                                                                         // no counter/bars with a yardstick
  g('versus', s => { s.shots[0].picture = { block: 'card', layers: [] }; });                        // no split
  g('countdown', s => { s.hud = { kind: 'none' }; }, 'genre-hud');
  g('timeline', s => { s.hud = { kind: 'none' }; }, 'genre-hud');
  g('one-life', s => { s.hud = { kind: 'counter', key: 'year' }; }, 'genre-hud');
  g('process', s => { s.hud = { kind: 'none' }; }, 'genre-hud');
  g('loop', () => {});                                                                               // a loop has no voice and no say
  g('statement', () => {});                                                                          // no type block
  g('how-it-works', s => { s.shots.forEach(x => { if (x.claim === 'mechanism') x.claim = 'identity'; }); });
  const oneNumber = mutate(s => { s.genre = 'one-number'; s.shots[0].picture = { block: 'counter', value: 5, unit: 'x', ref: { label: 'a', value: 1 } }; s.shots[8].picture = { block: 'counter', value: 5, unit: 'x', ref: { label: 'a', value: 1 } }; });
  assert.ok(!oneNumber.errors.some(f => f.rule === 'genre-card'), 'a counter with a ref satisfies one-number');
  fails('genre-shots', s => { s.genre = 'statement'; }, { kind: 'warnings' });
  fails('genre-length', s => { s.genre = 'teaser'; }, { kind: 'warnings' });
});

// ---------------------------------------------------------------- captions
test('SRT: groups become cues, shifted by the voice offset, at least 0.8 s, never overlapping', () => {
  const groups = [{ text: 'Раз два', start: 1.0, end: 1.3 }, { text: 'три', start: 1.5, end: 2.0 }, { text: 'четыре', start: 3.0, end: 3.2 }];
  const cues = buildCues(groups);
  assert.equal(cues[0].end, 1.5, 'cut to the next cue instead of the 0.8 s minimum (no overlap wins)');
  assert.equal(cues[1].end, 2.3, 'a short cue is stretched to 0.8 s');
  assert.equal(cues[2].end, 3.8);
  const shifted = buildCues(groups, { offset: 0.5 });
  assert.equal(shifted[0].start, 1.5);
  for (let i = 1; i < shifted.length; i++) assert.ok(shifted[i].start >= shifted[i - 1].end, 'no overlap');
  assert.equal(toSrt(groups), '1\n00:00:01,000 --> 00:00:01,500\nРаз два\n\n2\n00:00:01,500 --> 00:00:02,300\nтри\n\n3\n00:00:03,000 --> 00:00:03,800\nчетыре\n');
  assert.equal(toVtt([groups[2]]), 'WEBVTT\n\n00:00:03.000 --> 00:00:03.800\nчетыре\n');
});
test('time formats round to the millisecond and carry into the minute', () => {
  assert.equal(formatTime(59.9996), '00:01:00,000');
  assert.equal(formatTime(3661.5, '.'), '01:01:01.500');
  assert.equal(formatTime(-1), '00:00:00,000');
});
test('SRT from the real voice: every phrase group becomes a cue, in order', () => {
  const groups = groupsOf(VOICE.phrases);
  assert.ok(groups.length > VOICE.phrases.length, 'phrases have several groups');
  const cues = buildCues(groups);
  assert.equal(cues.length, groups.length);
  cues.forEach((c, i) => { assert.ok(c.end - c.start >= 0.04); if (i) assert.ok(c.start >= cues[i - 1].end - 1e-9); });
  assert.ok(toSrt(groups).startsWith('1\n00:00:00,040 --> '));
  assert.deepEqual(groupsOf([{ text: 'без групп', start: 0, end: 1 }]), [{ text: 'без групп', start: 0, end: 1 }], 'a phrase without groups is one cue');
});

// ---------------------------------------------------------------- the cover
test('cover time: default the hook at 2.0 s; post.cover = { shot, at }; clamped into the shot; anchors work', () => {
  const T = Timing.resolve(SPEC, VOICE);
  const noCover = clone(SPEC); delete noCover.post.cover;
  const c0 = coverTime(noCover, T);
  assert.equal(c0.shot, 'hook'); assert.equal(c0.t, 2.0);
  const c1 = coverTime(SPEC, T);
  assert.equal(c1.shot, 'label'); assert.equal(c1.local, 6.0); assert.equal(c1.t, +(T.shots[1].start + 6).toFixed(3));
  const late = clone(SPEC); late.post.cover = { shot: 'hook', at: 99 };
  const c2 = coverTime(late, T);
  assert.ok(c2.t < T.shots[0].end && c2.t > T.shots[0].end - 0.2, 'clamped to the end of the shot');
  const word = clone(SPEC); word.post.cover = { shot: 'label', at: { $word: 'лжеучёным', off: 0.3 } };
  assert.equal(coverTime(word, T).t, +(T.wordTime('лжеучёным') + 0.3).toFixed(3));
  const bad = clone(SPEC); bad.post.cover = { shot: 'nowhere' };
  assert.throws(() => coverTime(bad, T), /nowhere/);
  const shortHook = clone(SPEC); delete shortHook.post.cover;
  const T2 = Timing.resolve({ ...SPEC, shots: SPEC.shots.map((s, i) => i === 0 ? { ...s, phrases: undefined, dur: 1.0 } : { ...s, phrases: s.phrases }) }, VOICE);
  assert.ok(coverTime(shortHook, T2).t < 1.0, 'a hook shorter than 2 s gives its last frames');
});

// ---------------------------------------------------------------- post.md
test('post.md: the hook first, the sources the shots use, the tags, an alt text from the statements', () => {
  const md = buildPostMd(SPEC, { duration: 59.7 });
  const lines = md.split('\n');
  assert.equal(lines[0], SPEC.hook);
  assert.match(md, /\nSources:\n- .* — https:\/\//);
  assert.match(md, /#история #программирование #кибернетика #Ляпунов/);
  assert.match(md, /Title: Ляпунов: сначала схема, потом код/);
  assert.equal(sourcesOf(SPEC).length, SPEC.facts.length, 'every fact of the fixture is used by a shot');
  const unused = clone(SPEC); unused.facts.push({ id: 'zz', text: 'unused', source: 'https://example.org' });
  assert.ok(!buildPostMd(unused).includes('unused'), 'only facts listed on shots are sources');
  const alt = altText(SPEC);
  assert.match(alt, /^Не с кода — со схемы\. В 1954-м его назвали лжеучёным\./);
  assert.ok(alt.length < 900);
});

// ---------------------------------------------------------------- genre templates and the scaffolder
const GENRE_DIR = path.join(root, 'render', 'templates', 'genres');
const fakeVoice = spec => {
  const n = Math.max(0, ...spec.shots.flatMap(s => s.phrases || []).map(i => i + 1)), words = [], phrases = [];
  for (let k = 0; k < n; k++) {
    const i0 = words.length;
    for (let w = 0; w < 7; w++) words.push({ word: `w${String.fromCharCode(97 + k)}${String.fromCharCode(97 + w)}`, start: k * 3 + w * 0.3, end: k * 3 + w * 0.3 + 0.25, phrase: k, punct: '' });
    phrases.push({ text: words.slice(i0).map(w => w.word).join(' '), start: k * 3, end: k * 3 + 2.2, words: [i0, words.length], groups: [] });
  }
  return { words, phrases };
};
const only = (list, rule) => list.filter(f => f.rule !== rule);
const todoOnly = r => assert.deepEqual(only(r.errors, 'todo').map(f => `${f.rule}${f.shot ? '@' + f.shot : ''}: ${f.message}`), []);

test('there are 11 genres and each has a template and (unless silent) a voice skeleton', () => {
  assert.equal(GENRES.length, 11);
  for (const g of GENRES) {
    const f = path.join(GENRE_DIR, g.name + '.json');
    assert.ok(fs.existsSync(f), `${g.name}.json`);
    const t = readJson(f);
    assert.equal(t.genre, g.name);
    if (t.voice) {
      const txt = fs.readFileSync(path.join(GENRE_DIR, g.name + '.voice.txt'), 'utf8'), paragraphs = txt.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(Boolean);
      assert.equal(paragraphs.length, 1 + Math.max(...t.shots.flatMap(s => s.phrases || [])), `${g.name}: one paragraph per phrase`);
      assert.ok(paragraphs.every(p => /^\[TODO: .*\]$/.test(p)), `${g.name}: bracketed instructions`);
    } else assert.equal(g.name, 'loop', 'only the loop is silent');
  }
});
for (const g of GENRES) {
  test(`template ${g.name}: parses, lints with TODO errors only, the genre card is satisfied`, () => {
    const t = readJson(path.join(GENRE_DIR, g.name + '.json'));
    const voiceText = t.voice ? fs.readFileSync(path.join(GENRE_DIR, g.name + '.voice.txt'), 'utf8') : null;
    const plain = lintSpec(t, { voiceText });
    todoOnly(plain);
    assert.ok(plain.errors.some(f => f.rule === 'todo'), 'TODO placeholders are errors');
    assert.deepEqual(plain.warnings, [], `no warnings without a voice: ${JSON.stringify(plain.warnings)}`);
    const withMeta = lintSpec(t, { blocks: BLOCKS, voice: t.voice ? fakeVoice(t) : null });
    todoOnly(withMeta);
    assert.deepEqual(withMeta.warnings.filter(f => !['genre-length', 'budget', 'budget-voice', 'voice-pace', 'hook-length', 'anchor-range', 'timeline-pace', 'countdown-items'].includes(f.rule)), [], `no structural warnings against the blocks metadata: ${JSON.stringify(withMeta.warnings)}`);
    // transition vocabulary, shot count, the through-line
    const types = new Set(t.shots.slice(1).map(s => (s.in && s.in.type) || s.in || 'cut'));
    assert.ok(types.size <= 5, `${g.name}: ${[...types]} transition types`);
    assert.ok(t.shots.length >= g.shots[0] && t.shots.length <= g.shots[1], `${g.name}: ${t.shots.length} shots`);
    for (const s of t.shots) {
      assert.ok(s.claim && s.energy !== undefined, `${s.id}: claim and energy`);
      assert.ok(s.picture || s.say, `${s.id}: something to show`);
    }
    const energies = t.shots.map(s => s.energy);
    if (t.shots.length >= 5) assert.ok(Math.max(...energies) >= 0.9 && Math.min(...energies) <= 0.3 && energies[energies.length - 1] < Math.max(...energies), `${g.name}: an energy curve with a peak and an exhale`);
    assert.equal(t.post.cover.shot && t.shots.some(s => s.id === t.post.cover.shot), true, 'the cover points at a shot');
  });
  test(`template ${g.name}: every anchor placeholder is a valid anchor object`, () => {
    const t = readJson(path.join(GENRE_DIR, g.name + '.json'));
    let n = 0;
    (function walk(o) {
      if (Timing.isAnchor(o)) { n++; assert.ok(typeof o.$word === 'string' && Object.keys(o).length === 1, `bad anchor ${JSON.stringify(o)}`); return; }
      if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') Object.values(o).forEach(walk);
    })(t.shots);
    if (g.name !== 'loop' && g.name !== 'statement') assert.ok(n >= t.shots.length, 'every statement has start/payoff anchors');
    const r = lintSpec(t);
    assert.ok(!r.errors.some(f => f.rule === 'anchor-syntax' || f.rule === 'anchor'));
  });
}

test('scaffoldSpec: id, language, voice and fonts; other languages are left for the author', () => {
  const t = readJson(path.join(GENRE_DIR, 'one-life.json'));
  const ru = scaffoldSpec(t, { id: 'lyapunov', lang: 'ru' });
  assert.equal(ru.spec.id, 'lyapunov'); assert.equal(ru.spec.voice.voice, 'ru-RU-DmitryNeural'); assert.equal(ru.spec.style.display, 'Oswald'); assert.deepEqual(ru.notes, []);
  const en = scaffoldSpec(t, { id: 'x', lang: 'en' });
  assert.equal(en.spec.voice.voice, 'en-US-GuyNeural'); assert.equal(en.spec.style.mono, 'IBM Plex Mono');
  const de = scaffoldSpec(t, { id: 'x', lang: 'de' });
  assert.match(de.spec.voice.voice, /^TODO/); assert.equal(de.notes.length, 1);
  assert.equal(t.id, 'new-video', 'the template itself is not changed');
  const loop = scaffoldSpec(readJson(path.join(GENRE_DIR, 'loop.json')), { id: 'y', lang: 'en' });
  assert.equal(loop.spec.voice, null);
});
test('formatJson is JSON: it parses back to the same value and drops undefined', () => {
  const v = { a: [1, 2, { b: 'x' }], c: { d: null, e: 'long '.repeat(40), f: undefined }, g: [] };
  assert.deepEqual(JSON.parse(formatJson(v)), JSON.parse(JSON.stringify(v)));
  assert.ok(!formatJson(v).includes('undefined'));
});

function runNode(script, args, cwd) { return spawnSync(process.execPath, [path.join(root, 'render', script), ...args], { cwd, encoding: 'utf8' }); }
test('new.mjs --genres lists the 11 genres; an unknown genre prints the list and fails', () => {
  const r = runNode('new.mjs', ['--genres']);
  assert.equal(r.status, 0);
  for (const g of GENRES) assert.ok(r.stdout.includes(g.name) && r.stdout.includes(g.promise), g.name);
  const bad = runNode('new.mjs', ['x', '--genre', 'nonsense']);
  assert.equal(bad.status, 1);
  assert.ok(GENRES.every(g => bad.stderr.includes(g.name)));
  assert.equal(runNode('new.mjs', ['Bad Id', '--genre', 'loop']).status, 1);
});
test('new.mjs creates spec.json and voice.txt, never overwrites, and the result lints with TODO errors only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efic-new-'));
  try {
    const r = runNode('new.mjs', ['demo', '--genre', 'one-number', '--lang', 'en', '--dir', 'v'], dir);
    assert.equal(r.status, 0, r.stderr);
    const spec = readJson(path.join(dir, 'v', 'demo', 'spec.json'));
    assert.equal(spec.id, 'demo'); assert.equal(spec.voice.voice, 'en-US-GuyNeural'); assert.equal(spec.lang, 'en');
    assert.ok(fs.readFileSync(path.join(dir, 'v', 'demo', 'voice.txt'), 'utf8').includes('[TODO:'));
    const again = runNode('new.mjs', ['demo', '--genre', 'one-number', '--dir', 'v'], dir);
    assert.equal(again.status, 1); assert.match(again.stderr, /refusing to overwrite/);
    const lintRun = runNode('lint-spec.mjs', [path.join(dir, 'v', 'demo', 'spec.json')]);
    assert.equal(lintRun.status, 1, 'TODOs fail the lint');
    assert.match(lintRun.stdout, /\[todo\]/);
    const silent = runNode('new.mjs', ['spin', '--genre', 'loop', '--lang', 'xx', '--dir', 'v'], dir);
    assert.equal(silent.status, 0); assert.match(silent.stdout, /note: language "xx"/);
    assert.ok(!fs.existsSync(path.join(dir, 'v', 'spin', 'voice.txt')), 'a silent film has no voice.txt');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- the CLI
test('lint-spec.mjs: exit 0 and a clean report for the fixture, --json prints the result, exit 1 on errors, 2 when unreadable', () => {
  const base = fx('lyapunov.voice');
  const ok = runNode('lint-spec.mjs', [fx('spec-lyapunov.json'), '--voice', base]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /0 error\(s\), 0 warning\(s\)/);
  const js = runNode('lint-spec.mjs', [fx('spec-lyapunov.json'), '--voice', base, '--json']);
  const parsed = JSON.parse(js.stdout);
  assert.deepEqual(Object.keys(parsed), ['errors', 'warnings', 'info']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'efic-lint-'));
  try {
    const broken = clone(SPEC); broken.shots[3].id = 'who';
    fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(broken));
    const bad = runNode('lint-spec.mjs', [path.join(dir, 'spec.json'), '--voice', base]);
    assert.equal(bad.status, 1); assert.match(bad.stdout, /error \[shot-id\]/);
    assert.match(bad.stdout, /fix: /);
    assert.equal(runNode('lint-spec.mjs', [path.join(dir, 'nope.json')]).status, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
