// motion-kit chiptune: a Pyxel-style MML player and one-shot sfx presets on the Web Audio API.
// A whole score is a compact text string on a few channels with four tones (triangle, square, pulse, noise):
//   Chip.play(ac, t, out, ['T140 @1 O4 L8 CEGE', 'T140 @0 O2 L4 C G'])
// Classic script, no dependencies, works from file://:  <script src="../../runtime/chip.js"></script>
// Two more paths: Chip.playScore plays a Score (music as data: tracks of note events in beats, with roles, envelopes, echo, pan, ducking),
// and Chip.drums.* are real kick / snare / hat / tom / crash / clap / rim hits (also the MML tones @4..@10).
// Instruments have the same signature as Film.audio ones: (ac, t, out, gain) with t in AudioContext seconds.
// The pure part (Chip.parse) also loads in Node: require('./chip.js'). No Math.random anywhere: same input, same samples.
// Time base: 192 ticks per whole note (48 per quarter, L1..L192), the unit of @ENV / @VIB / @GLI durations. Docs: 16-chiptune.md.
(function () {
'use strict';

const TICKS = 192;                      // ticks per whole note; one tick = 1/48 of a quarter note
const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const midiToHz = m => 440 * 2 ** ((m - 69) / 12);
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteToMidi(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(name).trim());
  if (!m) throw new Error(`Chip.noteToMidi: bad note name "${name}" (expected like A4, C#5, Bb3)`);
  return 12 * (+m[3] + 1) + SEMI[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

// Tones. type: triangle | square | sine | sawtooth | pulse (duty) | noise | wave (real/imag Fourier coefficients).
// gain balances the loudness of the tones so V means roughly the same everywhere. Override or add with opts.tones.
const TONES = {
  0: { type: 'triangle', gain: 1 },
  1: { type: 'square', gain: .55 },
  2: { type: 'pulse', duty: .25, gain: .6 },
  3: { type: 'noise', gain: .5 },
  // drum voices: the note plays a real drum hit (Chip.drums), its own envelope; Q, @ENV and the note length do not apply. Note pitch only bends the tom.
  4: { type: 'drum', drum: 'kick', gain: 1 },
  5: { type: 'drum', drum: 'snare', gain: 1 },
  6: { type: 'drum', drum: 'hat', gain: 1 },
  7: { type: 'drum', drum: 'ohat', gain: 1 },
  8: { type: 'drum', drum: 'tom', gain: 1 },
  9: { type: 'drum', drum: 'crash', gain: 1 },
  10: { type: 'drum', drum: 'clap', gain: 1 },
};
const tonesOf = o => Object.assign({}, TONES, o && o.tones);

// ---------------------------------------------------------------- parser
const RE_NUM = /[+-]?\d+/y, RE_WORD = /[A-Za-z]+/y, RE_DIGIT = /\d/;

function fail(src, off, pos, msg) {
  const rel = pos - off, where = pos < off ? `in opts.prefix at char ${pos}` : `at char ${rel}`;
  const a = Math.max(0, pos - 14), b = Math.min(src.length, pos + 15);
  throw new Error(`Chip.parse: ${msg} ${where}: "${src.slice(a, pos)}>>${src[pos] === undefined ? 'end' : src[pos]}<<${src.slice(pos + 1, b)}"`);
}

// text -> tree of nodes; repeats become { k: 'rep', body, count } (count null = infinite)
function lex(src, off, tones) {
  let i = 0; const n = src.length, err = (msg, p = i) => fail(src, off, p, msg);
  const stack = [{ body: [], pos: 0 }];
  const put = nd => { nd.pos ??= i; stack[stack.length - 1].body.push(nd); };
  const ws = () => {
    for (;;) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '|') i++;                       // '|' is a bar line for the eye
      else if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; }              // // comment to end of line
      else break;
    }
  };
  const num = (what, min, max) => {
    ws(); RE_NUM.lastIndex = i; const m = RE_NUM.exec(src);
    if (!m) err(`${what} needs a number`);
    const v = +m[0]; if (v < min || v > max) err(`${what} must be ${min}..${max === Infinity ? '' : max}, got ${v}`);
    i += m[0].length; return v;
  };
  const length = (what) => {                                                                            // 8 or 8.. directly after a note/rest/&
    let len = null, dots = 0;
    if (RE_DIGIT.test(src[i] || '')) { const p = i; RE_NUM.lastIndex = i; const m = RE_NUM.exec(src); len = +m[0]; i += m[0].length; if (len < 1 || len > TICKS) err(`${what} length must be 1..${TICKS}, got ${len}`, p); }
    while (src[i] === '.') { dots++; i++; }
    return { len, dots };
  };
  const block = (kind) => {                                                                             // { a, b, c }
    const start = i; i++;
    const end = src.indexOf('}', i); if (end < 0) err(`{ is never closed`, start);
    const items = []; const re = /[^\s,]+/g; re.lastIndex = 0; const body = src.slice(i, end); let m;
    while ((m = re.exec(body))) {
      const p = i + m.index, s = m[0];
      if (s === '*' && kind === 'gli') items.push({ star: true });
      else if (/^[+-]?\d+$/.test(s)) items.push({ v: +s });
      else err(`@${kind.toUpperCase()} { ... } takes numbers${kind === 'gli' ? ' or *' : ''}, got "${s}"`, p);
      items[items.length - 1].pos = p;
    }
    i = end + 1;
    const chk = (it, min, max, what) => { if (it.star) return; if (it.v < min || it.v > max) err(`${what} must be ${min}..${max === Infinity ? '' : max}, got ${it.v}`, it.pos); };
    if (kind === 'env') {
      if (!items.length || items.length % 2 === 0) err(`@ENV { init_vol, dur_ticks, vol, ... } needs an initial volume and then pairs`, start);
      items.forEach((it, k) => k === 0 || k % 2 === 0 ? chk(it, 0, 127, 'envelope volume') : chk(it, 0, Infinity, 'envelope duration'));
      return { v: items.map(x => x.v) };
    }
    if (kind === 'vib') {
      if (items.length !== 3) err(`@VIB { delay_ticks, period_ticks, depth_cents } needs exactly 3 numbers`, start);
      chk(items[0], 0, Infinity, 'vibrato delay'); chk(items[1], 1, Infinity, 'vibrato period'); chk(items[2], -Infinity, Infinity, 'vibrato depth');
      return { delay: items[0].v, period: items[1].v, depth: items[2].v };
    }
    if (items.length !== 2) err(`@GLI { offset_cents, dur_ticks } needs exactly 2 values (each may be *)`, start);
    chk(items[1], 0, Infinity, 'glide duration');
    return { cents: items[0].star ? null : items[0].v, dur: items[1].star ? null : items[1].v };
  };

  while (ws(), i < n) {
    const p = i, c = src[i].toUpperCase();
    if (c >= 'A' && c <= 'G') {
      i++; let semi = SEMI[c];
      while (src[i] === '#' || src[i] === '+') { semi++; i++; }                                          // C#  C+
      while (src[i] === '-') { semi--; i++; }                                                            // B-  (flat)
      put({ k: 'n', semi, ...length('note'), pos: p });
    } else if (c === 'R') { i++; put({ k: 'r', ...length('rest'), pos: p }); }
    else if (c === '&') {
      i++; put({ k: '&', pos: p }); ws();
      if (RE_DIGIT.test(src[i] || '')) { const q = i; put({ k: 'tl', ...length('tie'), pos: q }); }                       // C4&16: only the length
    }
    else if (c === 'T') { i++; put({ k: 'T', v: num('T (tempo)', 1, Infinity), pos: p }); }
    else if (c === 'Q') { i++; put({ k: 'Q', v: num('Q (gate)', 0, 100), pos: p }); }
    else if (c === 'V') { i++; put({ k: 'V', v: num('V (volume)', 0, 127), pos: p }); }
    else if (c === 'K') { i++; put({ k: 'K', v: num('K (transpose)', -240, 240), pos: p }); }
    else if (c === 'Y') { i++; put({ k: 'Y', v: num('Y (detune)', -4800, 4800), pos: p }); }
    else if (c === 'O') { i++; put({ k: 'O', v: num('O (octave)', -1, 9), pos: p }); }
    else if (c === 'L') { i++; put({ k: 'L', v: num('L (default length)', 1, TICKS), pos: p }); }
    else if (c === '>') { i++; put({ k: 'O+', pos: p }); }
    else if (c === '<') { i++; put({ k: 'O-', pos: p }); }
    else if (c === '@') {
      i++; RE_WORD.lastIndex = i; const w = /[A-Za-z]/.test(src[i] || '') ? RE_WORD.exec(src) : null;
      if (!w) { const v = num('@ (tone)', 0, Infinity); if (!tones[v]) err(`unknown tone @${v} (defined: ${Object.keys(tones).join(', ')})`, p); put({ k: 'tone', v, pos: p }); continue; }
      const kind = w[0].toLowerCase(); i += w[0].length;
      if (kind !== 'env' && kind !== 'vib' && kind !== 'gli') err(`unknown command @${w[0]}`, p);
      const slot = num(`@${kind.toUpperCase()} slot`, 0, Infinity); ws();
      let def = null;
      if (src[i] === '{') { if (slot === 0) err(`slot 0 means "off" and cannot be defined`, p); def = block(kind); }
      put({ k: 'slot', kind, slot, def, pos: p });
    }
    else if (c === '[') { i++; stack.push({ body: [], pos: p }); }
    else if (c === ']') {
      i++; if (stack.length < 2) err(`] without a matching [`, p);
      const fr = stack.pop(); ws(); let count = null;
      if (RE_DIGIT.test(src[i] || '')) count = num('repeat count', 1, Infinity);
      stack[stack.length - 1].body.push({ k: 'rep', body: fr.body, count, pos: fr.pos });
    }
    else err(`unexpected "${src[i]}"`);
  }
  if (stack.length > 1) err(`[ is never closed`, stack[stack.length - 1].pos);
  return stack[0].body;
}

