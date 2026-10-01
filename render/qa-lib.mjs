// The pure part of render/qa.mjs: analysis of a vertical social video against the rules of chapters 19-21.
// No browser, no ffmpeg, no file system: every function takes plain data and returns plain data, so each is unit-tested
// (runtime/test/qa.test.mjs). qa.mjs collects the data (a sweep of window.__draw, frames from ffmpeg, loudness) and calls these.
//
// A check is { id, rule, severity, status, summary, details[] }
//   severity  what a violation costs: 'fail' | 'warn' | 'info'      (the contract in 23-short-factory.md)
//   status    the outcome: 'PASS' | 'WARN' | 'FAIL' | 'INFO' | 'SKIP'   (SKIP: the input for it was not given, e.g. no --video)
//
// Data shapes
//   film     { W, H, FPS, duration, portrait, margin: { x, y, yb }, shots: [{ id, start, end, chapter, in, tr: { t0, t1, type } | null,
//            says: [{ text, caption }] }], voice: { words: [{ word, start, end, punct }] } | null, phrases?: [{ start, end }] }
//   samples  [{ t, boxes: [{ kind, x0, y0, x1, y1, text }] }]    boxes recorded by the page at each swept time (runtime/film.js f.boxes)
//   series   what analyzeFrames returns (grayscale frames sampled at series.fps)

export const LIMITS = {
  // frame 0 must move: mean |gray difference| between frame 0 and the frame 0.3 s later. A static title card with film grain scores
  // about 0.1 on the 108 px-wide analysis frames, a stamp growing out of the screen about 8; 1.0 is clearly above the grain.
  frame0Lag: 0.3, frame0Min: 1.0,
  hookBy: 2.0,                      // a say / subtitle box must be on screen by this time (chapter 20, rule 1)
  // dead stretch: "moved" is the share (%) of pixels that differ by at least `motionPix` gray levels from the frame `motionLag` earlier; below
  // `motionMin` the picture is "still". Why not the mean absolute difference: it is dominated by the film grain (0.15-0.28 on a static scene) and
  // blind to thin moving lines (a map drifting under a held statement scored 0.07). The share of changed pixels ignores the grain
  // (static scenes: under 0.02%) and sees any drift or tick (a slow push-in: 1-6%, a map drifting slowly: 0.4-0.5%, a lone counter: well over 0.1%).
  // The half-second lag lets a drift of a pixel or two per second accumulate above the threshold.
  motionLag: 0.5, motionPix: 6, motionMin: 0.1,
  deadMax: 2.0,                     // a still stretch longer than this is a dead stretch
  tailExempt: 1.5,                  // the last seconds hold the end state on purpose (chapter 21: hold at least 1.5 s)
  // frozen: identical frames (mean difference under frozenEps). Film grain makes real footage never exactly identical, but a film without grain
  // holds the end state of a picture bit for bit, and chapter 21 asks for that hold (1.5 s, better 2): so only a run beyond the allowed hold is a freeze.
  frozenEps: 0.03, frozenMin: 2.0,
  // black: mean luminance (0-255) below blackLum, outside a transition (blackMargin seconds of slack around its window). The last blackTail seconds
  // are exempt: a fade to black on the final frames is how a film ends, black before that is a gap.
  blackLum: 4, blackMargin: 0.1, blackTail: 0.6,
  // safe zones as fractions of the frame (chapter 19): the platform's own interface covers the top, the bottom and the right side
  zones: { top: 0.10, bottom: 0.22, right: 0.11, left: 0.07 }, zoneTol: 2,
  overlap: 0.08,                    // intersection over the smaller box
  stmtWords: 8, stmtLine: 16, stmtShown: 2.0,
  budget: 2.5, budgetVoice: 2.2, pace: 2.6, paceMinWords: 3,   // words per second
  lufs: -14, lufsTol: 1.5, truePeak: -1.0,
};

const SAFE_KINDS = new Set(['say', 'caption', 'subtitle', 'label', 'number', 'stamp', 'name', 'hud']);
const TEXT_KINDS = ['say', 'subtitle'];
const mk = (id, rule, severity, status, summary, details = [], data) => ({ id, rule, severity, status, summary, details, ...(data ? { data } : {}) });
const skip = (id, rule, severity, why) => mk(id, rule, severity, 'SKIP', `skipped: ${why}`);
export const fmtT = t => `${t.toFixed(2)} s`;
const range = (a, b) => `${a.toFixed(2)}-${b.toFixed(2)} s`;
const f1 = x => Number.isFinite(x) ? x.toFixed(1) : String(x);
const pct = x => `${Math.round(x * 100)}%`;
export function shotAt(shots, t) { const s = (shots || []).find(s => t >= s.start - 1e-6 && t < s.end - 1e-6) || (shots || [])[(shots || []).length - 1]; return s ? s.id : null; }
const inShot = (film, t) => { const id = shotAt(film.shots, t); return id ? ` [${id}]` : ''; };

// ------------------------------------------------------------------ frames

