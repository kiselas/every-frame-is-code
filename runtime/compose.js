// motion-kit generator: a short PLAN (key, tempo, style, sections with an energy 0..1) becomes a full SCORE (data) that
// runtime/chip.js plays: chords, voice leading, bass, arpeggios, a hook with development, a groove, fills, risers, ducking.
// The agent writes intent; seeded generators write the notes. Same plan + seed -> the same score, always.
// Classic script, no dependencies:  <script src="../../runtime/compose.js"></script>  then  Compose.generate({...}).
// API and method: 18-music-generation.md. Also usable in Node (module.exports).
(function (global) {
'use strict';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mulberry32 = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hashStr = str => { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const mod = (n, m) => ((n % m) + m) % m;
// independent streams: changing the melody never reshuffles the drums
const stream = (seed, name) => { const r = mulberry32((seed * 2654435761 + hashStr(name)) >>> 0); r(); r(); return r; };
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const wpick = (rng, pairs) => { const tot = pairs.reduce((s, p) => s + p[1], 0); let x = rng() * tot; for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; } return pairs[pairs.length - 1][0]; };

// ---------------------------------------------------------------- theory
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
};
const MINORISH = new Set(['minor', 'dorian', 'phrygian', 'harmonic']);
function parsePc(name) {
  const m = /^([A-Ga-g])([#b]?)$/.exec(String(name).trim());
  if (!m) throw new Error(`Compose: "${name}" is not a note name (C, F#, Bb...)`);
  return mod(LETTER[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0), 12);
}
// key('A minor') | key({ root: 'A', mode: 'minor' }) -> { root (pc), mode, scale, name }
function key(spec) {
  if (spec && spec.scale) return spec;
  let root, mode;
  if (typeof spec === 'string') { const [r, m = 'major'] = spec.trim().split(/\s+/); root = r; mode = m.toLowerCase(); } else { root = spec.root; mode = spec.mode || 'major'; }
  if (!MODES[mode]) throw new Error(`Compose: unknown mode "${mode}" (have: ${Object.keys(MODES).join(', ')})`);
  const pc = parsePc(root);
  return { root: pc, mode, scale: MODES[mode], name: `${NAMES[pc]} ${mode}` };
}
const degreeMidi = (k, d, oct = 4) => { const n = k.scale.length, o = Math.floor(d / n); return 12 * (oct + 1) + k.root + k.scale[mod(d, n)] + 12 * o; };
const degreeOfPc = (k, pc) => { let best = 0, bd = 99; k.scale.forEach((iv, i) => { const d = Math.min(mod(k.root + iv - pc, 12), mod(pc - k.root - iv, 12)); if (d < bd) { bd = d; best = i; } }); return best; };

const ROMAN = { I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 };
const QUAL = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], dom7: [0, 4, 7, 10], min7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7], sus2: [0, 2, 7], power: [0, 7] };
const SUFFIX = { maj: '', min: 'm', dim: 'dim', aug: 'aug', dom7: '7', min7: 'm7', maj7: 'maj7', sus4: 'sus4', sus2: 'sus2', power: '5' };
// chord('V7', key) - upper case = major, lower case = minor, `o` diminished, `+` augmented, `7`, `M7`, `sus4`, `sus2`, `5`; `b`/`#` prefix moves the root
function chord(numeral, k) {
  k = key(k);
  const m = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(o|\+|M7|7|sus4|sus2|5)?$/.exec(numeral);
  if (!m) throw new Error(`Compose: "${numeral}" is not a chord numeral (I, ii, V7, bVII, vio, IVM7, Isus4...)`);
  const up = m[2] === m[2].toUpperCase(), deg = ROMAN[m[2].toUpperCase()], sfx = m[3] || '';
  const root = mod(k.root + k.scale[deg] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0), 12);
  const q = sfx === 'o' ? 'dim' : sfx === '+' ? 'aug' : sfx === '7' ? (up ? 'dom7' : 'min7') : sfx === 'M7' ? 'maj7' : sfx === 'sus4' ? 'sus4' : sfx === 'sus2' ? 'sus2' : sfx === '5' ? 'power' : (up ? 'maj' : 'min');
  const iv = QUAL[q];
  return { numeral, root, quality: q, name: NAMES[root] + SUFFIX[q], intervals: iv, pcs: iv.map(i => mod(root + i, 12)) };
}
// nearest MIDI note to `m` whose pitch class is in `pcs`
function nearestTone(m, pcs) { let best = m, bd = 99; for (let d = -6; d <= 6; d++) { const x = m + d; if (pcs.includes(mod(x, 12)) && Math.abs(d) < bd) { bd = Math.abs(d); best = x; } } return best; }
// a strong-beat melody note: the nearest chord tone, but the root is discouraged (the bass plays it: parallel octaves) and the third is preferred
function strongTone(m, c, allowRoot, avoidPerfect) {
  let best = m, bc = 1e9;
  for (let d = -7; d <= 7; d++) {
    const x = m + d, pc = mod(x, 12); if (!c.pcs.includes(pc)) continue;
    const pen = pc === c.root ? (allowRoot ? 0 : 6) : pc === c.pcs[2 % c.pcs.length] && c.pcs.length > 2 ? 1.2 : 0;
    const iv = mod(pc - c.root, 12), cost = Math.abs(d) + pen + (avoidPerfect && (iv === 0 || iv === 7) ? 8 : 0); if (cost < bc) { bc = cost; best = x; }
  }
  return best;
}
const nearOctave = (m, prev) => { let best = m, bd = 99; for (let o = -24; o <= 24; o += 12) if (Math.abs(m + o - prev) < bd) { bd = Math.abs(m + o - prev); best = m + o; } return best; };
// voice leading: the inversion of `c` that moves least from the previous voicing (or sits closest to `center`)
function voicing(c, prev, center = 62) {
  const n = c.pcs.length; let best = null, bc = 1e9;
  for (let inv = 0; inv < n; inv++) {
    const order = c.pcs.slice(inv).concat(c.pcs.slice(0, inv)); const notes = [];
    let low = center - 7; let x = nearestTone(low, [order[0]]); if (x < low - 2) x += 12; notes.push(x);
    for (let i = 1; i < n; i++) { let y = notes[i - 1] + 1; while (mod(y, 12) !== order[i]) y++; notes.push(y); }
    const cost = prev ? notes.reduce((s, v, i) => s + Math.abs(v - (prev[i] ?? prev[prev.length - 1])), 0) + Math.abs(notes[0] - (prev[0])) * .5 : notes.reduce((s, v) => s + Math.abs(v - center), 0);
    if (cost < bc) { bc = cost; best = notes; }
  }
  return best;
}
// Bjorklund: k onsets spread as evenly as possible over n steps, rotated
function euclid(k, n, rot = 0) {
  k = clamp(Math.round(k), 0, n); let a = Array.from({ length: k }, () => [1]), b = Array.from({ length: n - k }, () => [0]);
  while (b.length > 1 && a.length > 0) {
    const m = Math.min(a.length, b.length), na = [];
    for (let i = 0; i < m; i++) na.push(a[i].concat(b[i]));
    const rest = a.length > b.length ? a.slice(m) : b.slice(m);
    a = na; b = rest;
  }
  const flat = [].concat(...a, ...b);
  return Array.from({ length: n }, (_, i) => flat[mod(i - rot, n)] === 1);
}

