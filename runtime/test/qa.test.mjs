// Unit tests for render/qa-lib.mjs: the pure analysis behind render/qa.mjs, on synthetic data (no browser, no ffmpeg).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../../render/qa-lib.mjs';

// ------------------------------------------------------------------ synthetic frames
// 20x20 gray frames at 10 fps: a 3x3 bright patch on a mid-gray ground. `kind(i)` says what frame i does:
// 'move' puts the patch at x = i mod 16 (it travels), 'still' keeps it at x = 0, 'black' is all zero, 'ground' is a flat frame.
const FW = 20, FH = 20, FPS = 10;
function frame(kind, i) {
  const f = new Uint8Array(FW * FH).fill(kind === 'black' ? 0 : 50);
  if (kind === 'black' || kind === 'ground') return f;
  const x0 = kind === 'move' ? i % 16 : 0;
  for (let y = 5; y < 8; y++) for (let x = x0; x < x0 + 3; x++) f[y * FW + x] = 200;
  return f;
}
const frames = kinds => Buffer.concat(kinds.map((k, i) => Buffer.from(frame(k, i))));
const run = (n, kind) => Array(n).fill(kind);
const series = kinds => Q.analyzeFrames(frames(kinds), FW, FH, FPS);
const film = (extra = {}) => ({ W: 1080, H: 1920, FPS: 30, duration: 50, portrait: true, margin: { x: 76, y: 192, yb: 422 }, shots: [], voice: null, ...extra });
const box = (kind, x0, y0, x1, y1, text = kind) => ({ kind, x0, y0, x1, y1, text });
const at = (t, ...boxes) => ({ t, boxes });
const STEP = 0.25;

test('analyzeFrames: luminance, step difference, difference to frame 0, share of moved pixels', () => {
  const s = series([...run(5, 'still'), ...run(5, 'black')]);
  assert.equal(s.n, 10);
  assert.equal(s.lum[0], (50 * 391 + 200 * 9) / 400);
  assert.equal(s.lum[9], 0);
  assert.equal(s.diff[1], 0);
  assert.ok(s.diff[5] > 40);
  assert.ok(s.d0[5] > 40 && s.d0[2] === 0);
  assert.equal(s.moved[2], 0);
  assert.equal(s.moved[9], 100);              // every pixel went from the ground/patch to black
});

test('findStill: runs of consecutive samples below the threshold, with the time they span', () => {
  const v = [0, 5, 0.01, 0.01, 0.01, 5, 0.01, 5];
  const runs = Q.findStill(v, 10, 0.5, 1);
  assert.deepEqual(runs.map(r => [r.a, r.b]), [[2, 4], [6, 6]]);
  assert.ok(Math.abs(runs[0].t0 - 0.1) < 1e-9 && Math.abs(runs[0].t1 - 0.4) < 1e-9);
  assert.equal(Q.findStill([0, 1, 1, 1], 10, 0.5).length, 0);
});

// ------------------------------------------------------------------ frame 0, dead stretches, frozen, black
test('frame 0: a moving opening passes, a static one fails, no video is skipped', () => {
  assert.equal(Q.checkFrame0(series(run(20, 'move'))).status, 'PASS');
  const still = Q.checkFrame0(series(run(20, 'still')));
  assert.equal(still.status, 'FAIL');
  assert.equal(still.severity, 'fail');
  assert.equal(Q.checkFrame0(null).status, 'SKIP');
});

test('dead stretch: a still middle of 5 s is found; motion all through, and a motionless tail, are not', () => {
  // 12 s: 3 s moving, 5 s still, 2 s moving, 2 s still tail (the last 1.5 s are exempt)
  const s = series([...run(30, 'move'), ...run(50, 'still'), ...run(20, 'move'), ...run(20, 'still')]);
  const c = Q.checkDead(s, film({ shots: [{ id: 'mid', start: 0, end: 12 }] }));
  assert.equal(c.status, 'WARN');
  assert.equal(c.severity, 'warn');
  assert.equal(c.data.stretches.length, 1);
  const d = c.data.stretches[0];
  assert.ok(d.t0 >= 3 && d.t0 <= 3.6 && d.t1 >= 7.8 && d.t1 <= 8.1, JSON.stringify(d));
  assert.match(c.details[0], /\[mid\]/);
  assert.equal(Q.checkDead(series(run(120, 'move')), film()).status, 'PASS');
  // only the tail is still: 2 s still, the last 1.5 s exempt, the rest below the 2 s limit
  assert.equal(Q.checkDead(series([...run(100, 'move'), ...run(20, 'still')]), film()).status, 'PASS');
  // a still stretch of 1.5 s in the middle is below the limit
  assert.equal(Q.checkDead(series([...run(40, 'move'), ...run(20, 'still'), ...run(60, 'move')]), film()).status, 'PASS');
  assert.equal(Q.checkDead(null, film()).status, 'SKIP');
});

