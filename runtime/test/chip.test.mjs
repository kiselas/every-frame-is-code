// node --test runtime/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const Chip = createRequire(import.meta.url)('../chip.js');
const { parse, midiToHz, noteToMidi, scoreEvents } = Chip;

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
  assert.throws(() => parse('@11 C'), /unknown tone @11/);       // 4..10 are the built-in drum tones
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

// ---------------------------------------------------------------- scores: scoreEvents, validation, and playScore against a recording fake AudioContext
const mini = () => ({
  bpm: 120, length: 8,
  tracks: [
    { name: 'bass', role: 'bass', voice: 'triangle', gain: .6, events: [{ b: 0, d: 1, n: 36 }, { b: 2, d: .5, n: 43, v: .5 }] },
    { name: 'drums', role: 'drums', events: [{ b: 0, voice: 'kick' }, { b: 1, voice: 'snare', v: 1 }, { b: 1.5, voice: 'tom', n: 72 }] },
  ],
  duck: [{ b: 0, depth: .5, rel: .2 }],
});
const err = (fn, re) => assert.throws(fn, e => { assert.match(e.message, /^Chip score: /); assert.match(e.message, re); return true; });

test('scoreEvents: default timing is beats * 60 / bpm from t0, sorted by time', () => {
  const ev = scoreEvents(mini());
  assert.deepEqual(ev.map(e => e.t), [0, 0, .5, .75, 1]);
  assert.equal(ev[0].track, 'bass'); assert.equal(ev[1].track, 'drums');           // equal times: track order
  close(ev[0].dur, .5); close(ev[4].dur, .25);
  assert.deepEqual(scoreEvents(mini(), { t0: 10 }).map(e => e.t), [10, 10, 10.5, 10.75, 11]);
  const fast = scoreEvents({ ...mini(), bpm: 240 }); close(fast[4].t, .5);
  assert.equal(ev[0].midi, 36); assert.equal(ev[0].voice, 'triangle'); assert.equal(ev[0].ti, 0); assert.equal(ev[0].role, 'bass');
});

test('scoreEvents: a custom timeOf (tempo map) sets start and duration', () => {
  const timeOf = b => b < 4 ? b * .5 : 2 + (b - 4) * .25;            // 120 bpm, then 240 bpm from beat 4
  const s = { bpm: 120, tracks: [{ voice: 'square', events: [{ b: 3, d: 2, n: 60 }, { b: 6, d: 1, n: 62 }] }] };
  const [a, c] = scoreEvents(s, { timeOf });
  close(a.t, 1.5); close(a.dur, .5 + .25); close(c.t, 2.5); close(c.dur, .25);
  assert.equal(a.track, 'track0');
  assert.throws(() => scoreEvents(s, { timeOf: () => NaN }), /timeOf\(3\) returned NaN/);
});

test('scoreEvents: velocity maps to gain monotonically (v^1.5 times the track gain)', () => {
  const vs = [0, .1, .25, .5, .75, .8, 1];
  const ev = scoreEvents({ bpm: 120, tracks: [{ voice: 'square', gain: .4, events: vs.map((v, i) => ({ b: i, d: 1, n: 60, v })) }] });
  const g = ev.map(e => e.gain);
  for (let i = 1; i < g.length; i++) assert.ok(g[i] > g[i - 1], `${g[i]} > ${g[i - 1]}`);
  close(g[0], 0); close(g[6], .4); close(g[3], .4 * .5 ** 1.5); close(ev[5].vel, .8 ** 1.5);
  close(scoreEvents({ bpm: 120, tracks: [{ voice: 'square', events: [{ b: 0, d: 1, n: 60 }] }] })[0].gain, .5 * .8 ** 1.5);   // default gain .5, velocity .8
});

test('scoreEvents: from skips events that start before it (a live seek)', () => {
  const all = scoreEvents(mini()), late = scoreEvents(mini(), { from: .6 });
  assert.equal(all.length, 5); assert.deepEqual(late.map(e => e.t), [.75, 1]);
  assert.equal(scoreEvents(mini(), { from: .5 }).length, 3);          // starting exactly at `from` still plays
  assert.equal(scoreEvents(mini(), { from: 100 }).length, 0);
});

