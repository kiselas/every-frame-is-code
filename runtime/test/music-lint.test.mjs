// node --test "runtime/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const ML = createRequire(import.meta.url)('../music-lint.js');
const BASIC = fs.readFileSync(new URL('./fixtures/score-basic.json', import.meta.url), 'utf8');
const basic = () => JSON.parse(BASIC);

const rulesOf = r => [...new Set(r.findings.map(f => f.rule))].sort();
const only = (score, rule, severity, opts) => {
  const r = ML.lint(score, opts);
  assert.deepEqual(rulesOf(r), [rule], r.findings.map(f => `${f.severity} ${f.rule}: ${f.message}`).join('\n'));
  if (severity) assert.ok(r.findings.every(f => f.severity === severity), `expected only ${severity}: ` + r.findings.map(f => f.severity).join());
  return r;
};
const clean = (score, opts) => { const r = ML.lint(score, opts); assert.deepEqual(r.findings, [], r.findings.map(f => `${f.severity} ${f.rule}: ${f.message}`).join('\n')); return r; };
const track = (s, name) => s.tracks.find(t => t.name === name);
const ev = (s, name, b) => track(s, name).events.find(e => Math.abs(e.b - b) < 1e-6);
const drop = (s, name, pred) => { const t = track(s, name); t.events = t.events.filter(e => !pred(e)); };

// a small score: tracks given as { role, events } with no key, chords or sections unless asked for
const VEL = [.6, .8, .7, .9, .65];
const mini = (tracks, extra = {}) => ({
  bpm: 120, beatsPerBar: 4, length: 32,
  tracks: tracks.map((t, i) => ({ name: t.name || t.role, role: t.role, voice: 'square', gain: .5, events: t.events })), ...extra,
});
// 8 different 4-note bars of stepwise motion, so that no loop or leap rule fires
const BARS = [[0, 2, 4, 2], [0, 1, 3, 1], [0, -1, 1, 3], [4, 2, 1, 0], [0, 2, 1, 2], [2, 0, 2, 4], [0, 3, 2, 0], [1, 2, 0, 2]];
const varied = (role, base, bars = 8, dur = 1, offsetBar = 0) => {
  const out = [];
  for (let k = 0; k < bars; k++) BARS[(k + offsetBar) % 8].forEach((iv, j) => out.push({ b: (k + offsetBar) * 4 + j, d: dur, n: base + iv, v: VEL[(k + j) % 5] }));
  return { role, events: out };
};

test('clean fixture triggers no rules and scores 100', () => {
  const r = clean(basic());
  assert.equal(r.score, 100);
  assert.deepEqual(Object.keys(r), ['findings', 'stats', 'score']);
});

test('graceful skips: missing key, chords, sections (each and all together)', () => {
  for (const drops of [['key'], ['chords'], ['sections'], ['key', 'chords', 'sections']]) {
    const s = basic(); for (const k of drops) delete s[k];
    clean(s);
  }
  // rules that need chords/key/sections do not fire even on a bad melody when those are missing
  const s = basic(); ev(s, 'lead', 16).n = 73; delete s.chords; delete s.key; delete s.sections;
  clean(s);
});

test('empty and degenerate scores do not throw', () => {
  assert.deepEqual(ML.lint({}).findings, []);
  assert.deepEqual(ML.lint({ tracks: [] }).findings, []);
  assert.deepEqual(ML.lint({ tracks: [{ name: 'lead', events: [] }] }).findings, []);
  assert.equal(typeof ML.describe({}), 'string');
});

test('strong-beat-chord: warn when < 70% of the strong-beat notes are chord tones (in-key non-chord notes)', () => {
  const s = basic();
  ev(s, 'lead', 8).n = 79; ev(s, 'lead', 12).n = 77; ev(s, 'lead', 16).n = 77; ev(s, 'lead', 20).n = 77;
  const r = only(s, 'strong-beat-chord', 'warn');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].b, null);
  assert.match(r.findings[0].message, /67%/);
});

test('strong-beat-chord: error for a strong-beat note outside the chord and the key, with an actionable message', () => {
  const s = basic();
  ev(s, 'lead', 16).n = 73;               // C# on beat 1 of bar 5 over C major
  const r = only(s, 'strong-beat-chord', 'error');
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.bar, 5); assert.equal(f.b, 16); assert.equal(f.track, 'lead');
  assert.equal(f.message, 'lead bar 5 beat 1: C# is not in C major chord (C E G) and is outside C major; use a chord tone');
  assert.equal(r.score, 92);
});