// ---------------------------------------------------------------- harmony: a chord graph with weights
const GRAPH = {
  major: { I: [['IV', 3], ['V', 3], ['vi', 3], ['ii', 1], ['iii', .5]], ii: [['V', 4], ['IV', 1], ['vi', 1]], iii: [['vi', 3], ['IV', 2]], IV: [['V', 3], ['I', 2], ['ii', 1], ['vi', 1]], V: [['I', 4], ['vi', 2], ['IV', 1]], vi: [['IV', 3], ['ii', 2], ['V', 2], ['iii', .5]] },
  minor: { i: [['VI', 3], ['iv', 2], ['VII', 3], ['V', 1], ['III', 1.5]], III: [['VII', 2], ['VI', 3], ['iv', 1]], iv: [['V', 2], ['i', 2], ['VII', 2], ['VI', 1]], V: [['i', 5], ['VI', 1]], VI: [['VII', 3], ['iv', 1.5], ['V', 1.5], ['III', 1]], VII: [['i', 3], ['III', 2], ['VI', 1]] },
};
// progression('minor', 4, rng, { cadence: 'half' | 'full' | 'none' }) -> numerals; starts on the tonic; ends on V (half) or resolves (full)
function progression(mode, bars, rng, o = {}) {
  const minor = MINORISH.has(mode), g = GRAPH[minor ? 'minor' : 'major'], tonic = minor ? 'i' : 'I', dom = minor ? 'V' : 'V';
  const out = [o.start || tonic];
  for (let i = 1; i < bars; i++) out.push(wpick(rng, g[out[i - 1]].filter(([c]) => c !== out[i - 1] || rng() < .1)));
  if (bars >= 2 && o.cadence === 'half') { out[bars - 1] = dom; if (out[bars - 2] === dom) out[bars - 2] = minor ? 'iv' : 'IV'; }
  if (bars >= 2 && o.cadence === 'full') { out[bars - 1] = tonic; if (out[bars - 2] !== dom && out[bars - 2] !== (minor ? 'VII' : 'IV')) out[bars - 2] = dom; }
  if (mode === 'dorian') return out.map(c => c === 'iv' ? 'IV' : c);
  return out;
}