test('frozen: identical frames for more than the allowed hold warn; a short hold and a still tail do not', () => {
  const frozen = Q.checkFrozen(series([...run(30, 'move'), ...run(35, 'ground'), ...run(55, 'move')]), film());
  assert.equal(frozen.status, 'WARN');
  assert.equal(frozen.data.runs.length, 1);
  assert.equal(Q.checkFrozen(series([...run(30, 'move'), ...run(12, 'ground'), ...run(78, 'move')]), film()).status, 'PASS');
  assert.equal(Q.checkFrozen(series([...run(100, 'move'), ...run(20, 'ground')]), film()).status, 'PASS');
});

test('black: a black stretch warns outside a transition, is allowed inside one and in the last fraction of a second', () => {
  const kinds = [...run(40, 'move'), ...run(5, 'black'), ...run(75, 'move')];
  const bad = Q.checkBlack(series(kinds), film({ shots: [{ id: 'a', start: 0, end: 12 }] }));
  assert.equal(bad.status, 'WARN');
  assert.deepEqual(bad.data.runs, [{ t0: 4, t1: 4.4 }]);
  const inTransition = film({ shots: [{ id: 'a', start: 0, end: 4.2 }, { id: 'b', start: 4.2, end: 12, tr: { t0: 3.8, t1: 4.8, type: 'dip' } }] });
  assert.equal(Q.checkBlack(series(kinds), inTransition).status, 'PASS');
  assert.equal(Q.checkBlack(series([...run(100, 'move'), ...run(5, 'black')]), film()).status, 'PASS');   // a fade-out on the last 0.5 s
  assert.equal(Q.checkBlack(series(run(120, 'move')), film()).status, 'PASS');
});

// ------------------------------------------------------------------ boxes
test('safe zones (portrait): boxes in the bottom UI zone, the top and the right strip fail; the HUD is exempt in the top and bottom', () => {
  const ok = [at(0, box('say', 76, 400, 900, 700), box('caption', 76, 720, 700, 750), box('hud', 76, 40, 900, 150))];
  assert.equal(Q.checkSafeZones(ok, film(), STEP).status, 'PASS');
  const bottom = [at(1, box('label', 100, 1500, 500, 1650)), at(1.25, box('label', 100, 1500, 500, 1650)), at(1.5, box('label', 100, 1500, 500, 1650))];
  const b = Q.checkSafeZones(bottom, film({ shots: [{ id: 'low', start: 0, end: 5 }] }), STEP);
  assert.equal(b.status, 'FAIL');
  assert.equal(b.data.violations.length, 1);                       // consecutive samples are one violation
  assert.deepEqual([b.data.violations[0].zone, b.data.violations[0].t0, b.data.violations[0].t1], ['bottom', 1, 1.5]);
  assert.match(b.details[0], /\[low\]/);
  const top = Q.checkSafeZones([at(0, box('say', 100, 120, 900, 400))], film(), STEP);       // y0 = 120 < 192
  assert.equal(top.data.violations[0].zone, 'top');
  const right = Q.checkSafeZones([at(0, box('number', 600, 1100, 1000, 1200))], film(), STEP); // x1 = 1000 > 961, in the lower half where the buttons are
  assert.equal(Q.checkSafeZones([at(0, box('say', 76, 400, 1000, 700))], film(), STEP).status, 'PASS', 'a statement in the top half may use the full width');
  assert.equal(right.data.violations[0].zone, 'right');
  const hud = Q.checkSafeZones([at(0, box('hud', 76, 30, 1000, 100), box('hud', 76, 1800, 1000, 1880))], film(), STEP);
  assert.deepEqual(hud.data.violations.map(v => v.zone), ['right']);   // exempt top and bottom, not the side buttons
  assert.equal(Q.checkSafeZones(null, film(), STEP).status, 'SKIP');
});