test('scoreEvents: drum events resolve to a drum name, toms keep their note, glide resolves to seconds', () => {
  const ev = scoreEvents(mini());
  const kick = ev.find(e => e.drum === 'kick'), tom = ev.find(e => e.drum === 'tom');
  assert.equal(kick.midi, undefined); assert.equal(kick.dur, 0); assert.equal(kick.voice, 'kick'); assert.equal(tom.midi, 72);
  assert.equal(ev.find(e => e.track === 'bass').drum, undefined);
  const g = scoreEvents({ bpm: 120, tracks: [{ voice: 'sine', events: [{ b: 0, d: 1, n: 60, g: 72 }, { b: 1, d: 1, n: 60, g: 55, gd: .5 }, { b: 2, d: 1, n: 60 }] }] });
  assert.deepEqual(g[0].glide, { midi: 72, dur: .06 }); close(g[1].glide.dur, .25); assert.equal(g[2].glide, null);
  const mix = scoreEvents({ bpm: 120, tracks: [{ voice: 'triangle', events: [{ b: 0, n: 40, d: 1 }, { b: 1, voice: 'hat' }] }] });   // a drum event on a melodic track
  assert.equal(mix[1].drum, 'hat');
});

test('scoreDucks: duck events on absolute time, sorted', () => {
  const d = Chip.scoreDucks({ bpm: 120, tracks: [], duck: [{ b: 4, depth: .5, rel: .3 }, { b: 1, depth: 1, rel: .1 }] }, { t0: 1 });
  assert.deepEqual(d, [{ t: 1.5, depth: 1, rel: .1 }, { t: 3, depth: .5, rel: .3 }]);
});

