// node --test runtime/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const Chip = createRequire(import.meta.url)('../chip.js');
const { parse, midiToHz, noteToMidi } = Chip;

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const times = mml => parse(mml).events.map(e => +e.t.toFixed(6));
const midis = mml => parse(mml).events.map(e => e.midi);

test('helpers: midiToHz, noteToMidi', () => {
  close(midiToHz(69), 440); close(midiToHz(57), 220); close(midiToHz(60), 261.6255653005986, 1e-9);
  assert.equal(noteToMidi('A4'), 69); assert.equal(noteToMidi('C4'), 60); assert.equal(noteToMidi('C#5'), 73); assert.equal(noteToMidi('Bb3'), 58); assert.equal(noteToMidi('C-1'), 0);
  assert.throws(() => noteToMidi('H4'), /bad note name/);
});

test('tempo and length: T120 L4 CDE -> 0, 0.5, 1.0', () => {
  const r = parse('T120 L4 CDE');
  assert.deepEqual(times('T120 L4 CDE'), [0, .5, 1]);
  assert.deepEqual(r.events.map(e => e.dur), [.5, .5, .5]);
  close(r.length, 1.5); assert.equal(r.infinite, false);
  assert.deepEqual(midis('T120 L4 CDE'), [60, 62, 64]);
});

test('default gate Q80: dur is the slot, sounding time is dur * gate', () => {
  const e = parse('T120 C').events[0];
  assert.equal(e.dur, .5); close(e.gate, .8); close(e.dur * e.gate, .4);
  const f = parse('T120 Q100 C Q50 D Q0 E').events;
  assert.deepEqual(f.map(x => x.gate), [1, .5, 0]);
  assert.equal(f.length, 3);                          // Q0 is kept as an event: it just never sounds
});

test('tempo defaults to 120, tempo changes are honored mid-track', () => {
  assert.deepEqual(times('C C'), [0, .5]);
  const r = parse('T60 C T120 C C');                  // 1 s, then 0.5 s, 0.5 s
  assert.deepEqual(r.events.map(e => +e.t.toFixed(6)), [0, 1, 1.5]);
  assert.deepEqual(r.events.map(e => e.dur), [1, .5, .5]);
  close(r.length, 2);
});

test('lengths: 1..192, L default, explicit length overrides, triplets', () => {
  const e = parse('T120 L8 C C4 C16 C1 C12').events.map(x => x.dur);
  close(e[0], .25); close(e[1], .5); close(e[2], .125); close(e[3], 2); close(e[4], 1 / 6);
  close(parse('T120 L192 C').events[0].dur, 2 / 192);
  assert.throws(() => parse('C193'), /length must be 1\.\.192, got 193/);
  assert.throws(() => parse('L0'), /L \(default length\) must be 1\.\.192/);
});

test('dots extend by half, repeatedly', () => {
  const d = parse('T120 C4. C4.. C8.').events.map(x => x.dur);
  close(d[0], .75); close(d[1], .875); close(d[2], .375);
  assert.deepEqual(times('T120 C4. D'), [0, .75]);
});

test('rests advance time and produce no event', () => {
  const r = parse('T120 C R4 D R8. E');
  assert.deepEqual(r.events.map(e => +e.t.toFixed(6)), [0, 1, 1.875]);
  assert.equal(r.events.length, 3);
  close(r.length, 2.375);
  assert.deepEqual(times('T120 L8 R C R2 D'), [.25, 1.5]);
});

test('accidentals: # + - and octaves', () => {
  assert.deepEqual(midis('C C# C+ D- E- F#'), [60, 61, 61, 61, 63, 66]);
  assert.deepEqual(midis('B# C-'), [72, 59]);
  assert.equal(parse('A').events[0].freq, 440);
  assert.deepEqual(midis('O4 C O5 C O3 C O-1 C O9 C'), [60, 72, 48, 0, 120]);
  assert.deepEqual(midis('O4 C > C > C < C < C'), [60, 72, 84, 72, 60]);
  assert.deepEqual(midis('O9 > C'), [120]);            // octave clamps at 9
  assert.deepEqual(midis('O-1 < C'), [0]);             // and at -1
  assert.deepEqual(midis('c d e'), [60, 62, 64]);       // case-insensitive
});