test('safe zones: a caption padded to the width of its statement is not blamed for the statement\'s overhang', () => {
  const wide = box('say', 76, 1100, 1000, 1300);
  const padded = box('caption', 76, 1320, 1000, 1350);
  const v = Q.findZoneViolations([at(0, wide, padded)], film(), STEP);
  assert.deepEqual(v.map(x => x.kind), ['say']);
  const own = Q.findZoneViolations([at(0, box('say', 76, 1100, 800, 1300), box('caption', 76, 1320, 1000, 1350))], film(), STEP);
  assert.deepEqual(own.map(x => x.kind), ['caption']);
});

test('safe zones (landscape): the film\'s own margins are used, not the portrait numbers', () => {
  const land = film({ W: 1920, H: 1080, portrait: false, margin: { x: 125, y: 108, yb: 108 } });
  assert.equal(Q.safeZones(land).basis, 'film');
  assert.equal(Q.checkSafeZones([at(0, box('say', 130, 200, 900, 400))], land, STEP).status, 'PASS');
  assert.equal(Q.checkSafeZones([at(0, box('say', 60, 200, 900, 400))], land, STEP).status, 'FAIL');
  assert.equal(Q.checkSafeZones([at(0, box('say', 130, 200, 1900, 400))], land, STEP).status, 'FAIL');
  // 1000 px down is 92% of the height: inside the portrait bottom zone (22%) would not apply here, the margin says 108 px
  assert.equal(Q.checkSafeZones([at(0, box('say', 130, 900, 900, 960))], land, STEP).status, 'PASS');
  assert.equal(Q.safeZones(film()).basis, 'portrait');
  assert.match(Q.checkSafeZones([], land, STEP).summary, /film's own margins/);
});

test('overlap: boxes of different kinds above 8% of the smaller fail; same kind, small, and in-transition overlaps do not', () => {
  const a = box('say', 100, 400, 900, 700), b = box('stamp', 500, 600, 1000, 900, 'stamp');
  assert.ok(Q.overlapRatio(a, b) > 0.08);
  const bad = Q.checkOverlap([at(1, a, b), at(1.25, a, b)], film(), STEP);
  assert.equal(bad.status, 'FAIL');
  assert.equal(bad.data.overlaps.length, 1);
  assert.equal(bad.data.overlaps[0].t1, 1.25);
  assert.equal(Q.checkOverlap([at(1, a, box('say', 500, 600, 1000, 900, 'other'))], film(), STEP).status, 'PASS');          // same kind
  assert.equal(Q.checkOverlap([at(1, a, box('label', 100, 690, 900, 1000))], film(), STEP).status, 'PASS');                 // 10 px of 310: 3%
  assert.equal(Q.checkOverlap([at(1, a, box('label', 100, 700, 900, 1000))], film(), STEP).status, 'PASS');                 // touching
  const tr = film({ shots: [{ id: 'a', start: 0, end: 1 }, { id: 'b', start: 1, end: 4, tr: { t0: 0.5, t1: 1.5, type: 'push' } }] });
  assert.equal(Q.checkOverlap([at(1, a, b)], tr, STEP).status, 'PASS');
  assert.equal(Q.checkOverlap(null, film(), STEP).status, 'SKIP');
});

test('hook: a say or subtitle box by 2 s passes; later, never, or only a caption fails', () => {
  assert.equal(Q.checkHook([at(0, box('hud', 0, 0, 10, 10)), at(1.5, box('say', 0, 0, 10, 10, 'WHY?'))], film()).status, 'PASS');
  assert.equal(Q.checkHook([at(2, box('subtitle', 0, 0, 10, 10, 'why'))], film()).status, 'PASS');
  const late = Q.checkHook([at(0), at(2.25, box('say', 0, 0, 10, 10, 'WHY?'))], film());
  assert.equal(late.status, 'FAIL');
  assert.equal(late.severity, 'fail');
  assert.equal(Q.checkHook([at(0, box('caption', 0, 0, 10, 10, 'src')), at(1, box('caption', 0, 0, 10, 10, 'src'))], film()).status, 'FAIL');
  assert.equal(Q.checkHook([], film()).status, 'FAIL');
  assert.equal(Q.checkHook([], film(), { genre: 'loop' }).status, 'INFO');
});

// ------------------------------------------------------------------ text
const says = (...texts) => film({ shots: texts.map((text, i) => ({ id: 's' + i, start: i * 5, end: i * 5 + 5, says: [{ text, caption: null }] })) });

test('words, lines and groupTimes', () => {
  assert.equal(Q.countWords('1952. ПЕРВЫЙ|В СТРАНЕ КУРС|*ПРОГРАММИРОВАНИЯ*'), 6);
  assert.equal(Q.countWords('a — b · c'), 3);
  assert.equal(Q.countWords(null), 0);
  assert.deepEqual(Q.statementLines('ONE *TWO*|THREE'), ['ONE TWO', 'THREE']);
  assert.deepEqual(Q.groupTimes([1, 1.25, 1.5, 3, 3.25], 0.25).map(r => [r.t0, r.t1]), [[1, 1.5], [3, 3.25]]);
});

test('statement: nine words, a long line and a short stay warn; a good statement passes', () => {
  assert.equal(Q.checkStatements(says('ONE TWO THREE|FOUR FIVE|SIX SEVEN *EIGHT*'), null, STEP).status, 'PASS');          // 8 words
  const nine = Q.checkStatements(says('ONE TWO THREE|FOUR FIVE SIX|SEVEN EIGHT *NINE*'), null, STEP);
  assert.equal(nine.status, 'WARN');
  assert.match(nine.details[0], /9 words/);
  const long = Q.checkStatements(says('A LINE OF EXACTLY 17|*SHORT*'), null, STEP);   // 'A LINE OF EXACTLY 17' is 20 characters
  assert.equal(long.status, 'WARN');
  assert.match(long.details[0], /longest line 20/);
  assert.equal(Q.checkStatements(says('SIXTEEN CHARS OK|*FINE*'), null, STEP).status, 'PASS');
  // shown for 0.75 s only (3 samples of 0.25 s)
  const f = says('QUICK *FLASH*');
  const short = Q.checkStatements(f, [at(1, box('say', 0, 0, 1, 1, 'QUICK *FLASH*')), at(1.25, box('say', 0, 0, 1, 1, 'QUICK *FLASH*')), at(1.5, box('say', 0, 0, 1, 1, 'QUICK *FLASH*'))], STEP);
  assert.equal(short.status, 'WARN');
  assert.match(short.details[0], /0\.75 s/);
  const ok = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3].map(t => at(t, box('say', 0, 0, 1, 1, 'QUICK *FLASH*')));
  assert.equal(Q.checkStatements(f, ok, STEP).status, 'PASS');
  // a landscape film is not graded on the words and the line, only on the reading time
  assert.equal(Q.checkStatements({ ...says('ONE TWO THREE|FOUR FIVE SIX|SEVEN EIGHT *NINE*'), portrait: false }, null, STEP).status, 'PASS');
});