test('validation: readable errors for malformed scores', () => {
  const ev = e => ({ bpm: 120, tracks: [{ name: 'lead', voice: 'square', events: [e] }] });
  err(() => scoreEvents(null), /must be an object/);
  err(() => scoreEvents({ bpm: 120 }), /tracks must be an array/);
  err(() => scoreEvents({ bpm: NaN, tracks: [] }), /bpm must be a finite number, got NaN/);
  err(() => scoreEvents({ bpm: 0, tracks: [] }), /bpm must be/);
  err(() => scoreEvents({ bpm: 120, tracks: [{ name: 'x', voice: 'wobble', events: [] }] }), /track "x": unknown voice "wobble" \(triangle, square/);
  err(() => scoreEvents(ev({ b: 0, d: 1, n: 60, voice: 'wobble' })), /track "lead" event 0: unknown voice "wobble"/);
  err(() => scoreEvents(ev({ b: 0, d: -1, n: 60 })), /event 0: d \(duration\) must not be negative, got -1/);
  err(() => scoreEvents(ev({ b: 0, d: Infinity, n: 60 })), /d \(duration in beats\) must be a finite number, got Infinity/);
  err(() => scoreEvents(ev({ b: NaN, d: 1, n: 60 })), /b \(start beat\) must be a finite number/);
  err(() => scoreEvents(ev({ d: 1, n: 60 })), /b \(start beat\) must be a finite number, got "?undefined/);
  err(() => scoreEvents(ev({ b: -1, d: 1, n: 60 })), /b \(start beat\) must be 0\.\./);
  err(() => scoreEvents(ev({ b: 0, d: 1, n: '60' })), /n \(MIDI note\) must be a finite number/);
  err(() => scoreEvents(ev({ b: 0, d: 1, n: 200 })), /n \(MIDI note\) must be 0\.\.127, got 200/);
  err(() => scoreEvents(ev({ b: 0, d: 1 })), /a note event needs n/);
  err(() => scoreEvents(ev({ b: 0, d: 1, n: 60, v: 2 })), /v \(velocity\) must be 0\.\.1, got 2/);
  err(() => scoreEvents({ bpm: 120, tracks: [{ name: 'dr', role: 'drums', events: [{ b: 0 }] }] }), /track "dr" event 0: a drum event needs voice: one of kick, snare/);
  err(() => scoreEvents({ bpm: 120, tracks: [{ name: 'dr', role: 'drums', events: [{ b: 0, voice: 'square' }] }] }), /a drum event needs voice.*got "square"/);
  err(() => scoreEvents({ bpm: 120, tracks: [{ role: 'choir', events: [] }] }), /unknown role "choir"/);
  err(() => scoreEvents({ bpm: 120, tracks: [{ gain: NaN, events: [] }] }), /gain must be a finite number/);
  err(() => scoreEvents({ bpm: 120, tracks: [{ pan: 2, events: [] }] }), /pan must be -1\.\.1/);
  err(() => scoreEvents({ bpm: 120, tracks: [{ env: { s: 1.5 }, events: [] }] }), /env\.s must be 0\.\.1/);
  err(() => scoreEvents({ bpm: 120, tracks: [{ echo: { time: 0 }, events: [] }] }), /echo\.time must be 0\.001\.\./);
  err(() => scoreEvents({ bpm: 120, tracks: [{ duty: [.1], events: [] }] }), /duty as a sweep is \[from, to\]/);
  err(() => scoreEvents({ bpm: 120, tracks: [], duck: [{ b: 0, depth: 2, rel: .2 }] }), /duck 0: depth must be 0\.\.1/);
  err(() => scoreEvents({ bpm: 120, tracks: [], duck: [{ b: 0, depth: .5, rel: 0 }] }), /duck 0: rel/);
  assert.equal(Chip.validateScore(mini()), true);
});

// A recording fake of the parts of AudioContext that playScore touches. Every AudioParam records its automation.
function fakeContext(sampleRate = 48000) {
  const params = [], counts = {}, started = [];
  const param = (v = 0) => { const p = { value: v, ev: [] }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) p[m] = (val, t) => { p.ev.push([m, val, t]); return p; }; params.push(p); return p; };
  const node = kind => {
    const n = { kind, connect(d) { return d; }, start(t) { started.push([kind, t]); }, stop() {}, setPeriodicWave() {} };
    counts[kind] = (counts[kind] || 0) + 1;
    for (const k of ['gain', 'frequency', 'detune', 'delayTime', 'Q', 'pan']) n[k] = param(k === 'gain' ? 1 : 0);
    return n;
  };
  const ac = { sampleRate, currentTime: 0, destination: node('dest'), counts, params, started };
  for (const k of ['Gain', 'Oscillator', 'BufferSource', 'BiquadFilter', 'Delay', 'WaveShaper', 'StereoPanner']) ac['create' + k] = () => node(k);
  ac.createBuffer = (c, n) => ({ getChannelData: () => new Float32Array(n) });
  ac.createPeriodicWave = () => ({});
  return ac;
}
const ascending = ac => {
  for (const p of ac.params) {
    let last = -Infinity;
    for (const [m, v, t] of p.ev) { assert.ok(Number.isFinite(t) && Number.isFinite(v), `${m} ${v} ${t}`); assert.ok(t >= last - 1e-12, `automation out of order: ${t} after ${last}`); if (m === 'exponentialRampToValueAtTime') assert.ok(v > 0, 'exponential ramp target must be > 0'); last = t; }
  }
};

test('playScore: schedules on a fake context, returns end / tail / length, automation stays in time order', () => {
  const ac = fakeContext(), sc = mini();
  sc.tracks[0].duck = true; sc.tracks[0].echo = { time: .5, fb: .9, mix: .3 };
  sc.duck.push({ b: 0.01, depth: .8, rel: .5 }, { b: 0.5, depth: .5, rel: .05 }, { b: 3, depth: .5, rel: 1 }, { b: 3.5, depth: .5, rel: 1 });
  const r = Chip.playScore(ac, .25, ac.destination, sc);
  assert.ok(r.end > .25 + 1.25, `end ${r.end}`); assert.ok(r.tail > r.end, 'the echo tail is longer than the notes');
  close(r.length, .25 + 4);                                            // 8 beats at 120 bpm
  assert.ok(ac.counts.Delay === 1 && ac.counts.Oscillator >= 3);       // one echo, a triangle note x2 + kick body + snare tone + tom body...
  ascending(ac);
});

test('playScore: from skips the events that already sounded, timeOf is honored', () => {
  const all = fakeContext(), seek = fakeContext(), mapped = fakeContext();
  Chip.playScore(all, 0, all.destination, mini());
  Chip.playScore(seek, 0, seek.destination, mini(), { from: .6 });      // the kick, the snare and the first bass note are past: the tom (.75 s) and the second bass note (1 s) remain
  assert.ok(seek.counts.Oscillator < all.counts.Oscillator);
  Chip.playScore(mapped, 0, mapped.destination, mini(), { timeOf: b => 100 + b, from: 0 });
  assert.ok(mapped.started.every(([, t]) => t >= 100), 'every source starts on the mapped clock');
  ascending(mapped);
  const empty = fakeContext(); const r = Chip.playScore(empty, 0, empty.destination, mini(), { from: 1000 });
  assert.equal(empty.counts.Oscillator ?? 0, 0); assert.equal(r.end, 0);
});

test('playScore: a long open hat is choked by the next closed hat, overlapping drums use lanes', () => {
  const ac = fakeContext();
  const ev = [{ b: 0, voice: 'ohat' }, { b: .5, voice: 'hat' }, { b: .5, voice: 'kick' }, { b: .5, voice: 'snare' }, { b: 1, voice: 'crash' }];
  const r = Chip.playScore(ac, 0, ac.destination, { bpm: 120, tracks: [{ role: 'drums', events: ev }] });
  assert.ok(r.end > 1.5); ascending(ac);
  const nochoke = fakeContext(); Chip.playScore(nochoke, 0, nochoke.destination, { bpm: 120, tracks: [{ role: 'drums', events: [{ b: 0, voice: 'ohat' }] }] });
  const choked = ac.params.filter(p => p.ev.some(e => e[0] === 'exponentialRampToValueAtTime' && e[2] > .25 && e[2] < .3));
  assert.ok(choked.length >= 1, 'an envelope ends right after the choke time (.25 s) instead of running the natural .32 s');
});

test('Chip.drums: every drum returns its end, rejects bad options, has a length', () => {
  const ac = fakeContext();
  for (const name of ['kick', 'snare', 'hat', 'ohat', 'tom', 'crash', 'clap', 'rim']) {
    const r = Chip.drums[name](ac, 1, ac.destination, { gain: .7, seed: 3 });
    assert.equal(r.end, 1 + Chip.drums.length(name)); assert.equal(Chip.drums.lengths[name], Chip.drums.length(name));
    assert.ok(Chip.drums.length(name) > 0);
    assert.throws(() => Chip.drums[name](ac, 0, ac.destination, { pitch: 0 }), /pitch must be > 0/);
  }
  assert.throws(() => Chip.drums.length('gong'), /unknown drum "gong"/);
  assert.equal(Chip.drums.crash(ac, 0, ac.destination, { decay: .5 }).end, Chip.drums.length('crash') * .5);
  assert.deepEqual(Chip.drums.names, ['kick', 'snare', 'hat', 'ohat', 'tom', 'crash', 'clap', 'rim']);
  ascending(ac);
});

test('MML drum tones @4..@10 parse and play through Chip.play (tone 11 does not exist)', () => {
  const ev = parse('@4 V110 O3 C4 R4 C4 R4 @5 C @6 C @7 C @8 O4 C @9 C @10 C').events;
  assert.deepEqual(ev.map(e => e.tone), [4, 4, 5, 6, 7, 8, 9, 10]);
  const ac = fakeContext();
  const r = Chip.play(ac, 0, ac.destination, ['T120 @4 V110 O3 C4 R4 C4 R4', 'T120 @5 C4 @6 C8 C8']);
  assert.ok(Math.abs(r.end - 1.4) < 1e-9); assert.ok(ac.counts.Oscillator >= 3); ascending(ac);
  assert.throws(() => parse('@11 C'), /unknown tone @11/);
});

test('Chip API surface: score functions and drums', () => {
  for (const k of ['playScore', 'scoreEvents', 'scoreDucks', 'validateScore']) assert.equal(typeof Chip[k], 'function', k);
  for (const k of ['kick', 'snare', 'hat', 'ohat', 'tom', 'crash', 'clap', 'rim']) assert.equal(typeof Chip.drums[k], 'function', k);
});