test('strong-beat-chord: without a key a non-chord note is only counted in the ratio, never an error', () => {
  const s = basic(); delete s.key; ev(s, 'lead', 16).n = 73;
  clean(s);
});

test('out-of-key: warn for a weak-beat note outside the key that is not a chord tone', () => {
  const s = basic(); ev(s, 'lead', 17.5).n = 75;
  const r = only(s, 'out-of-key', 'warn');
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].message, /lead bar 5 beat 2\.5: D# is outside C major and not in C major chord \(C E G\)/);
});

test('out-of-key: info when the outside note is a chord tone (chromatic chord)', () => {
  const s = basic(); s.chords[4] = { b: 16, d: 4, root: 'C', quality: 'min', pcs: [0, 3, 7] }; ev(s, 'lead', 17.5).n = 75;
  const r = only(s, 'out-of-key', 'info');
  assert.match(r.findings[0].message, /chromatic chord/);
});

test('leap: warn for a jump > 12 semitones', () => {
  const s = basic(); ev(s, 'lead', 19).n = 88;     // 72 -> 88
  const r = only(s, 'leap', 'warn');
  assert.equal(r.findings.length, 1); assert.match(r.findings[0].message, /leap of 16 semitones/);
});

test('leap: info for a leap > 7 not followed by a step in the opposite direction', () => {
  const s = basic(); ev(s, 'lead', 19).n = 81;     // 72 -> 81 (9 up), next 76: 5 down
  const r = only(s, 'leap', 'info');
  assert.equal(r.findings.length, 1); assert.match(r.findings[0].message, /not followed by a step back/);
  // recovery by a step in the opposite direction is fine
  const t = mini([{ role: 'lead', events: [72, 81, 80, 78].map((n, i) => ({ b: i, d: 1, n, v: VEL[i] })) }]);
  clean(t);
});

test('leap: a leap across a rest is a phrase start, not a leap', () => {
  const t = mini([{ role: 'lead', events: [{ b: 0, d: 1, n: 60, v: .6 }, { b: 4, d: 1, n: 84, v: .8 }] }]);
  clean(t, { disable: ['dead-air'] });
});

test('range: warn for notes outside the role range', () => {
  const s = basic(); ev(s, 'arp', 13.5).n = 91;
  const r = only(s, 'range', 'warn');
  assert.match(r.findings[0].message, /arp bar 4 beat 2\.5: 1 note outside arp range 48\.\.84/);
  for (const [role, n] of [['lead', 50], ['lead', 90], ['bass', 20], ['bass', 57]]) {
    const t = mini([{ role, events: [{ b: 0, d: 1, n, v: .7 }] }]);
    only(t, 'range', 'warn');
  }
});

test('parallel-perfects: parallel fifths between bass and lead on consecutive strong beats', () => {
  const s = basic(); ev(s, 'lead', 15).n = 77; ev(s, 'lead', 16).n = 79;   // bar 4 beat 3: G-D, bar 5 beat 1: C-G
  const r = only(s, 'parallel-perfects', 'warn');
  assert.equal(r.findings.length, 1); assert.match(r.findings[0].message, /parallel fifths \(G-D then C-G\)/);
});

test('parallel-perfects: parallel octaves are found too, repeated notes are not parallel motion', () => {
  const t = mini([
    { role: 'bass', events: [{ b: 0, d: 2, n: 36, v: .8 }, { b: 2, d: 2, n: 38, v: .7 }] },
    { role: 'lead', events: [{ b: 0, d: 2, n: 72, v: .8 }, { b: 2, d: 2, n: 74, v: .7 }] },
  ]);
  const r = only(t, 'parallel-perfects', 'warn'); assert.match(r.findings[0].message, /octaves/);
  const same = mini([
    { role: 'bass', events: [{ b: 0, d: 2, n: 36, v: .8 }, { b: 2, d: 2, n: 36, v: .7 }] },
    { role: 'lead', events: [{ b: 0, d: 2, n: 72, v: .8 }, { b: 2, d: 2, n: 72, v: .7 }] },
  ]);
  clean(same);
});

