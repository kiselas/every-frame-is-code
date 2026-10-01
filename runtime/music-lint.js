// motion-kit music lint: a symbolic linter for a Score, "eyes" for an agent that cannot listen.
//   const { findings, stats, score } = MusicLint.lint(score, opts?)     MusicLint.describe(score) -> compact text
// Classic script, no dependencies, pure functions, no Math.random. Loads in the browser (window.MusicLint) and in Node (require).
//
// Score = { bpm, beatsPerBar, length,                                   // length in beats
//   key?:      { root: 'C', mode: 'major' | 'minor' | 'dorian' | ... },
//   chords?:   [ { b, d, root, quality, pcs: [0,4,7] } ],               // pcs are absolute pitch classes, C = 0
//   sections?: [ { name, b, bars, energy: 0..1, key?: 'D major' | { root, mode } } ],      // a section key overrides the score key there
//   tracks:    [ { name, role: 'bass'|'lead'|'arp'|'pad'|'drums'|'fx', voice, gain, events: [ { b, d, n, v, voice? } ] } ],
//   duck?:     [ { b, depth, rel } ] }
// key, chords and sections are optional: every rule that needs one of them is skipped when it is missing.
//
// Finding = { severity: 'error'|'warn'|'info', rule, track, b, bar, message }
//   b is in beats (null for a whole-track finding), bar is 1-based, message is short and written for a model that must fix it.
//   The list is sorted errors first, then warnings, then infos, each by time. Findings of severity warn/info are capped at
//   opts.maxPerTrack per rule and track (the rest is folded into one "... and N more" info); the score counts all of them.
// score = max(0, 100 - 8 * errors - 3 * warns - 0.5 * infos).
//
// Rules (id: what it checks; the thresholds are in DEFAULTS below and can be overridden through opts; opts.disable = ['loop', ...]):
//   strong-beat-chord  lead/arp notes on beat 1 (and 3 in 4/4, 1 and 4 in 6/8) should be chord tones: warn when fewer than
//                      strongBeatChordMin (70%) of them are, over a track with >= strongBeatMinNotes notes; an error per note
//                      that is also outside the key (or a warn when chords exist but there is no key: not an error then).
//   out-of-key         a note outside the key scale (pad/bass/lead/arp): warn; info when the note is a chord tone (chromatic
//                      chord). Notes already reported as strong-beat errors are not reported again.
//   leap               lead/bass jump > leapWarn (12) semitones: warn; a lead jump > leapInfo (7) that is not followed by a step
//                      (<= 2 semitones) in the opposite direction: info (an exact octave is idiomatic and not reported as info).
//                      Pairs of notes separated by a rest > leapMaxGap (1 beat) are not a melodic leap.
//   range              lead outside MIDI 55..88, bass 28..55, arp 48..84: warn (one finding per track, bars listed).
//   parallel-perfects  bass and lead both move by the same direction between consecutive strong beats and land on the same perfect
//                      interval (fifth or octave/unison) twice in a row: warn.
//   clash              lead vs bass, or lead vs arp: minor 2nd / minor 9th (interval 1 mod 12) or tritone sounding together on a
//                      strong beat and held together for >= 1 beat: warn. Skipped when both notes are tones of the current chord.
//   loop               lead/arp bars with the same rhythm and intervals: more than loopMaxRun (4) identical bars in a row, or
//                      fewer than loopMinUnique (25%) unique bars in a track with >= loopMinBars (8) non-empty bars: warn.
//   flat-dynamics      velocity standard deviation < flatVelStdev (0.04) in a track with >= flatMinEvents (16) events (not a pad): warn;
//                      drum kicks on beat 1 not louder than the other kicks (by kickAccentMin 0.03, from 8 kicks, and only when
//                      there are other kicks): warn.
//   density-vs-energy  needs >= 3 sections with energy: the highest-energy section must be among the 2 densest (pitched notes per
//                      beat), and no section with energy < densityLowEnergy (0.3) may be denser than the mean: warn.
//   drum-groove        sections with energy >= grooveMinEnergy (0.3): kick on beat 1 of at least grooveShare (60%) of bars; energy
//                      >= backbeatMinEnergy (0.5) in 4/4: snare or clap on beats 2 and 4 (60% of those beats), or on beat 3 for a half-time feel: warn. Energy >=
//                      fillMinEnergy (0.6), except the last section: a fill (>= fillMinHits (3) hits of snare/tom/clap/rim in the
//                      last beat, hats and kicks do not count) or a crash at the start of the next section: info if missing.
//                      Skipped when the score has no drums at all.
//   transitions        at each section boundary there should be a marker: a crash on the downbeat, an fx event up to 4 beats before,
//                      a drum fill in the last beat, or a change of >= 2 layers (tracks that have events in the section): info.
//   dead-air           a span with no sounding event in any track: >= deadAirInfo (2) beats info, >= deadAirWarn (4) beats warn.
//                      The tail after the last event is ignored.
//   masking            lead and arp with medians within maskMedianDiff (9) semitones and the arp sounding under >= maskOverlap
//                      (60%) of the lead's time: info.
(function (global) {
'use strict';

const DEFAULTS = {
  strongBeatChordMin: 0.7, strongBeatMinNotes: 4,
  leapWarn: 12, leapInfo: 7, leapMaxGap: 1, leapRoles: ['lead', 'bass'], leapRecoveryRoles: ['lead'],
  ranges: { lead: [55, 88], bass: [28, 55], arp: [48, 84] },
  loopMaxRun: 4, loopMinUnique: 0.25, loopMinBars: 8,
  flatVelStdev: 0.04, flatMinEvents: 16, kickAccentMin: 0.03, kickAccentMinKicks: 8,
  densityLowEnergy: 0.3,
  grooveMinEnergy: 0.3, backbeatMinEnergy: 0.5, fillMinEnergy: 0.6, grooveShare: 0.6, fillMinHits: 3,
  deadAirInfo: 2, deadAirWarn: 4,
  maskMedianDiff: 9, maskOverlap: 0.6,
  maxPerTrack: 10,
  disable: [],
  weights: { error: 8, warn: 3, info: 0.5 },
};
const RULES = ['strong-beat-chord', 'out-of-key', 'leap', 'range', 'parallel-perfects', 'clash', 'loop', 'flat-dynamics',
  'density-vs-energy', 'drum-groove', 'transitions', 'dead-air', 'masking'];

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_OF = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], ionian: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11], 'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
  'major-pentatonic': [0, 2, 4, 7, 9], 'minor-pentatonic': [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10],
};
const QUALITY = {   // intervals from the root; also used to fill in pcs when a chord has only root + quality
  maj: [0, 4, 7], major: [0, 4, 7], min: [0, 3, 7], minor: [0, 3, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], '5': [0, 7], '7': [0, 4, 7, 10], dom7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
  m7: [0, 3, 7, 10], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10],
};
const QUALITY_WORD = { maj: 'major', min: 'minor', m: 'minor', dom7: '7' };
const QUALITY_SYM = { maj: '', major: '', min: 'm', minor: 'm', m: 'm', dom7: '7' };
const DRUM_VOICES = ['kick', 'snare', 'hat', 'ohat', 'tom', 'crash', 'clap', 'rim'];
const FILL_VOICES = ['snare', 'tom', 'clap', 'rim'];
const EPS = 0.02;             // beats: tolerance when comparing onsets

