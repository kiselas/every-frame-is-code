# motion-kit demo: 60-second film script

The film tells the story of the repo using the repo's own tools. Each chapter shows one capability and simultaneously changes style, so in one minute the viewer sees the whole set: a phosphor terminal, fire, an engraving, 3D, palettes, a pixel-art game, a catalog of transitions, sound, and quality control.

## Specs

| Parameter | Value |
|---|---|
| Length | 60 s |
| Format | 1920×1080, 60 fps (drafts at 30 fps) |
| Tempo | 120 BPM: beat 0.5 s, bar 2 s, 30 bars total |
| Caption language | captions are in English (a localized version only needs new strings in `captions`) |
| Concept | "Every frame is code": not a single pixel is generated, everything is drawn by the program |
| Recurring motif | a blinking cursor `▍`. It opens the film, turns into a spark, hides in every scene (a dot in the engraving, the sphere's core, a pixel in the game), and closes the film |

## Musical form

| Bars | Time | Section | What plays |
|---|---|---|---|
| 1–2 | 0:00–0:04 | intro | silence, keystroke clicks, a low hum |
| 3–8 | 0:04–0:16 | build A | pad, kick on every beat starting at bar 5 |
| 9–11 | 0:16–0:22 | build B | eighth-note hi-hats come in, the pad filter opens up |
| 12–14 | 0:22–0:28 | montage | dense rhythm, riser on bar 14 |
| 14 (end) | 0:27.5–0:28.5 | break | 1 s of complete silence |
| 15–19 | 0:28.5–0:38 | drop | impact at 0:28.5, kick, bass, game sounds locked to the grid |
| 20–23 | 0:38–0:46 | groove | the rhythm holds, every transition has its own sound |
| 24–26 | 0:46–0:52 | reveal | the rhythm becomes visible, sound pulses line up with the graphics |
| 27–30 | 0:52–1:00 | outro | the drums drop out, the pad sustains through the final title (L-cut) |

## Shots

### 1. Terminal (0:00–0:04) · 00, 01, 08

Phosphor style: #020402 background, #1f7a1f and #b6ffb6 text, white for hot characters. Scanlines, slight barrel distortion, two-layer text glow.

Black screen, the cursor blinks exactly twice (two beats). The line `function draw(ctx, t) {` types out with keystroke sound, each character with a flash. `// every frame is code` appears below it. Framing: close-up, slow 4% push-in.

Transition: the code characters break apart into particles (sampled from the text's pixels), the particles converge into a single point at the cursor's position. The point flares and becomes a spark.

### 2. Fire (0:04–0:10) · 07, 08

Filmstrip style: #1c1a17, a warm fire ramp from #fff6d5 to #4a1208. 6% film grain, vignette.

The spark falls and ignites into a flame (a sprite-based particle system, additive blending), a layer of embers drifts upward on noise. The camera tilts up, following the embers. Title types in letter by letter with blur, serif typeface (Cinzel): **NO PIXELS WERE GENERATED.** The key word isn't highlighted with color; it sits on its own line, larger.

Transition: zoom-through into the brightest point of the flame at 0:10, a white flash on the strong beat of bar 6.

### 3. Engraving (0:10–0:16) · 03, 07, 04

Engraving style: #efe6d2 paper, #3b3226 ink, #9e2b25 as the single accent. Hatching instead of gradients, line boil at 10 times per second.

The paper emerges out of the white flash. A single line draws an astrolabe (lineDash animation), the rings finish turning with stagger and a spring. A red dot at the center is the cursor. A demonstration of determinism: the frame "rewinds" half a second and plays again, and the lines wobble identically. Lower-third title in a sans-serif: **Seeded. Deterministic. Frame-exact.**

Transition: a match cut on shape. The astrolabe's outer ring matches the size and position of the sphere's outline in the next shot.

### 4. 3D sphere (0:16–0:22) · 11, 07

Blueprint style in 3D: #1d3557 background, #e8f1f7 lines, #f4a261 core. Three.js, ACES, UnrealBloomPass, fog, narrow field of view (fov 30).

A wireframe sphere made of blueprint lines, with a hot core inside (the former cursor). The camera orbits along a spline with inOutCubic easing. Around it, 20,000 shader-driven particles slowly spiral into a disk. The core pulses on every beat. Title: **3D when you need it.**

Transition: a burn dissolve (GLSL) with an orange edge that burns through the frame into the next scene on bar 11.

### 5. Palette montage (0:22–0:28) · 03, 06

Styles change on the beat, accelerating: the first 4 frames at one beat each (0.5 s), the next 8 at half a beat each (0.25 s). Every frame keeps the same composition (a circle, a horizon, one line of text), so only the style changes, not the content: Swiss poster, Forest fog, Night city, Blueprint, then faster: Engraving, Filmstrip, Phosphor, pixel art, watercolor, ASCII, neon, duotone. The palette name appears in a small line at the bottom.

The riser builds, and the last two frames tear apart with a glitch transition.

### 6. Pause (0:27.5–0:28.5) · 06

Silence, a black screen, only the cursor blinks. Once. This is the most important frame for the peak: the viewer holds their breath.

### 7. Game (0:28.5–0:38) · 10, 04

Pixel style: internal resolution 128×72, a 16-color palette, scaled with `image-rendering: pixelated`. The cursor becomes a pixel-art character.

The impact at 0:28.5 lines up with the hero's landing: squash, dust, trauma-based screen shake. Then a short gameplay beat, one action per beat: a run-up, a jump with stretch, a hit on an enemy (80 ms hitstop, white flash, particles snapped to the pixel grid), a coin pickup (flies to the counter, the counter bounces on a spring). At the peak the enemy breaks into debris, a speed ramp slows time at 0:35, then snaps back to full speed. Title in a large pixel font on the hit: **JUICE.**

Transition: a whip pan to the right at 0:38, the character "runs out" into the next frame.

### 8. Transition catalog (0:38–0:46) · 05

Swiss poster style: #f2f0eb, #111111, #e3242b, a strict grid, sans-serif type.

The screen splits into a 2x2 grid; each cell loops its own transition between two simple scenes (a circle and a square): iris, push, a luma wipe, wave distortion. On bar 22 the grid collapses back into a single frame via a push, and a soft angled wipe covers the whole screen. Each cell is labeled with its transition type. Title: **Transitions are data.**

Transition: a soft wipe reveals the next scene.

### 9. Sound and QA (0:46–0:52) · 09, 12

Night city style: #0b0d17, #4a4e8c, #ff3d7f accent.

Sound becomes visible: the kick is an expanding ring, the hi-hats are short marks on a horizontal scale, the pad is a slow wave at the bottom. Everything stays perfectly in sync because it all reads from one `events` array. Then the frame shrinks down into a single contact-sheet cell, and the film's other frames appear next to it with timecodes. Two cells get red "review" frames drawn on them: this is how the agent spots problem frames. Title: **Rendered frame by frame. Checked like a director.**

Transition: a pull-out. The contact sheet keeps zooming out, and the cells shrink into dots.

### 10. Finale (0:52–1:00) · 06, 08

The style returns to the Phosphor look from the first shot; the circle closes.

All the dot-cells converge into one: the cursor. `motion-kit` types out, with `github.com/kiselas/every-frame-is-code` below it. The scanline flicker fades out. The pad sustains for two more seconds after the picture disappears (L-cut), and the cursor is the last thing to blink.

## Transition summary

| Time | From | To | Type | Meaning |
|---|---|---|---|---|
| 0:04 | terminal | fire | text into particles, particles into a spark | code becomes an image |
| 0:10 | fire | engraving | zoom-through + white flash | diving into detail |
| 0:16 | engraving | sphere | match cut on a circle | same shape, new dimension |
| 0:22 | sphere | palettes | burn dissolve | burning into the next chapter |
| 0:22–0:28 | palettes | palettes | cuts on the beat, glitch at the end | accelerating toward the peak |
| 0:28.5 | pause | game | smash cut on the impact | contrast between silence and impact |
| 0:38 | game | catalog | whip pan | energy, the character pulls the camera along |
| 0:46 | catalog | sound | soft wipe | calm after the showcase |
| 0:52 | contact sheet | finale | pull-out to a dot | everything returns to the cursor |

## Captions

```js
const captions = [
  { t: 1.0,  end: 4.0,  text: 'function draw(ctx, t) {', style: 'code' },
  { t: 5.5,  end: 9.5,  text: 'NO PIXELS WERE GENERATED.', style: 'hero-serif' },
  { t: 12.0, end: 15.5, text: 'Seeded. Deterministic. Frame-exact.', style: 'lower-third' },
  { t: 18.0, end: 21.5, text: '3D when you need it.', style: 'lower-third' },
  { t: 31.0, end: 32.5, text: 'JUICE.', style: 'pixel-hit' },
  { t: 40.0, end: 45.5, text: 'Transitions are data.', style: 'swiss' },
  { t: 47.0, end: 51.5, text: 'Rendered frame by frame. Checked like a director.', style: 'lower-third' },
  { t: 54.0, end: 60.0, text: 'motion-kit', style: 'code' },
];
```

## Capabilities the film covers

Canvas 2D and WebGL, Three.js with post-processing, shader transitions, seeded randomness and rewind, a stateless particle system, fire, glow, film grain, vignette, scanlines, hand-drawn line and line boil, hatching, kinetic typography (typing, letter blur, hits on the beat), text into particles, 12 palettes, pixel art, game feel (hitstop, screen shake, squash, springs), speed ramp, match cut, whip pan, burn dissolve, zoom-through, glitch, iris, push, luma wipe, split-screen, Web Audio music synced to events, L-cut, contact sheet.

## How to build it

A one-minute film with ten styles is too heavy to build in one pass. Build it in three parts inside a single HTML file, sharing one timeline, BPM, and events array:

1. 0:00–0:22 (shots 1–4)
2. 0:22–0:38 (shots 5–7)
3. 0:38–1:00 (shots 8–10)

After each part: render the fragment with `--from` and `--to`, build a contact sheet, and fix issues by timecode.

Prompt for the first part:

```
Read SKILL.md and follow it. We're building the repo's demo film from examples/demo/SCRIPT.md.
Right now, only part 1: shots 1-4 (0:00-0:22), but set up the whole scaffold (timeline, BPM,
events, captions, render mode, audio) for the full 60 seconds from the start.
First show the plan as data, then the code in examples/demo/demo.html.
After rendering the 0-22s fragment, build a contact sheet and describe what you see.
```