test('K transpose, Y detune, V volume, tone', () => {
  const [a, b] = parse('K12 A K0 Y100 A').events;
  assert.equal(a.midi, 81); close(a.freq, midiToHz(81));
  assert.equal(b.midi, 69); close(b.freq, midiToHz(70));
  assert.equal(parse('V127 C').events[0].vol, 1); close(parse('V0 C').events[0].vol, 0);
  const t = parse('@1 C @2 D @3 E').events.map(e => e.tone); assert.deepEqual(t, [1, 2, 3]);
  assert.equal(parse('C', { tone: 2 }).events[0].tone, 2);
});

test('ties: same pitch merges into one note with the summed slot', () => {
  const r = parse('T120 C4&4 D');
  assert.equal(r.events.length, 2); close(r.events[0].dur, 1); close(r.events[1].t, 1);
  const s = parse('T120 C4&16 D').events;              // length-only continuation
  close(s[0].dur, .625); close(s[1].t, .625);
  const c = parse('T120 C4&8.&16 D').events;          // chain
  close(c[0].dur, .5 + .375 + .125); assert.equal(c.length, 2);
  const q = parse('T120 Q50 C4&4').events[0];          // the gate applies to the whole merged slot
  close(q.dur, 1); close(q.gate, .5);
});

test('slur: different pitch is legato (gate 1, no gap, tie flag on the next note)', () => {
  const e = parse('T120 C4&D4 E').events;
  assert.equal(e.length, 3);
  assert.equal(e[0].gate, 1); assert.equal(e[0].tie, false);
  assert.equal(e[1].tie, true); close(e[1].t, .5); close(e[1].gate, .8);
  assert.equal(e[2].tie, false);
});

test('repeats: count, nesting, state carries over', () => {
  assert.deepEqual(midis('[CD]3'), [60, 62, 60, 62, 60, 62]);
  assert.deepEqual(midis('[C [DE]2 ]2'), [60, 62, 64, 62, 64, 60, 62, 64, 62, 64]);
  assert.deepEqual(midis('[C>]3'), [60, 72, 84]);       // octave persists across iterations
  assert.deepEqual(midis('[[C]2 D]2'), [60, 60, 62, 60, 60, 62]);
  assert.deepEqual(times('T120 [C]4'), [0, .5, 1, 1.5]);
  assert.deepEqual(midis('[C]1 D'), [60, 62]);
  assert.deepEqual(midis('[ ]4 C'), [60]);
  assert.deepEqual(midis('[C&D]2 D'), [60, 62, 60, 62, 62]);   // [C&D]2 D
});

test('infinite repeat: unrolled until maxSeconds, the track is cut there', () => {
  const r = parse('T120 [C]', { maxSeconds: 3 });
  assert.equal(r.events.length, 6); assert.equal(r.infinite, true); close(r.length, 3);
  const c = parse('T120 [C D E]', { maxSeconds: 2 });    // cuts mid-loop: 0, .5, 1, 1.5 -> 4 notes
  assert.deepEqual(c.events.map(e => e.midi), [60, 62, 64, 60]);
  close(c.length, 2);
  const s = parse('T120 [C4.]', { maxSeconds: 1 });      // the last note is shortened to end at the cap
  assert.equal(s.events.length, 2); close(s.events[1].dur, .25); close(s.length, 1);
  assert.equal(parse('T120 [C]').length, 60);            // default cap 60 s
  assert.equal(parse('C D [E]2').infinite, false);
  const m = parse('T120 C [D R]', { maxSeconds: 2 });    // rest overshoot is cut too
  close(m.length, 2);
  assert.throws(() => parse('[T120]'), /infinite repeat with no notes or rests/);
});

test('envelope, vibrato, glide slots resolve to seconds', () => {
  const r = parse('T120 @ENV1 { 30, 24, 127, 48, 0 } @VIB1 { 12, 24, 50 } @GLI1 { -100, 24 } C @ENV0 @VIB0 @GLI0 D').events;
  // 1 tick = 1/48 quarter = 1/96 s at T120
  assert.equal(r[0].env.v0, 30 / 127); close(r[0].env.pts[0][0], 24 / 96); assert.equal(r[0].env.pts[0][1], 1);
  close(r[0].env.pts[1][0], 72 / 96); assert.equal(r[0].env.pts[1][1], 0);
  close(r[0].vib.delay, 12 / 96); close(r[0].vib.period, 24 / 96); assert.equal(r[0].vib.depth, 50);
  assert.deepEqual([r[0].gli.cents, +r[0].gli.dur.toFixed(6)], [-100, .25]);
  assert.equal(r[1].env, null); assert.equal(r[1].vib, null); assert.equal(r[1].gli, null);
});