const r2 = x => Math.round(x * 100) / 100;
const r3 = x => Math.round(x * 1000) / 1000;
const mod12 = x => ((x % 12) + 12) % 12;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const stdev = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const isPitched = e => typeof e.n === 'number';
const pcName = pc => PC_NAMES[mod12(pc)];
const noteName = n => PC_NAMES[mod12(n)] + (Math.floor(n / 12) - 1);

function parseRoot(r) {
  if (typeof r === 'number') return mod12(r);
  const m = /^([A-Ga-g])([#b♯♭]*)$/.exec(String(r == null ? '' : r).trim());
  if (!m) return null;
  let pc = PC_OF[m[1].toUpperCase()];
  for (const ch of m[2]) pc += (ch === '#' || ch === '♯') ? 1 : -1;
  return mod12(pc);
}
const modeKey = m => String(m || '').toLowerCase().replace(/[\s_]+/g, '-');
function keyInfo(score) { return keyFromSpec(score.key); }
// a key from { root, mode } or a string like 'D major'
function keyFromSpec(k) {
  if (!k) return null;
  if (typeof k === 'string') { const [r, m] = k.trim().split(/\s+/); k = { root: r, mode: m || 'major' }; }
  const root = parseRoot(k.root), mode = MODES[modeKey(k.mode || 'major')];
  if (root == null || !mode) return null;
  return { root, mode: modeKey(k.mode || 'major'), pcs: new Set(mode.map(i => mod12(root + i))), name: `${pcName(root)} ${modeKey(k.mode || 'major')}` };
}
function chordPcs(c) {
  if (Array.isArray(c.pcs) && c.pcs.length) return c.pcs.map(mod12);
  const root = parseRoot(c.root), q = QUALITY[c.quality || 'maj'];
  return root != null && q ? q.map(i => mod12(root + i)) : [];
}
function chordRoot(c) { const r = parseRoot(c.root); return r != null ? r : (Array.isArray(c.pcs) && c.pcs.length ? mod12(c.pcs[0]) : null); }
// 'C', 'Am', 'F', 'G7'
function chordSymbol(c) {
  const r = chordRoot(c), q = c.quality == null ? 'maj' : c.quality;
  return (r == null ? '?' : pcName(r)) + (q in QUALITY_SYM ? QUALITY_SYM[q] : q);
}
// 'F major', 'A minor'
function chordWords(c) {
  const r = chordRoot(c), q = c.quality == null ? 'maj' : c.quality;
  return (r == null ? '?' : pcName(r)) + ' ' + (QUALITY_WORD[q] || q);
}

// ---------------------------------------------------------------- score model shared by all rules
function guessRole(t) {
  if (t.role) return String(t.role);
  const n = String(t.name || '').toLowerCase();
  for (const r of ['bass', 'lead', 'arp', 'pad', 'drum', 'fx']) if (n.includes(r)) return r === 'drum' ? 'drums' : r;
  return 'other';
}
function model(score, opts) {
  const bpb = score.beatsPerBar || 4, bpm = score.bpm || 120;
  const tracks = (score.tracks || []).map((t, i) => {
    const events = (t.events || []).filter(e => e && typeof e.b === 'number').slice().sort((a, b) => a.b - b.b || (a.n || 0) - (b.n || 0));
    return { t, i, name: t.name || `track${i + 1}`, role: guessRole(t), events, pitched: events.filter(isPitched) };
  });
  let length = score.length;
  if (!(length > 0)) length = Math.max(0, ...tracks.flatMap(t => t.events.map(e => e.b + (e.d || 0))));
  const chords = (score.chords || []).filter(c => c && typeof c.b === 'number').map(c => ({ c, b: c.b, d: c.d == null ? bpb : c.d, pcs: chordPcs(c) })).sort((a, b) => a.b - b.b);
  const sections = (score.sections || []).filter(s => s && typeof s.b === 'number').map(s => {
    const bars = s.bars > 0 ? s.bars : 1;
    return { name: s.name || 'section', b: s.b, bars, end: s.b + bars * bpb, energy: typeof s.energy === 'number' ? s.energy : null, key: keyFromSpec(s.key) };
  }).sort((a, b) => a.b - b.b);
  // drum hits from the drum tracks and from any note-less event that has a drum voice
  const hits = [];
  for (const tr of tracks) for (const e of tr.events) {
    const v = e.voice || (tr.role === 'drums' ? tr.t.voice : null);
    if (!isPitched(e) && (tr.role === 'drums' || DRUM_VOICES.includes(v))) hits.push({ b: e.b, v: v || 'kick', vel: e.v == null ? 0.8 : e.v, track: tr.name });
  }
  hits.sort((a, b) => a.b - b.b);
  return {
    score, opts, bpb, bpm, length, tracks, chords, sections, hits, key: keyInfo(score),
    bar: b => Math.floor(b / bpb + 1e-6) + 1,
    beat: b => { const x = r2(((b % bpb) + bpb) % bpb); return (x >= bpb ? 0 : x) + 1; },
    errNotes: new Set(),
    keyAt(b) { for (const s of this.sections) if (s.key && b >= s.b - 1e-6 && b < s.end - 1e-6) return s.key; return this.key; },      // a section can modulate: its key wins
    chordAt(b) { for (const c of this.chords) if (b >= c.b - 1e-6 && b < c.b + c.d - 1e-6) return c; return null; },
    strongOffsets: bpb === 4 ? [0, 2] : bpb === 6 ? [0, 3] : [0],
    isStrong(b) { const x = ((b % bpb) + bpb) % bpb; return this.strongOffsets.some(o => Math.abs(x - o) < EPS || Math.abs(x - o - bpb) < EPS); },
    pitchedOf: role => tracks.filter(t => t.role === role),
  };
}
const fmt = x => String(r2(x));
const where = (M, b) => `bar ${M.bar(b)} beat ${fmt(M.beat(b))}`;
const sounding = (tr, x) => tr.pitched.filter(e => e.b <= x + EPS && e.b + (e.d || 0) > x + EPS);
const activeTracks = (M, s) => M.tracks.filter(t => t.events.some(e => e.b >= s.b - EPS && e.b < s.end - EPS));
const bars = list => { const u = [...new Set(list)].sort((a, b) => a - b); return u.length > 8 ? u.slice(0, 8).join(', ') + ', ...' : u.join(', '); };

// ---------------------------------------------------------------- rules: each pushes findings via add(severity, rule, track, b, message)
const rule = {};

rule['strong-beat-chord'] = (M, add) => {
  if (!M.chords.length) return;
  for (const tr of M.tracks) {
    if (tr.role !== 'lead' && tr.role !== 'arp') continue;
    let total = 0, good = 0;
    for (const e of tr.pitched) {
      if (!M.isStrong(e.b)) continue;
      const ch = M.chordAt(e.b); if (!ch || !ch.pcs.length) continue;
      total++;
      if (ch.pcs.includes(mod12(e.n))) { good++; continue; }
      const K = M.keyAt(e.b);
      if (K && !K.pcs.has(mod12(e.n))) {
        add('error', 'strong-beat-chord', tr.name, e.b, `${tr.name} ${where(M, e.b)}: ${pcName(e.n)} is not in ${chordWords(ch.c)} chord (${ch.pcs.map(pcName).join(' ')}) and is outside ${K.name}; use a chord tone`);
        M.errNotes.add(e);
      }
    }
    if (total >= M.opts.strongBeatMinNotes && good / total < M.opts.strongBeatChordMin)
      add('warn', 'strong-beat-chord', tr.name, null, `${tr.name}: only ${Math.round(100 * good / total)}% (${good}/${total}) of the notes on strong beats are chord tones (need ${Math.round(100 * M.opts.strongBeatChordMin)}%); move non-chord notes to weak beats`);
  }
};

rule['out-of-key'] = (M, add) => {
  if (!M.key && !M.sections.some(x => x.key)) return;
  for (const tr of M.tracks) {
    if (tr.role === 'drums' || tr.role === 'fx') continue;
    for (const e of tr.pitched) {
      const K = M.keyAt(e.b); if (!K) continue;
      if (K.pcs.has(mod12(e.n)) || M.errNotes.has(e)) continue;
      const ch = M.chordAt(e.b);
      if (ch && ch.pcs.includes(mod12(e.n)))
        add('info', 'out-of-key', tr.name, e.b, `${tr.name} ${where(M, e.b)}: ${pcName(e.n)} is outside ${K.name} but is a tone of ${chordWords(ch.c)} (chromatic chord); fine if intended`);
      else
        add('warn', 'out-of-key', tr.name, e.b, `${tr.name} ${where(M, e.b)}: ${pcName(e.n)} is outside ${K.name}${ch ? ` and not in ${chordWords(ch.c)} chord (${ch.pcs.map(pcName).join(' ')})` : ''}; use ${nearestInKey(K, e.n)} or change the key/chord`);
    }
  }
};
function nearestInKey(key, n) {
  for (const d of [1, -1, 2, -2]) if (key.pcs.has(mod12(n + d))) return pcName(n + d);
  return 'a scale tone';
}

// the melodic line of a track: the top (or bottom for bass) note of every onset, in time order
function line(tr) {
  const out = [], pick = tr.role === 'bass' ? Math.min : Math.max;
  for (const e of tr.pitched) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.b - e.b) < EPS) { if (pick(e.n, last.n) === e.n) out[out.length - 1] = e; } else out.push(e);
  }
  return out;
}
rule.leap = (M, add) => {
  const o = M.opts;
  for (const tr of M.tracks) {
    if (!o.leapRoles.includes(tr.role)) continue;
    const L = line(tr);
    for (let i = 1; i < L.length; i++) {
      const p = L[i - 1], c = L[i];
      if (c.b - (p.b + (p.d || 0)) > o.leapMaxGap) continue;
      const iv = c.n - p.n, a = Math.abs(iv);
      if (a > o.leapWarn) {
        add('warn', 'leap', tr.name, c.b, `${tr.name} ${where(M, c.b)}: leap of ${a} semitones (${noteName(p.n)} to ${noteName(c.n)}); keep leaps <= ${o.leapWarn} or route through a step`);
      } else if (a > o.leapInfo && a !== 12 && o.leapRecoveryRoles.includes(tr.role) && i + 1 < L.length) {
        const nx = L[i + 1], iv2 = nx.n - c.n;
        if (!(Math.abs(iv2) <= 2 && Math.abs(iv2) > 0 && Math.sign(iv2) !== Math.sign(iv)) && nx.b - (c.b + (c.d || 0)) <= o.leapMaxGap)
          add('info', 'leap', tr.name, c.b, `${tr.name} ${where(M, c.b)}: leap of ${a} semitones (${noteName(p.n)} to ${noteName(c.n)}) is not followed by a step back; continue ${iv > 0 ? 'down' : 'up'} by 1-2 semitones`);
      }
    }
  }
};