// buf: grayscale frames, w*h bytes each, back to back, sampled at `fps`. For each frame: mean luminance (0-255) and the mean absolute
// difference (gray levels) to the previous frame (`diff`) and to frame 0 (`d0`), and `moved`: the percentage of pixels that differ by at least
// `pix` gray levels from the frame `lag` samples earlier.
export function analyzeFrames(buf, w, h, fps, lag = Math.max(1, Math.round(LIMITS.motionLag * fps)), pix = LIMITS.motionPix) {
  const size = w * h, n = Math.floor(buf.length / size);
  const lum = new Float64Array(n), diff = new Float64Array(n), moved = new Float64Array(n), d0 = new Float64Array(n);
  const mad = (a, b) => { let s = 0; for (let k = 0; k < size; k++) { const d = buf[a + k] - buf[b + k]; s += d < 0 ? -d : d; } return s / size; };
  for (let i = 0; i < n; i++) {
    const o = i * size; let s = 0;
    for (let k = 0; k < size; k++) s += buf[o + k];
    lum[i] = s / size;
    if (i) {
      diff[i] = mad(o, o - size); d0[i] = mad(o, 0);
      const p = Math.max(0, i - lag) * size; let c = 0;
      for (let k = 0; k < size; k++) { const d = buf[o + k] - buf[p + k]; if (d >= pix || d <= -pix) c++; }
      moved[i] = 100 * c / size;
    }
  }
  return { fps, n, w, h, lag, duration: n / fps, lum, diff, moved, d0 };
}

// maximal runs of consecutive samples (from index 1) whose value is below eps. `span` is how many samples back each value looks
// (1 for a step difference, `lag` for `moved`), so a run a..b is still over [(a - span) / fps, b / fps].
export function findStill(values, fps, eps, span = 1) {
  const runs = []; let a = -1;
  for (let i = 1; i <= values.length; i++) {
    const still = i < values.length && values[i] < eps;
    if (still && a < 0) a = i;
    if (!still && a >= 0) { runs.push({ a, b: i - 1, t0: Math.max(0, (a - span) / fps), t1: (i - 1) / fps }); a = -1; }
  }
  return runs;
}

export function checkFrame0(series, opts = {}) {
  const id = 'frame0', rule = 'frame 0 moves: the frame 0.3 s later differs from it', sev = 'fail';
  if (!series) return skip(id, rule, sev, 'no --video');
  const { frame0Lag: lag, frame0Min: min } = { ...LIMITS, ...opts };
  const k = Math.min(series.n - 1, Math.round(lag * series.fps));
  const d = series.d0[k];
  const ok = d >= min;
  return mk(id, rule, sev, ok ? 'PASS' : 'FAIL', `mean difference frame 0 -> ${fmtT(k / series.fps)} is ${d.toFixed(2)} (minimum ${min})`,
    ok ? [] : ['the opening does not move: no title card held, no fade from black; start the first shot already in motion (chapter 19, "Frame 0 must move")'], { diff: +d.toFixed(3) });
}

export function checkDead(series, film, opts = {}) {
  const id = 'dead', rule = `no stretch of more than ${LIMITS.deadMax} s without motion (the last ${LIMITS.tailExempt} s excluded)`, sev = 'warn';
  if (!series) return skip(id, rule, sev, 'no --video');
  const L = { ...LIMITS, ...opts }, end = series.duration - L.tailExempt;
  const still = findStill(series.moved, series.fps, L.motionMin, series.lag).map(r => ({ t0: r.t0, t1: Math.min(r.t1, end) })).filter(r => r.t1 > r.t0);
  const dead = still.filter(r => r.t1 - r.t0 > L.deadMax);
  const longest = still.reduce((m, r) => !m || r.t1 - r.t0 > m.t1 - m.t0 ? r : m, null);
  const near = longest ? `longest still stretch ${range(longest.t0, longest.t1)}${inShot(film, (longest.t0 + longest.t1) / 2)}, ${fmtT(longest.t1 - longest.t0)}` : 'no still stretch at all';
  return mk(id, rule, sev, dead.length ? 'WARN' : 'PASS',
    dead.length ? `${dead.length} dead stretch(es), the longest ${fmtT(Math.max(...dead.map(r => r.t1 - r.t0)))}` : `no still stretch over ${L.deadMax} s (${near})`,
    dead.map(r => `${range(r.t0, r.t1)}${inShot(film, (r.t0 + r.t1) / 2)}: ${fmtT(r.t1 - r.t0)} of almost no change (under ${L.motionMin}% of pixels changing in ${L.motionLag} s); add a push-in or a live element (chapter 19, "No dead stretch")`),
    { stretches: dead.map(r => ({ t0: +r.t0.toFixed(2), t1: +r.t1.toFixed(2) })), longestStill: longest ? +(longest.t1 - longest.t0).toFixed(2) : 0 });
}

export function checkFrozen(series, film, opts = {}) {
  const id = 'frozen', rule = `no run of identical frames longer than ${LIMITS.frozenMin} s (the end-state hold of chapter 21 is allowed)`, sev = 'warn';
  if (!series) return skip(id, rule, sev, 'no --video');
  const L = { ...LIMITS, ...opts }, end = series.duration - L.tailExempt;
  const runs = findStill(series.diff, series.fps, L.frozenEps, 1).map(r => ({ t0: r.t0, t1: Math.min(r.t1, end) })).filter(r => r.t1 - r.t0 >= L.frozenMin - 1e-6);
  return mk(id, rule, sev, runs.length ? 'WARN' : 'PASS', runs.length ? `${runs.length} frozen run(s)` : 'no frozen run',
    runs.map(r => `${range(r.t0, r.t1)}${inShot(film, (r.t0 + r.t1) / 2)}: the picture does not change at all for ${fmtT(r.t1 - r.t0)} (a stuck render, or a missing grain)`),
    { runs: runs.map(r => ({ t0: +r.t0.toFixed(2), t1: +r.t1.toFixed(2) })) });
}