test('word budget: 40 words in a 3 s film fail the 2.5 words per second, 107 words in 50 s pass, the voice alone has its own limit', () => {
  const words = n => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const dense = Q.checkBudget(film({ duration: 3, shots: [{ id: 'a', start: 0, end: 3, says: [{ text: words(30), caption: words(10) }] }] }));
  assert.equal(dense.status, 'WARN');
  assert.equal(dense.data.total, 40);
  assert.ok(dense.data.rate > 13);
  assert.equal(Q.checkBudget(film({ shots: [{ id: 'a', start: 0, end: 50, says: [{ text: words(60), caption: words(47) }] }] })).status, 'PASS');
  const voice = n => ({ words: Array.from({ length: n }, (_, i) => ({ word: 'w', start: i, end: i + 0.3 })) });
  const v = Q.checkBudget(film({ duration: 50, voice: voice(115) }));          // 2.3 words/s alone, under 2.5 in total
  assert.equal(v.status, 'WARN');
  assert.match(v.details[0], /voice alone/);
  assert.equal(Q.checkBudget(film({ duration: 50, voice: voice(100) })).status, 'PASS');
  assert.equal(Q.wordBudget(film({ duration: 10, shots: [{ id: 'a', start: 0, end: 10, says: [{ text: 'A B|*C*', caption: 'D E' }] }], voice: voice(5) })).total, 10);
});