rule.range = (M, add) => {
  for (const tr of M.tracks) {
    const r = M.opts.ranges[tr.role]; if (!r) continue;
    const bad = tr.pitched.filter(e => e.n < r[0] || e.n > r[1]);
    if (!bad.length) continue;
    const worst = bad.reduce((w, e) => Math.max(e.n - r[1], r[0] - e.n) > Math.max(w.n - r[1], r[0] - w.n) ? e : w, bad[0]);
    add('warn', 'range', tr.name, bad[0].b, `${tr.name} ${where(M, bad[0].b)}: ${bad.length} note${bad.length > 1 ? 's' : ''} outside ${tr.role} range ${r[0]}..${r[1]} (${noteName(r[0])}..${noteName(r[1])}), worst ${noteName(worst.n)} (${worst.n}); bars ${bars(bad.map(e => M.bar(e.b)))}; transpose by octaves`);
  }
};

function strongSlots(M) {
  const out = [];
  for (let k = 0; k * M.bpb < M.length - 1e-6; k++) for (const o of M.strongOffsets) { const x = k * M.bpb + o; if (x < M.length - 1e-6) out.push(x); }
  return out;
}
rule['parallel-perfects'] = (M, add) => {
  const slots = strongSlots(M);
  for (const bt of M.pitchedOf('bass')) for (const lt of M.pitchedOf('lead')) {
    let prev = null;
    for (const x of slots) {
      const bs = sounding(bt, x), ls = sounding(lt, x);
      if (!bs.length || !ls.length) { prev = null; continue; }
      const bn = Math.min(...bs.map(e => e.n)), ln = Math.max(...ls.map(e => e.n)), ic = mod12(ln - bn);
      if (prev && (ic === 0 || ic === 7) && ic === prev.ic && bn !== prev.bn && ln !== prev.ln && Math.sign(bn - prev.bn) === Math.sign(ln - prev.ln))
        add('warn', 'parallel-perfects', `${bt.name}/${lt.name}`, x, `${bt.name}/${lt.name} ${where(M, prev.x)} to ${where(M, x)}: parallel ${ic === 7 ? 'fifths' : 'octaves'} (${pcName(prev.bn)}-${pcName(prev.ln)} then ${pcName(bn)}-${pcName(ln)}); move the lead (or bass) by contrary motion or a different interval`);
      prev = { x, ic, bn, ln };
    }
  }
};