// Chip.parse(mml, opts?) -> { events: [{ t, dur, midi, freq, vol, tone, env, vib, gli, gate, tie }], length, infinite }
//   t     start, seconds from the track start (tempo changes honored)
//   dur   the note's slot on the grid, seconds: the time to the next note; tied same-pitch notes are one event with the summed slot
//   gate  Q/100. The note sounds for dur * gate, then the rest of the slot is silent. Legato (&) sets the earlier note's gate to 1
//   midi  MIDI number after K; freq in Hz including Y detune; vol V/127 (0..1); tone index
//   tie   true if the note continues the previous one legato (different pitch after &): no new attack, one voice
//   env   null | { v0, pts: [[seconds from note start, vol 0..1], ...] }  linear between points, last value held
//   vib   null | { delay, period (seconds), depth (cents, peak) }
//   gli   null | { cents, dur (seconds) }  the pitch starts `cents` away and returns to the note; * is resolved here
// An infinite repeat ( [ ... ] with no count ) is unrolled until opts.maxSeconds (default 60): the track is cut there, `length` = maxSeconds.
// opts: maxSeconds, tones, prefix (MML put before the text: shared @ENV/@VIB/@GLI slots, T), tone (initial tone), maxEvents (default 100000).
function parse(mml, opts = {}) {
  if (typeof mml !== 'string') throw new Error('Chip.parse: the score must be a string');
  const prefix = opts.prefix ? opts.prefix + '\n' : '', src = prefix + mml, off = prefix.length, tones = tonesOf(opts);
  const cap = opts.maxSeconds ?? 60, maxEvents = opts.maxEvents ?? 100000;
  const tree = lex(src, off, tones), err = (msg, p) => fail(src, off, p, msg);
  const st = { T: 120, Q: 80, V: 100, K: 0, Y: 0, O: 4, L: 4, tone: opts.tone ?? 0, env: 0, vib: 0, gli: 0 };
  if (!tones[st.tone]) throw new Error(`Chip.parse: unknown initial tone ${st.tone}`);
  const slots = { env: {}, vib: {}, gli: {} };
  const events = []; let t = 0, tie = null, last = null, adj = false, inf = 0, done = false, wasInf = false;

  const secs = ticks => ticks / 48 * (60 / st.T);
  const lenTicks = (len, dots) => TICKS / len * (2 - .5 ** dots);
  const finish = e => { if (inf && e.t + e.dur > cap) { e.dur = cap - e.t; t = cap; done = true; } };
  const tick = () => 60 / (st.T * 48);

  function note(nd) {
    if (inf && t >= cap) { done = true; return; }
    const dur = secs(lenTicks(nd.len ?? st.L, nd.dots)), midi = 12 * (st.O + 1) + nd.semi + st.K;
    let legato = false; adj = true;
    if (tie) {
      tie = null;
      if (last.midi === midi) { last.dur += dur; last.gate = st.Q / 100; t += dur; finish(last); return; }
      last.gate = 1; legato = true;
    }
    const e = { t, dur, midi, freq: midiToHz(midi + st.Y / 100), vol: st.V / 127, tone: st.tone, env: null, vib: null, gli: null, gate: st.Q / 100, tie: legato };
    if (st.env) { const d = slots.env[st.env], k = tick(); let c = 0; e.env = { v0: d.v[0] / 127, pts: [] }; for (let j = 1; j < d.v.length; j += 2) { c += d.v[j] * k; e.env.pts.push([c, d.v[j + 1] / 127]); } }
    if (st.vib) { const d = slots.vib[st.vib], k = tick(); e.vib = { delay: d.delay * k, period: d.period * k, depth: d.depth }; }
    if (st.gli) { const d = slots.gli[st.gli]; e.gli = { cents: d.cents ?? (last ? (last.midi - midi) * 100 : 0), dur: d.dur == null ? dur : d.dur * tick() }; }
    events.push(e); if (events.length > maxEvents) err(`more than ${maxEvents} notes (a runaway repeat?)`, nd.pos);
    last = e; t += dur; finish(e);
  }

  function exec(body) {
    for (const nd of body) {
      if (done) return;
      switch (nd.k) {
        case 'n': note(nd); break;
        case 'r':
          if (tie) err('& must be followed by a note or a length', tie.pos);
          adj = false; t += secs(lenTicks(nd.len ?? st.L, nd.dots)); if (inf && t >= cap) { t = cap; done = true; } break;
        case '&': if (!last || !adj) err('& must come right after a note', nd.pos); tie = nd; break;
        case 'tl': {
          if (!tie) err('a bare length is only valid after &', nd.pos);
          tie = null; if (inf && t >= cap) { done = true; break; }
          const dur = secs(lenTicks(nd.len, nd.dots)); last.dur += dur; last.gate = st.Q / 100; t += dur; finish(last); break;
        }
        case 'T': case 'Q': case 'V': case 'K': case 'Y': case 'O': case 'L': st[nd.k] = nd.v; break;
        case 'tone': st.tone = nd.v; break;
        case 'O+': st.O = Math.min(9, st.O + 1); break;
        case 'O-': st.O = Math.max(-1, st.O - 1); break;
        case 'slot':
          if (nd.def) slots[nd.kind][nd.slot] = nd.def;
          else if (nd.slot && !slots[nd.kind][nd.slot]) err(`@${nd.kind.toUpperCase()} slot ${nd.slot} is not defined (define it: @${nd.kind.toUpperCase()}${nd.slot} { ... })`, nd.pos);
          st[nd.kind] = nd.slot; break;
        case 'rep': {
          const forever = nd.count == null; if (forever) { inf++; wasInf = true; }
          for (let c = 0; forever || c < nd.count; c++) {
            const t0 = t; exec(nd.body); if (done) return;
            if (forever && t === t0) err('an infinite repeat with no notes or rests would never end', nd.pos);
          }
          break;
        }
      }
    }
  }
  exec(tree);
  if (tie && !done) err('& at the end has no note to tie to', tie.pos);
  return { events, length: t, infinite: wasInf };
}