// classic four-chord loops: a calm one for quiet sections, a fuller one for loud ones (the graph above is for other lengths and free walks)
const LOOPS = {
  major: { calm: ['I V vi IV', 'I vi IV V', 'I IV I V'], full: ['vi IV I V', 'I V vi IV', 'IV V iii vi', 'I iii IV V'] },
  minor: { calm: ['i VII VI VII', 'i iv VII III', 'i VI III VII'], full: ['i VI III VII', 'i VII VI V', 'i iv VI V', 'i III VII VI'] },
};

// ---------------------------------------------------------------- rhythm
const RHYTHMS = {
  adventure: [[[1, .5, .5, 1, 1], 3], [[.5, .5, 1, .5, .5, 1], 3], [[1.5, .5, 1, 1], 2], [[.75, .75, .5, 1, 1], 2], [[.5, .5, .5, .5, .5, .5, .5, .5], 1.5]],
  tense: [[[1.5, .5, 1, 1], 3], [[.5, .5, .5, .5, 2], 2], [[1, -.5, .5, 1, 1], 3], [[.75, .75, .5, 2], 2]],
  chill: [[[1, .5, .5, 1, 1], 2], [[.5, .5, .5, .5, 2], 3], [[1, 1, .5, .5, 1], 3], [[1, -.5, .5, 1, 1], 2]],
  drive: [[[.5, .5, .5, .5, .5, .5, .5, .5], 3], [[.75, .75, .5, .75, .75, .5], 2], [[.5, .5, 1, .5, .5, 1], 3], [[1, .5, .5, 1, 1], 1]],
};
// drum grids: 16 steps a bar. x hit, X accent, o ghost, . rest
const GROOVES = {
  adventure: {
    kick: [['', 0], ['x...............', .1], ['x.......x.......', .3], ['x.......x.....x.', .5], ['x.....x.x.......', .7], ['x...x...x...x...', .85]],
    snare: [['', 0], ['', .3], ['....x.......x...', .4]],
    hat: [['', 0], ['', .3], ['x.x.x.x.x.x.x.x.', .4], ['x.xxx.x.x.xxx.xx', .7], ['xxxxxxxxxxxxxxxx', .85]],
    ohat: [['', 0], ['', .7], ['......x.......x.', .8]],
  },
  tense: {
    kick: [['', 0], ['x...............', .1], ['x.......x.......', .3], ['x.....x...x.....', .55], ['x..x....x.x.....', .8]],
    snare: [['', 0], ['', .3], ['........x.......', .35], ['........x.......', .6]],
    hat: [['', 0], ['', .3], ['x.x.x.x.x.x.x.x.', .45], ['o.xoo.xoo.xoo.xo', .7]],
    ohat: [['', 0], ['', .7], ['..............x.', .8]],
  },
  chill: {
    kick: [['', 0], ['x...............', .1], ['x.......x.......', .3], ['x.......x..x....', .7]],
    snare: [['', 0], ['', .3], ['....x.......x...', .45]],
    hat: [['', 0], ['', .25], ['x.x.x.x.x.x.x.x.', .3], ['x.xox.xox.xox.xo', .7]],
    ohat: [['', 0], ['', .8], ['......x.........', .85]],
  },
  drive: {
    kick: [['', 0], ['x...x...x...x...', .2]],
    snare: [['', 0], ['', .2], ['....x.......x...', .3]],
    hat: [['', 0], ['', .2], ['..x...x...x...x.', .3], ['x.x.x.x.x.x.x.x.', .6], ['xxxxxxxxxxxxxxxx', .85]],
    ohat: [['', 0], ['', .5], ['..x...x...x...x.', .55]],
  },
};
const tierOf = (list, e) => { let cur = list[0][0]; for (const [g, min] of list) if (e >= min) cur = g; return cur; };

