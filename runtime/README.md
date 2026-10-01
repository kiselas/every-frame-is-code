# runtime

`film.js` is a small runtime for films of 1-3 minutes: the parts every long film needs and nobody should rewrite per film. Classic script, no dependencies, works from `file://` and on any static host. Why and how to structure the film itself: [14-long-form.md](../14-long-form.md). A complete film built on it: [examples/gps/film.html](../examples/gps/film.html).

```html
<canvas></canvas>
<script src="../../runtime/film.js"></script>
<script>
Film.create({
  tempo: [{ bar: 0, bpm: 100 }, { bar: 16, bpm: 112 }],
  themes: { paper: { bg: '#ebe6da', ink: '#17191b', muted: '#6c685f', accent: '#d9381e', texture: 'grid' } },
  fonts: ['800 64px "Archivo"', '500 20px "IBM Plex Mono"'],
  shots: [
    { id: 'hook', bars: 2, draw: (ctx, s) => { /* colors from s.T */ }, say: 'YOU ARE *HERE.*' },
    { id: 'next', bars: 2, in: 'flash', say: { text: 'HOW DOES IT|*KNOW?*', per: .4 } },
  ],
});
</script>
```

The runtime sets up the canvas, the render contract for `render/render.mjs` (`__meta`, `__draw`, `__ready`, `__renderAudio`, `__shots`) and a live preview. For publishing, fold it into one file: `node runtime/inline.mjs film.html` writes `film.inline.html`.

## Film.create(config)

| Field | Default | What it is |
|---|---|---|
| `W`, `H`, `FPS` | 1920, 1080, 30 | Frame size and render rate |
| `tempo` | 120 | One BPM, or a tempo map `[{ bar, bpm, ramp? }]`; `ramp: true` glides to the next entry |
| `beatsPerBar` | 4 | |
| `offset` | 0 | Seconds before bar 1 (prefer trimming the music with `beatmap.mjs --trim`) |
| `themes` | one paper theme | `{ name: tokens }`. Tokens: `bg, ink, muted, accent, hud, texture ('paper' \| 'grid' \| 'stars' \| 'none'), glow (a color or null), grain, vignette` |
| `theme` | the first theme | Theme of the first shot |
| `type` | Archivo + IBM Plex Mono | `{ display, mono }` font families |
| `fonts` | [] | Font strings to load before the first frame (the page still links the font CSS) |
| `assets` | [] | Promises to wait for before `__ready`, e.g. `Film.geo.load()` |
| `shots` | required | The film, see below |
| `initial` | {} | HUD values before the first `set` |
| `tween` | 1 | Beats a numeric HUD value takes to reach a new `set` value |
| `hud` | none | `(ctx, h, f) => {}` drawn over every shot; `Film.hudFrame({...})` is a ready one |
| `score` | none | `(ac, bus, f, at) => {}` schedules the music, see Audio |
| `post` | grain + vignette | `(ctx, T, f) => {}` after the HUD |
| `transitions` | {} | Extra transitions `{ name: (ctx, A, B, p, opts, f) => {} }` |
| `safe` | `[.065, .1]`; portrait `[.07, .1, .22]` | Safe margins as fractions: `[sides, top, bottom]`, bottom defaults to top. Portrait leaves room for the platform UI at the bottom |
| `fontText` | '' | Characters drawn inside `draw()` functions, so each font in `fonts` is loaded with the right unicode-range file (statements and captions are added automatically). Needed for Cyrillic, Greek, accents |
| `tail` | 0 | Seconds after the last shot |

## Vertical films

`W: 1080, H: 1920` switches the runtime to portrait: `f.portrait`, `f.u` (the unit, `min(W, H) / 1080`), a taller bottom margin `f.margin.yb`, statements sized from the width, the HUD scaled by the short side. A statement or caption wider than its room shrinks to fit and logs a `console.warn`; `fit: false` turns that off and `maxWidth` sets the room. Chapter and checklist: [19-vertical.md](../19-vertical.md); example: [examples/lyapunov/](../examples/lyapunov/). `node render/textcheck.mjs film.html` sweeps a film for those warnings.

## Shots

| Field | What it is |
|---|---|
| `id` | Unique name: used by `--shot`, `still.mjs`, `f.shot(id)`, recaps |
| `bars` or `beats` | Length on the tempo map (default 1 bar) |
| `chapter` | Chapter label; inherited by the next shots until changed |
| `theme` | Theme name; inherited |
| `draw(ctx, s, f)` | Draws the shot. Take every color from `s.T` |
| `say` | A statement, or a list of them (see below) |
| `set` | HUD values: `{ key: value }` or `{ key: { to, from?, b: [beat0, beat1], ease?, log? } }`; inherited |
| `in` | Transition into this shot: `'flash'` or `{ type, beats, ...options }`, centered on the cut |
| `hud: false` | Hide the HUD (it fades across transitions) |
| `bg: false` | Don't paint the theme background |

### The shot state `s`