test('glide with *: offset from the previous note, duration = the note', () => {
  const r = parse('T120 @GLI2 { *, * } C G').events;
  assert.equal(r[0].gli.cents, 0);
  assert.equal(r[1].gli.cents, (60 - 67) * 100); close(r[1].gli.dur, .5);
});

test('slots can be redefined and are switched by number', () => {
  const r = parse('@ENV1 { 127 } C @ENV2 { 64 } D @ENV1 E').events;
  assert.deepEqual(r.map(e => e.env.v0), [1, 64 / 127, 1]);
  assert.deepEqual(parse('@ENV1 { 127 } @ENV1 @ENV 1 C').events.length, 1);
});

test('opts.prefix and opts.tones', () => {
  const r = parse('C', { prefix: 'T60 @ENV1 { 100 } @ENV1' }).events[0];
  assert.equal(r.dur, 1); assert.ok(r.env);
  const t = parse('@4 C', { tones: { 4: { type: 'sine' } } }).events[0]; assert.equal(t.tone, 4);
  assert.throws(() => parse('@4 C'), /unknown tone @4/);
});

test('comments, bar lines, whitespace, line breaks', () => {
  assert.deepEqual(midis('C D | E F // this is ignored\n G'), [60, 62, 64, 65, 67]);
  assert.deepEqual(midis('  T 120   L 8\n C\tD '), [60, 62]);
});

test('events are sorted and contiguous on the grid', () => {
  const ev = parse('T133 L8 [CEG R C4& D4 E4.&16 F ]3 T90 [A B]2').events;
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].t >= ev[i - 1].t + ev[i - 1].dur - 1e-9);
});

test('errors are readable and carry the position', () => {
  assert.throws(() => parse('C D X E'), /unexpected "X" at char 4: "C D >>X<< E"/);
  assert.throws(() => parse('[C D'), /\[ is never closed at char 0/);
  assert.throws(() => parse('C D]'), /\] without a matching \[ at char 3/);
  assert.throws(() => parse('T'), /T \(tempo\) needs a number/);
  assert.throws(() => parse('T0 C'), /T \(tempo\) must be 1\.\., got 0/);
  assert.throws(() => parse('Q101 C'), /Q \(gate\) must be 0\.\.100, got 101/);
  assert.throws(() => parse('V128 C'), /V \(volume\) must be 0\.\.127/);
  assert.throws(() => parse('O10 C'), /O \(octave\) must be -1\.\.9/);
  assert.throws(() => parse('@ENV3 C'), /@ENV slot 3 is not defined/);
  assert.throws(() => parse('@VIB1 { 1, 2 } C'), /@VIB \{ delay_ticks, period_ticks, depth_cents \} needs exactly 3/);
  assert.throws(() => parse('@ENV1 { 1, 2 } C'), /needs an initial volume and then pairs/);
  assert.throws(() => parse('@ENV1 { 1, x, 3 } C'), /takes numbers, got "x"/);
  assert.throws(() => parse('@ENV1 { 1, 2, 3 C'), /\{ is never closed/);
  assert.throws(() => parse('@ENV0 { 1 }'), /slot 0 means "off"/);
  assert.throws(() => parse('@FOO1 C'), /unknown command @FOO/);
  assert.throws(() => parse('C&R D'), /& must be followed by a note or a length at char 1/);
  assert.throws(() => parse('C&'), /& at the end has no note to tie to/);
  assert.throws(() => parse('R&C'), /& must come right after a note/);
  assert.throws(() => parse('C 8'), /unexpected "8"/);
  assert.throws(() => parse(42), /must be a string/);
  assert.throws(() => parse('X', { prefix: 'T120' }), /at char 0/);
  assert.throws(() => parse('C', { prefix: 'T120 Z' }), /in opts\.prefix at char 5/);
});

test('runaway repeats are stopped', () => {
  assert.throws(() => parse('[[[[C]99]99]99]99'), /more than 100000 notes/);
});

test('Chip API surface', () => {
  for (const k of ['parse', 'play', 'instrument', 'midiToHz', 'noteToMidi']) assert.equal(typeof Chip[k], 'function', k);
  for (const k of ['coin', 'jump', 'hit', 'explode', 'laser', 'powerup', 'blip', 'select', 'fall', 'land']) { assert.equal(typeof Chip.sfx[k], 'function', k); assert.ok(Chip.sfx.length(k) > 0); assert.equal(Chip.sfx.lengths[k], Chip.sfx.length(k)); }
  assert.throws(() => Chip.sfx.length('nope'), /unknown sfx/);
  assert.equal(Chip.TICKS, 192);
});