// transitions: the film's own windows [t0, t1]; a dip through black is allowed to be dark there
export function checkBlack(series, film, opts = {}) {
  const id = 'black', rule = `no black frame (mean luminance < ${LIMITS.blackLum}) outside a transition (a fade-out on the last ${LIMITS.blackTail} s is allowed)`, sev = 'warn';
  if (!series) return skip(id, rule, sev, 'no --video');
  const L = { ...LIMITS, ...opts };
  const wins = (film.shots || []).filter(s => s.tr).map(s => [s.tr.t0 - L.blackMargin, s.tr.t1 + L.blackMargin]);
  const dark = [];
  for (let i = 0; i < series.n; i++) {
    const t = i / series.fps;
    if (series.lum[i] < L.blackLum && t < series.duration - L.blackTail && !wins.some(([a, b]) => t >= a && t <= b)) dark.push(t);
  }
  const runs = groupTimes(dark, 1 / series.fps);
  return mk(id, rule, sev, runs.length ? 'WARN' : 'PASS', runs.length ? `${runs.length} black stretch(es)` : 'no black frame outside a transition',
    runs.map(r => `${range(r.t0, r.t1 + 1 / series.fps)}${inShot(film, r.t0)}: black (no fade from black, no black gap between shots)`),
    { runs: runs.map(r => ({ t0: +r.t0.toFixed(2), t1: +r.t1.toFixed(2) })) });
}

// ascending times sampled `dt` apart -> [{ t0, t1 }] of consecutive ones
export function groupTimes(times, dt, gap = 1.5) {
  const out = [];
  for (const t of times) {
    const l = out[out.length - 1];
    if (l && t - l.t1 <= dt * gap + 1e-9) l.t1 = t; else out.push({ t0: t, t1: t });
  }
  return out;
}

// ------------------------------------------------------------------ boxes

// The zone the text must stay out of, in pixels. Portrait: the fixed fractions of chapter 19. Any other frame (landscape films have
// no platform UI): the film's own safe margins (f.margin), so the numbers are not applied where they were never meant to hold.
export function safeZones(film) {
  const { W, H, margin } = film;
  if (film.portrait) {
    const z = LIMITS.zones;
    return { basis: 'portrait', top: H * z.top, bottom: H * z.bottom, left: W * z.left, right: W * z.right };
  }
  return { basis: 'film', top: margin.y, bottom: margin.yb, left: margin.x, right: margin.x };
}

export function findZoneViolations(samples, film, step) {
  const Z = safeZones(film), { W, H } = film, tol = LIMITS.zoneTol, hits = new Map();
  for (const s of samples) for (const b of s.boxes) {
    if (!SAFE_KINDS.has(b.kind) || !(b.x1 > b.x0) || !(b.y1 > b.y0)) continue;
    // runtime/film.js makes a caption's box as wide as its statement (max of the two right edges), so a short caption under a wide
    // statement would be reported for the statement's overhang. Such a right edge is the statement's own and is reported there.
    const padded = b.kind === 'caption' && s.boxes.some(o => o.kind === 'say' && o.x1 === b.x1);
    const zones = [];
    // the HUD is decorative and lives near the edges on purpose: exempt in the top and the bottom, still kept off the side buttons
    if (b.kind !== 'hud' && b.y0 < Z.top - tol) zones.push(['top', Z.top - b.y0]);
    if (b.kind !== 'hud' && b.y1 > H - Z.bottom + tol) zones.push(['bottom', b.y1 - (H - Z.bottom)]);
    // the button column of Reels, Shorts and TikTok sits in the lower half of the frame: a statement at the top may use the full width
    if (!padded && b.x1 > W - Z.right + tol && (Z.basis !== 'portrait' || b.y1 > H * 0.5)) zones.push(['right', b.x1 - (W - Z.right)]);
    if (b.x0 < Z.left - tol) zones.push(['left', Z.left - b.x0]);
    for (const [zone, px] of zones) {
      const key = `${b.kind}\u0001${b.text}\u0001${zone}`;
      let h = hits.get(key);
      if (!h) hits.set(key, h = { kind: b.kind, text: b.text, zone, times: [], px: 0 });
      h.times.push(s.t); h.px = Math.max(h.px, px);
    }
  }
  const out = [];
  for (const h of hits.values()) for (const r of groupTimes(h.times, step)) out.push({ kind: h.kind, text: h.text, zone: h.zone, px: Math.round(h.px), t0: r.t0, t1: r.t1 });
  return out.sort((a, b) => a.t0 - b.t0);
}

export function checkSafeZones(samples, film, step) {
  const Z = film && safeZones(film), id = 'safe';
  const rule = `no text in the top ${pct(LIMITS.zones.top)}, the bottom ${pct(LIMITS.zones.bottom)} or the right ${pct(LIMITS.zones.right)} of the lower half of the frame (the button column; HUD exempt in the top and bottom)`, sev = 'fail';
  if (!samples) return skip(id, rule, sev, 'the page has no window.__film');
  const v = findZoneViolations(samples, film, step);
  const basis = Z.basis === 'portrait' ? 'portrait rules of chapter 19' : `the film's own margins (landscape: x ${Math.round(Z.left)} px, top ${Math.round(Z.top)} px, bottom ${Math.round(Z.bottom)} px)`;
  const label = t => String(t).length > 50 ? String(t).slice(0, 47) + '...' : t;
  return mk(id, rule, sev, v.length ? 'FAIL' : 'PASS', v.length ? `${v.length} box(es) enter a safe zone (basis: ${basis})` : `all boxes inside the safe zones (basis: ${basis})`,
    v.map(x => `${range(x.t0, x.t1)}${inShot(film, x.t0)}: ${x.kind} "${label(x.text)}" is ${x.px} px into the ${x.zone} zone`),
    { basis: Z.basis, zones: { top: Math.round(Z.top), bottom: Math.round(Z.bottom), left: Math.round(Z.left), right: Math.round(Z.right) }, violations: v.map(x => ({ ...x, t0: +x.t0.toFixed(2), t1: +x.t1.toFixed(2) })) });
}

