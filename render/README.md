# render

Frame-by-frame rendering of HTML animations to MP4, and contact sheets for review.

## Installation

Requires Node 18+, Google Chrome, and ffmpeg on PATH.

```bash
npm install
```

If Chrome isn't installed in the default location: `CHROME_PATH=/path/to/chrome node render.mjs ...`

## Rendering

```bash
node render.mjs ../film.html ../film.mp4
node render.mjs ../film.html ../part.mp4 --from 20 --to 35      # a fragment
node render.mjs ../film.html ../film.mp4 --voice ../voice.wav     # mix voice-over into the music
```

Page contract:

```js
window.__meta = { W: 1920, H: 1080, FPS: 60, DURATION: 60 };
window.__draw = t => { /* draw the frame for time t */ };
window.__ready = true;                         // after document.fonts.ready
window.__renderAudio = async () => base64Wav;  // optional
```

The page is opened with `?render`: in this mode it must not run its own requestAnimationFrame.

## Contact sheet

```bash
./contact-sheet.sh ../film.mp4 ../sheet.png        # 2 frames/s, 8 columns
./contact-sheet.sh ../film.mp4 ../sheet.png 4 10   # 4 frames/s, 10 columns
```

Requires an ffmpeg build with drawtext (freetype). If drawtext isn't available, remove it from the filter in the script.

## Speed

Taking a screenshot for every frame is slower than real time: a one-minute clip at 60 fps usually takes several minutes to render. For drafts, set `FPS: 30` and a lower resolution in `__meta`.
