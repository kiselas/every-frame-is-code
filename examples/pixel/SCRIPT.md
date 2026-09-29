# Sixteen Colors: script

A 64-second film about limits, built on [runtime/film.js](../../runtime/film.js) and the pixel toolkit ([runtime/pixel.js](../../runtime/pixel.js), [pixel-fx.js](../../runtime/pixel-fx.js), [chip.js](../../runtime/chip.js)) by the method in [14-long-form.md](../../14-long-form.md) and [15-pixel-retro.md](../../15-pixel-retro.md). Source: [film.html](film.html). Render: `node render/render.mjs examples/pixel/film.html examples/pixel/film.mp4 --loudnorm`.

## Specs

| | |
|---|---|
| Length | 1:04, 10 shots, 5 chapters |
| Frame | 1920×1080, 30 fps, drawn at 160×90 and scaled 12× |
| Tempo | 120 BPM throughout (32 bars of 2 s): a pixel film wants a steady clock |
| Palettes | mono → gameboy → cga → sweetie16 (day, then night) for the picture; the final act squeezes a full-color scene into pico8 / sweetie16 / gameboy |
| Type | the built-in 3×5 pixel font, nothing else |
| Sound | 4-channel MML (triangle bass, square lead, pulse arpeggio, noise drums) + sfx presets, all on the film's tempo map |

## Meaning

- **Thesis.** A limit is a style: 16 colors, 160×90 pixels and four sound channels are enough to make a film, and you can squeeze anything into them.
- **Hook.** One blinking pixel: "ONE PIXEL." Then the question the counter answers: how many make a screen?
- **Spine.** Build up, then reveal: one pixel → a screen (14,400) → the palette (4, then 16 colors) → machines made of formulas → a world made of text sprites → the twist: everything you saw can be *any* picture, squeezed.
- **Through-line.** The HUD counter "COLORS": 2 → 4 → **16** → 16 → then it *falls* from 16,777,216 to 16 as a hi-res picture is quantized live (the reversal), and the last shot proves the promise with the numbers.
- **Motif.** The blinking cursor pixel. It opens the film, becomes the sun's spark, and closes the film.
- **Bookend.** The last shot returns to the single pixel from shot 1, now with the three limits typed under it.

## Shots

| # | Chapter | Bars | On screen | What it proves | Colors | In |
|---|---|---|---|---|---|---|
| 1 | I · ONE | 4 | a pixel blinks; "ONE PIXEL."; a counter runs 1 → 14,400 while random pixels light up to a white screen; "ONE SCREEN." | a screen is just a lot of pixels; the counter and the noise are the same number | 2 | |
| 2 | II · PALETTE | 3 | one landscape in the Game Boy palette, then CGA (a flash on the switch), sun and birds moving, hills in parallax, dithered sky | the same drawing, other palette: indexes, not colors | 4 | dithered wipe from the white screen |
| 3 | | 3 | the same landscape in sweetie16 with a 5-band dithered sunset; a palette strip builds up swatch by swatch; day fades to night through `palette.mix`, stars come out | 16 colors is plenty; the palette itself is animatable | → 16 | dither dissolve |
| 4 | III · FORMULA | 2 | plasma, "EVERY PIXEL IS A FORMULA." and `COLOR = F(X, Y, T)` | a picture is a function | 16 | pixelate |
| 5 | | 2 | a tunnel, "NO STATE. SEEK ANYWHERE." | frame = f(t): the reason the whole kit works | | squares |
| 6 | | 2 | a rotozoomer of a text sprite with the sprite shown as characters | a sprite is a block of text | | dithered wipe down |
| 7 | | 2 | copper bars and a sine scroller with the three limits | the classics are cheap | | |
| 8 | IV · WORLD | 8 | a Mode 7 floor, a hero from a text grid running and jumping, coins on the road collected on the beat, a hit (flash, shake), "SPRITES ARE TEXT" with the source beside the hero | sprites as text, the floor as a formula, game feel in whole pixels | 16 | pixelate |
| 9 | V · ANYTHING | 4 | a hi-res, full-color sunset; a divider sweeps across and everything behind it becomes 16 colors; the dither mode and palette change on the beat; the counter falls from 16,777,216 to 16 | `Pixel.post` squeezes any canvas into a palette | 16.7M → 16 | dither wipe |
| 10 | | 2 | one blinking pixel; "16 COLORS. 160 X 90. 4 CHANNELS." then "EVERY FRAME IS CODE." and a fade to black through the palette | the callback | 16 | dip through the palette |

## Beat grid

| Bars | Beats | Section |
|---|---|---|
| 1-4 | 0-16 | I: 0-2 blink, 2-4 line, 4-12 the count, 12-16 white |
| 5-10 | 16-40 | II: shot 2 is gameboy for 6 beats, then cga for 6; shot 3 is sweetie16, dusk to night in its beats 4-8 |
| 11-18 | 40-72 | III: plasma, tunnel, rotozoom, copper (8 beats each) |
| 19-26 | 72-104 | IV: coins on beats 4, 8, 10, 12, 16, 18, 20; the hit on beat 24 |
| 27-30 | 104-120 | V: divider 1-9, mode changes every 1.5-2 beats after |
| 31-32 | 120-128 | end |