const area = b => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
export function overlapRatio(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (!(w > 0) || !(h > 0)) return 0;
  const m = Math.min(area(a), area(b));
  return m > 0 ? w * h / m : 0;
}

// samples inside a transition window are skipped: both shots are drawn, and the page records their boxes where they would sit
// without the transition's own movement, so two statements that never meet on screen would look as if they overlap
export function findOverlaps(samples, film, step, min = LIMITS.overlap) {
  const wins = (film.shots || []).filter(s => s.tr).map(s => [s.tr.t0, s.tr.t1]), hits = new Map();
  for (const s of samples) {
    if (wins.some(([a, b]) => s.t >= a && s.t <= b)) continue;
    const bs = s.boxes.filter(b => area(b) > 0);
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const A = bs[i], B = bs[j];
      if (A.kind === B.kind) continue;
      const r = overlapRatio(A, B);
      if (r <= min) continue;
      const [p, q] = (A.kind + A.text) <= (B.kind + B.text) ? [A, B] : [B, A], key = `${p.kind}\u0001${p.text}\u0001${q.kind}\u0001${q.text}`;
      let h = hits.get(key);
      if (!h) hits.set(key, h = { a: p, b: q, times: [], ratio: 0 });
      h.times.push(s.t); h.ratio = Math.max(h.ratio, r);
    }
  }
  const out = [];
  for (const h of hits.values()) for (const r of groupTimes(h.times, step)) out.push({ a: { kind: h.a.kind, text: h.a.text }, b: { kind: h.b.kind, text: h.b.text }, ratio: h.ratio, t0: r.t0, t1: r.t1 });
  return out.sort((a, b) => a.t0 - b.t0);
}

export function checkOverlap(samples, film, step) {
  const id = 'overlap', rule = `two boxes of different kinds overlap by more than ${pct(LIMITS.overlap)} of the smaller (transitions excluded)`, sev = 'fail';
  if (!samples) return skip(id, rule, sev, 'the page has no window.__film');
  const v = findOverlaps(samples, film, step);
  const label = t => String(t).length > 34 ? String(t).slice(0, 31) + '...' : t;
  return mk(id, rule, sev, v.length ? 'FAIL' : 'PASS', v.length ? `${v.length} overlap(s)` : 'no overlapping boxes',
    v.map(x => `${range(x.t0, x.t1)}${inShot(film, x.t0)}: ${x.a.kind} "${label(x.a.text)}" and ${x.b.kind} "${label(x.b.text)}" overlap ${pct(x.ratio)} of the smaller`),
    { overlaps: v.map(x => ({ ...x, ratio: +x.ratio.toFixed(3), t0: +x.t0.toFixed(2), t1: +x.t1.toFixed(2) })) });
}

export function checkHook(samples, film, opts = {}) {
  const id = 'hook', rule = `a say or subtitle box is on screen by ${LIMITS.hookBy} s`, sev = 'fail';
  if (opts.genre === 'loop') return mk(id, rule, 'info', 'INFO', 'loop genre: no text by design, rule not applied');
  if (!samples) return skip(id, rule, sev, 'the page has no window.__film');
  const first = samples.find(s => s.boxes.some(b => TEXT_KINDS.includes(b.kind) && b.text));
  const t = first ? first.t : null, ok = t !== null && t <= LIMITS.hookBy + 1e-6;
  const b = first && first.boxes.find(b => TEXT_KINDS.includes(b.kind) && b.text);
  return mk(id, rule, sev, ok ? 'PASS' : 'FAIL',
    first ? `first ${b.kind} "${clip(String(b.text).replace(/[*]/g, ''))}" at ${fmtT(t)}` : 'no statement or subtitle in the whole film',
    ok ? [] : ['the viewer decides within two seconds: the question must be in words by then (chapter 20, rule 1)'], { firstAt: t });
}

// ------------------------------------------------------------------ text

