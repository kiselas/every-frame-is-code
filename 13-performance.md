# Performance

A frame-by-frame render is only as fast as its slowest step. In practice that step is almost never your JavaScript: it is pixel capture, encoding, and a handful of canvas operations that are slow for non-obvious reasons. Measure first, then fix what the numbers point at.

All numbers below were measured on the demo film (`examples/demo/demo.html`, 1920×1080, 60 fps) in headless Chrome on a laptop: Intel Core i7-13700H (20 threads) with integrated Intel UHD graphics. Absolute values will differ on your machine; the ratios are what matter.

## Measure first

```bash
node render/render.mjs film.html part.mp4 --from 10 --to 16 --profile
```

`--profile` prints the ten slowest frames by timecode and the mean frame time for every second of the film. Look there before changing anything.

How to read it: the "draw call" is only the JS side of `window.__draw(t)`, usually 1–5 ms. Canvas 2D and WebGL queue work for the GPU and return; the GPU finishes the frame while it is being captured. So the heavy effects show up in the total, not in the draw call.

**Never time a frame with `getImageData`.** It looks like the honest way to wait for the GPU, but after a few readbacks Chrome decides the canvas is read often and moves it from the GPU to the CPU. From then on every `drawImage` is slow: 650 glow sprites went from 2.8 ms to 15.9 ms, and the demo's fire scene from 40–100 ms to about 800 ms per frame. The same trap applies to effects: never read pixels back in the frame loop. Sample text into particles, build lookup tables and read images once, at init.

## The render pipeline

What `render/render.mjs` does and why, with the effect of each step on the demo:

| Step | Measurement |
|---|---|
| Capture with CDP `Page.captureScreenshot` (`optimizeForSpeed`) instead of Playwright `locator.screenshot()` | a 6 s fragment (360 frames): 500 s → 127 s in one process |
| Split the timeline into chunks, render them in parallel browsers, join without re-encoding | same fragment: 127 s → 44 s with 8 workers |
| `--draft`: half size, 30 fps, JPEG frames, x264 `veryfast` | same fragment: 17 s |
| The whole 60 s demo with sound, default settings (5 workers) | 2 min 54 s; before these changes, 10 min with 8 processes started by hand |

Things that turned out not to matter, or to hurt:

- **More workers is not always faster.** All browsers share one GPU. On the test laptop a 10 s fragment took 37.8 s with 2 workers, 24.6 s with 4, 23.4 s with 6, 25.6 s with 8 and 30.6 s with 12. The default is a quarter of the CPU cores, capped at 6; check `--workers` on your hardware once.
- **PNG vs JPEG capture.** In a single process JPEG is 3.5× faster per frame (58 vs 203 ms on fire and engraving scenes), because a 1080p PNG with film grain is 2–3 MB to compress. With parallel workers the gap closes (24 s vs 26 s), because encoding spreads over the CPU cores while the GPU stays the bottleneck. So PNG, which is lossless, stays the default, and JPEG is for drafts. Either way the output is H.264 with 4:2:0 chroma: the two paths differ by 46 dB PSNR, which is invisible.
- **x264 preset.** `slow` vs `medium` made no measurable difference in render time. Keep `slow` for the final cut.
- **Chrome GPU flags** (`--enable-gpu-rasterization`, `--ignore-gpu-blocklist`) made capture slightly slower on this machine, so the renderer does not set them.

Working loop: iterate on 5–10 s fragments with `--draft`, build a contact sheet from the fragment, and render the whole film at full quality only for the final cut.

## Canvas 2D: what is expensive

Each case below was measured on a fresh GPU-backed 1920×1080 canvas, 8 frames, one readback at the end.

| Operation | Cost | Do instead | Cost |
|---|---|---|---|
| `ctx.filter = 'blur(10px)'` on each of 24 `fillText` calls | 16.9 ms | draw pre-blurred glyph sprites with `drawImage` | 0.27 ms |
| `shadowBlur = 14` on each of 55 strokes | 12.6 ms | glow as a wide faint stroke under a thin one | 0.31 ms |
| a new radial gradient per particle, 650 particles | 6.7 ms | one glow sprite drawn 650 times | 2.8 ms |
| 20 full-frame `drawImage` composites (motion blur, whip pan) | 3.4 ms | composite at half size, upscale once | 2.4 ms |
| one full-frame `filter: blur(10px)` | 2.1 ms | blur a quarter-size copy and upscale | 1.0 ms |
| any draw on a canvas demoted by `getImageData` | 5.6× slower | no readbacks in the frame loop | — |