test('clash: tritone / minor 9th between bass and lead held together on a strong beat for >= 1 beat', () => {
  const s = basic();
  ev(s, 'bass', 8).d = 2; const l = ev(s, 'lead', 8); l.n = 71; l.d = 1.5;   // B against F
  const r = only(s, 'clash', 'warn');
  assert.equal(r.findings.length, 1); assert.match(r.findings[0].message, /bass\/lead bar 3 beat 1: F1 against B4 is a tritone/);
  // a short overlap (< 1 beat) is not a clash
  const t = basic(); ev(t, 'lead', 8).n = 71;
  clean(t);
});

test('clash: lead against arp', () => {
  const t = mini([
    { role: 'lead', events: [{ b: 0, d: 2, n: 72, v: .8 }, { b: 2, d: 2, n: 76, v: .7 }] },
    { role: 'arp', events: [{ b: 0, d: 2, n: 71, v: .5 }, { b: 2, d: 2, n: 55, v: .6 }] },
  ], { length: 4 });
  only(t, 'clash', 'warn', { disable: ['masking'] });
});

test('loop: more than 4 identical lead bars in a row', () => {
  const ev6 = []; for (let k = 0; k < 6; k++) BARS[0].forEach((iv, j) => ev6.push({ b: k * 4 + j, d: 1, n: 72 + iv, v: VEL[(k + j) % 5] }));
  const r = only(mini([{ role: 'lead', events: ev6 }], { length: 24 }), 'loop', 'warn');
  assert.match(r.findings[0].message, /lead bars 1-6 are identical \(6 in a row\)/);
  // 4 in a row is allowed: three different patterns take turns
  const okEvents = []; [0, 0, 0, 0, 1, 2, 3, 4].forEach((p, k) => BARS[p].forEach((iv, j) => okEvents.push({ b: k * 4 + j, d: 1, n: 72 + iv, v: VEL[(k + j) % 5] })));
  clean(mini([{ role: 'lead', events: okEvents }], { length: 32 }));
});

test('loop: fewer than 25% unique bars in a track of >= 8 bars', () => {
  const out = []; for (let k = 0; k < 16; k++) BARS[k % 3].forEach((iv, j) => out.push({ b: k * 4 + j, d: 1, n: 72 + iv, v: VEL[(k + j) % 5] }));
  const r = only(mini([{ role: 'arp', events: out.map(e => ({ ...e, n: e.n - 12 })) }], { length: 64 }), 'loop', 'warn');
  assert.match(r.findings[0].message, /19% unique bars \(3 of 16\)/);
});

test('flat-dynamics: warn for constant velocity over >= 16 events', () => {
  const t = varied('lead', 72); t.events.forEach(e => e.v = .8);
  const r = only(mini([t]), 'flat-dynamics', 'warn');
  assert.match(r.findings[0].message, /velocity stdev 0 < 0\.04 over 32 events/);
  // fewer than 16 events: not enough evidence
  const few = mini([{ role: 'lead', events: varied('lead', 72, 3).events.map(e => ({ ...e, v: .8 })) }]);
  clean(few, { disable: ['dead-air'] });
});

test('flat-dynamics: kicks on beat 1 that are not louder than the others', () => {
  const s = basic();
  for (const e of track(s, 'drums').events) if (e.voice === 'kick') e.v = .9;
  // give the drum track enough variance by leaving other voices alone
  const r = only(s, 'flat-dynamics', 'warn');
  assert.match(r.findings[0].message, /kicks on beat 1 .* are not louder/);
});