export const countWords = text => String(text ?? '').replace(/[*|]/g, ' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
export const statementLines = text => String(text ?? '').split(/\||\n/).map(l => l.replace(/\*/g, '').trim()).filter(Boolean);
const clip = (s, n = 40) => { s = String(s).replace(/\|/g, ' / '); return s.length > n ? s.slice(0, n - 3) + '...' : s; };

// How long each statement stays on screen: contiguous runs of samples that contain its say box. The step is added to the span
// (a box seen in two samples 0.25 s apart was on screen for about 0.5 s).
export function statementDurations(samples, step) {
  const times = new Map();
  for (const s of samples) for (const b of s.boxes) if (b.kind === 'say') { if (!times.has(b.text)) times.set(b.text, new Set()); times.get(b.text).add(s.t); }
  const out = [];
  for (const [text, set] of times) for (const r of groupTimes([...set].sort((a, b) => a - b), step)) out.push({ text, t0: r.t0, t1: r.t1, dur: r.t1 - r.t0 + step });
  return out.sort((a, b) => a.t0 - b.t0);
}

export function checkStatements(film, samples, step) {
  const id = 'statement', rule = `a statement has at most ${LIMITS.stmtWords} words, a line at most ${LIMITS.stmtLine} characters, and stays on screen at least ${LIMITS.stmtShown} s`, sev = 'warn';
  const says = (film.shots || []).flatMap(s => (s.says || []).map(x => ({ shot: s.id, text: x.text })));
  if (!says.length) return mk(id, rule, sev, 'PASS', 'the film has no statements', []);
  // the word and line limits are those of a vertical silent short (1080 px wide, a phone at arm's length); a landscape film is measured by
  // its own margins elsewhere and here only by the reading time, the limits being listed as information
  const graded = film.portrait, d = [], info = [];
  for (const x of says) {
    const words = countWords(x.text), longest = Math.max(0, ...statementLines(x.text).map(l => [...l].length));
    if (words > LIMITS.stmtWords) (graded ? d : info).push(`[${x.shot}] "${clip(x.text)}": ${words} words (at most ${LIMITS.stmtWords})`);
    if (longest > LIMITS.stmtLine) (graded ? d : info).push(`[${x.shot}] "${clip(x.text)}": longest line ${longest} characters (at most ${LIMITS.stmtLine})`);
  }
  let shown = 'not measured (no box data)';
  if (samples) {
    const durs = statementDurations(samples, step), short = durs.filter(x => x.dur < LIMITS.stmtShown - 1e-6);
    for (const x of short) d.push(`${range(x.t0, x.t1)}${inShot(film, x.t0)}: "${clip(x.text)}" is on screen for ${fmtT(x.dur)} (at least ${LIMITS.stmtShown} s to read)`);
    const m = durs.length ? Math.min(...durs.map(x => x.dur)) : null;
    shown = m === null ? 'none seen' : `shortest ${fmtT(m)}`;
  }
  const maxW = Math.max(...says.map(x => countWords(x.text)));
  const maxL = Math.max(...says.map(x => Math.max(0, ...statementLines(x.text).map(l => [...l].length))));
  if (info.length) d.push(`not graded (landscape film; the limits are for vertical shorts): ${info.length} statement(s) over the word or line limit`, ...info.map(t => '  ' + t));
  const bad = d.length - (info.length ? info.length + 1 : 0);
  return mk(id, rule, sev, bad > 0 ? 'WARN' : 'PASS', bad > 0 ? `${bad} finding(s)` : `${says.length} statements, up to ${maxW} words, longest line ${maxL} characters, ${shown}${info.length ? ' (word and line limits not graded: landscape)' : ''}`, d,
    { statements: says.length, maxWords: maxW, maxLine: maxL, graded });
}

export function wordBudget(film) {
  let statements = 0, captions = 0;
  for (const s of film.shots || []) for (const x of s.says || []) { statements += countWords(x.text); captions += countWords(x.caption); }
  const voice = film.voice ? (film.voice.words || []).length : 0, D = film.duration;
  return { statements, captions, voice, total: statements + captions + voice, duration: D, rate: (statements + captions + voice) / D, voiceRate: voice / D };
}

export function checkBudget(film) {
  const id = 'budget', rule = `statements + captions + voice at most ${LIMITS.budget} words per second of film, the voice alone at most ${LIMITS.budgetVoice}`, sev = 'warn';
  const b = wordBudget(film), d = [];
  if (b.rate > LIMITS.budget) d.push(`${b.total} words in ${fmtT(b.duration)} = ${b.rate.toFixed(2)} words/s (at most ${LIMITS.budget}, i.e. ${Math.floor(LIMITS.budget * b.duration)} words): cut words before cutting pictures`);
  if (b.voice && b.voiceRate > LIMITS.budgetVoice) d.push(`the voice alone: ${b.voice} words = ${b.voiceRate.toFixed(2)} words/s (at most ${LIMITS.budgetVoice})`);
  return mk(id, rule, sev, d.length ? 'WARN' : 'PASS',
    `${b.statements} statement + ${b.captions} caption + ${b.voice} voice = ${b.total} words in ${fmtT(b.duration)} = ${b.rate.toFixed(2)} words/s${b.voice ? `, voice alone ${b.voiceRate.toFixed(2)}` : ''}`, d,
    { ...b, rate: +b.rate.toFixed(3), voiceRate: +b.voiceRate.toFixed(3) });
}

// Phrases of the voice-over as { start, end, n, text }. With the timing's own phrases ({ start, end }) a word belongs to the phrase
// that contains its middle; without them a phrase ends at sentence punctuation or at a pause longer than 0.7 s.
export function voicePhrases(words, phrases) {
  if (!words || !words.length) return [];
  const out = [];
  if (phrases && phrases.length) {
    for (const p of phrases) {
      const ws = words.filter(w => (w.start + w.end) / 2 >= p.start - 1e-3 && (w.start + w.end) / 2 <= p.end + 1e-3);
      if (ws.length) out.push({ start: ws[0].start, end: ws[ws.length - 1].end, n: ws.length, text: ws.map(w => w.word + (w.punct || '')).join(' ') });
    }
    return out;
  }
  let cur = [];
  const flush = () => { if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, n: cur.length, text: cur.map(w => w.word + (w.punct || '')).join(' ') }); cur = []; };
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (/[.!?…]/.test(w.punct || '') || (next && next.start - w.end > 0.7)) flush();
  });
  flush();
  return out;
}