rule.clash = (M, add) => {
  const slots = strongSlots(M), seen = new Set();
  const pairs = [];
  for (const b of M.pitchedOf('bass')) for (const l of M.pitchedOf('lead')) pairs.push([b, l]);
  for (const l of M.pitchedOf('lead')) for (const a of M.pitchedOf('arp')) pairs.push([l, a]);
  for (const [ta, tb] of pairs) for (const x of slots) {
    const ch = M.chordAt(x);
    for (const ea of sounding(ta, x)) for (const eb of sounding(tb, x)) {
      const d = Math.abs(ea.n - eb.n) % 12;
      if (d !== 1 && d !== 6) continue;
      if (Math.min(ea.b + (ea.d || 0), eb.b + (eb.d || 0)) - x < 1 - EPS) continue;
      if (ch && ch.pcs.includes(mod12(ea.n)) && ch.pcs.includes(mod12(eb.n))) continue;
      if (seen.has(ea) && seen.has(eb)) continue;
      seen.add(ea); seen.add(eb);
      add('warn', 'clash', `${ta.name}/${tb.name}`, x, `${ta.name}/${tb.name} ${where(M, x)}: ${noteName(ea.n)} against ${noteName(eb.n)} is a ${d === 1 ? 'minor 2nd/9th' : 'tritone'} held for >= 1 beat; change one of the notes or shorten it`);
    }
  }
};