// ---------------------------------------------------------------- player
const ATT = .002, REL = .008;                     // attack and release ramps of every note: no clicks
const cache = new WeakMap();                     // per context: noise buffers, periodic waves
const memo = (ac, key, make) => { let m = cache.get(ac); if (!m) cache.set(ac, m = new Map()); if (!m.has(key)) m.set(key, make()); return m.get(key); };
const noiseBuf = (ac, seed = 7) => memo(ac, 'n' + seed, () => {
  const b = ac.createBuffer(1, Math.ceil(ac.sampleRate * 2), ac.sampleRate), d = b.getChannelData(0), r = mulberry32(seed);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return b;
});
function waveOf(ac, spec) {
  if (spec.type === 'pulse') {                    // pulse with duty d: a_n = 2 sin(n pi d) / (n pi), b_n = 2 (1 - cos(n pi d)) / (n pi)
    const d = spec.duty ?? .25;
    return memo(ac, 'p' + d, () => {
      const N = 64, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
      for (let n = 1; n <= N; n++) { re[n] = 2 * Math.sin(n * Math.PI * d) / (n * Math.PI); im[n] = 2 * (1 - Math.cos(n * Math.PI * d)) / (n * Math.PI); }
      return ac.createPeriodicWave(re, im);
    });
  }
  const re = Float32Array.from([0, ...(spec.real || [])]), im = Float32Array.from([0, ...(spec.imag || [])]);
  return memo(ac, 'w' + JSON.stringify([spec.real, spec.imag]), () => ac.createPeriodicWave(re, im));
}
function setWave(ac, o, spec) {
  if (spec.type === 'pulse' || spec.type === 'wave') o.setPeriodicWave(waveOf(ac, spec)); else o.type = spec.type;
}
const SOFT = (() => { const N = 4097, c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = Math.tanh(2 * (i / (N - 1) * 2 - 1)); return c; })();   // input is halved: this is tanh(x) on [-2, 2]

function envLevel(env, tau) {                     // envelope value (0..1) at tau seconds after the note start
  if (!env) return 1;
  let pt = 0, pv = env.v0;
  for (const [t, v] of env.pts) { if (tau < t) return t === pt ? v : pv + (v - pv) * (tau - pt) / (t - pt); pt = t; pv = v; }
  return pv;
}

// one voice = a run of events: a note and any legato notes tied to it (one oscillator, no re-attack)
function voice(ac, dest, spec, run, ts, rng, lanes) {
  if (spec.type === 'drum') {                     // a drum tone: one hit, its own envelope, routed through the track's lanes (see Lanes)
    const h = run[0]; if (!(h.vol > 0)) return ts;
    const hg = ac.createGain(), r = drums[spec.drum](ac, ts, hg, { gain: h.vol * (spec.gain ?? 1), pitch: spec.drum === 'tom' ? 2 ** ((h.midi - 60) / 12) : 1, seed: rng() * 4294967296 >>> 0 });
    lanes.add(hg, ts, r.end); return r.end;
  }
  const head = run[0], first = head.t, ne = run.length, last = run[ne - 1];
  const len = last.t - first + last.dur * last.gate;
  if (!(len > 0) || !(head.vol > 0)) return ts;
  const noise = spec.type === 'noise', g = ac.createGain();
  const src = noise ? ac.createBufferSource() : ac.createOscillator();
  if (noise) { src.buffer = noiseBuf(ac); src.loop = true; } else setWave(ac, src, spec);
  const P = noise ? src.playbackRate : src.frequency, pv = f => noise ? Math.max(.02, f / 440) : f, det = src.detune;
  // amplitude: attack, envelope (or flat), release; the release starts at note-off
  const L = head.vol * (spec.gain ?? 1), att = Math.min(ATT, len * .4), rel = Math.min(REL, len * .4), cut = len - rel, env = head.env;
  g.gain.setValueAtTime(0, ts); g.gain.linearRampToValueAtTime(L * envLevel(env, att), ts + att);
  if (env) { let prev = att; for (const [t] of env.pts) if (t > prev && t < cut) { g.gain.linearRampToValueAtTime(L * envLevel(env, t), ts + t); prev = t; } }
  g.gain.linearRampToValueAtTime(L * envLevel(env, cut), ts + cut); g.gain.linearRampToValueAtTime(0, ts + len);
  // pitch: per note a step (legato) or a glide; vibrato is a scheduled sine on detune (no free-running LFO)
  det.setValueAtTime(0, ts); let vibOn = false;
  for (let k = 0; k < ne; k++) {
    const e = run[k], ns = ts + e.t - first, nl = k < ne - 1 ? e.dur : e.dur * e.gate, f = pv(e.freq);
    if (e.gli && e.gli.cents && e.gli.dur > 0) {
      P.setValueAtTime(pv(e.freq * 2 ** (e.gli.cents / 1200)), ns); P.exponentialRampToValueAtTime(f, ns + Math.min(e.gli.dur, nl));
    } else P.setValueAtTime(f, ns);
    if (e.vib && e.vib.depth && e.vib.period > 0) {
      const v = e.vib, step = v.period / 16, s0 = ns + v.delay, end = ns + nl; vibOn = true;
      det.setValueAtTime(0, ns); if (v.delay > 0) det.setValueAtTime(0, Math.min(s0, end));
      if (s0 < end) { let j = 1; for (; j <= 4000 && s0 + j * step < end; j++) det.linearRampToValueAtTime(v.depth * Math.sin(Math.PI * 2 * j / 16), s0 + j * step); det.linearRampToValueAtTime(v.depth * Math.sin(Math.PI * 2 * (end - s0) / v.period), end); }
    } else if (vibOn) { det.setValueAtTime(0, ns); vibOn = false; }
  }
  src.connect(g).connect(dest);
  if (noise) src.start(ts, rng() * 1.5); else src.start(ts);
  src.stop(ts + len + .02);
  return ts + len;
}

function prepare(tracks, opts) {
  const tones = tonesOf(opts), list = (Array.isArray(tracks) ? tracks : [tracks]).map(x => typeof x === 'string' ? { mml: x } : x);
  const popts = { tones: opts.tones, prefix: opts.prefix, maxEvents: opts.maxEvents, maxSeconds: opts.maxSeconds === 'longest' ? 60 : opts.maxSeconds };
  let ps = list.map(x => parse(x.mml, { ...popts, tone: x.tone }));
  if (opts.maxSeconds === 'longest') {            // infinite loops end together with the longest finite track (60 s if there is none)
    const fin = ps.filter(p => !p.infinite).map(p => p.length);
    if (fin.length) { const m = Math.max(...fin); ps = ps.map((p, i) => p.infinite ? parse(list[i].mml, { ...popts, tone: list[i].tone, maxSeconds: m }) : p); }
  }
  return list.map((x, i) => ({ x, p: ps[i], tones }));
}