`s.t` local seconds, `s.beat` local beats (tempo-aware), `s.p` 0..1 over the shot, `s.dur`, `s.beats`, `s.g` global time, `s.T` theme tokens, `s.frame`.
Helpers: `s.seg(b0, b1)` progress between two local beats, `s.sec(a, b)` between two local seconds, `s.at(beat)` local beat → local seconds, `s.out(n)` 0..1 over the last n beats, `s.val(key)` a HUD value, `s.rnd(seed)` a seeded RNG.
During a transition both shots are drawn: the incoming one with a negative `s.t` and `s.beat`, the outgoing one past its end. Everything built on `seg()` handles that.

## Statements

```js
say: { text: 'EACH ONE SAYS|ONLY ONE THING:|*THE TIME.*', at: 'tl', per: .4, caption: 'FROM ATOMIC CLOCKS ON BOARD' }
```

`|` breaks lines, `*...*` marks payoff words: accent color, a spring pop, and one extra beat before them (`gap`). A line of only payoff words is `accentScale` (1.5) times larger. Words appear one every `per` beats from `start`. Every payoff lands in `f.hits` so the score can hit it.

| Option | Default | |
|---|---|---|
| `at` | `'tl'` | Zone `tl tc tr l c r bl bc br`, or `[x, y]` with `align`, `valign` |
| `size` | 5.8% of H | Base size in px |
| `font`, `weight` | display, 800 | |
| `start`, `per`, `gap` | 0, .5, per | Timing in beats |
| `out` | none | Local beat at which the words leave |
| `caption`, `captionAt`, `captionSize` | | The small monospace line under the statement, typed on |
| `color`, `accentColor` | `T.ink`, `T.accent` | |
| `pop` | true | Spring scale on payoff words |

Inside `draw`, `Film.say(ctx, s, spec)` draws one more; it returns the block's bounds.

## Counters

```js
Film.count(ctx, s, { from: 0, to: 20200, b: [0, 3], x: 1300, y: 570, size: 92, align: 'center', unit: 'KILOMETERS' });
```

Digits sit in fixed cells, so a running number doesn't jitter. `format`: `'int'` (default, with separators), `'plain'`, `1`/`2`/`3` decimals, or a function. `log: true` counts in log space (for ranges like 2,300 → 208,000,000,000).

## HUD

`Film.hudFrame({ title, sub, left: { label, value }, right: { label, value, meter }, rail })`: corner brackets, the chapter top left, the title top right, two readouts at the bottom, a progress rail with chapter ticks. `value` and `meter` receive `h` with `h.val(key)`, `h.t`, `h.chapter`, `h.progress`, `h.T`. Write your own HUD as `(ctx, h, f) => {}` when the film needs another layout.

## Recap

`draw: Film.recap(['a', 'b', 'c'], { per: .5, theme: 'night', pose: .92, label: sh => '1905' })`: replays earlier shots one every `per` beats, frozen at `pose` of their length, optionally in another theme, with a label.

## Transitions

`fade`, `dip` (color), `flash` (to white and out with rays), `punch` (hard cut with a zoom punch, ghosting and rays), `push` (dir, axis), `whip` (dir, axis; `axis: 'y'` slides vertically), `zoom` (at, color: into a point of the old shot), `iris` (at), `wipe`. Options go into the `in` object; `beats` is the window, centered on the cut.

## Drawing helpers

- `Film.ink`: `poly(ctx, pts, p, closed)` draws the first `p` of a polyline (flat `[x0, y0, x1, y1, ...]`); shapes `line, rect, arc, circle, ellipse, gear`; `hatch(ctx, pathFn, { angle, gap, p, box })`; `poly3(ctx, cam, pts3, p)` and `box3(w, h, d)` for 3D line art.
- `Film.cam3({ x, y, yaw, pitch, scale, dist, fov })`: a camera function `(X, Y, Z) => [sx, sy, z]`; `dist: Infinity` gives a parallel (isometric-like) view.
- `Film.globe({ x, y, r, lon, lat })`: an orthographic Earth. `proj(lon, lat, h)`, `p3(X, Y, Z)` with visibility, `grid`, `land` (coastlines after `Film.geo.load()`), `outline`, `disc`, `path3(ctx, pts, { p, hiddenAlpha })` for orbits. `Film.orbitPoint(R, inc, raan, phase)`, `Film.ecef(lon, lat, h)`.
- `Film.geo.load()`: Natural Earth 110m land from the world-atlas package on jsdelivr, decoded without a library; `Film.geo.flat(ctx, [x, y, w, h], { lon, lat })` draws a flat map.
- `Film.fx`: `rays` (speed lines), `ring` (a signal pulse), `glow` (a cached glow sprite).
- `Film.textSprite`, `Film.drawSprite`, `Film.font`: text rasterized once per look.
- `Film.util`: `clamp, lerp, seg, smooth, ease, spring, mulberry32, noise1, hash1, mix, alpha, mixTheme`.