// signature of one bar: rhythm + intervals relative to the first note (a transposed repeat is the same bar); an arpeggio compares absolute pitches, since the same shape over a new chord is the point
function barSig(M, tr, k) {
  const b0 = k * M.bpb, ev = tr.events.filter(e => e.b >= b0 - EPS && e.b < b0 + M.bpb - EPS);
  if (!ev.length) return '';
  const n0 = ev.find(isPitched);
  return ev.map(e => `${Math.round((e.b - b0) * 16)},${Math.round((e.d || 0) * 16)},${isPitched(e) ? (tr.role === 'arp' ? e.n : e.n - n0.n) : e.voice || ''}`).join(';');
}
function barSigs(M, tr) {
  const nb = Math.ceil(M.length / M.bpb - 1e-6), out = [];
  for (let k = 0; k < nb; k++) out.push(barSig(M, tr, k));
  return out;
}
rule.loop = (M, add) => {
  const o = M.opts;
  for (const tr of M.tracks) {
    if (tr.role !== 'lead' && tr.role !== 'arp') continue;
    const sigs = barSigs(M, tr), nonEmpty = sigs.filter(Boolean);
    let run = 1, start = 0;
    const flush = end => { if (sigs[start] && run > o.loopMaxRun) add('warn', 'loop', tr.name, start * M.bpb, `${tr.name} bars ${start + 1}-${end + 1} are identical (${run} in a row); vary the rhythm or contour, or drop the layer for a bar`); };
    for (let k = 1; k <= sigs.length; k++) {
      if (k < sigs.length && sigs[k] === sigs[k - 1]) run++;
      else { flush(k - 1); run = 1; start = k; }
    }
    if (nonEmpty.length >= o.loopMinBars) {
      const uniq = new Set(nonEmpty).size / nonEmpty.length;
      if (uniq < o.loopMinUnique) {
        const groups = {}; sigs.forEach((s, k) => { if (s) (groups[s] = groups[s] || []).push(k + 1); });
        const top = Object.values(groups).sort((a, b) => b.length - a.length)[0];
        add('warn', 'loop', tr.name, null, `${tr.name}: only ${Math.round(100 * uniq)}% unique bars (${new Set(nonEmpty).size} of ${nonEmpty.length}); bars ${bars(top)} are the same; write new bars for at least a quarter of them`);
      }
    }
  }
};