const STYLES = {
  adventure: { swing: 0, arpPatterns: [[0, 1, 2, 1], [0, 1, 2, 3, 2, 1], [0, 2, 1, 2]], bassMain: 'eighth', lead: { duty: .25, echo: true } },
  tense:     { swing: 0, arpPatterns: [[0, 1, 2, 1], [0, 2, 1, 3]], bassMain: 'syncopated', lead: { duty: .5, echo: true } },
  chill:     { swing: .16, arpPatterns: [[0, 1, 2, 3], [0, 2, 1, 2]], bassMain: 'walk', lead: { duty: .25, echo: true } },
  drive:     { swing: 0, arpPatterns: [[0, 1, 2, 1], [0, 1, 2, 3, 2, 1, 2, 1]], bassMain: 'drive', lead: { duty: .125, echo: false } },
};

// ---------------------------------------------------------------- melody: a hook made once, then developed
// A hook is 4 bars of { o: scale-degree offset from the chord root, d: beats (negative = rest) }. Notes on strong beats snap to chord tones.
function makeHook(rng, style) {
  const rhy = () => wpick(rng, RHYTHMS[style] || RHYTHMS.adventure);
  const contour = start => {
    let o = start; return len => Array.from({ length: len }, (_, i) => {
      if (i > 0) o += wpick(rng, [[1, 3], [-1, 3], [2, 1.5], [-2, 1.5], [0, 1], [3, .6], [-3, .6]]);
      o = clamp(o, -2, 7); return o;
    });
  };
  const cell = (rh, start) => { const os = contour(start)(rh.length); return rh.map((d, i) => ({ o: os[i], d })); };
  const r1 = rhy(), bar1 = cell(r1, pick(rng, [0, 2, 4]));
  const bar2 = bar1.map(n => ({ o: clamp(n.o + wpick(rng, [[1, 2], [2, 2], [-1, 1]]), -2, 8), d: n.d }));                 // a sequence of bar 1
  const bar3 = cell(rng() < .5 ? r1 : rhy(), pick(rng, [2, 4, 5]));                                                         // a variation
  const end = wpick(rng, [[[2, 1, 1], 2], [[1.5, .5, 2], 2], [[1, 1, 2], 1]]);                                              // a cadence: long last note
  const os = [pick(rng, [4, 2]), pick(rng, [2, 1, 3]), 0];
  const bar4 = end.map((d, i) => ({ o: i === end.length - 1 ? 0 : os[i], d }));
  return [bar1, bar2, bar3, bar4];
}
const invert = bar => bar.map(n => ({ o: 4 - n.o, d: n.d }));
const isStrong = (pos, bpb) => pos % 1 === 0 && (pos === 0 || (bpb === 4 && pos === 2));

