import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const Timing = createRequire(import.meta.url)('../timing.js');

const words = [
  { word: 'Раз', start: 0.1, end: 0.5, punct: ',' }, { word: 'два', start: 0.6, end: 1.0, punct: '.' },
  { word: 'Три', start: 2.0, end: 2.4 }, { word: 'раз', start: 2.5, end: 2.9 }, { word: 'ЛЖЕУЧЁНЫМ', start: 3.0, end: 3.6, punct: '.' },
  { word: 'Конец', start: 5.0, end: 5.6, punct: '.' },
];
const phrases = [{ start: 0.1, end: 1.0 }, { start: 2.0, end: 3.6 }, { start: 5.0, end: 5.6 }];
const voice = { words, phrases };
const spec = (shots, extra = {}) => ({ tempo: 120, shots, ...extra });

test('shots are cut in the pauses between phrases, and the last one gets a tail', () => {
  const T = Timing.resolve(spec([{ id: 'a', phrases: [0] }, { id: 'b', phrases: [1] }, { id: 'c', phrases: [2], tail: 1 }]), voice);
  assert.equal(T.shots[0].start, 0);
  assert.equal(T.shots[0].end, (1.0 + 2.0) / 2);                // the middle of the pause 1.0 .. 2.0
  assert.equal(T.shots[1].start, T.shots[0].end);
  assert.equal(T.shots[1].end, (3.6 + 5.0) / 2);
  assert.equal(T.duration, 5.6 + 1);
  assert.equal(T.shots[2].end, T.duration);
  assert.equal(T.shots[1].beats, T.shots[1].dur / 0.5);
  assert.deepEqual(T.shots[1].words, [2, 5]);
});

test('a shot may span several phrases, and a shot without phrases takes dur', () => {
  const T = Timing.resolve(spec([{ id: 'a', phrases: [0, 1] }, { id: 'b', dur: 1.5 }, { id: 'c', phrases: [2] }]), voice);
  assert.equal(T.shots[0].phrases[1], 1);
  assert.equal(T.shots[1].dur, 1.5);
  assert.equal(T.shots[1].start, T.shots[0].end);
});

test('hold stretches a shot and pushes the rest', () => {
  const a = Timing.resolve(spec([{ id: 'a', phrases: [0] }, { id: 'b', phrases: [1] }]), voice);
  const b = Timing.resolve(spec([{ id: 'a', phrases: [0], hold: 0.5 }, { id: 'b', phrases: [1] }]), voice);
  assert.equal(b.shots[0].end, a.shots[0].end + 0.5);
  assert.equal(b.shots[1].start, a.shots[1].start + 0.5);
});

test('anchors: words (case, punctuation and e/yo ignored), phrases, beats, shot edges, plain numbers', () => {
  const T = Timing.resolve(spec([{ id: 'a', phrases: [0] }, { id: 'b', phrases: [1] }, { id: 'c', phrases: [2] }]), voice);
  const b = T.shots[1];
  assert.equal(T.anchor(1, { $word: 'лжеучёный'.replace('ый', 'ым') }), 3.0 - b.start);
  assert.equal(T.anchor(1, { $word: 'ЛЖЕУЧЕНЫМ!' }), 3.0 - b.start);
  assert.equal(T.anchor(1, { $word: 'раз' }), 2.5 - b.start, 'the occurrence inside the shot wins over an earlier one in another shot');
  assert.equal(T.anchor(1, { $word: 'раз', off: 0.25 }), 2.5 - b.start + 0.25);
  assert.equal(T.anchor(0, { $word: 'раз', n: 1 }), 0.1);
  assert.equal(T.anchor(1, { $phrase: 1 }), 2.0 - b.start);
  assert.equal(T.anchor(1, { $phrase: 1, at: 'end' }), 3.6 - b.start);
  assert.equal(T.anchor(1, { $beat: 3 }), 1.5);
  assert.equal(T.anchor(1, { $shot: 'end', off: -0.5 }), b.dur - 0.5);
  assert.equal(T.anchor(1, 0.75), 0.75);
  assert.throws(() => T.anchor(1, { $word: 'нету' }), /not in the voice-over/);
});

test('resolveDeep turns every anchor in a nested object into seconds and leaves the rest alone', () => {
  const T = Timing.resolve(spec([{ id: 'a', phrases: [0] }, { id: 'b', phrases: [1] }]), voice);
  const r = T.resolveDeep(1, { block: 'x', at: { $phrase: 1 }, items: [{ t: { $beat: 2 }, label: 'keep' }], n: 3 });
  assert.deepEqual(r, { block: 'x', at: 2.0 - T.shots[1].start, items: [{ t: 1, label: 'keep' }], n: 3 });
});

test('a silent film needs no voice, and a voice offset moves everything', () => {
  const S = Timing.resolve(spec([{ id: 'a', dur: 2 }, { id: 'b', beats: 6 }]), null);
  assert.equal(S.duration, 5);
  const O = Timing.resolve(spec([{ id: 'a', phrases: [0] }, { id: 'b', phrases: [1] }], { voice: { offset: 0.5 } }), voice);
  assert.equal(O.wordTime('конец'), 5.5);
});

test('errors name the shot', () => {
  assert.throws(() => Timing.resolve(spec([{ id: 'zzz', phrases: [9] }]), voice), /zzz/);
  assert.throws(() => Timing.resolve(spec([{ id: 'a', phrases: [1] }, { id: 'back', phrases: [0], tail: 0 }, { id: 'c', phrases: [2] }]), voice), /back/);
});