rule['flat-dynamics'] = (M, add) => {
  const o = M.opts;
  for (const tr of M.tracks) {
    if (tr.events.length >= o.flatMinEvents && tr.role !== 'pad') {                                                       // a sustained pad is flat by nature
      const sd = stdev(tr.events.map(e => e.v == null ? 0.8 : e.v));
      if (sd < o.flatVelStdev) add('warn', 'flat-dynamics', tr.name, null, `${tr.name}: velocity stdev ${r3(sd)} < ${o.flatVelStdev} over ${tr.events.length} events; add accents (beat 1 louder), ghost notes, a phrase swell`);
    }
  }
  const kicks = M.hits.filter(h => h.v === 'kick');
  const on1 = kicks.filter(h => Math.abs(((h.b % M.bpb) + M.bpb) % M.bpb) < EPS), other = kicks.filter(h => !on1.includes(h));
  if (kicks.length >= o.kickAccentMinKicks && on1.length && other.length && mean(on1.map(h => h.vel)) < mean(other.map(h => h.vel)) + o.kickAccentMin)
    add('warn', 'flat-dynamics', on1[0].track, on1[0].b, `${on1[0].track}: kicks on beat 1 (mean v ${r2(mean(on1.map(h => h.vel)))}) are not louder than the other kicks (${r2(mean(other.map(h => h.vel)))}); accent the downbeat`);
};

function density(M, s) {
  let n = 0;
  for (const tr of M.tracks) if (tr.role !== 'drums' && tr.role !== 'fx') n += tr.pitched.filter(e => e.b >= s.b - EPS && e.b < s.end - EPS).length;
  return n / (s.end - s.b);
}
rule['density-vs-energy'] = (M, add) => {
  const S = M.sections.filter(s => s.energy != null);
  if (S.length < 3) return;
  const d = S.map(s => ({ s, d: density(M, s) })), mu = mean(d.map(x => x.d));
  const ranked = d.slice().sort((a, b) => b.d - a.d), maxE = Math.max(...S.map(s => s.energy));
  const rankOf = x => 1 + d.filter(y => y.d > x.d + 1e-9).length;   // ties share a rank
  const bestRank = Math.min(...d.filter(x => x.s.energy === maxE).map(rankOf));
  if (bestRank > 2) {
    const top = d.find(x => x.s.energy === maxE);
    add('warn', 'density-vs-energy', null, top.s.b, `section "${top.s.name}" has the highest energy (${maxE}) but is only #${bestRank} by density (${r2(top.d)} notes/beat; densest: ${ranked.slice(0, 2).map(x => `"${x.s.name}" ${r2(x.d)}`).join(', ')}); add layers or notes there or thin the others`);
  }
  for (const x of d) if (x.s.energy < M.opts.densityLowEnergy && x.d > mu)
    add('warn', 'density-vs-energy', null, x.s.b, `section "${x.s.name}" has low energy (${x.s.energy}) but is denser (${r2(x.d)} notes/beat) than the mean (${r2(mu)}); remove notes or layers`);
};