// ---------------------------------------------------------------- the generator
// plan: { seed, bpm, key: 'C major', style: 'adventure', sections: [{ name, bars, energy, key?, prog?, melody?, breakBefore? }], title? }
function generate(plan) {
  const seed = plan.seed ?? 1, bpm = plan.bpm || 120, bpb = plan.beatsPerBar || 4, styleName = plan.style || 'adventure';
  const style = { ...(STYLES[styleName] || STYLES.adventure), ...(plan.styleOverrides || {}) };
  const baseKey = key(plan.key || 'C major');
  if (!plan.sections || !plan.sections.length) throw new Error('Compose.generate: plan.sections is empty');
  const rHarm = stream(seed, 'harmony'), rHook = stream(seed, 'hook'), rDrum = stream(seed, 'drums'), rBass = stream(seed, 'bass'), rArp = stream(seed, 'arp'), rFx = stream(seed, 'fx'), rVel = stream(seed, 'vel');
  const progCache = {};                                                                                                    // progressions belong to a mode: a minor section gets minor numerals
  const progsFor = mode => progCache[mode] || (progCache[mode] = (() => {
    const fam = LOOPS[MINORISH.has(mode) ? 'minor' : 'major'], fix = l => l.split(' ').map(c => mode === 'dorian' && c === 'iv' ? 'IV' : c);
    const A = pick(stream(seed, 'harmony-A-' + mode), fam.calm), B = pick(stream(seed, 'harmony-B-' + mode), fam.full.filter(l => l !== A));
    return { A: fix(A), B: fix(B) };
  })());
  const hook = makeHook(rHook, styleName), arpPat = pick(rArp, style.arpPatterns);
  const groove = GROOVES[styleName] || GROOVES.adventure;
  const gridFor = (layer, e) => tierOf(groove[layer], e);                                                                    // the groove of a layer at an energy

  const T = { bass: [], lead: [], arp: [], pad: [], drums: [], fx: [] };
  const chords = [], sections = [], duck = [];
  const loop = { idx: 0, key: null, which: null };
  let beat = 0, prevArp = null, prevPad = null, prevBass = 40, prevLead = 72, prevIv = null, prevRootPc = null;
  const secs = plan.sections.map(s => ({ ...s, energy: clamp(s.energy ?? .5, 0, 1) }));
  const vel = (base, step, jitter = .05) => clamp(base + (step % 4 === 0 ? .08 : step % 2 === 0 ? 0 : -.1) + (rVel() - .5) * jitter * 2, .15, 1);

  secs.forEach((s, si) => {
    const k = key(s.key || baseKey), e = s.energy, bars = s.bars, next = secs[si + 1], start = beat, end = start + bars * bpb;
    const nextE = next ? next.energy : null, rising = next && nextE - e >= .2, lastBar = bars - 1;
    const which = s.prog === 'A' || (s.prog !== 'B' && e < .6) ? 'A' : 'B', P = progsFor(k.mode);
    const prog = typeof s.prog === 'string' && s.prog.includes(' ') ? s.prog.split(/\s+/) : P[which];
    // the loop keeps going across neighbouring sections in the same key and mood; a new key or mood starts it again
    if (!(loop.key === k.name && loop.which === which && !s.prog)) loop.idx = 0;
    loop.key = k.name; loop.which = which;
    const numerals = Array.from({ length: bars }, (_, i) => prog[(loop.idx + i) % prog.length]);
    loop.idx += bars;
    const minor = MINORISH.has(k.mode), tonic = minor ? 'i' : 'I', pre = minor ? 'iv' : 'IV';
    const nk = next ? key(next.key || baseKey).name : null, nWhich = next ? (next.prog === 'A' || (next.prog !== 'B' && next.energy < .6) ? 'A' : 'B') : null;
    const phraseEnds = !next || bars >= 4 || nk !== k.name || nWhich !== which || next.breakBefore;                          // a cadence only where a phrase really ends
    if (bars >= 2 && !s.prog && phraseEnds) {
      numerals[lastBar] = next ? 'V' : tonic;                                                                            // lead into the next section with a dominant, end the film on the tonic
      if (numerals[lastBar - 1] === numerals[lastBar]) numerals[lastBar - 1] = next ? pre : 'V';                          // never the same chord twice at the seam
      loop.idx = 0;
    }
    const cs = numerals.map(n => chord(n, k));
    cs.forEach((c, i) => chords.push({ b: start + i * bpb, d: bpb, root: NAMES[c.root], quality: c.quality, pcs: c.pcs.slice().sort((a, b) => a - b), numeral: c.numeral, name: c.name }));
    sections.push({ name: s.name || `section ${si + 1}`, b: start, bars, energy: e, key: k.name });

    const breakNext = next && next.breakBefore;
    const cut = (b) => !(breakNext && b >= end - 1);                                                                       // a one-beat gap before a drop
    // ---- pad
    if (e < 1) cs.forEach((c, i) => {
      prevPad = voicing(c, prevPad, 58);
      const swell = [1, .86, .94, .8][i % 4];                                                                             // the pad breathes over the loop
      prevPad.forEach(n => T.pad.push({ b: start + i * bpb, d: bpb * .98, n, v: clamp((.55 - e * .25) * swell, .2, .6) }));
    });
    // ---- bass
    if (e >= .15) cs.forEach((c, i) => {
      const b0 = start + i * bpb, r = c.root, nc = cs[i + 1] || (next ? chord(prog[0], key(next.key || baseKey)) : c);
      const near = (pc, from) => { let best = 36 + pc % 12, bd = 99; for (let m = 28 + ((pc - 28) % 12 + 12) % 12; m <= 43; m += 12) if (Math.abs(m - from) < bd) { bd = Math.abs(m - from); best = m; } return best; };   // pitch class pc in 28..43, nearest to `from`
      const base = near(r, prevBass), nb = near(nc.root, base), up = base + 12, fifth = base + 7 <= 50 ? base + 7 : base - 5;
      prevBass = base;
      const kind = e < .4 ? 'whole' : e < .55 ? 'half' : e >= .9 ? 'drive' : style.bassMain === 'walk' ? 'walk' : e < .75 && style.bassMain === 'drive' ? 'eighth' : style.bassMain;
      const add = (pos, d, n, v) => { if (cut(b0 + pos)) T.bass.push({ b: b0 + pos, d, n, v }); };
      if (kind === 'whole') add(0, bpb * .95, base, .85);
      else if (kind === 'half') { add(0, 1.9, base, .9); add(2, 1.9, i % 2 ? fifth : base, .8); }
      else if (kind === 'eighth') for (let q = 0; q < bpb * 2; q++) add(q / 2, .45, q % 2 ? up : base, q === 0 ? .95 : q % 2 ? .6 : .8);
      else if (kind === 'walk') { [base, fifth, up, fifth].forEach((n, q) => add(q, .9, n, q === 0 ? .9 : .7)); }
      else if (kind === 'syncopated' || kind === 'drive') {
        const pat = kind === 'drive' ? euclid(e >= .9 ? 9 : 7, 16, 0) : euclid(5, 16, 0);
        pat.forEach((on, st) => { if (on) add(st / 4, .22, st % 8 === 3 ? fifth : st % 4 === 0 ? base : rBass() < .3 ? up : base, st === 0 ? .95 : .72); });
        if (!pat[0]) add(0, .22, base, .95);
      }
      if (kind === 'eighth' || kind === 'syncopated' || kind === 'drive' || kind === 'walk') {                             // a passing note into the next chord on the last eighth, a scale tone next to the target
        const nk = key(i < bars - 1 ? k : (next && next.key) || baseKey), inKey = m => nk.scale.includes(mod(m - nk.root, 12));
        const appr = [nb - 1, nb - 2, nb + 1, nb + 2].find(inKey);
        if (nb !== base && appr !== undefined && rBass() < .55 && i < bars - 1 && cut(b0 + bpb - .5)) { const last = T.bass[T.bass.length - 1]; if (last && last.b >= b0 + bpb - .5) T.bass.pop(); T.bass.push({ b: b0 + bpb - .5, d: .45, n: appr, v: .55 }); }
      }
      const lastB = T.bass[T.bass.length - 1];                                                                              // no leap of more than an octave across the barline
      if (lastB && lastB.b >= b0 && i < bars - 1) while (Math.abs(lastB.n - nb) > 12) lastB.n += lastB.n > nb ? -12 : 12;
    });
    // ---- arp
    if (e >= .45) cs.forEach((c, i) => {
      const b0 = start + i * bpb, step = e < .65 ? .5 : .25, n = Math.round(bpb / step);
      prevArp = voicing(c, prevArp, 66);
      const tones = prevArp.concat(prevArp[0] + 12);
      for (let q = 0; q < n; q++) {
        const b = b0 + q * step; if (!cut(b)) continue;
        const idx = arpPat[q % arpPat.length] % tones.length;
        T.arp.push({ b, d: step * .9, n: tones[idx], v: vel(.55, q * (step === .5 ? 2 : 1), .06) });
        if (e >= .9 && q % 2 === 1 && tones[idx] + 12 <= 84) T.arp.push({ b, d: step * .8, n: tones[idx] + 12, v: .38 });                // sparkle at the top
      }
    });
    // ---- lead (the hook, developed)
    const melodyKind = s.melody || (e < .3 ? 'none' : e < .45 ? 'sparse' : e < .78 ? 'hook' : 'high');
    if (melodyKind !== 'none') {
      const phrases = Math.ceil(bars / 4);
      for (let i = 0; i < bars; i++) {
        const phrase = Math.floor(i / 4), j = i % 4, barsLeft = bars - phrase * 4;
        const c = cs[i], rootDeg = degreeOfPc(k, c.root), b0 = start + i * bpb;
        let src = hook[barsLeft < 4 && i === bars - 1 ? 3 : j];
        if (phrase % 2 === 1 && j < 2) src = invert(src);                                                                    // the second phrase answers with the mirrored contour
        if (melodyKind === 'sparse') src = src.map((n, q) => n.d >= 1 || q % 2 === 0 ? n : { o: n.o, d: -Math.abs(n.d) });     // drop the short notes, keep the timing
        const oct = melodyKind === 'high' ? 1 : 0;
        let t = 0;
        src.forEach((n, ni) => {
          const d = Math.abs(n.d);
          if (n.d > 0 && cut(b0 + t)) {
            let m = degreeMidi(k, rootDeg + n.o + 7 * oct, 4);
            if (isStrong(t, bpb) || n.d >= 1.5) {
              const finalNote = j === 3 && t + d >= bpb - 1e-6 && ni === src.length - 1;                                    // the cadence note may be the root; other strong beats avoid doubling the bass
              const avoid = prevIv !== null && (prevIv === 0 || prevIv === 7) && prevRootPc !== c.root;                          // no parallel fifths or octaves with the bass root
              m = strongTone(m, c, finalNote, avoid); prevIv = mod(m - c.root, 12); prevRootPc = c.root;
            }
            while (m > 86) m -= 12; while (m < 57) m += 12;
            m = nearOctave(m, prevLead); while (m > 86) m -= 12; while (m < 57) m += 12; prevLead = m;
            T.lead.push({ b: b0 + t, d: Math.min(d * .95, bpb - t), n: m, v: clamp(.62 + (t === 0 ? .18 : t % 1 === 0 ? .08 : -.04) + (j === 1 || j === 2 ? .04 : 0) + (rVel() - .5) * .06, .3, 1) });
          }
          t += d;
        });
      }
    }
    // ---- drums
    const G = { kick: gridFor('kick', e), snare: gridFor('snare', e), hat: gridFor('hat', e), ohat: gridFor('ohat', e) };
    for (let i = 0; i < bars; i++) {
      const b0 = start + i * bpb, hits = [];
      const put = (grid, voice, hi = .9) => { for (let st = 0; st < grid.length; st++) { const ch = grid[st]; if (ch === '.' || !ch) continue; const b = b0 + st / 4; if (cut(b)) hits.push({ b, d: .25, voice, v: ch === 'X' ? 1 : ch === 'o' ? .38 : voice === 'kick' ? (st === 0 ? 1 : .78) : clamp(vel(hi * .82, st, .04), .3, 1) }); } };
      put(G.kick, 'kick', 1); if (e >= .5) put(G.snare, 'snare', 1); if (e >= .85) put(G.snare, 'clap', .8);
      put(G.hat, 'hat', .75); put(G.ohat, 'ohat', .8);
      const fillBar = e >= .5 && i === lastBar && (rising || e >= .6) && !breakNext;
      if (fillBar) {                                                                                                          // a fill in the last beat: a snare crescendo or a tom run
        const roll = rDrum() < .5, from = b0 + bpb - 1;
        for (let q = hits.length - 1; q >= 0; q--) if (hits[q].b >= from - 1e-6 && hits[q].voice !== 'kick') hits.splice(q, 1);
        for (let q = 0; q < 4; q++) hits.push(roll ? { b: from + q * .25, d: .25, voice: 'snare', v: .5 + q * .16 } : { b: from + q * .25, d: .25, voice: 'tom', n: [72, 69, 65, 60][q], v: .72 + q * .07 });
      }
      T.drums.push(...hits);
    }
    // a marker on every downbeat where the section changes: a crash (louder the more energy it arrives with); a quiet section gets an open hat
    if (si > 0) T.drums.push(e >= .3 || e - secs[si - 1].energy >= .2 ? { b: start, d: 1, voice: 'crash', v: clamp(.55 + e * .4 + Math.max(0, e - secs[si - 1].energy), .5, 1) } : { b: start, d: .5, voice: 'ohat', v: .6 });
    // a riser (noise sweeping up) over the last two beats before a jump
    if (rising) for (let q = 0; q < 8; q++) T.fx.push({ b: end - 2 + q * .25, d: .24, n: 60 + q * 5, voice: 'noise', v: .25 + q * .07 });
    beat = end;
  });
  // ducking: every kick dips the bass, pad and arp a little
  for (const d of T.drums) if (d.voice === 'kick') duck.push({ b: d.b, depth: .32, rel: .14 });
  // swing: push the off-beat eighths late
  if (style.swing) for (const tr of Object.values(T)) for (const ev of tr) if (Math.abs(mod(ev.b, 1) - .5) < 1e-6) ev.b += style.swing * .5;

  T.bass.sort((x, y) => x.b - y.b);                                                                                          // no leap over an octave, and stay in the bass range
  T.bass.forEach((ev, i) => { while (ev.n < 28) ev.n += 12; while (ev.n > 55) ev.n -= 12; const pv = T.bass[i - 1]; if (pv) while (Math.abs(ev.n - pv.n) > 12) ev.n += ev.n > pv.n ? -12 : 12; while (ev.n < 28) ev.n += 12; });
  const secAt = b => { for (let i = sections.length - 1; i >= 0; i--) if (b >= sections[i].b - 1e-6) return sections[i]; return sections[0]; };
  for (const tr of Object.values(T)) for (const ev of tr) ev.v = clamp(ev.v * (.55 + .45 * secAt(ev.b).energy), .12, 1);           // energy is also loudness: quiet sections play softer
  const len = beat, sortE = a => a.sort((x, y) => x.b - y.b || (x.n || 0) - (y.n || 0));
  const lead = style.lead || {};
  const tracks = [
    { name: 'pad', role: 'pad', voice: 'triangle', gain: .32, env: { a: .22, d: .3, s: .8, r: .35 }, duck: true, events: sortE(T.pad) },
    { name: 'bass', role: 'bass', voice: 'triangle', gain: .62, env: { a: .004, d: .08, s: .85, r: .05 }, duck: true, events: sortE(T.bass) },
    { name: 'arp', role: 'arp', voice: 'pulse', duty: .125, gain: .3, env: { a: .002, d: .1, s: .18, r: .05 }, pan: .25, duck: true, events: sortE(T.arp) },
    { name: 'lead', role: 'lead', voice: 'pulse', duty: lead.duty ?? .25, gain: .42, env: { a: .008, d: .12, s: .7, r: .1 }, vib: { delay: .22, rate: 5.5, depth: 14 }, pan: -.15, ...(lead.echo ? { echo: { time: .75, fb: .32, mix: .22 } } : {}), events: sortE(T.lead) },
    { name: 'drums', role: 'drums', voice: 'noise', gain: .7, events: sortE(T.drums) },
    { name: 'fx', role: 'fx', voice: 'noise', gain: .35, events: sortE(T.fx) },
  ].filter(t => t.events.length);
  return { title: plan.title || 'untitled', seed, style: styleName, bpm, beatsPerBar: bpb, length: len, key: { root: NAMES[baseKey.root], mode: baseKey.mode }, chords, sections, tracks, duck };
}

// n scores of the same plan with different seeds, for auditioning
const variants = (plan, n = 4, from = 1) => Array.from({ length: n }, (_, i) => generate({ ...plan, seed: from + i }));

const api = { generate, variants, key, chord, voicing, progression, euclid, degreeMidi, nearestTone, styles: STYLES, grooves: GROOVES, loops: LOOPS, rhythms: RHYTHMS, modes: MODES, NAMES, stream };
global.Compose = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