export function checkPace(film) {
  const id = 'pace', rule = `no voice phrase faster than ${LIMITS.pace} words per second`, sev = 'warn';
  if (!film.voice || !(film.voice.words || []).length) return skip(id, rule, sev, 'the film has no voice-over');
  const ph = voicePhrases(film.voice.words, film.phrases).filter(p => p.n >= LIMITS.paceMinWords && p.end > p.start);   // two words in half a second say nothing about a pace
  const fast = ph.filter(p => p.n / (p.end - p.start) > LIMITS.pace);
  const top = Math.max(0, ...ph.map(p => p.n / (p.end - p.start)));
  return mk(id, rule, sev, fast.length ? 'WARN' : 'PASS', fast.length ? `${fast.length} phrase(s) too fast` : `${ph.length} phrases, fastest ${top.toFixed(2)} words/s`,
    fast.map(p => `${range(p.start, p.end)}${inShot(film, p.start)}: ${p.n} words = ${(p.n / (p.end - p.start)).toFixed(2)} words/s "${clip(p.text, 60)}"`), { phrases: ph.length, fastest: +top.toFixed(3) });
}

// ------------------------------------------------------------------ page logs, loudness, format

export function checkFit(logs) {
  const id = 'fit', rule = 'the page logged no "had to shrink" warning and no error', sev = 'fail';
  const fit = [], err = [], other = [];
  for (const l of logs) {
    if (l.type === 'error' || l.type === 'pageerror') err.push(l.text);
    else if (/available|shrink|size \d+ -> \d+/i.test(l.text)) fit.push(l.text);
    else other.push(l.text);
  }
  const d = [...err.map(t => `error: ${t}`), ...fit.map(t => `did not fit: ${t}`), ...other.map(t => `warning: ${t}`)];
  const status = err.length || fit.length ? 'FAIL' : other.length ? 'WARN' : 'PASS';
  return mk(id, rule, sev, status, d.length ? `${fit.length} fit warning(s), ${err.length} error(s), ${other.length} other warning(s)` : 'nothing logged', d);
}

// m: { I (LUFS), TP (dBTP), LRA } from ffmpeg ebur128, or null when the file has no audio / was not measured
export function checkLoudness(m, hasVideo, hasAudio = true) {
  const id = 'loudness', rule = `integrated ${LIMITS.lufs} +/- ${LIMITS.lufsTol} LUFS, true peak not above ${LIMITS.truePeak} dBTP`, sev = 'fail';
  if (!hasVideo) return skip(id, rule, sev, 'no --video');
  if (!hasAudio) return mk(id, rule, 'info', 'INFO', 'the video has no audio track (fine for a silent loop; otherwise render with the music)');
  if (!m) return skip(id, rule, sev, 'loudness was not measured');
  const d = []; let status = 'PASS';
  if (!Number.isFinite(m.I) || Math.abs(m.I - LIMITS.lufs) > LIMITS.lufsTol) { status = 'FAIL'; d.push(`integrated ${f1(m.I)} LUFS is outside ${LIMITS.lufs} +/- ${LIMITS.lufsTol}: render with --loudnorm`); }
  if (m.TP > LIMITS.truePeak) { if (status === 'PASS') status = 'WARN'; d.push(`true peak ${f1(m.TP)} dBTP is above ${LIMITS.truePeak}: lower the limiter ceiling`); }
  return mk(id, rule, sev, status, `integrated ${f1(m.I)} LUFS, true peak ${f1(m.TP)} dBTP${m.LRA !== undefined ? `, range ${f1(m.LRA)} LU` : ''}`, d, { ...m });
}

export function checkFormat(film) {
  const id = 'format', rule = 'the frame is 1080x1920 at 30 fps (the safe-zone numbers are for portrait)', sev = 'info';
  const { W, H, FPS } = film, d = [];
  if (!film.portrait) d.push(`the frame is ${W}x${H}, landscape: the safe zones use the film's own margins (x ${film.margin.x} px, top ${film.margin.y} px, bottom ${film.margin.yb} px) and the portrait rules of chapter 19 are not applied`);
  else if (W !== 1080 || H !== 1920 || FPS !== 30) d.push(`portrait, but ${W}x${H} at ${FPS} fps (the platforms' format is 1080x1920 at 30)`);
  return mk(id, rule, sev, film.portrait && !d.length ? 'PASS' : 'INFO', `${W}x${H}, ${FPS} fps, ${film.portrait ? 'portrait' : 'landscape'}`, d);
}

export function checkTransitions(film) {
  const id = 'transitions', rule = '3-5 transition types, each with one meaning', sev = 'info';
  const types = new Map();
  for (const s of film.shots || []) if (s.in && s.in !== 'cut') types.set(s.in, (types.get(s.in) || 0) + 1);
  const list = [...types].map(([t, n]) => `${t} x${n}`).join(', ') || 'none (all cuts)';
  const ok = types.size >= 3 && types.size <= 5;
  return mk(id, rule, sev, 'INFO', `${types.size} type(s): ${list}`, ok ? [] : [`${types.size} types: the rule asks for 3-5, each with one meaning`], { types: Object.fromEntries(types), ok });
}