// Chrome sums the inputs of a node in no fixed order, and a float sum of 3+ values depends on the order (1 ulp).
// Tracks are therefore added pairwise in a tree of 2-input gains, so two renders are bit-identical.
function sumTree(ac, xs) {
  while (xs.length > 1) {
    const ys = [];
    for (let i = 0; i < xs.length; i += 2) {
      if (i + 1 < xs.length) { const s = ac.createGain(); xs[i].connect(s); xs[i + 1].connect(s); ys.push(s); } else ys.push(xs[i]);
    }
    xs = ys;
  }
  return xs[0];
}

// Lanes: sounds that can overlap (drum hits with tails, chord notes) are dealt to lanes so that only one is audible per lane at any time.
// A lane sums its sources with silence (exact in any order); the lanes are then added pairwise. Result: bit-identical renders with any number of overlapping sounds.
function makeLanes(ac) {
  const lanes = [];
  return {
    add(node, t, end) {                                   // node: the sound's output; it is audible from t until end
      let l = lanes.find(x => x.free <= t + 1e-9);
      if (!l) lanes.push(l = { node: ac.createGain(), free: 0 });
      node.connect(l.node); l.free = end + .005; return l;
    },
    out() { return lanes.length ? sumTree(ac, lanes.map(l => l.node)) : null; },
    get count() { return lanes.length; },
  };
}

function schedule(ac, t0, out, prepared, opts) {
  const rng = mulberry32(opts.seed ?? 1), now = ac.currentTime, outs = []; let end = t0;
  for (const { x, p, tones } of prepared) {
    const tg = ac.createGain(); tg.gain.value = x.gain ?? .3;
    if (x.pan && ac.createStereoPanner) { const pn = ac.createStereoPanner(); pn.pan.value = x.pan; tg.connect(pn); outs.push(pn); } else outs.push(tg);
    let run = null; const lanes = makeLanes(ac);
    const flush = () => { if (run) { const ts = t0 + run[0].t; if (ts >= now - 1e-3) end = Math.max(end, voice(ac, tg, tones[run[0].tone], run, ts, rng, lanes)); run = null; } };
    for (const e of p.events) { if (e.tie && run) run.push(e); else { flush(); run = [e]; } }
    flush();
    const lo = lanes.out(); if (lo) lo.connect(tg);
  }
  const master = ac.createGain(); master.gain.value = opts.gain ?? 1;
  if (outs.length) sumTree(ac, outs).connect(master);
  if (opts.limit === false) master.connect(out);
  else { const pre = ac.createGain(), ws = ac.createWaveShaper(); pre.gain.value = .5; ws.curve = SOFT; master.connect(pre).connect(ws).connect(out); }
  return { end };
}

// Chip.play(ac, t0, out, tracks, opts?) -> { end }. tracks: an MML string or an array of strings / { mml, gain (default .3), pan, tone }.
// opts: gain (master, default 1), maxSeconds (number, default 60, or 'longest' = the longest finite track), tones, prefix, seed, maxEvents, limit (false = no soft limiter).
function play(ac, t0, out, tracks, opts = {}) { return schedule(ac, t0, out, prepare(tracks, opts), opts); }

// Chip.instrument(mml | tracks, opts?) -> (ac, t, out, gain?) like Film.audio; the score is parsed once, errors surface here
function instrument(tracks, opts = {}) {
  const prepared = prepare(tracks, opts);
  return (ac, t, out, gain = 1) => schedule(ac, t, out, prepared, { ...opts, gain: (opts.gain ?? 1) * gain });
}

// ---------------------------------------------------------------- sfx
// One-shot presets in the jsfxr manner: an oscillator or noise with a frequency ramp and a decaying envelope.
// (ac, t, out, { gain (default .5), pitch (x frequencies), seed (a little seeded variation of pitch and level) })
function osc(ac, out, t, { type = 'square', fs, dur, peak = .6, att = .002, hold = 0 }) {
  const o = ac.createOscillator(), g = ac.createGain();
  if (type === 'pulse') o.setPeriodicWave(waveOf(ac, { type: 'pulse', duty: .25 })); else o.type = type;
  for (const [dt, f, mode] of fs) { if (dt === 0 || mode === 'set') o.frequency.setValueAtTime(f, t + dt); else if (mode === 'lin') o.frequency.linearRampToValueAtTime(f, t + dt); else o.frequency.exponentialRampToValueAtTime(f, t + dt); }
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + att);
  if (hold) g.gain.setValueAtTime(peak, t + att + hold);
  g.gain.exponentialRampToValueAtTime(peak * .001, t + dur - .005); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + dur + .01);
}
function hiss(ac, out, t, rng, { fs, q = .7, dur, peak = .6, att = .002, hold = 0 }) {
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf(ac); s.loop = true; f.type = 'lowpass'; f.Q.value = q;
  f.frequency.setValueAtTime(fs[0], t); f.frequency.exponentialRampToValueAtTime(fs[1], t + fs[2]);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + att);
  if (hold) g.gain.setValueAtTime(peak, t + att + hold);
  g.gain.exponentialRampToValueAtTime(peak * .001, t + dur - .005); g.gain.linearRampToValueAtTime(0, t + dur);
  s.connect(f).connect(g).connect(out); s.start(t, rng() * 1.5); s.stop(t + dur + .01);
}
const LEN = { coin: .34, jump: .2, hit: .14, explode: 1, laser: .24, powerup: .5, blip: .06, select: .14, fall: .6, land: .1 };
const BUILD = {
  coin(ac, out, t, k) { osc(ac, out, t, { fs: [[0, 988 * k.p], [.075, 1319 * k.p, 'set']], dur: LEN.coin, hold: .1, peak: .7 }); },
  jump(ac, out, t, k) { osc(ac, out, t, { type: 'pulse', fs: [[0, 260 * k.p], [.16, 640 * k.p, 'exp']], dur: LEN.jump, hold: .07, peak: .8, att: .003 }); },
  hit(ac, out, t, k) { hiss(ac, out, t, k.r, { fs: [5000, 500, .12], dur: LEN.hit, peak: .8 }); osc(ac, out, t, { type: 'triangle', fs: [[0, 200 * k.p], [.1, 50 * k.p, 'exp']], dur: .12, peak: .7 }); },
  explode(ac, out, t, k) { hiss(ac, out, t, k.r, { fs: [3000, 60, .9], dur: LEN.explode, peak: .8, att: .004, hold: .05 }); osc(ac, out, t, { fs: [[0, 120 * k.p], [.5, 30 * k.p, 'exp']], dur: .5, peak: .45 }); },
  laser(ac, out, t, k) { osc(ac, out, t, { fs: [[0, 2000 * k.p], [.2, 200 * k.p, 'exp']], dur: LEN.laser, hold: .05, peak: .6, att: .001 }); },
  powerup(ac, out, t, k) { osc(ac, out, t, { fs: [392, 494, 587, 784, 988, 1175].map((f, i) => [i * .05, f * k.p, 'set']), dur: LEN.powerup, hold: .3, peak: .6 }); },
  blip(ac, out, t, k) { osc(ac, out, t, { fs: [[0, 880 * k.p]], dur: LEN.blip, hold: .02, peak: .6, att: .001 }); },
  select(ac, out, t, k) { osc(ac, out, t, { fs: [[0, 660 * k.p], [.05, 990 * k.p, 'set']], dur: LEN.select, hold: .06, peak: .5 }); },
  fall(ac, out, t, k) { osc(ac, out, t, { type: 'pulse', fs: [[0, 620 * k.p], [.55, 70 * k.p, 'exp']], dur: LEN.fall, hold: .3, peak: .6 }); },
  land(ac, out, t, k) { hiss(ac, out, t, k.r, { fs: [1200, 200, .08], dur: LEN.land, peak: .7 }); osc(ac, out, t, { type: 'triangle', fs: [[0, 140 * k.p], [.08, 55 * k.p, 'exp']], dur: .1, peak: .8 }); },
};
const sfx = {};
for (const name of Object.keys(BUILD)) {
  sfx[name] = (ac, t, out, o = {}) => {
    const r = mulberry32(o.seed ?? 0); let p = o.pitch ?? 1, g = o.gain ?? .5;
    if (o.seed != null) { p *= 1 + (r() * 2 - 1) * .05; g *= 1 + (r() * 2 - 1) * .08; }
    const v = ac.createGain(); v.gain.value = g; v.connect(out);
    BUILD[name](ac, v, t, { p, r });
    return { end: t + LEN[name] };
  };
}
sfx.lengths = LEN;                                // seconds until each preset is silent
sfx.length = name => { if (!(name in LEN)) throw new Error(`Chip.sfx.length: unknown sfx "${name}" (${Object.keys(LEN).join(', ')})`); return LEN[name]; };

