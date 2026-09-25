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
node render.mjs ../film.html ../draft.mp4 --draft               # fast preview: half size, 30 fps, JPEG frames
node render.mjs ../film.html ../film.mp4 --profile              # also print the slowest frames by timecode
node render.mjs ../film.html ../film.mp4 --voice ../voice.wav     # mix voice-over into the music
```

| Option | Default | What it does |
|---|---|---|
| `--from S`, `--to S` | whole film | Render a fragment |
| `--workers N` | a quarter of the CPU cores, 1 to 6 | Parallel browsers. They share one GPU, so more is not always faster: measure |
| `--draft` | off | `--scale 0.5 --fps 30 --format jpeg --preset veryfast` |
| `--scale K` | 1 | Capture scale; 0.5 turns a 1080p page into a 540p video |
| `--fps N` | page FPS | Time step of the render |
| `--format png\|jpeg` | png | Frame capture format. JPEG is lossy but about 3x faster in a single process |
| `--quality Q` | 92 | JPEG quality |
| `--crf N`, `--preset P` | 18, slow | x264 settings |
| `--voice FILE` | none | Mix a voice-over into the page audio |
| `--loudnorm` | off | Normalize the final audio to −14 LUFS |
| `--no-audio` | off | Skip `window.__renderAudio` |
| `--profile` | off | Report per-frame draw and capture times, the 10 slowest frames and the mean per second |

How it works: frames are captured with CDP `Page.captureScreenshot` (`optimizeForSpeed`), the timeline is cut into chunks, the workers take chunks from a shared queue, every chunk is encoded separately, and the chunks are joined without re-encoding. Audio is rendered once and muxed at the end. Why each of these matters, with measurements: [13-performance.md](../13-performance.md).

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

Requires an ffmpeg build with drawtext (freetype). Builds without fontconfig (common on Windows) need a font file: the script uses Consolas on Windows, or set `FONTFILE=/path/to/font.ttf`. If drawtext isn't available at all, remove it from the filter in the script.

## Speed

Rendering is still slower than real time. Iterate on fragments with `--draft`, render the whole film only for the final cut, and run `--profile` when a render feels slow: it names the timecodes to look at. Rules for writing pages that render fast are in [13-performance.md](../13-performance.md).
