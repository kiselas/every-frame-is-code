// motion-kit chiptune: a Pyxel-style MML player and one-shot sfx presets on the Web Audio API.
// A whole score is a compact text string on a few channels with four tones (triangle, square, pulse, noise):
//   Chip.play(ac, t, out, ['T140 @1 O4 L8 CEGE', 'T140 @0 O2 L4 C G'])
// Classic script, no dependencies, works from file://:  <script src="../../runtime/chip.js"></script>
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
function voice(ac, dest, spec, run, ts, rng) {
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

function schedule(ac, t0, out, prepared, opts) {
  const rng = mulberry32(opts.seed ?? 1), now = ac.currentTime, outs = []; let end = t0;
  for (const { x, p, tones } of prepared) {
    const tg = ac.createGain(); tg.gain.value = x.gain ?? .3;
    if (x.pan && ac.createStereoPanner) { const pn = ac.createStereoPanner(); pn.pan.value = x.pan; tg.connect(pn); outs.push(pn); } else outs.push(tg);
    let run = null;
    const flush = () => { if (run) { const ts = t0 + run[0].t; if (ts >= now - 1e-3) end = Math.max(end, voice(ac, tg, tones[run[0].tone], run, ts, rng)); run = null; } };
    for (const e of p.events) { if (e.tie && run) run.push(e); else { flush(); run = [e]; } }
    flush();
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

const Chip = { parse, play, instrument, sfx, midiToHz, noteToMidi, TICKS };
if (typeof window !== 'undefined') window.Chip = Chip;
if (typeof module !== 'undefined' && module.exports) module.exports = Chip;
})();