// spec: the factory's spec.json (optional). Lists what only a human can verify against it.
export function checkSpec(spec, film) {
  const id = 'spec', rule = 'every shot has a claim type; every fact has a source (the facts themselves are for a human)', sev = 'info';
  if (!spec) return skip(id, rule, sev, 'no --spec');
  const shots = spec.shots || [], noClaim = shots.filter(s => !s.claim).map(s => s.id);
  const facts = spec.facts || [], noSrc = facts.filter(f => !f.source && !f.url).map(f => f.id);
  const nums = [];
  for (const s of film.shots || []) for (const x of s.says || []) for (const [k, t] of [['say', x.text], ['caption', x.caption]]) {
    const m = String(t ?? '').match(/\d[\d\s.,]*/g); if (m) nums.push(`[${s.id}] ${k} "${clip(String(t))}": ${m.map(z => z.trim()).join(', ')}`);
  }
  const d = [];
  if (noClaim.length) d.push(`shots without a claim type: ${noClaim.join(', ')}`);
  if (noSrc.length) d.push(`facts without a source: ${noSrc.join(', ')}`);
  d.push(`${facts.length} fact(s) declared; numbers on screen to check against them:`, ...nums.map(n => '  ' + n));
  return mk(id, rule, sev, 'INFO', `${shots.length} shots (${noClaim.length} without a claim), ${facts.length} facts (${noSrc.length} without a source)`, d, { allClaims: shots.length > 0 && !noClaim.length, allSources: !noSrc.length });
}

export function checkPoster(files) {
  return mk('poster', 'the poster test: frames at fixed fractions and the cover candidate, looked at by a human or the agent', 'info',
    files.length ? 'INFO' : 'SKIP', files.length ? `${files.length} frame(s) in poster/` : 'skipped: no poster frames', files.map(f => `${f.name}  (t = ${fmtT(f.t)}${f.note ? ', ' + f.note : ''})`));
}

// ------------------------------------------------------------------ checklist of chapters 19-21

// `checks`: ids whose result decides the line; `human`: why a machine cannot tick it. A line with both is ticked only when the checks pass
// and still says what is left for a human.
export const CHECKLIST = [
  { chapter: '19 Vertical video (19-vertical.md)', items: [
    { text: '1080x1920, 30 fps; the longest line fits the room at the film\'s one statement size, no fit warnings', checks: ['format', 'fit'] },
    { text: 'Nothing important in the top 10% or the bottom 22%; the HUD is decorative', checks: ['safe'] },
    { text: 'Frame 0 moves; the question is asked in 2-3 s', checks: ['frame0', 'hook'] },
    { text: 'No held shot without a push-in or something alive; the stamp, token or counter keeps going', checks: ['dead', 'frozen'] },
    { text: 'Every non-Latin character is in `fonts` + `fontText`, and the font really has the subset', human: 'a missing subset falls back silently; look at the stills (poster/) for a default-looking face' },
    { text: 'Every number and date has a source; no unverified portrait, no invented quote', human: 'check the numbers on screen against the sources (see the spec check for the list)' },
    { text: 'The ending calls back to the first frame; the last line reframes the thesis', human: 'compare the last frame of sheet.png with the first' },
    { text: '`--loudnorm`, true peak under -1 dBTP', checks: ['loudness'] },
    { text: 'The contact sheet reviewed', human: 'look at sheet.png: text over the platform UI, two things stamped on top of each other' },
  ] },
  { chapter: '20 Silent social video (20-silent-social.md)', items: [
    { text: 'The sound is off for the first review and the film still makes complete sense', human: 'watch it once muted' },
    { text: 'Frame 0 moves; the question is on screen by 2 s', checks: ['frame0', 'hook'] },
    { text: 'Word count at most 2.5 times the seconds; no statement over 8 words; none shorter than 2 s on screen', checks: ['budget', 'statement'] },
    { text: 'Each payoff word lands with the picture\'s decisive move, on a beat', human: 'watch the shot with the statement and the picture together' },
    { text: 'Each number has a yardstick in the frame and a source in the caption', human: 'the yardstick is a picture question, not measurable here' },
    { text: 'No picture is a list of labels in shapes (the label test)', human: 'cover the drawing and read the labels as a list' },
    { text: 'Three random paused frames pass the poster test', human: 'look at poster/ (15%, 50%, 85% and the cover candidate): statement + picture + context, readable at 540 px' },
    { text: 'Transitions: 3-5 types, each with one meaning, used consistently', checks: ['transitions'], tick: c => c.data && c.data.ok, human: 'the meaning of each type is a human call' },
    { text: 'The ending returns to the first frame and resolves in the last 2 s', human: 'compare the first and the last frame' },
    { text: 'The genre is named in SCRIPT.md, and its requirement card was checked against the shot table', human: 'not in the page' },
  ] },
  { chapter: '21 Infographics (21-infographics.md)', items: [
    { text: 'Every shot has a claim type, or is marked typographic', checks: ['spec'], tick: c => c.data && c.data.allClaims, human: 'pass --spec to check it' },
    { text: 'Every picture passes the label test', human: 'the label test' },
    { text: 'Encodings are position, length or counts; no pies, donuts, areas, 3D', human: 'look at the pictures' },
    { text: 'Every number has a yardstick in the frame, drawn first, in the same encoding and scale', human: 'the yardstick' },
    { text: 'Only the datum moves; the chrome is still; the end state holds for at least 1.5 s', human: 'the dead-stretch check only sees that something moves, not what' },
    { text: 'Labels touch marks; no legend; one accent color, on the datum and the payoff word', human: 'look at the stills' },
    { text: 'Units on screen, sources in the caption, at most three significant digits', human: 'read the captions' },
    { text: 'Bars from zero; one scale per sequence; timelines placed by date', human: 'the facts' },
    { text: 'Within the density limits for a phone; split the shot otherwise', human: 'count marks and labels per picture' },
    { text: 'A "X replaced Y" claim shows Y and X together', human: 'the facts' },
  ] },
];

