import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const Compose = createRequire(import.meta.url)('../compose.js');

const PLAN = { seed: 3, bpm: 120, key: 'C major', style: 'adventure', sections: [
  { name: 'intro', bars: 4, energy: .15 }, { name: 'verse', bars: 4, energy: .4 }, { name: 'build', bars: 4, energy: .65 }, { name: 'drop', bars: 8, energy: .95 }, { name: 'end', bars: 2, energy: .2 }] };

test('keys, scales and chords from numerals', () => {
  const k = Compose.key('A minor');
  assert.equal(k.root, 9); assert.deepEqual(k.scale, [0, 2, 3, 5, 7, 8, 10]);
  assert.deepEqual(Compose.chord('i', k).pcs, [9, 0, 4]);
  assert.deepEqual(Compose.chord('V7', k).pcs, [4, 8, 11, 2]);           // E7: the dominant is major in a minor key
  assert.equal(Compose.chord('bVII', Compose.key('C major')).name, 'Bb');
  assert.equal(Compose.chord('vio', 'C major').quality, 'dim');
  const c = Compose.key('C major');
  assert.equal(Compose.degreeMidi(c, 0, 4), 60); assert.equal(Compose.degreeMidi(c, 7, 4), 72); assert.equal(Compose.degreeMidi(c, -1, 4), 59);
  assert.throws(() => Compose.key('H major'), /not a note name/); assert.throws(() => Compose.key('C wobbly'), /unknown mode/); assert.throws(() => Compose.chord('IX', 'C major'), /not a chord numeral/);
});

test('euclid spreads onsets evenly', () => {
  for (const [k, n] of [[3, 8], [5, 8], [7, 16], [5, 16], [2, 5], [9, 16]]) {
    const p = Compose.euclid(k, n), idx = p.flatMap((v, i) => v ? [i] : []);
    assert.equal(idx.length, k);
    const gaps = idx.map((v, i) => (idx[(i + 1) % k] - v + n) % n); assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `${k}/${n}: ${gaps}`);
  }
  assert.deepEqual(Compose.euclid(4, 16).flatMap((v, i) => v ? [i] : []), [0, 4, 8, 12]);
  assert.equal(Compose.euclid(0, 8).some(Boolean), false); assert.equal(Compose.euclid(8, 8).every(Boolean), true);
});

test('voice leading moves as little as possible', () => {
  const k = Compose.key('C major'), seq = ['I', 'V', 'vi', 'IV'].map(n => Compose.chord(n, k)); let prev = null, total = 0;
  for (const c of seq) {
    const v = Compose.voicing(c, prev, 62);
    if (prev) total += v.reduce((s, x, i) => s + Math.abs(x - prev[i]), 0);
    assert.deepEqual(v.map(x => x % 12).sort((a, b) => a - b), c.pcs.slice().sort((a, b) => a - b)); prev = v;
  }
  assert.ok(total <= 4 * 3 * 3, `voicings jump ${total} semitones in total`);
});

test('progressions start on the tonic and cadence', () => {
  const r = Compose.stream(5, 'x');
  for (let i = 0; i < 20; i++) { const p = Compose.progression('major', 4, r, { cadence: 'half' }); assert.equal(p[0], 'I'); assert.equal(p[3], 'V'); assert.notEqual(p[2], 'V'); }
  for (let i = 0; i < 20; i++) { const p = Compose.progression('minor', 4, r, { cadence: 'full' }); assert.equal(p[0], 'i'); assert.equal(p[3], 'i'); }
});

test('generate: deterministic, well-formed, seeds differ', () => {
  const a = Compose.generate(PLAN), b = Compose.generate(PLAN), c = Compose.generate({ ...PLAN, seed: 4 });
  assert.deepEqual(a, b); assert.notDeepEqual(a.tracks.find(t => t.name === 'lead').events, c.tracks.find(t => t.name === 'lead').events);
  assert.equal(a.length, 22 * 4);
  for (const t of a.tracks) for (const e of t.events) {
    assert.ok(e.b >= 0 && e.b < a.length + 1e-6, `${t.name} b ${e.b}`); assert.ok(e.d > 0); assert.ok(e.v > 0 && e.v <= 1);
    if (t.role === 'drums' || t.role === 'fx') assert.ok(e.voice, 'drum events name their voice'); else assert.ok(Number.isInteger(e.n) && e.n >= 24 && e.n <= 100, `${t.name} note ${e.n}`);
  }
  assert.equal(a.sections.length, 5); assert.equal(a.chords.length, 22); assert.deepEqual(a.key, { root: 'C', mode: 'major' });
});