rule['drum-groove'] = (M, add) => {
  if (!M.hits.length) return;
  const o = M.opts, near = (h, x, w) => h.b >= x - EPS && h.b < x + w;
  M.sections.forEach((s, i) => {
    if (s.energy == null) return;
    const nb = Math.round(s.bars), starts = Array.from({ length: nb }, (_, k) => s.b + k * M.bpb);
    if (s.energy >= o.grooveMinEnergy) {
      const share = starts.filter(x => M.hits.some(h => h.v === 'kick' && near(h, x, 0.25))).length / nb;
      if (share < o.grooveShare)
        add('warn', 'drum-groove', 'drums', s.b, `section "${s.name}" (energy ${s.energy}, bars ${M.bar(s.b)}-${M.bar(s.b) + s.bars - 1}): kick on beat 1 in only ${Math.round(share * 100)}% of bars; put a kick on every downbeat`);
      if (s.energy >= o.backbeatMinEnergy && M.bpb === 4) {
        const slots = starts.flatMap(x => [x + 1, x + 3]);
        const snareAt = x => M.hits.some(h => (h.v === 'snare' || h.v === 'clap') && near(h, x, 0.25));
        const bs = slots.filter(snareAt).length / slots.length;
        const half = starts.filter(x => snareAt(x + 2)).length / nb;                                                             // half-time feel: one snare on beat 3
        if (Math.max(bs, half) < o.grooveShare)
          add('warn', 'drum-groove', 'drums', s.b, `section "${s.name}" (energy ${s.energy}): snare/clap on beats 2 and 4 in only ${Math.round(bs * 100)}% of them (and not on beat 3 for a half-time feel); add a backbeat`);
      }
    }
    if (s.energy >= o.fillMinEnergy && i < M.sections.length - 1) {
      const fill = M.hits.filter(h => FILL_VOICES.includes(h.v) && h.b >= s.end - 1 - EPS && h.b < s.end - EPS).length >= o.fillMinHits;
      const crash = M.hits.some(h => h.v === 'crash' && h.b >= s.end - 0.26 && h.b < s.end + 0.5);
      if (!fill && !crash)
        add('info', 'drum-groove', 'drums', s.end - 1, `end of section "${s.name}" (energy ${s.energy}, bar ${M.bar(s.b) + s.bars - 1}): no drum fill (>= ${o.fillMinHits} snare/tom hits in the last beat) and no crash on the next downbeat`);
    }
  });
};

rule.transitions = (M, add) => {
  const o = M.opts;
  for (let i = 1; i < M.sections.length; i++) {
    const a = M.sections[i - 1], s = M.sections[i], x = s.b;
    const crash = M.hits.some(h => h.v === 'crash' && h.b >= x - 0.26 && h.b < x + 0.5);
    const fx = M.tracks.some(t => (t.role === 'fx' && t.events.some(e => e.b >= x - 4 - EPS && e.b < x + 0.5)) || t.events.some(e => e.voice === 'fx' && e.b >= x - 4 - EPS && e.b < x + 0.5));
    const fill = M.hits.filter(h => FILL_VOICES.includes(h.v) && h.b >= x - 1 - EPS && h.b < x - EPS).length >= o.fillMinHits;
    const la = new Set(activeTracks(M, a).map(t => t.name)), lb = new Set(activeTracks(M, s).map(t => t.name));
    const changed = [...la].filter(n => !lb.has(n)).length + [...lb].filter(n => !la.has(n)).length;
    if (!crash && !fx && !fill && changed < 2)
      add('info', 'transitions', null, x, `bar ${M.bar(x)}: no marker at the boundary "${a.name}" to "${s.name}"; add a crash on the downbeat, a riser/fx before it, a fill in the last beat, or change >= 2 layers`);
  }
};

rule['dead-air'] = (M, add) => {
  const iv = [];
  for (const tr of M.tracks) for (const e of tr.events) iv.push([e.b, e.b + Math.max(e.d || 0, 0.05)]);
  if (!iv.length) return;
  iv.sort((a, b) => a[0] - b[0]);
  let end = 0;
  const gap = (from, to) => {
    const g = to - from;
    if (g >= M.opts.deadAirWarn - EPS) add('warn', 'dead-air', null, from, `${where(M, from)}: ${fmt(g)} beats with no sound in any track; fill it or make the silence an intended break (add a riser/tail)`);
    else if (g >= M.opts.deadAirInfo - EPS) add('info', 'dead-air', null, from, `${where(M, from)}: ${fmt(g)} beats with no sound in any track`);
  };
  for (const [a, b] of iv) { if (a - end >= M.opts.deadAirInfo - EPS) gap(end, a); end = Math.max(end, b); }
};

rule.masking = (M, add) => {
  const o = M.opts;
  for (const lt of M.pitchedOf('lead')) for (const at of M.pitchedOf('arp')) {
    if (!lt.pitched.length || !at.pitched.length) continue;
    const md = Math.abs(median(lt.pitched.map(e => e.n)) - median(at.pitched.map(e => e.n)));
    if (md >= o.maskMedianDiff) continue;
    let on = 0, both = 0;
    for (let x = 0; x < M.length; x += 0.25) {
      if (!sounding(lt, x).length) continue;
      on++; if (sounding(at, x).length) both++;
    }
    if (on && both / on >= o.maskOverlap)
      add('info', 'masking', `${lt.name}/${at.name}`, null, `${lt.name} and ${at.name} sit in the same register (medians ${r2(md)} semitones apart) and overlap ${Math.round(100 * both / on)}% of the time; move the arp down an octave or thin it while the lead plays`);
  }
};