test('voice pace: a phrase over 2.6 words per second warns, short phrases are not judged', () => {
  const w = (word, start, end, punct = '') => ({ word, start, end, punct });
  const fast = [w('a', 0, 0.2), w('b', 0.25, 0.45), w('c', 0.5, 0.7), w('d', 0.75, 0.95), w('e', 1, 1.2), w('f', 1.25, 1.5, '.')];   // 6 words in 1.5 s = 4/s
  const slow = [w('g', 3, 3.5), w('h', 3.6, 4.1), w('i', 4.2, 4.7), w('j', 4.8, 5.3, '.')];                                        // 4 words in 2.3 s
  const two = [w('k', 6, 6.2), w('l', 6.25, 6.5, '.')];                                                                            // 8 words/s but only 2 words
  const ph = Q.voicePhrases([...fast, ...slow, ...two]);
  assert.deepEqual(ph.map(p => p.n), [6, 4, 2]);
  const c = Q.checkPace(film({ voice: { words: [...fast, ...slow, ...two] } }));
  assert.equal(c.status, 'WARN');
  assert.equal(c.details.length, 1);
  assert.equal(Q.checkPace(film({ voice: { words: slow } })).status, 'PASS');
  assert.equal(Q.checkPace(film()).status, 'SKIP');
  // the timing's own phrases take precedence over punctuation
  assert.deepEqual(Q.voicePhrases([...fast, ...slow], [{ start: 0, end: 5.4 }]).map(p => p.n), [10]);
  // a pause longer than 0.7 s ends a phrase even without a full stop
  assert.equal(Q.voicePhrases([w('a', 0, 1), w('b', 2, 3)]).length, 2);
});

// ------------------------------------------------------------------ audio, logs, small checks
test('loudness: -14 +/- 1.5 LUFS passes, outside fails, a hot true peak warns, missing input is skipped', () => {
  assert.equal(Q.checkLoudness({ I: -14.2, TP: -1.7 }, true).status, 'PASS');
  assert.equal(Q.checkLoudness({ I: -15.5, TP: -3 }, true).status, 'PASS');
  const quiet = Q.checkLoudness({ I: -18, TP: -4 }, true);
  assert.equal(quiet.status, 'FAIL');
  assert.equal(quiet.severity, 'fail');
  assert.equal(Q.checkLoudness({ I: -9, TP: -0.2 }, true).status, 'FAIL');
  assert.equal(Q.checkLoudness({ I: -14, TP: -0.5 }, true).status, 'WARN');
  assert.equal(Q.checkLoudness({ I: -Infinity, TP: -Infinity }, true).status, 'FAIL');
  assert.equal(Q.checkLoudness(null, false).status, 'SKIP');
  assert.equal(Q.checkLoudness(null, true, false).status, 'INFO');
});

test('fit: shrink warnings and errors fail, other warnings warn, a clean page passes', () => {
  assert.equal(Q.checkFit([]).status, 'PASS');
  const fit = Q.checkFit([{ type: 'warning', text: 'statement "X": widest line 990 px > 936 px available, size 94 -> 88' }]);
  assert.equal(fit.status, 'FAIL');
  assert.match(fit.details[0], /did not fit/);
  assert.equal(Q.checkFit([{ type: 'pageerror', text: 'boom' }]).status, 'FAIL');
  assert.equal(Q.checkFit([{ type: 'error', text: 'x' }]).status, 'FAIL');
  assert.equal(Q.checkFit([{ type: 'warning', text: 'voice-over not played' }]).status, 'WARN');
});

test('format, transitions, spec, poster', () => {
  assert.equal(Q.checkFormat(film()).status, 'PASS');
  assert.equal(Q.checkFormat(film({ W: 540, H: 960 })).status, 'INFO');
  assert.equal(Q.checkFormat(film({ W: 1920, H: 1080, portrait: false, margin: { x: 125, y: 108, yb: 108 } })).status, 'INFO');
  const t = Q.checkTransitions(film({ shots: [{ id: 'a', in: null }, { id: 'b', in: 'push' }, { id: 'c', in: 'push' }, { id: 'd', in: 'dip' }, { id: 'e', in: 'flash' }] }));
  assert.equal(t.data.ok, true);
  assert.equal(Q.checkTransitions(film({ shots: [{ id: 'a' }, { id: 'b', in: 'push' }] })).data.ok, false);
  assert.equal(Q.checkSpec(null, film()).status, 'SKIP');
  const spec = Q.checkSpec({ shots: [{ id: 'a', claim: 'identity' }, { id: 'b' }], facts: [{ id: 'f1', source: 'https://x' }, { id: 'f2' }] }, film({ shots: [{ id: 'a', says: [{ text: 'IN 1954', caption: null }] }] }));
  assert.equal(spec.data.allClaims, false);
  assert.match(spec.details.join('\n'), /without a claim type: b/);
  assert.match(spec.details.join('\n'), /without a source: f2/);
  assert.match(spec.details.join('\n'), /1954/);
  assert.equal(Q.checkPoster([{ name: 'poster/a.png', t: 1 }]).status, 'INFO');
});