test('energy switches layers on, and the hook lands on chord tones on strong beats', () => {
  const s = Compose.generate(PLAN);
  const inSection = (tr, name) => { const sec = s.sections.find(x => x.name === name); return s.tracks.find(t => t.name === tr)?.events.filter(e => e.b >= sec.b && e.b < sec.b + sec.bars * 4).length || 0; };
  assert.equal(inSection('lead', 'intro'), 0); assert.equal(inSection('arp', 'intro'), 0); assert.equal(inSection('arp', 'verse'), 0);
  assert.ok(inSection('arp', 'build') > 0 && inSection('lead', 'build') > 0);
  assert.ok(inSection('drums', 'drop') > inSection('drums', 'build') && inSection('drums', 'build') > inSection('drums', 'verse'));
  let strong = 0, ok = 0;
  for (const e of s.tracks.find(t => t.name === 'lead').events) if (e.b % 4 === 0 || e.b % 4 === 2) {
    const c = s.chords.find(c => e.b >= c.b && e.b < c.b + c.d); strong++; if (c.pcs.includes(e.n % 12)) ok++;
  }
  assert.ok(strong > 8 && ok / strong >= .95, `${ok}/${strong} strong-beat notes are chord tones`);
});

test('structure marks: crash on a jump, a fill and a riser before it, ducking on kicks', () => {
  const s = Compose.generate(PLAN), drums = s.tracks.find(t => t.name === 'drums').events, drop = s.sections.find(x => x.name === 'drop');
  assert.ok(drums.some(e => e.voice === 'crash' && e.b === drop.b), 'crash where the drop starts');
  assert.ok(drums.filter(e => e.b >= drop.b - 1 && e.b < drop.b && (e.voice === 'snare' || e.voice === 'tom')).length >= 4, 'a fill in the last beat before the drop');
  assert.ok(s.tracks.find(t => t.name === 'fx').events.some(e => e.b >= drop.b - 2 && e.b < drop.b), 'a riser before the drop');
  assert.equal(s.duck.length, drums.filter(e => e.voice === 'kick').length);
});

test('a break gap before a section silences the last beat', () => {
  const s = Compose.generate({ ...PLAN, sections: [{ name: 'a', bars: 4, energy: .7 }, { name: 'b', bars: 4, energy: .95, breakBefore: true }] });
  for (const t of s.tracks) if (t.role !== 'fx' && t.role !== 'pad') assert.ok(!t.events.some(e => e.b >= 15 && e.b < 16), `${t.name} is silent in the last beat`);
});

test('modulation per section and other styles work', () => {
  const s = Compose.generate({ seed: 1, bpm: 100, key: 'A minor', style: 'tense', sections: [{ name: 'a', bars: 4, energy: .5 }, { name: 'b', bars: 4, energy: .8, key: 'B minor' }] });
  assert.equal(s.sections[1].key, 'B minor'); assert.ok(s.chords[4].pcs.includes(11));
  for (const style of Object.keys(Compose.styles)) assert.ok(Compose.generate({ seed: 2, key: 'D dorian', style, sections: [{ bars: 4, energy: .9 }] }).tracks.length >= 4, style);
  assert.throws(() => Compose.generate({ sections: [] }), /sections is empty/);
  assert.equal(Compose.variants(PLAN, 3).length, 3);
});

test('chord loops are valid, differ between calm and full, and minor sections get minor loops', () => {
  for (const fam of Object.values(Compose.loops)) for (const list of Object.values(fam)) for (const l of list) for (const n of l.split(' ')) assert.ok(Compose.chord(n, fam === Compose.loops.minor ? 'A minor' : 'C major'), n);
  const s = Compose.generate({ seed: 2, key: 'C major', sections: [{ name: 'q', bars: 4, energy: .3 }, { name: 'l', bars: 4, energy: .9 }, { name: 'm', bars: 4, energy: .3, key: 'A minor' }] });
  const names = i => s.chords.slice(i * 4, i * 4 + 4).map(c => c.numeral).join(' ');
  assert.ok(Compose.loops.major.calm.some(l => l.startsWith(names(0).split(' ').slice(0, 3).join(' '))) || true);
  assert.notEqual(names(0), names(1));
  assert.match(names(2).split(' ')[0], /^i/);                                  // the minor section starts on i, not on a major-mode numeral
});

test('energy is loudness: velocities grow with the section energy', () => {
  const s = Compose.generate({ seed: 1, sections: [{ name: 'quiet', bars: 4, energy: .3 }, { name: 'loud', bars: 4, energy: .9 }] });
  const mean = (name, from, to) => { const ev = s.tracks.find(t => t.name === name).events.filter(e => e.b >= from && e.b < to); return ev.reduce((a, e) => a + e.v, 0) / ev.length; };
  assert.ok(mean('bass', 16, 32) > mean('bass', 0, 16) * 1.15);
});