// ---------------------------------------------------------------- stats, lint, describe
function stats(M) {
  const st = { bpm: M.bpm, beatsPerBar: M.bpb, length: r3(M.length), bars: Math.ceil(M.length / M.bpb - 1e-6), seconds: r3(M.length * 60 / M.bpm), key: M.key ? M.key.name : null, tracks: {}, sections: [], counts: { error: 0, warn: 0, info: 0 } };
  for (const tr of M.tracks) {
    const ns = tr.pitched.map(e => e.n), sigs = barSigs(M, tr).filter(Boolean);
    st.tracks[tr.name] = {
      role: tr.role, events: tr.events.length, notes: tr.pitched.length,
      minPitch: ns.length ? Math.min(...ns) : null, maxPitch: ns.length ? Math.max(...ns) : null,
      velStdev: r3(stdev(tr.events.map(e => e.v == null ? 0.8 : e.v))),
      nonEmptyBars: sigs.length, uniqueBars: sigs.length ? r3(new Set(sigs).size / sigs.length) : null,
    };
  }
  for (const s of M.sections) {
    const act = activeTracks(M, s);
    st.sections.push({ name: s.name, b: s.b, bars: s.bars, energy: s.energy == null ? null : r3(s.energy), notesPerBeat: r3(density(M, s)), layers: act.map(t => t.name), layerCount: act.length });
  }
  return st;
}
function lint(score, userOpts) {
  const opts = Object.assign({}, DEFAULTS, userOpts, { ranges: Object.assign({}, DEFAULTS.ranges, userOpts && userOpts.ranges), weights: Object.assign({}, DEFAULTS.weights, userOpts && userOpts.weights), disable: (userOpts && userOpts.disable) || [] });
  const M = model(score || {}, opts), all = [];
  const add = (severity, ruleId, track, b, message) => all.push({ severity, rule: ruleId, track: track == null ? null : track, b: b == null ? null : r3(b), bar: b == null ? null : M.bar(b), message });
  for (const id of RULES) if (!opts.disable.includes(id)) rule[id](M, add);
  const order = { error: 0, warn: 1, info: 2 };
  all.sort((a, b) => order[a.severity] - order[b.severity] || (a.b == null ? -1 : b.b == null ? 1 : a.b - b.b));
  const st = stats(M);
  for (const f of all) st.counts[f.severity]++;
  const scored = all.filter(f => !(f.rule === 'out-of-key' && f.severity === 'info')).reduce((c, f) => { c[f.severity]++; return c; }, { error: 0, warn: 0, info: 0 });   // chromatic chord tones (a harmonic-minor V) are reported but cost nothing
  const score100 = Math.max(0, Math.round((100 - opts.weights.error * scored.error - opts.weights.warn * scored.warn - opts.weights.info * scored.info) * 10) / 10);
  // cap warn/info per rule and track (errors are never capped)
  const seen = {}, findings = [], more = {};
  for (const f of all) {
    if (f.severity === 'error') { findings.push(f); continue; }
    const k = `${f.rule}|${f.track}|${f.severity}`;
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] <= opts.maxPerTrack) findings.push(f); else (more[k] = more[k] || { f, n: 0 }).n++;
  }
  for (const m of Object.values(more)) findings.push({ severity: 'info', rule: m.f.rule, track: m.f.track, b: null, bar: null, message: `${m.f.track || 'score'}: ...and ${m.n} more ${m.f.severity} finding${m.n > 1 ? 's' : ''} of rule ${m.f.rule}` });
  return { findings, stats: st, score: score100 };
}

function describe(score) {
  const M = model(score || {}, DEFAULTS), st = stats(M), L = [];
  L.push(`${M.bpm} bpm, ${M.bpb}/4, ${M.key ? M.key.name : 'key unknown'}, ${st.bars} bars (${r2(st.seconds)} s)`);
  if (M.chords.length) {
    const seq = []; for (const c of M.chords) { const s = chordSymbol(c.c); if (seq[seq.length - 1] !== s) seq.push(s); }
    L.push('chords: ' + seq.join(' '));
  }
  L.push('tracks:');
  for (const tr of M.tracks) {
    const t = st.tracks[tr.name];
    L.push(`  ${tr.name} (${tr.role}${tr.t.voice ? ', ' + tr.t.voice : ''}): ${t.events} events` + (t.notes ? `, pitch ${noteName(t.minPitch)}..${noteName(t.maxPitch)}` : '') + `, vel stdev ${t.velStdev}` + (t.uniqueBars != null ? `, ${Math.round(t.uniqueBars * 100)}% unique bars` : ''));
  }
  if (st.sections.length) {
    L.push('sections:');
    for (const s of st.sections) L.push(`  ${s.name}: bars ${M.bar(s.b)}-${M.bar(s.b) + s.bars - 1}, energy ${s.energy == null ? '?' : s.energy}, ${s.notesPerBeat} notes/beat, ${s.layerCount} layers (${s.layers.join(', ')})`);
  }
  return L.join('\n');
}

const api = { lint, describe, DEFAULTS, RULES, chordSymbol, chordWords, noteName, pcName, parseRoot, MODES, DRUM_VOICES };
global.MusicLint = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