// ---------------------------------------------------------------- drums
// Chip.drums.{kick, snare, hat, ohat, tom, crash, clap, rim}(ac, t, out, { gain (1), pitch (x frequencies, 1), decay (x lengths, 1), seed, choke })  ->  { end }
// Each hit is a few oscillators / filtered noise bursts with their own envelopes, summed pairwise (deterministic), with a fixed loudness: gain 1 is a full-strength hit.
// choke (seconds, ohat only): cut the open hat after that long, like a closed hat stepping on it.
const DRUM_NAMES = ['kick', 'snare', 'hat', 'ohat', 'tom', 'crash', 'clap', 'rim'];
const DLEN = { kick: .4, snare: .3, hat: .07, ohat: .42, tom: .45, crash: 1.7, clap: .32, rim: .09 };     // seconds until each hit is silent, at decay 1
function envAt(gp, t, pts) {                       // [[dt, level, 'lin' | 'exp'], ...] the first is the start; exp targets stay above 0; the end goes to exactly 0
  gp.setValueAtTime(pts[0][1], t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) { const [dt, v, m] = pts[i]; if (m === 'lin') gp.linearRampToValueAtTime(v, t + dt); else gp.exponentialRampToValueAtTime(Math.max(v, 1e-4), t + dt); }
  gp.setValueAtTime(0, t + pts[pts.length - 1][0]);
}
const stretch = (pts, D) => pts.map((p, i) => i < 2 ? p : [p[0] * D, p[1], p[2]]);     // stretch the decay part of an envelope (everything after the attack)
function dTone(ac, t, type, fs, pts, shape) {      // oscillator with a pitch path fs [[dt, hz], ...] (exponential between) and an amplitude envelope; returns its output node
  const o = ac.createOscillator(), g = ac.createGain(), end = t + pts[pts.length - 1][0] + .01; o.type = type;
  o.frequency.setValueAtTime(fs[0][1], t + fs[0][0]); for (let i = 1; i < fs.length; i++) o.frequency.exponentialRampToValueAtTime(fs[i][1], t + fs[i][0]);
  envAt(g.gain, t, pts); o.connect(g); o.start(t); o.stop(end);
  if (!shape) return g;
  const w = ac.createWaveShaper(); w.curve = SOFT; g.connect(w); return w;
}
function dNoise(ac, t, k, filters, pts) {          // seeded noise -> filters [[type, hz, Q, gainDb], ...] -> amplitude envelope
  const dur = pts[pts.length - 1][0] + .01, s = ac.createBufferSource(), g = ac.createGain(); let n = s;
  s.buffer = noiseBuf(ac);
  for (const [type, f, q, db] of filters) { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = Math.min(f, ac.sampleRate * .45); b.Q.value = q; if (db) b.gain.value = db; n.connect(b); n = b; }
  envAt(g.gain, t, pts); n.connect(g); s.start(t, k.rng() * Math.max(0, 1.9 - dur)); s.stop(t + dur); return g;
}
const BUILD_DRUM = {
  kick(ac, t, k, parts) {                          // sine, exponential pitch drop 150 -> 45 Hz, saturated for punch, plus a short click
    const D = k.D, p = k.p;
    parts.push(dTone(ac, t, 'sine', [[0, 150 * p], [.11, 46 * p], [Math.max(.3 * D, .15), 38 * p]], stretch([[0, 0], [.001, 1.15, 'lin'], [.07, .55, 'exp'], [.36, .001, 'exp']], D), true));
    parts.push(dNoise(ac, t, k, [['highpass', 2200, .7]], [[0, 0], [.0006, .32, 'lin'], [.009, .001, 'exp']]));
  },
  snare(ac, t, k, parts) {                         // band-passed noise crack + a short 190 Hz tone body
    const D = k.D, p = k.p;
    parts.push(dNoise(ac, t, k, [['highpass', 1300 * p, .7], ['peaking', 3800 * p, .8, 5]], stretch([[0, 0], [.001, .85, 'lin'], [.05, .32, 'exp'], [.2, .001, 'exp']], D)));
    parts.push(dTone(ac, t, 'triangle', [[0, 215 * p], [.05, 175 * p]], stretch([[0, 0], [.001, .62, 'lin'], [.09, .001, 'exp']], D)));
  },
  hat(ac, t, k, parts) {                           // very short high-passed noise
    parts.push(dNoise(ac, t, k, [['highpass', 7000 * k.p, .8], ['highpass', 5500 * k.p, .7]], stretch([[0, 0], [.0005, .55, 'lin'], [.05, .001, 'exp']], k.D)));
  },
  ohat(ac, t, k, parts) {                          // the same, longer; a choke cuts it short
    let pts = stretch([[0, 0], [.001, .5, 'lin'], [.07, .2, 'exp'], [.32, .001, 'exp']], k.D);
    const c = k.choke;
    if (c != null && c < pts[pts.length - 1][0]) {                     // the level at the choke time on the exponential path, then a fast fade
      let pt = pts[1][0], pv = pts[1][1];
      for (let i = 2; i < pts.length; i++) {
        const [dt, v] = pts[i];
        if (c <= dt) { const at = Math.max(c, pt + 1e-4); pts = [...pts.slice(0, i), [at, pv * (v / pv) ** ((at - pt) / (dt - pt)), 'exp'], [at + .012, .001, 'exp']]; break; }
        pt = dt; pv = v;
      }
    }
    parts.push(dNoise(ac, t, k, [['highpass', 6800 * k.p, .8], ['highpass', 5200 * k.p, .7]], pts));
  },
  tom(ac, t, k, parts) {                           // sine with a pitch drop; `pitch` multiplies (2^((n-60)/12) from a score note)
    const D = k.D, p = k.p * 118;
    parts.push(dTone(ac, t, 'sine', [[0, p * 1.9], [.09, p], [Math.max(.3 * D, .12), p * .82]], stretch([[0, 0], [.002, 1, 'lin'], [.32, .001, 'exp']], D), true));
    parts.push(dNoise(ac, t, k, [['highpass', 1800, .7]], [[0, 0], [.0006, .22, 'lin'], [.008, .001, 'exp']]));
  },
  crash(ac, t, k, parts) {                         // long high-passed noise: a bright burst, a slow shimmer
    parts.push(dNoise(ac, t, k, [['highpass', 4200 * k.p, .6], ['highpass', 3000 * k.p, .5]], stretch([[0, 0], [.002, .6, 'lin'], [.12, .24, 'exp'], [1.6, .001, 'exp']], k.D)));
  },
  clap(ac, t, k, parts) {                          // three short noise bursts and a longer fourth
    const pts = [[0, 0]], gap = .011;
    for (let i = 0; i < 3; i++) pts.push([i * gap + .0008, .8 + i * .05, 'lin'], [i * gap + .009, .06, 'exp']);
    pts.push([3 * gap + .0008, 1, 'lin'], [3 * gap + .15 * k.D, .001, 'exp']);
    parts.push(dNoise(ac, t, k, [['highpass', 700, .7], ['bandpass', 1700 * k.p, 1.1]], pts));
  },
  rim(ac, t, k, parts) {                           // a tiny click and two short tones
    const p = k.p;
    parts.push(dTone(ac, t, 'triangle', [[0, 420 * p]], [[0, 0], [.0005, .7, 'lin'], [.05, .001, 'exp']]));
    parts.push(dTone(ac, t, 'sine', [[0, 1650 * p]], [[0, 0], [.0005, .35, 'lin'], [.03, .001, 'exp']]));
    parts.push(dNoise(ac, t, k, [['bandpass', 2600, 1.5]], [[0, 0], [.0004, .45, 'lin'], [.006, .001, 'exp']]));
  },
};
const DRUM_LEVEL = { kick: .8, snare: .5, hat: .45, ohat: .45, tom: .75, crash: .5, clap: 1.1, rim: .55 };   // per-drum trim: gain 1 is a full-strength hit
const drums = {};
for (const name of DRUM_NAMES) {
  drums[name] = (ac, t, out, o = {}) => {
    const k = { p: o.pitch ?? 1, D: o.decay ?? 1, rng: mulberry32(o.seed ?? 0), choke: o.choke }, parts = [];
    if (!(k.p > 0) || !(k.D >= .05 && k.D <= 10)) throw new Error(`Chip.drums.${name}: pitch must be > 0 and decay 0.05..10`);
    BUILD_DRUM[name](ac, t, k, parts);
    const v = ac.createGain(); v.gain.value = (o.gain ?? 1) * DRUM_LEVEL[name]; sumTree(ac, parts).connect(v); v.connect(out);
    return { end: name === 'ohat' && k.choke != null ? Math.min(t + DLEN[name] * k.D, t + k.choke + .03) : t + DLEN[name] * k.D };
  };
}
drums.names = DRUM_NAMES; drums.lengths = DLEN;
drums.length = name => { if (!(name in DLEN)) throw new Error(`Chip.drums.length: unknown drum "${name}" (${DRUM_NAMES.join(', ')})`); return DLEN[name]; };

