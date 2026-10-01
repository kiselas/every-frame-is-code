// Checks the parts of the runtime that need a browser: the WebGL post pass, flip, the dithered transitions, the offline chiptune render and Score rendering (drums, echo, duck).
// Usage: node runtime/test/browser.check.mjs        (needs Chrome and `npm install` in render/; CHROME_PATH if Chrome is not in the default place)
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const { chromium } = await import(pathToFileURL(path.join(root, 'render/node_modules/playwright-core/index.mjs')).href);
const launch = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const browser = await chromium.launch({ ...launch, args: ['--force-color-profile=srgb'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.setContent('<canvas id=c width=640 height=360></canvas>');
for (const f of ['film.js', 'pixel.js', 'pixel-fx.js', 'chip.js', 'compose.js', 'music-lint.js']) await page.addScriptTag({ path: path.join(root, 'runtime', f) });

const res = await page.evaluate(async () => {
  const out = {}, hex = c => '#' + [...c].map(v => v.toString(16).padStart(2, '0')).join('');
  const px = (cv, pts) => pts.map(([x, y]) => [...cv.getContext('2d').getImageData(x, y, 1, 1).data]);
  const mk = (w, h, paint) => { const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); return c; };
  const pts = [[10, 10], [200, 90], [320, 180], [500, 300], [630, 350], [77, 250]];

  // 1. post: only palette colors, deterministic
  const src = mk(640, 360, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#12f'); gr.addColorStop(.5, '#f80'); gr.addColorStop(1, '#fe8'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const pal = Pixel.palette('pico8'), allowed = new Set(pal.hex);
  const q = Pixel.post({ w: 160, h: 90, palette: 'pico8', dither: 'bayer4' });
  const a = mk(640, 360, g => q.apply(src, g)), b = mk(640, 360, g => q.apply(src, g));
  const da = a.getContext('2d').getImageData(0, 0, 640, 360).data, db = b.getContext('2d').getImageData(0, 0, 640, 360).data;
  const seen = new Set(); let same = true;
  for (let i = 0; i < da.length; i += 4) { seen.add(hex(da.subarray(i, i + 3))); if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) same = false; }
  out.postColors = seen.size; out.postOnlyPalette = [...seen].every(c => allowed.has(c)); out.postDeterministic = same;
  const flat = mk(640, 360, g => { g.fillStyle = '#808080'; g.fillRect(0, 0, 640, 360); });
  const q2 = Pixel.post({ w: 160, h: 90, palette: ['#000000', '#ffffff'], dither: 'bayer8', spread: 1 });
  const d2 = mk(640, 360, g => q2.apply(flat, g)).getContext('2d').getImageData(0, 0, 640, 360).data;
  let white = 0; for (let i = 0; i < d2.length; i += 4) white += d2[i] > 128 ? 1 : 0;
  out.midGrayDitherRatio = +(white / (d2.length / 4)).toFixed(2);              // 50% gray through a 2-color Bayer 8 dither: about half white

  // 2. flip: scaled nearest neighbor, palette colors, see-through key
  const scr = Pixel.screen({ w: 4, h: 3, palette: 'pico8' }); scr.cls(8).pset(1, 1, 12);
  const dst = mk(48, 36, () => {}), dg = dst.getContext('2d');
  out.flipScale = scr.flip(dg, {}).scale;
  out.flipRed = hex(px(dst, [[2, 2]])[0].slice(0, 3)) === pal.hex[8];
  const kd = mk(48, 36, () => {}); scr.flip(kd.getContext('2d'), { key: 12 }); out.keyAlpha = px(kd, [[15, 15]])[0][3];

  // 3. transitions: p=0 is A, p=1 is B, the middle is neither; no exceptions
  const A = mk(640, 360, g => { g.fillStyle = '#e33'; g.fillRect(0, 0, 640, 360); }), B = mk(640, 360, g => { g.fillStyle = '#3c3'; g.fillRect(0, 0, 640, 360); });
  out.transitions = {};
  for (const name of Object.keys(Pixel.transitions)) {
    const at = p => { const c = mk(640, 360, () => {}), g = c.getContext('2d'); Pixel.transitions[name](g, A, B, p, {}, null); return px(c, pts); };
    const p0 = at(0), p1 = at(1), pm = at(.5);
    const all = (arr, col) => arr.every(v => Math.abs(v[0] - col[0]) < 6 && Math.abs(v[1] - col[1]) < 6);
    out.transitions[name] = { startsAsA: all(p0, [238, 51, 51]), endsAsB: all(p1, [51, 204, 51]), middleMixed: !all(pm, [238, 51, 51]) || !all(pm, [51, 204, 51]) };
  }

  // 4. chiptune: an offline render is finite, audible and identical twice
  const render = async () => {
    const ac = new OfflineAudioContext(1, 48000 * 3, 48000), o = ac.createGain(); o.connect(ac.destination);
    Chip.play(ac, .1, o, ['T120 @0 O3 L8 [C E G E]4', 'T120 @1 V60 O5 L16 [C E G]8', 'T120 @3 V50 O6 L8 [C R]6']); Chip.sfx.coin(ac, 1.5, o);
    return (await ac.startRendering()).getChannelData(0);
  };
  const r1 = await render(), r2 = await render(); let peak = 0, nan = 0, ident = true;
  r1.forEach((v, i) => { peak = Math.max(peak, Math.abs(v)); if (!Number.isFinite(v)) nan++; if (v !== r2[i]) ident = false; });
  out.chip = { peak: +peak.toFixed(3), nan, identical: ident };

  // 5. generated music end to end: plan -> Compose.generate -> MusicLint -> Chip.playScore offline, finite, audible, identical twice
  const plan = { seed: 5, bpm: 140, key: 'A minor', style: 'drive', sections: [{ name: 'a', bars: 2, energy: .3 }, { name: 'b', bars: 2, energy: .95 }] };
  const sc = Compose.generate(plan), lint = MusicLint.lint(sc);
  const renderGenerated = async () => {
    const ac = new OfflineAudioContext(1, Math.ceil(48000 * (sc.length * 60 / sc.bpm + 2)), 48000), o = ac.createGain(); o.connect(ac.destination);
    Chip.playScore(ac, .1, o, sc); return (await ac.startRendering()).getChannelData(0);
  };
  const g1 = await renderGenerated(), g2 = await renderGenerated(); let gp = 0, gnan = 0, gid = true, grms = 0;
  g1.forEach((v, i) => { gp = Math.max(gp, Math.abs(v)); grms += v * v; if (!Number.isFinite(v)) gnan++; if (v !== g2[i]) gid = false; });
  out.music = { events: sc.tracks.reduce((n, t) => n + t.events.length, 0), lint: lint.score, errors: lint.findings.filter(f => f.severity === 'error').length, peak: +gp.toFixed(3), rms: +Math.sqrt(grms / g1.length).toFixed(3), nan: gnan, identical: gid };

  // 4b. MML drum tones @4..@10: real drums from hand-written MML, still deterministic
  const mmlRender = async () => {
    const ac = new OfflineAudioContext(1, 48000 * 3, 48000), o = ac.createGain(); o.connect(ac.destination);
    Chip.play(ac, .1, o, [{ mml: 'T120 @4 V110 O3 [C4 R8 C8 R4 C4]2', gain: .5 }, { mml: 'T120 @5 V100 O4 [R4 C4]4 @10 C4', gain: .4 }, { mml: 'T120 @6 V80 O4 L16 [C C C C]8 @7 C4 @8 O3 C8 D8 @9 O4 C4', gain: .3 }]);
    return (await ac.startRendering()).getChannelData(0);
  };
  const m1 = await mmlRender(), m2 = await mmlRender(); let mp = 0, mi = true;
  m1.forEach((v, i) => { mp = Math.max(mp, Math.abs(v)); if (v !== m2[i]) mi = false; });
  out.mmlDrums = { peak: +mp.toFixed(3), identical: mi };

  // 5. Score: drums + echo + duck in one score: finite, audible, under 1, bit-identical over three renders
  const score = () => {
    const bass = [], lead = [], arp = [], drums = [], duck = [];
    for (let i = 0; i < 16; i++) bass.push({ b: i / 2, d: .45, n: [33, 33, 45, 33][i % 4], v: i % 2 ? .6 : .9 });
    for (let i = 0; i < 32; i++) arp.push({ b: i / 4, d: .2, n: 69 + [0, 3, 7, 12][i % 4], v: i % 4 ? .5 : .8 });
    lead.push({ b: 0, d: 1.5, n: 76, g: 72 }, { b: 2, d: 1, n: 79 }, { b: 4, d: 3, n: 74, v: 1 });
    for (let b = 0; b < 8; b += 2) { drums.push({ b, voice: 'kick' }, { b: b + 1, voice: 'snare', v: .9 }); duck.push({ b, depth: .6, rel: .2 }); }
    for (let i = 0; i < 16; i++) drums.push({ b: i / 2, voice: i === 15 ? 'ohat' : 'hat', v: i % 2 ? .35 : .6 });
    drums.push({ b: 0, voice: 'crash' }, { b: 7, voice: 'tom', n: 55 }, { b: 7.5, voice: 'tom', n: 50 }, { b: 3.5, voice: 'clap' }, { b: 5.5, voice: 'rim' });
    return { bpm: 120, length: 8, duck, tracks: [
      { name: 'bass', role: 'bass', voice: 'triangle', duck: true, events: bass },
      { name: 'arp', role: 'arp', voice: 'pulse', duty: [.125, .4], pan: -.3, duck: true, events: arp },
      { name: 'lead', role: 'lead', voice: 'square', vib: { delay: .2, rate: 5, depth: 15 }, echo: { time: .75, fb: .4, mix: .35 }, events: lead },
      { name: 'drums', role: 'drums', events: drums },
    ] };
  };
  const renderScore = async (sc, o = {}, secs = 5) => {
    const ac = new OfflineAudioContext(2, Math.ceil(48000 * secs), 48000), g = ac.createGain(); g.connect(ac.destination);
    Chip.playScore(ac, .1, g, sc, o);
    const buf = await ac.startRendering(); return [buf.getChannelData(0), buf.getChannelData(1)];
  };
  const rms = (c, a, b) => { let s = 0; const i0 = Math.floor(a * 48000), i1 = Math.floor(b * 48000); for (let i = i0; i < i1; i++) s += c[i] * c[i]; return Math.sqrt(s / (i1 - i0)); };
  const goertzel = (c, a, b, f) => { const i0 = Math.floor(a * 48000), i1 = Math.floor(b * 48000), w = 2 * Math.PI * f / 48000, k = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (let i = i0; i < i1; i++) { const s = c[i] + k * s1 - s2; s2 = s1; s1 = s; } return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / (i1 - i0); };
  const runs = [await renderScore(score()), await renderScore(score()), await renderScore(score())];
  let sp = 0, sn = 0, sIdent = true;
  runs[0].forEach((ch, k) => ch.forEach((v, i) => { sp = Math.max(sp, Math.abs(v)); if (!Number.isFinite(v)) sn++; if (v !== runs[1][k][i] || v !== runs[2][k][i]) sIdent = false; }));
  out.score = { peak: +sp.toFixed(3), nan: sn, identical: sIdent, rms: +rms(runs[0][0], .1, 4.1).toFixed(3) };
  // a seek: `from` in the middle plays only what is still ahead
  const early = await renderScore(score(), { from: 2.1 });
  out.score.seekSilentBefore = rms(early[0], .1, 1.9) === 0; out.score.seekAudibleAfter = rms(early[0], 2.2, 3.2) > .01;
  // duck: a held tone dips by (1 - depth) at the event and recovers; without `duck: true` it does not
  const tone = duck => ({ bpm: 120, duck: [{ b: 2, depth: .8, rel: .5 }], tracks: [{ voice: 'sine', duck, env: { a: .01, d: 0, s: 1, r: .05 }, events: [{ b: 0, d: 8, n: 57, v: 1 }] }] });
  const [dk, nd] = [await renderScore(tone(true), {}, 4), await renderScore(tone(false), {}, 4)];   // the event is at 1.1 s
  out.duck = { dip: +(rms(dk[0], 1.13, 1.16) / rms(nd[0], 1.13, 1.16)).toFixed(3), recovered: +(rms(dk[0], 2, 2.2) / rms(nd[0], 2, 2.2)).toFixed(3), untouched: +(rms(nd[0], 1.13, 1.16) / rms(nd[0], .5, .8)).toFixed(3) };
  // echo: after a short note the repeats ring at time + k * fb; without echo it is silent
  const ping = echo => ({ bpm: 120, tracks: [{ voice: 'triangle', echo, events: [{ b: 0, d: .25, n: 69 }] }] });
  const [ec, ne] = [await renderScore(ping({ time: 1, fb: .5, mix: .6 }), {}, 4), await renderScore(ping(null), {}, 4)];   // note .1-.225 s; repeats at .6+.. s
  out.echo = { repeat1: +rms(ec[0], .7, .9).toFixed(4), repeat2: +rms(ec[0], 1.2, 1.4).toFixed(4), dry: +rms(ne[0], .7, .9).toFixed(5), rest: +rms(ec[0], .3, .5).toFixed(5) };
  // drums are not noise notes: a kick has its energy low, a hat high, a snare in between with a tone near 200 Hz
  const hit = async name => (await renderScore({ bpm: 120, tracks: [{ role: 'drums', events: [{ b: 0, voice: name }] }] }, {}, 1))[0];
  const [kk, sn2, ht] = [await hit('kick'), await hit('snare'), await hit('hat')];
  const band = (c, a, b) => ({ low: goertzel(c, .1, .3, 60) + goertzel(c, .1, .3, 90), tone: goertzel(c, .1, .2, 200), mid: goertzel(c, .1, .3, 2500) + goertzel(c, .1, .3, 3500), high: goertzel(c, .1, .2, 9000) + goertzel(c, .1, .2, 11000) });
  const bk = band(kk), bs = band(sn2), bh = band(ht);
  out.drums = { kickLowOverHigh: +(bk.low / bk.high).toFixed(1), hatHighOverLow: +(bh.high / bh.low).toFixed(1), snareMidOverKickMid: +(bs.mid / bk.mid).toFixed(1), snareHasBody: +(bs.tone / bs.high).toFixed(2) };
  // 6. vertical film: orientation, a taller bottom margin, wide text shrinks to fit (and says so), vertical transitions, landscape unchanged
  const warns = [], warn0 = console.warn; console.warn = m => warns.push(String(m));
  const mkFilm = (W, H, say) => Film.create({ W, H, canvas: document.createElement('canvas'), shots: [{ id: 'a', bars: 1, say }] });
  const land = mkFilm(1920, 1080, { text: 'HELLO|*WORLD*' });
  const port = mkFilm(1080, 1920, { text: 'AN EXTREMELY LONG STATEMENT LINE THAT CANNOT FIT|*SHORT*', size: 160, caption: 'A CAPTION THAT IS ALSO FAR TOO LONG FOR ONE LINE OF A PHONE SCREEN, REALLY', captionSize: 40, captionAt: 0 });
  window.__draw(1.9);                                     // draws the portrait film's frame, with its statement and caption
  console.warn = warn0;
  out.vertical = {
    landscape: { portrait: land.portrait, u: land.u, sameMargins: land.margin.y === land.margin.yb, bottomZone: land.zone('bl')[1] },
    portrait: { portrait: port.portrait, u: +port.u.toFixed(3), margin: port.margin, bottomZone: port.zone('bl')[1] },
    fitWarnings: warns.length, fitMessage: warns[0] || '', captionWarned: warns.some(w => w.startsWith('caption ')),
  };
  const vt = (name, opts) => { const c = mk(640, 360, () => {}), g = c.getContext('2d'); Film.TRANSITIONS[name](g, A, B, .5, opts, null); return px(c, [[320, 90], [320, 270], [160, 180], [480, 180]]); };
  const redder = (a, b) => (a[0] - a[1]) > (b[0] - b[1]) + 60;        // A is red, B is green; whip blurs, so compare instead of matching a color
  for (const name of ['push', 'whip']) {
    const [top, bottom] = vt(name, { axis: 'y', dir: 1 });
    const [, , left, right] = vt(name, { dir: 1 });
    out.vertical[name] = { yOldAbove: redder(top, bottom), xOldLeft: redder(left, right) };
  }
  return out;
});
await browser.close();

const fails = [];
const need = (ok, what) => { if (!ok) fails.push(what); };
need(res.postOnlyPalette, 'post: every output pixel is a palette color'); need(res.postColors > 4, 'post: uses several palette colors'); need(res.postDeterministic, 'post: same input, same output');
need(res.midGrayDitherRatio > .4 && res.midGrayDitherRatio < .6, `post: 50% gray dithers to about half white (got ${res.midGrayDitherRatio})`);
need(res.flipScale === 12, `flip: 4x3 screen onto 48x36 scales 12x (got ${res.flipScale})`); need(res.flipRed, 'flip: pixel color comes from the palette'); need(res.keyAlpha === 0, 'flip: key index is transparent');
for (const [n, t] of Object.entries(res.transitions)) { need(t.startsAsA, `${n}: p=0 shows the old frame`); need(t.endsAsB, `${n}: p=1 shows the new frame`); need(t.middleMixed, `${n}: p=.5 is a mix`); }
const vv = res.vertical;
need(vv.landscape.portrait === false && vv.landscape.u === 1 && vv.landscape.sameMargins && vv.landscape.bottomZone === 1080 - 108, `vertical: a landscape film keeps equal top and bottom margins (${JSON.stringify(vv.landscape)})`);
need(vv.portrait.portrait === true && vv.portrait.u === 1 && vv.portrait.margin.yb === 422 && vv.portrait.margin.y === 192 && vv.portrait.bottomZone === 1920 - 422, `vertical: a portrait film defaults to 7% / 10% / 22% safe margins (${JSON.stringify(vv.portrait)})`);
need(vv.fitWarnings >= 2 && /widest line/.test(vv.fitMessage) && vv.captionWarned, `vertical: a too-wide statement and a too-long caption each shrink and warn (got ${vv.fitWarnings}: ${vv.fitMessage})`);
for (const n of ['push', 'whip']) need(vv[n].yOldAbove && vv[n].xOldLeft, `${n}: axis y slides vertically, the default slides sideways (${JSON.stringify(vv[n])})`);
need(res.music.events > 100 && res.music.errors === 0 && res.music.lint > 60, `music: the generated score is well formed and lints clean (${JSON.stringify(res.music)})`);
need(res.music.peak > .05 && res.music.peak < 1 && res.music.rms > .01 && res.music.nan === 0 && res.music.identical, `music: the generated score plays audibly, finitely and identically twice (${JSON.stringify(res.music)})`);
need(res.chip.peak > .05 && res.chip.peak < 1 && res.chip.nan === 0 && res.chip.identical, `chip: audible, finite, deterministic (${JSON.stringify(res.chip)})`);
need(res.mmlDrums.peak > .1 && res.mmlDrums.peak < 1 && res.mmlDrums.identical, `chip: MML drum tones are audible and deterministic (${JSON.stringify(res.mmlDrums)})`);
need(res.score.peak > .1 && res.score.peak < 1 && res.score.nan === 0, `score: audible, finite, under 1 (${JSON.stringify(res.score)})`);
need(res.score.identical, 'score: three renders with drums + echo + duck are bit-identical');
need(res.score.seekSilentBefore && res.score.seekAudibleAfter, `score: from skips the events before it (${JSON.stringify(res.score)})`);
need(res.duck.dip > .12 && res.duck.dip < .3 && res.duck.recovered > .95 && res.duck.untouched > .95, `duck: dips to 1 - depth and recovers (${JSON.stringify(res.duck)})`);
need(res.echo.repeat1 > .01 && res.echo.repeat2 > .003 && res.echo.repeat2 < res.echo.repeat1 && res.echo.dry < 1e-4 && res.echo.rest < 1e-4, `echo: repeats ring and decay, silence without it (${JSON.stringify(res.echo)})`);
need(res.drums.kickLowOverHigh > 20 && res.drums.hatHighOverLow > 20 && res.drums.snareMidOverKickMid > 3 && res.drums.snareHasBody > .3, `drums: kick low, hat high, snare noise + body (${JSON.stringify(res.drums)})`);
need(errors.length === 0, 'no page errors: ' + errors.join('; '));
console.log(JSON.stringify(res, null, 1));
if (fails.length) { console.error('\nFAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('\nbrowser checks passed');