// ------------------------------------------------------------------ the report
test('report: a summary table of every check with its status, the details with timecodes, the checklist of chapters 19-21', () => {
  const checks = [
    Q.checkFrame0(series(run(20, 'still'))),
    Q.checkSafeZones([at(1, box('label', 100, 1500, 500, 1650))], film({ shots: [{ id: 'low', start: 0, end: 5 }] }), STEP),
    Q.checkBudget(film()), Q.checkHook([at(0, box('say', 0, 0, 1, 1, 'Q'))], film()),
    Q.checkLoudness(null, false), Q.checkTransitions(film({ shots: [] })),
  ];
  const r = Q.buildReport({ film: film(), input: 'film.html', checks, files: { poster: 'poster' } });
  assert.match(r.md, /\| frame0 \| FAIL \|/);
  assert.match(r.md, /\| safe \| FAIL \|/);
  assert.match(r.md, /\| budget \| PASS \|/);
  assert.match(r.md, /\| loudness \| SKIP \|/);
  assert.match(r.md, /\| transitions \| INFO \|/);
  assert.match(r.md, /1\.00-1\.00 s \[low\]: label/);                      // details with the timecode and the shot
  assert.match(r.md, /Result: FAIL\*\* \(2 fail/);
  assert.match(r.md, /- \[x\] Nothing important.*|- \[ \] \*\*FAILED\*\* Nothing important in the top 10%/);
  assert.match(r.md, /\*\*FAILED\*\* Nothing important in the top 10%/);
  assert.match(r.md, /\*\*FAILED\*\* Frame 0 moves/);
  assert.match(r.md, /\*\*needs a human\*\* No picture is a list of labels in shapes \(the label test\)/);
  assert.match(r.md, /\*\*needs a human\*\* Each number has a yardstick/);
  assert.match(r.md, /\*\*needs a human\*\* Every number and date has a source/);
  assert.match(r.md, /\*\*not checked\*\* No held shot/);                    // dead and frozen were not given
  assert.match(r.md, /- \[x\] Word count at most 2\.5/.test(r.md) ? /./ : /Word count at most 2\.5/);
  assert.equal(r.json.checks.find(c => c.id === 'safe').status, 'FAIL');
  assert.equal(r.json.checks.find(c => c.id === 'safe').details.length, 1);
  assert.deepEqual(Object.keys(r.json.checks.find(c => c.id === 'budget')).sort(), ['data', 'details', 'id', 'rule', 'severity', 'status', 'summary']);
  assert.equal(r.json.checklist.length, 3);
  assert.equal(r.verdict.exitCode, 1);
});

test('report: the label test, the yardstick and the facts are always "needs a human", even when every check passes', () => {
  const checks = [Q.checkHook([at(0, box('say', 0, 0, 1, 1, 'Q'))], film()), Q.checkSafeZones([], film(), STEP), Q.checkFit([]), Q.checkFormat(film()), Q.checkBudget(film()), Q.checkStatements(film(), null, STEP)];
  const r = Q.buildReport({ film: film(), input: 'f.html', checks });
  const items = r.json.checklist.flatMap(c => c.items);
  const state = text => items.find(i => i.text.includes(text)).state;
  assert.equal(state('the label test'), 'human');
  assert.equal(state('Each number has a yardstick'), 'human');
  assert.equal(state('Every number and date has a source'), 'human');
  assert.equal(state('Nothing important in the top 10%'), 'ticked');
  assert.equal(state('Word count at most 2.5'), 'ticked');
  assert.equal(state('no fit warnings'), 'ticked');
  assert.match(r.md, /- \[x\] Nothing important in the top 10%/);
  assert.equal(r.verdict.result, 'PASS');
  assert.equal(r.verdict.exitCode, 0);
});

test('verdict: any FAIL is exit 1; a WARN is exit 1 only with --strict', () => {
  const pass = { status: 'PASS' }, warn = { status: 'WARN' }, fail = { status: 'FAIL' }, info = { status: 'INFO' }, skip = { status: 'SKIP' };
  assert.deepEqual(Q.verdict([pass, info, skip]), { fail: 0, warn: 0, result: 'PASS', exitCode: 0 });
  assert.equal(Q.verdict([pass, warn]).exitCode, 0);
  assert.equal(Q.verdict([pass, warn], true).exitCode, 1);
  assert.equal(Q.verdict([warn, fail]).result, 'FAIL');
  assert.equal(Q.verdict([fail]).exitCode, 1);
});