## Audio

`score(ac, bus, f, at)` is called once, with an `OfflineAudioContext` for the render or a live `AudioContext` in the preview. `bus.out` is the dry mix, `bus.verb` a reverb send. `at(filmTime)` returns the context time, or −1 when that moment is before the preview's start: schedule only when it is ≥ 0. Time on the tempo map: `f.bar(n)`, `f.time(beat)`, `f.shot(id).b0` (the shot's first beat), `f.hits` (payoff words).

Instruments in `Film.audio`, each `(ac, t, out, ...)`: `kick, hat, clap, tick, ping, pluck, bass, pad, riser, impact, sub, whoosh`; notes as `'A2'` or Hz (`Film.audio.hz`). For an existing track instead: `render/beatmap.mjs` gives the tempo map, `render.mjs --music track.wav` mixes it in.

## Pixel toolkit

Three optional scripts for pixel and retro films. Each is a classic script with no dependencies; load them after `film.js`. A complete film that uses all of them: [examples/pixel/film.html](../examples/pixel/film.html).

| Script | Global | What it is | Chapter |
|---|---|---|---|
| `pixel.js` | `Pixel` | an indexed-color screen (`pal`, `dither`, `clip`, `camera`, sprites written as text, a 3x5 font, a Mode 7 floor), palette maps (fade, flash, cycle), a WebGL "snap any canvas to a palette" post pass, dithered transitions, Perlin noise | [15-pixel-retro.md](../15-pixel-retro.md) |
| `pixel-fx.js` | `Pixel.fx` | demoscene effects as functions of (x, y, t) through a palette ramp: plasma, tunnel, rotozoom, copper bars, metaballs, starfield, a stateless fire, moire, wobble, a sine scroller | [17-demoscene.md](../17-demoscene.md) |
| `chip.js` | `Chip` | a score as MML text on four channels (`Chip.play`, `Chip.instrument`), or as data (`Chip.playScore`: real drums, envelopes, vibrato, echo, ducking), plus 8-bit sound effect presets (`Chip.sfx.coin`, `hit`, `jump`...) | [16-chiptune.md](../16-chiptune.md) |
| `compose.js` | `Compose` | a short plan (key, style, an energy per section) becomes a full Score: chords with voice leading, bass, arpeggio, a hook that develops, groove, fills, risers, ducking. Seeded, deterministic | [18-music-generation.md](../18-music-generation.md) |
| `music-lint.js` | `MusicLint` | a symbolic linter for a Score (harmony, leaps, parallel fifths, loops, groove, seams): eyes for an agent that cannot listen; `render/music-report.mjs` adds a piano roll, spectrogram and loudness per section | [18-music-generation.md](../18-music-generation.md) |

They plug into the runtime in four places:

```js
const scr = Pixel.screen({ w: 160, h: 90, palette: 'sweetie16' });
Film.create({
  transitions: Pixel.transitions,                       // bayer, bayerwipe, pixelate, squares: use them as `in: { type: 'bayerwipe' }`
  post: (ctx, T, f) => quantize.apply(ctx.canvas, ctx), // optional: Pixel.post over the whole film
  score(ac, bus, f, at) { Chip.play(ac, at(f.time(0)), bus.out, ['T120 @0 O2 L8 [C C G G]8']); Chip.sfx.coin(ac, at(f.time(8)), bus.out); },
  shots: [{ id: 'a', bg: false, draw: Pixel.shot(scr, (scr, s) => { scr.cls(1); Pixel.fx.plasma(scr, s.t); scr.text(80, 40, 'HI', 7, { align: 'center', scale: 3 }); }) }],
});
```

Notes: use `bg: false` on pixel shots so the runtime doesn't paint the theme background first; indexes of a frame in a shot must survive negative `s.t` (`((Math.floor(x) % n) + n) % n`), because the incoming shot of a transition is drawn before its start. In the live preview `at()` returns `-1` for moments before the playback start, so a score that must survive seeking derives the clock once: `const zero = at(f.DURATION) - f.DURATION;` and schedules at `zero + f.time(beat)` (`Chip.play` skips notes already in the past). Tests: `node --test "runtime/test/*.test.mjs"`.

## Preview

Open the page in Chrome. Click or `S` for sound, `Space` pause, `←` `→` previous / next shot, `Shift` + arrows ±1 s, `Home` restart, `L` loop the current shot, `D` debug overlay (shot, chapter, bar.beat, BPM, safe zone). URL: `?shot=id`, `?t=12.5`, `&loop`, `&debug`.

## Render

```bash
node render/render.mjs film.html --shots                         # the shot list with timecodes
node render/render.mjs film.html part.mp4 --shot two --draft      # one shot
node render/render.mjs film.html part.mp4 --shot "II · THE SPHERES" --draft   # a chapter
node render/render.mjs film.html part.mp4 --shot one..fourth      # a range
node render/still.mjs film.html stills/ two fast@0.3 61.2         # full-size frames
```
