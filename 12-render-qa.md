# Rendering and QA

## Rendering to MP4

Scripts live in the `render/` folder. Requirements: Node 18+, Chrome, ffmpeg.

```bash
cd render && npm install
node render.mjs ../my-film.html ../out.mp4
```

The page must set `window.__meta = { W, H, FPS, DURATION }`, `window.__draw(t)`, and `window.__ready = true` after fonts have loaded (see 01-pipeline.md). If `window.__renderAudio` is present, the audio will be mixed automatically.

## Contact sheet

One frame every half second, on a single image. The main review tool: it shows pacing, dead spots, composition, and repetition.

```bash
./render/contact-sheet.sh out.mp4 sheet.png        # 2 frames per second, 8 columns by default
```

For the agent: after every render, open the contact sheet and describe what you see before making changes.

## Checklist

**Composition and text**
- [ ] Text doesn't overlap objects and isn't placed on the brightest spot
- [ ] Text stays within safe zones, not cropped by edges
- [ ] Each caption stays on screen long enough to read
- [ ] Every frame makes it clear where to look

**Motion and pacing**
- [ ] No motionless stretch longer than 2 s
- [ ] No linear motion where an eased curve is needed
- [ ] Shots get shorter toward the peak, with a pause before it
- [ ] The first 2 seconds hook the viewer (for vertical platforms)

**Visuals**
- [ ] Objects don't go past the edges where they shouldn't
- [ ] No sudden brightness jumps between frames (except intentional flashes)
- [ ] The palette is consistent, and the accent color isn't smeared across the whole frame
- [ ] No flicker from `Math.random()` in rendering

**Sound**
- [ ] Cuts land on the beat
- [ ] No single loud hits right after silence
- [ ] Voice is intelligible over the music
- [ ] Final loudness is around −14 LUFS

**Technical**
- [ ] Fonts are loaded before the first frame
- [ ] Two renders produce identical results
- [ ] Live preview and render match in timing

## Common problems in a first draft

- Characters with a thick rounded outline look childish.
- Text is drawn on top of objects.
- Long stretches where nothing happens.
- Everything happens at once: no stagger, no hierarchy of motion.
- Transitions are all crossfades.
- The same shot type (framing, composition) throughout.
- Loud single hits in the music.

## Export formats

| Platform | Size | FPS |
|---|---|---|
| YouTube, website | 1920×1080 | 30 or 60 |
| Reels, Shorts, TikTok | 1080×1920 | 30 or 60 |
| Telegram, square social | 1080×1080 | 30 |

Encoding: H.264, `-pix_fmt yuv420p`, `-crf 18`, `-movflags +faststart`. For a GIF preview: `ffmpeg -i out.mp4 -vf "fps=15,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" preview.gif`.

## Live preview performance

Rendering is frame-by-frame, so a heavy frame doesn't hurt the MP4. But the live preview should run at least at 30 fps, or it becomes hard to judge. If it's slow: reduce the particle count in live mode, cache static layers into buffers, blur downscaled copies, or switch to WebGL.