// ---------------------------------------------------------------- scores: music as data
// Chip.playScore(ac, t0, out, score, opts?) -> { end, tail, length }     schedule a Score (16-chiptune.md, "Scores: music as data")
// Chip.scoreEvents(score, opts?) -> [{ t, dur, midi, drum, voice, vel, gain, track, ti, role, b, d, glide }]   the same notes as a flat list, pure (no WebAudio)
// Chip.scoreDucks(score, opts?) -> [{ t, depth, rel }]     the duck events on absolute time
// Chip.validateScore(score)     throws a readable error, returns true
// opts: timeOf(beat) -> absolute context time (default t0 + beat * 60 / bpm; a Film passes a tempo-map-aware one), t0 (scoreEvents only, for the default timeOf),
//       from (skip events that start before this context time; playScore default: now, so a live seek skips what already sounded), gain (master, 1),
//       limit (false = no soft limiter), seed (noise start offsets).
const MELODIC = ['triangle', 'square', 'pulse', 'saw', 'sine', 'noise'];
const VOICE_GAIN = { triangle: .8, square: .5, pulse: 1, saw: .85, sine: .75, noise: 1.7 };      // loudness balance between voices at the same velocity
const ENV_ROLE = { bass: { a: .004, d: .06, s: .9, r: .06 }, lead: { a: .012, d: .12, s: .75, r: .14 }, arp: { a: .002, d: .12, s: .3, r: .05 }, pad: { a: .22, d: .3, s: .8, r: .45 }, fx: { a: .004, d: .25, s: .3, r: .2 } };
const ENV_VOICE = { triangle: 'bass', sine: 'bass', square: 'lead', saw: 'lead', pulse: 'arp', noise: 'fx' };
const ROLE_VOICE = { bass: 'triangle', lead: 'square', arp: 'pulse', pad: 'triangle', fx: 'noise' };
const ROLES = ['bass', 'lead', 'arp', 'pad', 'drums', 'fx'];
const FLOOR = 1e-3;                                  // exponential ramps end here (-60 dB), then the gain goes to exactly 0