// -> [{ chapter, items: [{ text, state: 'ticked'|'failed'|'human'|'skipped', note }] }]
export function evalChecklist(checks, list = CHECKLIST) {
  const by = Object.fromEntries(checks.map(c => [c.id, c]));
  return list.map(ch => ({
    chapter: ch.chapter,
    items: ch.items.map(it => {
      if (!it.checks) return { text: it.text, state: 'human', note: it.human };
      const cs = it.checks.map(id => by[id]).filter(Boolean);
      const bad = cs.filter(c => c.status === 'FAIL' || c.status === 'WARN');
      if (bad.length) return { text: it.text, state: 'failed', note: bad.map(c => `${c.id}: ${c.summary}`).join('; ') };
      const skipped = cs.filter(c => c.status === 'SKIP');
      if (!cs.length || skipped.length) return it.human
        ? { text: it.text, state: 'human', note: it.human }
        : { text: it.text, state: 'skipped', note: skipped.map(c => `${c.id}: ${c.summary}`).join('; ') };
      if (it.tick && !cs.every(it.tick)) return { text: it.text, state: 'human', note: it.human };
      return { text: it.text, state: 'ticked', note: it.human };
    }),
  }));
}

// ------------------------------------------------------------------ the report

// result: FAIL when any check failed, WARN when any warned, else PASS; exit code 1 for FAIL (and for WARN with strict)
export function verdict(checks, strict = false) {
  const fail = checks.filter(c => c.status === 'FAIL').length, warn = checks.filter(c => c.status === 'WARN').length;
  return { fail, warn, result: fail ? 'FAIL' : warn ? 'WARN' : 'PASS', exitCode: fail || (strict && warn) ? 1 : 0 };
}

const ORDER = ['frame0', 'hook', 'dead', 'safe', 'overlap', 'fit', 'statement', 'budget', 'pace', 'loudness', 'black', 'frozen', 'poster', 'format', 'transitions', 'spec'];
export const sortChecks = checks => [...checks].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
const MARK = { ticked: '[x]', failed: '[ ]', human: '[ ]', skipped: '[ ]' };
const TAG = { ticked: '', failed: '**FAILED** ', human: '**needs a human** ', skipped: '**not checked** ' };

export function summaryLine(c) { return `${c.status.padEnd(4)}  ${c.id.padEnd(11)} ${c.summary}`; }

export function buildReport({ film, input, files = {}, checks, strict = false, notes = [], maxDetails = 14 }) {
  checks = sortChecks(checks);
  const v = verdict(checks, strict), checklist = evalChecklist(checks);
  const L = [];
  L.push(`# QA report: ${input}`, '');
  L.push(`- Frame: ${film.W}x${film.H}, ${film.FPS} fps, ${fmtT(film.duration)}, ${film.portrait ? 'portrait' : 'landscape'}, ${(film.shots || []).length} shots`);
  L.push(`- Safe zones: ${film.portrait ? 'the portrait rules of chapter 19 (top 10%, bottom 22%, right 11%, left 7%)' : `the film's own margins (landscape; the portrait numbers do not apply): x ${film.margin.x} px, top ${film.margin.y} px, bottom ${film.margin.yb} px`}`);
  L.push(`- Inputs: ${[files.video ? `video \`${files.video}\`` : 'no video (video checks skipped)', files.spec ? `spec \`${files.spec}\`` : 'no spec', film.voice ? `voice-over (${film.voice.words.length} words)` : 'no voice-over'].join(', ')}`);
  for (const n of notes) L.push(`- ${n}`);
  L.push('', `**Result: ${v.result}** (${v.fail} fail, ${v.warn} warn${strict ? ', strict: warnings fail' : ''})`, '');
  L.push('## Summary', '', '| Check | Status | Result |', '|---|---|---|');
  for (const c of checks) L.push(`| ${c.id} | ${c.status} | ${c.summary.replace(/\|/g, '\\|')} |`);
  L.push('', '## Details', '');
  for (const c of checks) {
    L.push(`### ${c.id}: ${c.status}`, '', `Rule: ${c.rule} (severity: ${c.severity})`, '', c.summary, '');
    if (c.details.length) {
      for (const d of c.details.slice(0, maxDetails)) L.push(`- ${d}`);
      if (c.details.length > maxDetails) L.push(`- ... and ${c.details.length - maxDetails} more (see report.json)`);
      L.push('');
    }
  }
  L.push('## Checklist of chapters 19-21', '');
  for (const ch of checklist) {
    L.push(`### ${ch.chapter}`, '');
    for (const it of ch.items) L.push(`- ${MARK[it.state]} ${TAG[it.state]}${it.text}${it.note ? ` — ${it.note}` : ''}`);
    L.push('');
  }
  if (files.sheet || files.poster) L.push('## Files', '', ...(files.sheet ? [`- \`${files.sheet}\`: the contact sheet`] : []), ...(files.poster ? [`- \`${files.poster}/\`: poster frames`] : []), '');
  const json = {
    input, result: v.result, fail: v.fail, warn: v.warn, strict, exitCode: v.exitCode,
    film: { W: film.W, H: film.H, FPS: film.FPS, duration: film.duration, portrait: film.portrait, margin: film.margin, shots: (film.shots || []).length, voice: !!film.voice },
    files, notes,
    checks: checks.map(c => ({ id: c.id, rule: c.rule, severity: c.severity, status: c.status, summary: c.summary, details: c.details, ...(c.data ? { data: c.data } : {}) })),
    checklist,
  };
  return { md: L.join('\n'), json, verdict: v };
}
