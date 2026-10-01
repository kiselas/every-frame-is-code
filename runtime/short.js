// Short.create(spec, voice): builds a whole film from a spec (23-short-factory.md) and the voice-over's timings.
// Classic script. Needs film.js and timing.js; blocks.js for pictures; chip.js and compose.js for music.
(function (global) {
const { Film, Timing } = global;
const { clamp, lerp, ease, alpha } = Film.util;

// ---------------------------------------------------------------- theme presets (every drawing takes its colors from these tokens)
const PRESETS = {
  paper: { bg: '#e9e1cd', ink: '#17150f', muted: '#756d5b', accent: '#b3261e', card: '#f7f2e4', ok: '#1d6b4b', hud: '#17150f', texture: 'paper', grain: .07, vignette: .3 },
  blueprint: { bg: '#1b4a8a', ink: '#eaf1fb', muted: '#93b3dd', accent: '#ff8a50', card: '#1b4a8a', ok: '#7be0a6', hud: '#eaf1fb', texture: 'grid', grain: .05, vignette: .35 },
};

// transitions: the names of the spec -> Film transitions (the window is `beats` long, centered on the cut)
function transition(spec, themeOf, shot, prevTheme) {
  const a = shot.in; if (!a || a === 'cut') return undefined;
  const o = typeof a === 'string' ? { type: a } : { ...a };
  const t = o.type;
  if (t === 'push-up') return { ...o, type: 'push', axis: 'y', dir: 1, beats: o.beats ?? 1 };
  if (t === 'push-down') return { ...o, type: 'push', axis: 'y', dir: -1, beats: o.beats ?? 1 };
  if (t === 'dip') return { ...o, color: o.color || themeOf(shot.theme || prevTheme).bg, beats: o.beats ?? 1.5 };
  return { ...o, beats: o.beats ?? 1 };
}

// all strings of the spec and the voice, for the font loader (every character drawn must be in the loaded font file)
function allText(o, out = []) {
  if (typeof o === 'string') out.push(o); else if (Array.isArray(o)) o.forEach(x => allText(x, out)); else if (o && typeof o === 'object') Object.values(o).forEach(x => allText(x, out));
  return out;
}

function create(spec, voice) {
  const T = Timing.resolve(spec, voice);
  const fmt = { W: 1080, H: 1920, FPS: 30, ...(spec.format || {}) }, style = spec.style || {};
  const display = style.display || 'Oswald', mono = style.mono || 'IBM Plex Mono';
  const themes = {};
  for (const t of [].concat(style.themes || ['paper'])) {
    if (typeof t === 'string') { if (!PRESETS[t]) throw new Error(`unknown theme preset "${t}" (${Object.keys(PRESETS).join(', ')}), or give the tokens`); themes[t] = PRESETS[t]; }
    else Object.assign(themes, Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { ...PRESETS.paper, ...v }])));
  }
  const themeOf = n => themes[n] || themes[Object.keys(themes)[0]];
  const size = style.statementSize || Math.round(fmt.W * .087);
  const beat = T.beat;

  // ---------------------------------------------------------------- statements: spaced so that the payoff word lands on its anchor
  function sayOf(i, say) {
    const sh = T.shots[i], loc = a => T.anchor(i, a);
    const first = sh.words ? T.words[sh.words[0]].start - sh.start : 0.1;
    const start = say.start !== undefined ? loc(say.start) : first;
    const parsed = Film.parseSay(say.text);
    let per = say.per ?? .35;
    if (say.payoff !== undefined) {
      let iP = -1; for (const ln of parsed.lines) for (const w of ln) if (iP < 0 && w.run === 0) iP = w.i;
      if (iP >= 0) per = clamp((loc(say.payoff) - start) / beat / (iP + 1), .1, .7);          // payoff beat = start + (iP + 1) * per, with gap = per
    }
    const o = { text: say.text, weight: 700, size, captionSize: Math.round(fmt.W * .022), start: start / beat, per, ...(say.at ? { at: say.at } : {}), ...(say.accentScale !== undefined ? { accentScale: say.accentScale } : {}) };
    if (say.caption) { o.caption = say.caption; if (say.captionAt !== undefined) o.captionAt = loc(say.captionAt) / beat; }
    if (say.out !== undefined) o.out = loc(say.out) / beat;
    return o;
  }

  // ---------------------------------------------------------------- pictures: layers of blocks, anchors resolved to local seconds once
  function pictureOf(i, pic) {
    if (!pic) return undefined;
    const layers = (Array.isArray(pic) ? pic : [pic]).map(p => T.resolveDeep(i, p));
    return (ctx, s, f) => {
      if (!global.Blocks) throw new Error('blocks.js is not loaded');
      for (const p of layers) global.Blocks.draw(ctx, s, f, p, p.area ? areaOf(p.area, f) : f.band);
    };
  }
  // area: 'band' (default) | [x, y, w, h] in pixels | { frac: [x, y, w, h] } as fractions of the band | { x, y, w, h }
  const areaOf = (a, f) => {
    if (Array.isArray(a)) return { x: a[0], y: a[1], w: a[2], h: a[3] };
    if (a && a.frac) { const b = f.band, [x, y, w, h] = a.frac; return { x: b.x + b.w * x, y: b.y + b.h * y, w: b.w * w, h: b.h * h }; }
    return a === 'band' || !a ? f.band : a;
  };

  // ---------------------------------------------------------------- HUD: a value on a rail (a year), or a bare counter
  const hudCfg = spec.hud || { kind: 'none' };
  function hud(ctx, h, f) {
    if (hudCfg.kind === 'none') return;
    const Tk = h.T, a = h.alpha, mx = f.margin.x, x1 = f.W - mx, v = h.val(hudCfg.key), num = typeof v === 'number' ? Math.round(v) : v;
    const put = (str, x, y, sz, wt, color, align = 'left', track = .04) => {
      ctx.save(); ctx.font = Film.font(sz, f.type.mono, wt); ctx.letterSpacing = `${sz * track}px`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.globalAlpha = a;
      ctx.fillText(str, x, y); const wd = ctx.measureText(str).width; ctx.restore();
      f.box('hud', align === 'right' ? x - wd : x, y - sz * .6, align === 'right' ? x : x + wd, y + sz * .6, str);
    };
    const yTop = Math.round(f.H * .107);
    put(String(num ?? ''), mx, yTop, Math.round(f.W * .061), 600, Tk.ink);
    put(String(h.chapter || '').toUpperCase(), x1, yTop - 4, Math.round(f.W * .022), 600, Tk.muted, 'right', .18);
    if (hudCfg.kind === 'rail' && hudCfg.span) {
      const [lo, hi] = hudCfg.span, Y = yTop + Math.round(f.H * .026), xOf = y => lerp(mx, x1, (clamp(y, lo, hi) - lo) / (hi - lo));
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = Tk.hud || Tk.muted;
      ctx.globalAlpha = a * .35; ctx.fillRect(mx, Y, x1 - mx, 2); ctx.globalAlpha = a;
      for (const k of hudCfg.marks || []) ctx.fillRect(xOf(k) - 1, Y - 7, 2, 14);
      const m = xOf(typeof v === 'number' ? v : lo);
      ctx.fillStyle = Tk.accent; ctx.fillRect(mx, Y - 1.5, m - mx, 4.5);
      ctx.beginPath(); ctx.moveTo(m, Y + 5); ctx.lineTo(m - 9, Y + 22); ctx.lineTo(m + 9, Y + 22); ctx.fill(); ctx.restore();
    }
  }

  // ---------------------------------------------------------------- music: sections from the shots' energies, bar by bar; effects by anchor
  let SCORE = null;
  const mu = spec.music;
  if (mu && global.Compose && global.Chip) {
    const barLen = 4 * beat, nBars = Math.max(1, Math.ceil(T.duration / barLen)), en = [];
    for (let b = 0; b < nBars; b++) { const t = Math.min(T.duration - 1e-3, (b + .5) * barLen), s = T.shots.find(x => t >= x.start && t < x.end) || T.shots[T.shots.length - 1]; en.push({ e: spec.shots[s.i].energy ?? .3, shot: s.i }); }
    const sections = [];
    for (let b = 0; b < nBars; b++) {
      const last = sections[sections.length - 1];
      if (last && Math.abs(last.energy - en[b].e) < .1) { last.bars++; last.energy = (last.energy * (last.bars - 1) + en[b].e) / last.bars; }
      else sections.push({ name: `s${sections.length}`, bars: 1, energy: en[b].e, jump: last ? en[b].e - last.energy : 0 });
    }
    // a one-bar section has no room for a cadence: merge it into the longer neighbour
    for (let k = sections.length - 1; k >= 0 && sections.length > 1; k--) if (sections[k].bars < 2) { const j = k > 0 ? k - 1 : k + 1; sections[j].bars += sections[k].bars; sections.splice(k, 1); }
    sections.forEach(s => { s.energy = +clamp(s.energy, .05, 1).toFixed(2); if (s.jump >= .3) s.breakBefore = true; delete s.jump; });
    SCORE = global.Compose.generate({ seed: mu.seed ?? 1, bpm: T.bpm, key: mu.key || 'A minor', style: mu.style || 'tense', sections });
    global.__score = SCORE;
  }
  const A = Film.audio;
  function sfxAt(ac, out, t, kind, o) {
    const g = o.gain;
    if (kind === 'stamp' || kind === 'impact') A.impact(ac, t, out, g ?? .8);
    else if (kind === 'whoosh') A.whoosh(ac, t, out, { g: g ?? .16, d: o.dur ?? .6 });
    else if (kind === 'riser') A.riser(ac, t, o.dur ?? 1, out, g ?? .2);
    else if (kind === 'ping') A.ping(ac, t, out, { g: g ?? .18 });
    else if (kind === 'tick') A.tick(ac, t, out, g ?? .12);
    else if (kind === 'print') for (let k = 0; k < (o.count ?? 20); k++) A.tick(ac, t + k * (o.every ?? .2), out, g ?? .1, 2200 + (k % 3) * 400);
    else throw new Error(`unknown sfx kind "${kind}"`);
  }
  const SFX = [];
  spec.shots.forEach((sh, i) => (sh.sfx || []).forEach(e => SFX.push({ t: T.shots[i].start + T.anchor(i, e.at ?? 0), kind: e.kind, o: e })));
  function score(ac, bus, f, at) {
    const zero = at(f.DURATION) - f.DURATION, now = ac.currentTime || 0;       // film time -> context time, also mid-film in the live preview
    if (SCORE) global.Chip.playScore(ac, 0, bus.out, SCORE, { timeOf: b => zero + f.time(b), from: now, gain: mu.gain ?? .55 });
    for (const e of SFX) { const t = zero + e.t; if (t >= now) sfxAt(ac, bus.sfx, t, e.kind, e.o); }
  }

  // ---------------------------------------------------------------- shots
  const firstSet = {};
  const shots = spec.shots.map((sh, i) => {
    const set = sh.set && Object.fromEntries(Object.entries(sh.set).map(([k, v]) => {
      if (v && typeof v === 'object') { const { dur, ...rest } = v; if (!(k in firstSet)) firstSet[k] = v.from ?? v.to; return [k, dur !== undefined ? { ...rest, b: [0, dur / beat] } : rest]; }
      if (!(k in firstSet)) firstSet[k] = v; return [k, v];
    }));
    const sd = { id: sh.id, beats: T.shots[i].beats, ...(sh.chapter !== undefined ? { chapter: sh.chapter } : {}), ...(sh.theme ? { theme: sh.theme } : {}), ...(sh.hud === false ? { hud: false } : {}) };
    if (set) sd.set = set;
    const tr = transition(spec, themeOf, sh, i ? spec.shots[i - 1].theme : undefined); if (tr && i) sd.in = tr;
    const pic = pictureOf(i, sh.picture); if (pic) sd.draw = pic;
    if (sh.say) sd.say = [].concat(sh.say).map(s => sayOf(i, s));
    return sd;
  });

  const voiceCfg = voice ? { words: voice.words, phrases: voice.phrases, offset: spec.voice?.offset || 0, ...(spec.voice?.src ? { src: spec.voice.src } : {}), ...(spec.voice?.subtitles || {}) } : undefined;
  const fonts = [`700 100px "${display}"`, `500 30px "${mono}"`, `600 30px "${mono}"`];
  const f = Film.create({
    W: fmt.W, H: fmt.H, FPS: fmt.FPS, tempo: T.bpm,
    // sides, top, bottom: the HUD (a year and a rail) takes the top, so statements start lower when there is one
    ...(spec.safe ? { safe: spec.safe } : fmt.H > fmt.W && hudCfg.kind !== 'none' ? { safe: [.07, .17, .22] } : {}),
    type: { display: `"${display}", sans-serif`, mono: `"${mono}", monospace` }, fonts,
    fontText: style.fontText || allText([spec, voice && voice.words]).join(' ') + ' 0123456789 .,:;?!«»№·—-–→',
    themes, theme: style.theme || Object.keys(themes)[0], initial: firstSet, tween: 1,
    hud, score: (SCORE || SFX.length) ? score : undefined, voice: voiceCfg, shots, duration: T.duration,
  });
  global.__short = { spec, timing: { duration: T.duration, bpm: T.bpm, shots: T.shots.map(s => ({ id: s.id, start: s.start, end: s.end, phrases: s.phrases })) } };
  return f;
}

global.Short = { create, PRESETS };
})(window);
