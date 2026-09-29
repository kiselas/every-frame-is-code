# Pixel and retro

Pixel art is the cheapest way out of the default look. A fixed low resolution and a fixed palette take away the decisions a model makes badly (gradients, glows, "atmosphere") and leave the ones it makes well (composition, timing, shapes). The ideas here come from [Pyxel](https://github.com/kitao/pyxel) (16 colors, `pal`, `dither`, `blt3d`, text sprites) and PICO-8 (`pal` ramps, `fillp`), rebuilt around the kit's rule that a frame is a pure function of time.

`runtime/pixel.js` implements it: an indexed-color screen, sprites written as text, a 3x5 font, a perspective floor, palette maps, a "snap any canvas to a palette" post pass and dithered transitions. Effects for it are in [17-demoscene.md](17-demoscene.md), sound in [16-chiptune.md](16-chiptune.md).

```html
<script src="../../runtime/film.js"></script>
<script src="../../runtime/pixel.js"></script>
```

## The constraint is the brief

Say the numbers in the prompt: `160x90, the pico8 palette, 4 sound channels`. The model stops reaching for a navy background with an amber accent because there is no amber to reach for. Each limit removes one class of mistakes:

| Limit | What it removes |
|---|---|
| 160x90 (or 128x72, 240x135) | blur, thin lines, tiny text, "detail for its own sake" |
| 16 colors | gradients, glow, random neon; forces contrast and a few chosen accents |
| Whole-pixel positions and camera | shimmering sub-pixel motion that reads as cheap |
| Dither instead of alpha | soft transparency; shadows and fades stay graphic |
| 4 sound channels | mud; every voice has to earn its place |

Pick the limits from the subject the way [03-visual-style.md](03-visual-style.md) picks a palette: a Game Boy palette for nostalgia, `sweetie16` for warm and friendly, `cga` for a hard 1980s computer, a two-color palette for a printed look.

## The screen

```js
const scr = Pixel.screen({ w: 160, h: 90, palette: 'pico8' });
scr.cls(1);
scr.rect(10, 10, 40, 20, 8).circ(120, 40, 12, 10).line(0, 89, 159, 60, 7);
scr.text(80, 4, 'HELLO', 7, { align: 'center', shadow: 0 });
scr.flip(ctx);                               // whole-number upscale onto the canvas, nearest neighbor
```

Sizes that scale by a whole number onto a 1920x1080 frame, so no bars and no uneven pixels:

| Size | Scale | Feel |
|---|---|---|
| 128x72 | 15x | coarse, PICO-8-like |
| 160x90 | 12x | the default: readable sprites, room for a scene |
| 192x108 | 10x | |
| 240x135 | 8x | detailed pixel art |
| 320x180 | 6x | fine, near the limit of "obviously pixels" |

Everything draws through one path: the camera, the clip rectangle, the draw palette and the dither mask apply to every primitive.

| Call | |
|---|---|
| `cls(c)`, `pset(x, y, c)`, `pget(x, y)` | clear, one pixel, read one pixel |
| `line`, `rect`, `rectb`, `circ`, `circb`, `elli`, `ellib`, `tri`, `trib` | primitives; `b` is the outline. Coordinates are rounded to whole pixels |
| `fill(x, y, c)` | flood fill on what is already drawn |
| `text(x, y, str, c, { scale, align, shadow, bg, spacing })` | built-in 3x5 font, upper case, 4 px per letter, 6 px per line |
| `blt(sprite, x, y, { flipX, flipY, rot, scale, sx, sy, w, h, key })` | copy a sprite; `rot` and `scale` use nearest neighbor, never smoothing |
| `blt3d(x, y, w, h, tex, opts)` | perspective floor, see Mode 7 |
| `pal(a, b)` / `pal()` | draw color `a` as `b` from now on / reset |
| `dither(alpha)` / `dither()` | draw at 0..1 opacity through a Bayer mask / reset |
| `clip(x, y, w, h)` / `clip()`, `camera(x, y)` / `camera()`, `reset()` | clip rectangle, camera offset, reset all state |
| `toSprite(key?)` | the screen as a sprite (render a layer once, then rotate or scale it) |

Every frame starts with `cls` and `reset`, exactly like every other page in this kit: the screen is not state, it is a canvas you repaint from `t`. `Pixel.shot` does the reset for you.

The whole kit's rules still apply: `Pixel.mulberry32(seed)` for randomness, positions from `t`, no accumulated state.

## Palettes

```js
Pixel.palette('sweetie16').i.orange      // a color by name -> index
Pixel.palette(['#0b0c1e', '#e63946', '#f1faee'])      // your own, up to 256
Pixel.palette.ramp('#0d0221', '#f5e6c8', 6)           // a ramp of n colors
```

Built in: `pyxel`, `pico8`, `sweetie16`, `gameboy` (4), `cga` (4), `mono` (2). `Pixel.palette.register(name, hexList, names)` adds one; [Lospec](https://lospec.com/palette-list) is a large catalog of ready ones.

Draw with **indexes**, not colors. Then the look becomes data:

```js
scr.flip(ctx, { palette: 'gameboy' });                        // the same picture in another palette
scr.flip(ctx, { palette: Pixel.palette.mix("sweetie16", nightPalette, s.seg(4, 8)) });   // day to night
scr.flip(ctx, { map: Pixel.fadeMap('pico8', 1 - s.seg(0, 2), 0) });                     // fade in from black
```

Palette maps are 256-entry lookup tables applied when indexes turn into colors:

| Map | Use |
|---|---|
| `Pixel.fadeMap(pal, level, to = 0)` | fade to a color through the colors the palette really has: banded steps, the pixel-art way. Level 0 is the picture, 1 is all `to` |
| `Pixel.flashMap(pal, idx)` | everything one color: a hit flash for one or two frames |
| `Pixel.cycleMap([i, j, k], shift)` | rotate colors: water, lava, neon signs, "loading" bars, without redrawing |

Draw-time remapping is `scr.pal(a, b)`: enemies in a different color, a "hurt" pass with `pal(all, 8)`, a shadow by remapping everything to one dark index.

## Dither

`dither(alpha)` fills only some pixels, chosen by a 4x4 Bayer matrix at screen coordinates. It is stateless, so it never shimmers between frames, and the result looks like drawing, not blending:

```js
scr.dither(.5).rect(0, 0, 160, 30, 14).dither();              // a half-transparent band
for (let i = 0; i < 6; i++) scr.dither(i / 6).rect(0, i * 5, 160, 5, 1);     // a sky gradient in six dithered steps
scr.dither(1 - s.seg(0, 1)).blt(sprite, x, y).dither();      // a sprite dissolving out
```

A gradient between two palette colors: paint the bands from far to near with rising alpha (the sky above). Soft shadows: dither a dark index under an object. Fog: `blt3d` takes `fog`.

## Sprites are text

No image files, no editor. A sprite is a block of characters, one per pixel: `0-9 a-z` are palette indexes (`a` = 10 ... `f` = 15), `.` or a space is transparent.

```js
const hero = Pixel.sprite(`
  ..33333..
  .3777773.
  .3707073.
  .3777773.
  ..88888..
  .8888888.
  .8.888.8.
  ...8.8...
`);
scr.blt(Pixel.outline(hero, 0), 30, 58);                     // a 1 px outline keeps it readable on any background
scr.blt(hero, 70, 58, { flipX: true });
```

| Helper | |
|---|---|
| `Pixel.sprite(rows, legend?)` | rows as an array or a template literal; `legend` maps other characters to indexes: `{ '#': 8 }` |
| `Pixel.frames(strip, frameWidth)` | a wide strip cut into frames: a walk cycle is one string |
| `Pixel.cut(sprite, x, y, w, h)` | a sub-rectangle |
| `Pixel.mirror(sprite, 'x' \| 'y')` | flipped copy |
| `Pixel.recolor(sprite, { 8: 12 })` | a variant with swapped colors (enemy tiers, team colors) |
| `Pixel.outline(sprite, c, diagonals?)` | outlined copy |

Cache sprites at init (they are just arrays). A frame index comes from time: `walk[cyc(s.t * 8, walk.length)]` with `const cyc = (x, n) => ((Math.floor(x) % n) + n) % n` (the plain `%` breaks on the negative time an incoming shot sees during a transition).

What makes a good sprite: 8x8 to 16x16 for characters at 160x90, a silhouette you can read in one color, 3-4 colors plus an outline, the light from one side (a lighter color top-left, darker bottom-right), a two-frame idle before you try a run cycle.

## Text

The built-in 3x5 font is for labels, HUD and titles at `scale: 2..4`. `Pixel.textWidth(str, scale)` measures. Only upper case and basic punctuation exist; anything else draws `?`. For real typography use the film's own canvas text on top of the pixel layer (fonts like *Silkscreen* or *Press Start 2P* work at sizes that are multiples of the pixel scale, drawn at whole-pixel positions).

## Mode 7: a floor in perspective

`blt3d` draws the plane `z = 0` through a camera: the classic SNES road, a checkerboard, a grid to the horizon. World units are texels.

```js
scr.blt3d(0, 30, 160, 60, (x, y) => ((x >> 4) + (y >> 4)) & 1 ? 3 : 11, {
  pos: [t * 40, 0, 30],           // x, y, height above the floor
  rot: [14, 20, 0],               // pitch (down is positive), yaw (right is positive), roll, in degrees
  fov: 70, sky: 12, fog: { color: 12, near: 60, far: 400 },
});
```

`tex` is a function `(x, y, dist) => index` (procedural floors: cheap and infinite) or a sprite that repeats (`wrap: 'clamp'` stops it repeating). Fog is dithered, not blended. Sprites standing on the floor (coins, a hero, trees) are billboards: `Pixel.project(x, y, z, { pos, rot, fov, rect })` uses the same camera and returns `{ x, y, dist, scale }` (or `null` behind the camera). Draw them far to near, after the floor:

```js
const cam = { pos: [0, t * 40, 30], rot: [14, 0, 0], fov: 70, rect: [0, 30, 160, 60] };
scr.blt3d(0, 30, 160, 60, floor, cam);
for (const c of coins.slice().sort((a, b) => b.y - a.y)) {
  const p = Pixel.project(c.x, c.y, 0, cam); if (!p) continue;
  scr.blt(coin[Math.floor(t * 8) % 4], p.x - 4 * p.scale, p.y - 8 * p.scale, { scale: Math.max(1, Math.round(p.scale * 4) / 2) });
}
```

Put the horizon a third of the way down, draw the sky and the sun first, then the floor, then the billboards. The floor costs one pass over the rectangle: at 160x90 that is a fraction of a millisecond.

## Post pass: make anything pixel art

`Pixel.post` takes any canvas (a Canvas 2D scene, a Three.js render, the film's own frame), shrinks it to the pixel resolution, adds a Bayer threshold, snaps every pixel to the nearest palette color and scales the result up. The technique of *Return of the Obra Dinn*, on a GPU, stateless.

```js
const q = Pixel.post({ w: 320, h: 180, palette: 'pico8', dither: 'bayer8', spread: .16 });

q.apply(sceneCanvas, ctx);                               // draw over the whole target
q.apply(sceneCanvas, ctx, { x: 960, w: 960 });          // half of the frame: a before/after split
Film.create({ post: (ctx, T, f) => q.apply(ctx.canvas, ctx), ... });   // pixelate the entire film, HUD included
```

| Option | Default | |
|---|---|---|
| `w`, `h` | 320x180 | pixel resolution |
| `palette` | pico8 | up to 32 colors |
| `dither` | bayer4 | `none`, `bayer2`, `bayer4`, `bayer8`. `none` is flat banding, `bayer2` a light crosshatch, `bayer8` the smoothest |
| `spread` | .16 | dither strength. Small palettes want more (.25 for `gameboy`), big ones less |
| `contrast`, `saturation`, `brightness` | 1, 1, 0 | adjust before snapping; a dull source needs contrast |

Three.js: create the renderer with `preserveDrawingBuffer: true` and pass `renderer.domElement` (see [11-threejs.md](11-threejs.md)). Each `Pixel.post` holds one WebGL context, and browsers allow about 16: make one per look, not per shot.

Tips: light the source scene with strong contrast (the palette has few steps); avoid thin lines below the pixel size; a source with a vignette turns into a dithered border for free.

## Dithered transitions

```js
Film.create({
  transitions: Pixel.transitions,
  shots: [{ id: 'b', in: { type: 'bayerwipe', beats: 1, dir: 'l' }, ... }],
});
```

| Type | What it does | Options |
|---|---|---|
| `bayer` | the frame dissolves through an 8x8 Bayer screen in 64 ordered steps | `cell` (px per dither cell, default W/240), `ease` |
| `bayerwipe` | a dithered edge sweeps across | `dir` `'l' 'r' 'u' 'd'`, `soft` (.5, width of the dithered band) |
| `pixelate` | the frame turns into chunky cells (powers of two), the cut hides at the biggest cell | `max` (largest cell, px) |
| `squares` | squares shrink away from the old frame in a wave | `size`, `order` `'diagonal' 'radial' 'random' 'rows'` |

They are ordinary `(ctx, A, B, p, opts, f)` transitions, so they mix with the built-in ones (`Film.create({ transitions: { ...Pixel.transitions, mine } })`). Tie the type to a meaning as in [05-transitions.md](05-transitions.md): a dithered wipe for "the same world, moving on", `pixelate` for "into the machine", `squares` for a level change.

## In a film

```js
const scr = Pixel.screen({ w: 160, h: 90, palette: 'sweetie16' });
Film.create({
  W: 1920, H: 1080, FPS: 30,
  transitions: Pixel.transitions,
  shots: [
    { id: 'title', bars: 4, bg: false, hud: false,
      draw: Pixel.shot(scr, (scr, s) => {
        scr.cls(0);
        const y = 30 + Math.round(Math.sin(s.t * 3) * 2);      // whole pixels only
        scr.text(80, y, 'HELLO', 12, { scale: 4, align: 'center', shadow: 1 });
      }, (s) => ({ map: Pixel.fadeMap('sweetie16', 1 - s.seg(0, 1), 0) })) },
  ],
});
```

`Pixel.shot(scr, fn, flipOptions)` resets the screen state, calls `fn(scr, s, f)` and flips; `flipOptions` may be a function of `(s, f)`. Use `bg: false` so the runtime does not paint the theme background first.

**Overlays**: draw a HUD or captions on a second screen and flip it with `key: 0`, so index 0 is transparent: `hud.flip(ctx, { key: 0 })`.

**Rules of pixel motion**

- Round positions, camera and shake to whole pixels: `scr.camera(...Pixel.shake(s.t, trauma))`. Sub-pixel movement is the loudest tell of fake pixel art.
- Use `fps: 30` (or 24). Pixel motion at 60 fps looks smooth and soulless; at 12-15 animation frames per second (`Math.floor(s.t * 12)`) it looks drawn.
- Easing still applies, but in steps: quantize the eased value (`Math.round(e * 20) / 20`) for a "stepped" fade.
- Rotation only by nearest neighbor (`blt` with `rot`); fine at 90-degree steps, rough at others, which is the look.
- Hit feedback in pixels: `flashMap` for two frames, hitstop, `Pixel.shake`, a few 2x2 particles ([10-games-juice.md](10-games-juice.md)).

## Pitfalls

- Drawing with CSS colors on the pixel canvas: the point is indexes, or the palette maps and swaps stop working.
- `ctx.imageSmoothingEnabled` is left on for your own upscales: everything turns to mush. `flip` and `post` handle it; your own `drawImage` must too.
- A size that does not divide the frame: `flip` then letterboxes with `bg` bars. Pick a size from the table or pass `fit: 'stretch'` and accept uneven pixels.
- Text at scale 1 on a 1080p video has letters 36 by 60 px: fine for a HUD, small for a statement. Use `scale: 2` or more.
- Fifteen colors "for atmosphere": the whole point is to choose. Give each scene 4-6 colors from the palette and keep the rest for accents.
- `frames[Math.floor(s.t * 8) % n]` with a negative `s.t`: during a transition the incoming shot is drawn *before* its start, and JavaScript's `%` returns negatives. Use `((Math.floor(x) % n) + n) % n`.
- Creating a `Pixel.screen`, `Pixel.post` or a sprite inside `draw`: build them once at init, then draw with them.
- Reading pixels back (`pget`) is fine, it is an array; reading the canvas back is not (rule 18 of the brief).

## Sources

- [Pyxel](https://github.com/kitao/pyxel): the engine these ideas come from, and its [API reference](https://github.com/kitao/pyxel/blob/main/docs/api-reference.md)
- [PICO-8 dither tutorial](https://www.lexaloffle.com/bbs/?pid=69408) and [palette ramps](https://nerdyteachers.com/PICO-8/Guide/PALETTES)
- [Ditherpunk](https://surma.dev/things/ditherpunk/): a thorough guide to dithering, including why ordered dither suits real-time
- [Lospec palette list](https://lospec.com/palette-list)