function normalizeScore(score) {
  const bad = (msg) => { throw new Error(`Chip score: ${msg}`); };
  const fin = (v, what, min = -Infinity, max = Infinity) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) bad(`${what} must be a finite number, got ${typeof v === 'number' ? v : JSON.stringify(v)}`);
    if (v < min || v > max) bad(`${what} must be ${min === -Infinity ? '' : min}..${max === Infinity ? '' : max}, got ${v}`);
    return v;
  };
  if (!score || typeof score !== 'object') bad('the score must be an object { bpm, tracks: [...] }');
  const bpm = fin(score.bpm ?? 120, 'bpm', 1e-3), length = score.length == null ? null : fin(score.length, 'length', 0);
  if (!Array.isArray(score.tracks)) bad('tracks must be an array');
  const tracks = score.tracks.map((tr, ti) => {
    if (!tr || typeof tr !== 'object') bad(`track ${ti} must be an object`);
    const name = tr.name == null ? `track${ti}` : String(tr.name), at = `track "${name}"`, role = tr.role ?? null;
    if (role != null && !ROLES.includes(role)) bad(`${at}: unknown role "${role}" (${ROLES.join(', ')})`);
    const drumTrack = role === 'drums';
    if (tr.voice != null && !MELODIC.includes(tr.voice) && !DRUM_NAMES.includes(tr.voice)) bad(`${at}: unknown voice "${tr.voice}" (${MELODIC.join(', ')}, or drums: ${DRUM_NAMES.join(', ')})`);
    const voice = tr.voice ?? (drumTrack ? null : ROLE_VOICE[role] ?? 'square');
    const gain = fin(tr.gain ?? .5, `${at}: gain`, 0), pan = fin(tr.pan ?? 0, `${at}: pan`, -1, 1);
    let duty = tr.duty ?? .25;
    duty = Array.isArray(duty) ? duty.map((d, i) => fin(d, `${at}: duty[${i}]`, .02, .98)) : fin(duty, `${at}: duty`, .02, .98);
    if (Array.isArray(duty) && duty.length !== 2) bad(`${at}: duty as a sweep is [from, to]`);
    const eb = ENV_ROLE[role] ?? ENV_ROLE[ENV_VOICE[voice]] ?? ENV_ROLE.lead, e = tr.env || {};
    const env = { a: fin(e.a ?? eb.a, `${at}: env.a`, 0), d: fin(e.d ?? eb.d, `${at}: env.d`, 0), s: fin(e.s ?? eb.s, `${at}: env.s`, 0, 1), r: fin(e.r ?? eb.r, `${at}: env.r`, 0) };
    let vib = null;
    if (tr.vib) vib = { delay: fin(tr.vib.delay ?? 0, `${at}: vib.delay`, 0), rate: fin(tr.vib.rate ?? 5, `${at}: vib.rate`, .01), depth: fin(tr.vib.depth ?? 0, `${at}: vib.depth`) };
    let echo = null;
    if (tr.echo) echo = { time: fin(tr.echo.time ?? .75, `${at}: echo.time`, 1e-3), fb: Math.min(.6, fin(tr.echo.fb ?? .35, `${at}: echo.fb`, 0)), mix: fin(tr.echo.mix ?? .3, `${at}: echo.mix`, 0, 1) };
    if (!Array.isArray(tr.events)) bad(`${at}: events must be an array`);
    const events = tr.events.map((ev, i) => {
      const w = `${at} event ${i}`;
      if (!ev || typeof ev !== 'object') bad(`${w} must be an object { b, d, n, v }`);
      const b = fin(ev.b, `${w}: b (start beat)`, 0), d = fin(ev.d ?? 0, `${w}: d (duration in beats)`);
      if (d < 0) bad(`${w}: d (duration) must not be negative, got ${d}`);
      if (ev.voice != null && !MELODIC.includes(ev.voice) && !DRUM_NAMES.includes(ev.voice)) bad(`${w}: unknown voice "${ev.voice}" (${MELODIC.join(', ')}, or drums: ${DRUM_NAMES.join(', ')})`);
      const vname = ev.voice ?? voice, vel = fin(ev.v ?? .8, `${w}: v (velocity)`, 0, 1);
      const drum = vname != null && DRUM_NAMES.includes(vname);
      if (drumTrack && !drum) bad(`${w}: a drum event needs voice: one of ${DRUM_NAMES.join(', ')}${vname ? ` (got "${vname}")` : ''}`);
      if (vname == null) bad(`${w}: no voice (set voice on the track or on the event)`);
      const out = { b, d, vname, vel, drum: drum ? vname : null, midi: null, glide: null };
      if (ev.n != null) out.midi = fin(ev.n, `${w}: n (MIDI note)`, 0, 127);
      else if (!drum) bad(`${w}: a note event needs n (MIDI note number)`);
      if (ev.g != null) { out.glide = { midi: fin(ev.g, `${w}: g (glide start note)`, 0, 127), beats: ev.gd == null ? null : fin(ev.gd, `${w}: gd (glide beats)`, 0) }; if (drum) out.glide = null; }
      return out;
    });
    return { name, role, voice, gain, pan, duty, env, vib, echo, duck: !!tr.duck, drumTrack, events };
  });
  const duck = (score.duck ?? []).map((k, i) => ({ b: fin(k.b, `duck ${i}: b`, 0), depth: fin(k.depth ?? .5, `duck ${i}: depth`, 0, 1), rel: fin(k.rel ?? .2, `duck ${i}: rel (seconds)`, 1e-3) }));
  return { bpm, length, tracks, duck };
}
const validateScore = score => (normalizeScore(score), true);

const defaultTimeOf = (S, t0) => b => t0 + b * 60 / S.bpm;
function resolveScore(S, timeOf, from) {             // events of every track on absolute time, sorted by start (stable: then by track, then by order)
  const byTrack = S.tracks.map(() => []), flat = [];
  S.tracks.forEach((tr, ti) => tr.events.forEach((e, i) => {
    const t = timeOf(e.b);
    if (!Number.isFinite(t)) throw new Error(`Chip score: timeOf(${e.b}) returned ${t} (track "${tr.name}" event ${i})`);
    if (t < from) return;
    const dur = Math.max(0, timeOf(e.b + e.d) - t), vel = e.vel ** 1.5;
    const ev = { t, dur, midi: e.midi, drum: e.drum, voice: e.vname, vel, gain: vel * tr.gain, track: tr.name, ti, role: tr.role, b: e.b, d: e.d, glide: null };
    if (e.midi == null) delete ev.midi;
    if (!e.drum) delete ev.drum;
    if (e.glide) ev.glide = { midi: e.glide.midi, dur: e.glide.beats == null ? .06 : Math.max(0, timeOf(e.b + e.glide.beats) - t) };
    ev.order = i; byTrack[ti].push(ev); flat.push(ev);
  }));
  const cmp = (a, c) => a.t - c.t || a.ti - c.ti || a.order - c.order;
  flat.sort(cmp); byTrack.forEach(l => l.sort(cmp));
  return { flat, byTrack };
}
function scoreEvents(score, opts = {}) {
  const S = normalizeScore(score), timeOf = opts.timeOf || defaultTimeOf(S, opts.t0 ?? 0);
  return resolveScore(S, timeOf, opts.from ?? -Infinity).flat.map(e => { const { order, ...rest } = e; return rest; });
}
const ducksOf = (S, timeOf) => S.duck.map(k => ({ t: timeOf(k.b), depth: k.depth, rel: k.rel })).sort((a, c) => a.t - c.t);
function scoreDucks(score, opts = {}) { const S = normalizeScore(score); return ducksOf(S, opts.timeOf || defaultTimeOf(S, opts.t0 ?? 0)); }

// ---- voices
const adsrAt = (E, tau) => {                          // relative level (0..1) tau seconds after the note start, before note-off; E.d >= .001
  if (tau <= E.a) return tau / E.a;
  const s = Math.max(E.s, FLOOR);
  return tau >= E.a + E.d ? s : s ** ((tau - E.a) / E.d);
};
function shapeGain(gp, ts, dur, peak, E0) {             // attack (linear), decay (exponential to the sustain), hold, release (exponential) - then exactly 0
  const E = { ...E0, a: Math.max(E0.a, .002), d: Math.max(E0.d, .001) }, a = E.a;
  gp.setValueAtTime(0, ts);
  if (dur <= a) gp.linearRampToValueAtTime(peak * dur / a, ts + dur);
  else {
    gp.linearRampToValueAtTime(peak, ts + a);
    if (E.s < 1) gp.exponentialRampToValueAtTime(peak * adsrAt(E, Math.min(dur, a + E.d)), ts + Math.min(dur, a + E.d));
  }
  const lo = peak * adsrAt(E, dur), r = Math.max(E.r, .004);
  gp.setValueAtTime(lo, ts + dur);
  if (lo > 1e-5) gp.exponentialRampToValueAtTime(Math.max(lo * FLOOR, 1e-6), ts + dur + r);
  gp.setValueAtTime(0, ts + dur + r);
  return ts + dur + r;
}
function vibrato(param, ts, dur, v) {                  // a scheduled sine on detune, fading in over the first cycle: no free-running LFO
  if (!v || !v.depth || !(v.rate > 0)) return;
  const s0 = ts + v.delay, end = ts + dur, step = 1 / (v.rate * 16);
  if (s0 >= end) return;
  param.setValueAtTime(0, s0);
  for (let k = 1; k <= 6000; k++) { const tt = s0 + k * step; if (tt >= end) break; param.linearRampToValueAtTime(v.depth * Math.sin(Math.PI * 2 * k / 16) * Math.min(1, k / 16), tt); }
}
// one note -> { node (output), end }; the source stops by `end`
function scoreNote(ac, ev, tr, rng) {
  const ts = ev.t, dur = Math.max(ev.dur, .01), voice = ev.voice, E = tr.env, g = ac.createGain();
  const peak = ev.vel * VOICE_GAIN[voice], f0 = midiToHz(ev.midi), end = shapeGain(g.gain, ts, dur, peak, E), stop = end + .01;
  const glide = ev.glide && ev.glide.dur > 0 ? ev.glide : null, fg = glide ? midiToHz(glide.midi) : f0, gd = glide ? Math.min(glide.dur, dur) : 0;
  const slide = p => { if (glide) { p.setValueAtTime(fg, ts); p.exponentialRampToValueAtTime(f0, ts + gd); } else p.setValueAtTime(f0, ts); };
  if (voice === 'noise') {                                              // pitched noise: the note is the centre of a band-pass, so higher notes are brighter
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), top = ac.sampleRate * .45;
    s.buffer = noiseBuf(ac); f.type = 'bandpass'; f.Q.value = 1.1;
    const c = x => Math.min(top, x * 2);
    if (glide) { f.frequency.setValueAtTime(c(fg), ts); f.frequency.exponentialRampToValueAtTime(c(f0), ts + gd); } else f.frequency.setValueAtTime(c(f0), ts);
    vibrato(f.detune, ts, dur, tr.vib);
    s.connect(f).connect(g); s.start(ts, rng() * 1.5); s.stop(stop);
  } else if (voice === 'pulse' && Array.isArray(tr.duty)) {              // PWM: a saw minus the same saw delayed by duty/f; the delay sweeps over the note
    const [d0, d1] = tr.duty, a = ac.createOscillator(), b = ac.createOscillator(), inv = ac.createGain(), dl = ac.createDelay(.1), mix = ac.createGain();
    a.type = b.type = 'sawtooth'; slide(a.frequency); slide(b.frequency);
    vibrato(a.detune, ts, dur, tr.vib); vibrato(b.detune, ts, dur, tr.vib);
    inv.gain.value = -1; mix.gain.value = 1 / (2 * Math.max((d0 + d1) / 2, 1 - (d0 + d1) / 2));
    dl.delayTime.setValueAtTime(Math.min(.095, d0 / f0), ts); dl.delayTime.linearRampToValueAtTime(Math.min(.095, d1 / f0), ts + dur);
    a.connect(mix); b.connect(inv).connect(dl).connect(mix); mix.connect(g);
    a.start(ts); b.start(ts); a.stop(stop); b.stop(stop);
  } else {
    const o = ac.createOscillator();
    if (voice === 'pulse') o.setPeriodicWave(waveOf(ac, { type: 'pulse', duty: tr.duty })); else o.type = voice === 'saw' ? 'sawtooth' : voice;
    slide(o.frequency); vibrato(o.detune, ts, dur, tr.vib);
    o.connect(g); o.start(ts); o.stop(stop);
  }
  return { node: g, end: stop };
}