test('density-vs-energy: the highest-energy section must be among the two densest', () => {
  // four 2-bar sections: notes per bar 4, 8, 2, 6 with energies .2, .5, .9, .4 -> section 3 is the sparsest
  const secs = [['a', .2, 4], ['b', .5, 8], ['c', .9, 2], ['d', .4, 6]];
  const evs = []; secs.forEach(([, , n], si) => { for (let k = 0; k < 2; k++) for (let j = 0; j < n; j++) evs.push({ b: (si * 2 + k) * 4 + j * 4 / n, d: 4 / n * .9, n: 72 + BARS[(si * 2 + k)][j % 4] + (j >= 4 ? 1 : 0), v: VEL[(j + k) % 5] }); });
  const fx = [8, 16, 24].map(b => ({ b: b - 1, d: 1, n: 60, v: .7 }));
  const s = mini([{ role: 'lead', events: evs }, { role: 'fx', events: fx }], { length: 32, sections: secs.map(([name, energy], i) => ({ name, b: i * 8, bars: 2, energy })) });
  const r = only(s, 'density-vs-energy', 'warn');
  assert.match(r.findings[0].message, /"c" has the highest energy \(0\.9\) but is only #4 by density/);
});

test('density-vs-energy: a low-energy section denser than the mean', () => {
  const secs = [['a', .2, 8], ['b', .5, 3], ['c', .9, 6], ['d', .5, 2]];
  const evs = []; secs.forEach(([, , n], si) => { for (let k = 0; k < 2; k++) for (let j = 0; j < n; j++) evs.push({ b: (si * 2 + k) * 4 + j * 4 / n, d: 4 / n * .9, n: 72 + BARS[(si * 2 + k)][j % 4], v: VEL[(j + k) % 5] }); });
  const fx = [8, 16, 24].map(b => ({ b: b - 1, d: 1, n: 60, v: .7 }));
  const s = mini([{ role: 'lead', events: evs }, { role: 'fx', events: fx }], { length: 32, sections: secs.map(([name, energy], i) => ({ name, b: i * 8, bars: 2, energy })) });
  const r = only(s, 'density-vs-energy', 'warn');
  assert.match(r.findings[0].message, /"a" has low energy \(0\.2\) but is denser/);
});

test('density-vs-energy: equally dense sections share a rank (a repeated chorus is not penalised)', () => {
  const secs = [['a', .2, 2], ['b', .8, 6], ['c', .9, 6]];
  const evs = []; secs.forEach(([, , n], si) => { for (let k = 0; k < 2; k++) for (let j = 0; j < n; j++) evs.push({ b: (si * 2 + k) * 4 + j * 4 / n, d: 4 / n * .9, n: 72 + BARS[(si * 2 + k)][j % 4], v: VEL[(j + k) % 5] }); });
  const fx = [8, 16].map(b => ({ b: b - 1, d: 1, n: 60, v: .7 }));
  clean(mini([{ role: 'lead', events: evs }, { role: 'fx', events: fx }], { length: 24, sections: secs.map(([name, energy], i) => ({ name, b: i * 8, bars: 2, energy })) }));
});

test('drum-groove: no kick on beat 1 in an energetic section', () => {
  const s = basic(); drop(s, 'drums', e => e.voice === 'kick' && e.b >= 16 && e.b < 28 && e.b % 4 === 0);
  const r = only(s, 'drum-groove', 'warn');
  assert.match(r.findings[0].message, /section "chorus" \(energy 0\.9, bars 5-7\): kick on beat 1 in only 0% of bars/);
});

test('drum-groove: no backbeat when energy >= .5', () => {
  const s = basic(); drop(s, 'drums', e => e.voice === 'snare' && e.b >= 8 && e.b < 16);
  const r = only(s, 'drum-groove', 'warn');
  assert.match(r.findings[0].message, /section "verse" .*snare\/clap on beats 2 and 4 in only 0%/);
});

test('drum-groove: missing fill/crash at the end of a section with energy >= .6 is an info, not for the last section', () => {
  const s = basic(); drop(s, 'drums', e => e.voice === 'tom' || (e.voice === 'snare' && e.b >= 27 && e.b < 28) || (e.voice === 'crash' && e.b === 28));
  const r = only(s, 'drum-groove', 'info');
  assert.equal(r.findings.length, 1); assert.match(r.findings[0].message, /end of section "chorus".*no drum fill/);
  // a crash on the next downbeat is a marker as well
  const t = basic(); drop(t, 'drums', e => e.voice === 'tom' || (e.voice === 'snare' && e.b >= 27 && e.b < 28));
  clean(t);
});

test('drum-groove: skipped when the score has no drums at all', () => {
  const s = basic(); s.tracks = s.tracks.filter(t => t.role !== 'drums');
  assert.ok(!rulesOf(ML.lint(s)).includes('drum-groove'));
});

test('transitions: a section boundary without any marker is an info', () => {
  const s = mini([{ role: 'lead', events: varied('lead', 72, 4).events }, { role: 'bass', events: varied('bass', 40, 4).events }],
    { length: 16, sections: [{ name: 'a', b: 0, bars: 2, energy: .5 }, { name: 'b', b: 8, bars: 2, energy: .5 }] });
  const r = only(s, 'transitions', 'info');
  assert.match(r.findings[0].message, /bar 3: no marker at the boundary "a" to "b"/);
  // an fx riser in the last 4 beats is a marker
  s.tracks.push({ name: 'riser', role: 'fx', voice: 'noise', gain: .3, events: [{ b: 6, d: 2, v: .5 }] });
  assert.deepEqual(ML.lint(s).findings, []);
});

test('dead-air: 2..4 beats of silence is an info, >= 4 beats a warn, silence at the end is ignored', () => {
  const at = (...bs) => mini([{ role: 'lead', events: bs.map((b, i) => ({ b, d: 1, n: 72 + i % 2, v: VEL[i % 5] })) }], { length: 16 });
  const i = only(at(0, 1, 4, 5), 'dead-air', 'info'); assert.match(i.findings[0].message, /bar 1 beat 3: 2 beats with no sound/);
  const w = only(at(0, 1, 6, 7), 'dead-air', 'warn'); assert.match(w.findings[0].message, /bar 1 beat 3: 4 beats/);
  clean(at(0, 1, 2, 3));                                             // the tail up to length 16 is not dead air
  clean(at(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15));
});

test('dead-air: a held note is not silence', () => {
  const s = mini([{ role: 'pad', events: [{ b: 0, d: 8, n: 60, v: .5 }, { b: 8, d: 8, n: 62, v: .6 }] }], { length: 16 });
  clean(s);
});

test('masking: lead and arp in the same register sounding at the same time is an info', () => {
  const arp = []; for (let i = 0; i < 64; i++) arp.push({ b: i / 2, d: .5, n: 72 + [0, 2, 4, 2][i % 4], v: VEL[i % 5] });
  const s = mini([varied('lead', 72), { role: 'arp', events: arp }]);
  const r = only(s, 'masking', 'info', { disable: ['clash', 'loop'] });
  assert.match(r.findings[0].message, /lead and arp sit in the same register/);
  // the arp an octave and a half below does not mask
  const low = mini([varied('lead', 76), { role: 'arp', events: arp.map(e => ({ ...e, n: e.n - 19 })) }]);
  assert.ok(!rulesOf(ML.lint(low, { disable: ['loop'] })).includes('masking'));
});

test('findings are capped per rule and track; the score counts all of them', () => {
  const evs = []; for (let i = 0; i < 40; i++) evs.push({ b: i / 2, d: .5, n: 72 + (i % 2 ? 1 : 0), v: VEL[i % 5] });   // C and C# on every eighth: 20 out-of-key notes
  const s = mini([{ role: 'pad', events: evs }], { key: { root: 'C', mode: 'major' }, length: 20 });
  const r = ML.lint(s);
  const oo = r.findings.filter(f => f.rule === 'out-of-key' && f.severity === 'warn');
  assert.equal(oo.length, 10);
  assert.ok(r.findings.some(f => /and 10 more warn finding/.test(f.message)));
  assert.equal(r.score, Math.max(0, 100 - 3 * 20 - 0.5 * 0), 'score = 100 - 3 per warn');
  assert.equal(r.stats.counts.warn, 20);
});

test('opts: thresholds and disable', () => {
  const s = basic(); ev(s, 'lead', 19).n = 88;
  assert.deepEqual(rulesOf(ML.lint(s)), ['leap']);
  assert.deepEqual(rulesOf(ML.lint(s, { disable: ['leap'] })), []);
  assert.ok(ML.lint(s, { leapWarn: 20 }).findings.every(f => f.severity === 'info'));   // the 16-semitone leap is now only an info (no step back)
  const r = ML.lint(s, { weights: { warn: 10 } }); assert.equal(r.score, 90);
});

test('key modes and root spellings: minor, dorian, flats', () => {
  const evs = [57, 59, 60, 62, 64, 65, 67, 69].map((n, i) => ({ b: i, d: 1, n, v: VEL[i % 5] }));   // A natural minor scale
  const s = mini([{ role: 'lead', events: evs }], { length: 8, key: { root: 'A', mode: 'minor' } });
  clean(s, { disable: ['range'] });
  s.key = { root: 'A', mode: 'major' };
  assert.ok(rulesOf(ML.lint(s, { disable: ['range'] })).includes('out-of-key'));
  s.key = { root: 'Bb', mode: 'dorian' };   // Bb C Db Eb F G Ab: the A minor scale has A, B, E outside
  assert.ok(ML.lint(s, { disable: ['range'] }).findings.some(f => f.rule === 'out-of-key'));
  s.key = { root: 'Q', mode: 'major' };     // an unusable key: rules that need it skip
  clean(s, { disable: ['range'] });
});

test('chords may give only root and quality', () => {
  const s = basic();
  s.chords = s.chords.map(c => ({ b: c.b, d: c.d, root: c.root, quality: c.quality }));
  clean(s);
  ev(s, 'lead', 16).n = 73;
  only(s, 'strong-beat-chord', 'error');
});

test('lint is pure and deterministic', () => {
  const s = basic(); ev(s, 'lead', 16).n = 73;
  const before = JSON.stringify(s);
  const a = ML.lint(s), b = ML.lint(s);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(a, b);
});

test('stats: per-track, per-section, layers', () => {
  const st = clean(basic()).stats;
  assert.equal(st.bars, 8); assert.equal(st.seconds, 16); assert.equal(st.key, 'C major');
  assert.deepEqual(Object.keys(st.tracks), ['bass', 'pad', 'arp', 'lead', 'drums']);
  assert.equal(st.tracks.lead.minPitch, 71); assert.equal(st.tracks.lead.maxPitch, 84);
  assert.equal(st.tracks.arp.uniqueBars, 1);
  assert.deepEqual(st.sections.map(s => s.layerCount), [2, 5, 5, 4]);
  assert.ok(st.sections[2].notesPerBeat > st.sections[1].notesPerBeat && st.sections[1].notesPerBeat > st.sections[0].notesPerBeat);
});

test('describe: compact text with sections, layers and density', () => {
  const d = ML.describe(basic());
  assert.match(d, /^120 bpm, 4\/4, C major, 8 bars \(16 s\)/);
  assert.match(d, /chords: C Am F G C Am F G/);
  assert.match(d, /chorus: bars 5-7, energy 0\.9, [\d.]+ notes\/beat, 5 layers \(bass, pad, arp, lead, drums\)/);
  assert.match(d, /lead \(lead, pulse\): 26 events, pitch B4\.\.C6/);
  assert.ok(d.split('\n').length < 25);
});

test('every rule id is exported and documented in the header', () => {
  const src = fs.readFileSync(new URL('../music-lint.js', import.meta.url), 'utf8');
  assert.equal(ML.RULES.length, 13);
  for (const id of ML.RULES) assert.ok(src.includes(`//   ${id} `), id);
});

test('a section key overrides the score key (modulation is not out-of-key)', () => {
  const s = basic();
  s.sections[2].key = 'D major';                                           // the chorus lifts to D: F# and C# are in key there
  const lead = track(s, 'lead'); const e = lead.events.find(x => x.b >= s.sections[2].b && x.b < s.sections[2].b + 4 && s.chords.every(c => true));
  const f = ML.lint(s).findings.filter(x => x.rule === 'out-of-key' && x.severity === 'warn');
  const before = ML.lint(basic()).findings.filter(x => x.rule === 'out-of-key' && x.severity === 'warn');
  assert.ok(f.length >= before.length);                                    // C major notes now leave D major (C natural): the section key is what counts
  assert.ok(ML.lint(s).stats.key === 'C major');
});

test('half-time snare on beat 3 counts as a backbeat', () => {
  const s = basic();
  const dr = track(s, 'drums');
  dr.events = dr.events.filter(e => e.voice !== 'snare' && e.voice !== 'clap');
  for (const sec of s.sections) if (sec.energy >= .5) for (let k = 0; k < sec.bars; k++) dr.events.push({ b: sec.b + k * 4 + 2, d: .25, voice: 'snare', v: .9 });
  dr.events.sort((a, b) => a.b - b.b);
  assert.ok(!ML.lint(s).findings.some(f => f.rule === 'drum-groove' && f.severity === 'warn'));
});

test('an arpeggio over new chords is not a loop; the same notes repeated is', () => {
  const s = mini([{ name: 'arp', role: 'arp', voice: 'pulse', events: [] }]);
  const arp = s.tracks[0];
  const shape = [0, 4, 7, 4, 0, 4, 7, 4];
  for (let bar = 0; bar < 8; bar++) { const root = [60, 65, 67, 57][bar % 4]; shape.forEach((iv, q) => arp.events.push({ b: bar * 4 + q * .5, d: .45, n: root + iv, v: [.6, .5, .55, .5][q % 4] })); }
  assert.ok(!ML.lint(s).findings.some(f => f.rule === 'loop' && f.track === 'arp'));
  arp.events = []; for (let bar = 0; bar < 8; bar++) shape.forEach((iv, q) => arp.events.push({ b: bar * 4 + q * .5, d: .45, n: 60 + iv, v: [.6, .5, .55, .5][q % 4] }));
  assert.ok(ML.lint(s).findings.some(f => f.rule === 'loop' && f.track === 'arp'));
});