And the things that are already cheap, so do not "optimize" them:

- `shadowBlur` on a single shape (a disc with `shadowBlur = 60`: 0.5 ms) or on a line of text (24 glyphs: 0.3 ms). It is the count of shadowed calls that hurts, not the blur radius.
- `fillRect`: 1,500 rects cost 1.35 ms. Merging them into a `Path2D` and filling once was twice as slow (3.0 ms).
- Separate `fill()` calls: 6,000 dots with a `beginPath/arc/fill` each cost 6.7 ms; one path with all 6,000 arcs and a single `fill()` cost 15.7 ms. Huge paths are expensive to tessellate.
- `fillText` in a grid: 4,500 cells cost the same as 4,500 `drawImage` calls from a glyph atlas (11.6 ms).
- `globalCompositeOperation = 'overlay'` for film grain: 0.7 ms for the whole frame.
- A small `OffscreenCanvas` as a sprite draws as fast as an `ImageBitmap` made from it.

Rules that follow:

1. **Blur and shadow belong in sprites, not in the frame loop.** Render the blurred or glowing thing once into a small offscreen canvas, then `drawImage` it. For animated blur, cache a few blur levels (the demo uses 9: 0 to 18 px) and pick the nearest one. A single blur of a whole layer per frame is fine.
2. **One sprite, many draws.** Particles, glows, bokeh, embers: pre-render a sprite per look (for fire, 16 sprites along the color ramp) and never create gradients per particle.
3. **Static layers are rendered once.** Paper texture, sky gradients, backgrounds that only move: draw them into an offscreen canvas at init and `drawImage` it each frame.
4. **Cheap copies for expensive composites.** Motion blur, whip pans, bloom, glow: do them on a half- or quarter-size buffer and scale the result up. The blur hides the lost resolution.
5. **Low resolution on purpose.** Pixel art is drawn at its internal resolution (the demo game runs at 160×90) and upscaled once with `imageSmoothingEnabled = false`.
6. **Reuse buffers.** Allocate offscreen canvases at init and reuse them. Never create a canvas, a large typed array or an image per frame.
7. **Cache text measurements.** `measureText` in a per-frame loop adds up; cache widths per font and string.
8. **Measure before batching.** Batching draw calls is the classic advice for WebGL, but Chrome's Canvas 2D already batches internally, and a single huge path can be slower than many small ones.

## WebGL and Three.js

- Move to WebGL when a scene needs tens of thousands of particles, bloom, distortion or per-pixel effects. Compute particle positions in the vertex shader from a time uniform; the CPU only sets `uTime`.
- Watch overdraw with additive blending. In the demo sphere, a point size of `260 / depth` gave 20,000 points up to 140 px wide: the frame washed out to white and the GPU drew millions of pixels per point layer. `16 / depth` looks right and costs almost nothing.
- Use one `WebGLRenderer` for the film and `setPixelRatio(1)`. Browsers allow about 16 live WebGL contexts and drop the oldest; the demo uses five (Three.js, the CRT post-process, the burn transition and two small transition cells).
- `preserveDrawingBuffer: true` only on canvases you copy into a 2D frame with `drawImage`.
- Uploading a 1080p 2D canvas as a texture every frame (for a shader transition or post-process) is fine for a transition or a single pass. If a scene needs several shader passes every frame, draw the whole scene in WebGL.

## Caches and determinism

Caches are safe only if the cached value is a pure function of its key. Workers render chunks out of order and each browser builds its own caches, so a cache keyed by glyph, color and blur level is fine, while anything keyed by "the previous frame" or filled in the order frames happen to be drawn will produce different films from different runs. Build expensive caches at init when you can; lazy caches are fine as long as the key describes the look, not the time.

## Live preview

The render does not care how long a frame takes; the live preview does. It should hold 30 fps or it becomes hard to judge timing. If it does not:

- apply the rules above first: they speed up the render too;
- lower the preview's internal resolution (for example, a canvas at half size scaled up with CSS) while the render keeps full size;
- never change what the film looks like depending on the mode. Particle counts, seeds and timings must be the same in `?render` and in the preview, or the preview stops being a preview.