function playScore(ac, t0, out, score, opts = {}) {
  const S = normalizeScore(score), timeOf = opts.timeOf || defaultTimeOf(S, t0);
  const from = opts.from ?? ((ac.currentTime || 0) - 1e-3), { byTrack } = resolveScore(S, timeOf, from);
  const rng = mulberry32(opts.seed ?? 1), plain = [], ducked = []; let end = t0, tail = t0;
  S.tracks.forEach((tr, ti) => {
    const evs = byTrack[ti]; if (!evs.length) return;
    const lanes = makeLanes(ac); let last = t0;
    evs.forEach((ev, i) => {
      if (ev.drum) {
        let choke;
        if (ev.drum === 'ohat') for (let j = i + 1; j < evs.length; j++) if ((evs[j].drum === 'hat' || evs[j].drum === 'ohat') && evs[j].t > ev.t + 1e-6) { choke = evs[j].t - ev.t; break; }
        const hg = ac.createGain(), r = drums[ev.drum](ac, ev.t, hg, { gain: ev.vel, pitch: ev.drum === 'tom' && ev.midi != null ? 2 ** ((ev.midi - 60) / 12) : 1, seed: rng() * 4294967296 >>> 0, choke });
        lanes.add(hg, ev.t, ev.drum === 'ohat' && choke != null ? Math.min(r.end, ev.t + choke + .03) : r.end); last = Math.max(last, r.end);
      } else {
        const n = scoreNote(ac, ev, tr, rng); lanes.add(n.node, ev.t, n.end); last = Math.max(last, n.end);
      }
    });
    end = Math.max(end, last);
    const tg = ac.createGain(); tg.gain.value = tr.gain; lanes.out().connect(tg);
    let node = tg, tl = last;
    if (tr.echo) {                                                    // feedback delay with a low-passed feedback path; dry stays at 1, the repeats are `mix`
      const e = tr.echo, b0 = evs[0].b, dt = Math.max(.005, timeOf(b0 + e.time) - timeOf(b0));
      const del = ac.createDelay(Math.max(1, dt + .1)), fb = ac.createGain(), lp = ac.createBiquadFilter(), wet = ac.createGain(), sum = ac.createGain();
      del.delayTime.value = dt; fb.gain.value = e.fb; lp.type = 'lowpass'; lp.frequency.value = 3200; wet.gain.value = e.mix;
      tg.connect(sum); tg.connect(del); del.connect(wet).connect(sum); del.connect(fb); fb.connect(lp); lp.connect(del);
      node = sum; tl = last + dt * Math.min(12, e.fb > 0 && e.mix > 0 ? Math.ceil(Math.log(.005 / e.mix) / Math.log(e.fb)) : 1) + .05;
    }
    tail = Math.max(tail, tl);
    if (tr.pan && ac.createStereoPanner) { const pn = ac.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, tr.pan)); node.connect(pn); node = pn; }
    (tr.duck ? ducked : plain).push(node);
  });
  if (ducked.length) {                                                  // one gain for the whole ducked group: a 3 ms dip at each event, then a linear recovery over `rel`
    const dg = ac.createGain(), gp = dg.gain, ks = [];
    for (const k of ducksOf(S, timeOf)) {                               // events closer than 4 ms are one dip (the deepest, the longest)
      const p = ks[ks.length - 1];
      if (p && k.t - p.t < .004) { p.depth = Math.max(p.depth, k.depth); p.rel = Math.max(p.rel, k.rel); } else if (k.depth > 0) ks.push({ ...k });
    }
    let dip = null;                                                     // the running dip: from time t (attack done) it recovers from v to 1 over rel
    const lvl = t => !dip ? 1 : t >= dip.t + dip.rel ? 1 : dip.v + (1 - dip.v) * (t - dip.t) / dip.rel;
    const settle = t => { if (dip) { const e = dip.t + dip.rel; gp.linearRampToValueAtTime(t >= e ? 1 : lvl(t), Math.min(t, e)); } };     // finish the recovery, or cut it where the next dip starts
    gp.setValueAtTime(1, 0);
    for (const k of ks) {
      settle(k.t); const cur = lvl(k.t), v = Math.min(cur, 1 - k.depth);
      gp.setValueAtTime(cur, k.t); gp.linearRampToValueAtTime(v, k.t + .003);
      dip = { t: k.t + .003, rel: Math.max(k.rel - .003, 1e-3), v };
    }
    settle(Infinity);
    sumTree(ac, ducked).connect(dg); plain.push(dg);
  }
  const master = ac.createGain(); master.gain.value = opts.gain ?? 1;
  if (plain.length) sumTree(ac, plain).connect(master);
  if (opts.limit === false) master.connect(out);
  else { const pre = ac.createGain(), ws = ac.createWaveShaper(); pre.gain.value = .5; ws.curve = SOFT; master.connect(pre).connect(ws).connect(out); }
  return { end, tail: Math.max(end, tail), length: S.length == null ? end : timeOf(S.length) };
}

const Chip = { parse, play, instrument, sfx, drums, playScore, scoreEvents, scoreDucks, validateScore, midiToHz, noteToMidi, TICKS };
if (typeof window !== 'undefined') window.Chip = Chip;
if (typeof module !== 'undefined' && module.exports) module.exports = Chip;
})();
