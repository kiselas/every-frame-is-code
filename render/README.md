# render

Frame-by-frame rendering of HTML animations to MP4, contact sheets and full-size stills for review, and tools to break down a reference video and to cut a film to an existing track.

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
node render.mjs ../film.html ../film.mp4 --music ../track.wav     # mix an existing music track
node render.mjs ../film.html --shots                            # shot list of a runtime/film.js page
node render.mjs ../film.html ../part.mp4 --shot two --draft      # one shot, a chapter, or a range a..b
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
| `--shot ID[..ID2]` | none | Render one shot, a chapter, or a range (pages built on `runtime/film.js`) |
| `--shots` | off | Print the shot list with timecodes and exit |
| `--voice FILE` | none | Mix a voice-over into the page audio |
| `--music FILE` | none | Mix a music track; combines with `--voice` and the page audio |
| `--loudnorm` | off | Normalize the final audio to −14 LUFS, then a limiter at −3 dB (single-pass loudnorm alone can overshoot, and AAC adds a little more) |
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
./contact-sheet.sh ../film.mp4 ../sheet.png        # 2 frames/s, 8 columns (12 for a portrait video)
./contact-sheet.sh ../film.mp4 ../sheet.png 4 10   # 4 frames/s, 10 columns
```

Tiles are 320 px wide for a landscape video and 190 px for a portrait one, so a 50-second 1080×1920 film at 1 frame/s fits one readable image. Requires an ffmpeg build with drawtext (freetype). Builds without fontconfig (common on Windows) need a font file: the script uses Consolas on Windows, or set `FONTFILE=/path/to/font.ttf`. If drawtext isn't available at all, remove it from the filter in the script.

## Text check

```bash
node textcheck.mjs ../film.html          # draws the whole film every 0.5 s, lists warnings and errors, exit code 1 if any
node textcheck.mjs ../film.html 0.25     # a finer sweep
```

`runtime/film.js` shrinks a statement or caption that is wider than its room and logs a warning; the sweep collects them, plus page errors, so a type size that would wander from shot to shot is caught before a render. Matters most for vertical films ([19-vertical.md](../19-vertical.md)).

## The short factory

Spoken, subtitled vertical shorts on a line: one `spec.json` per video, a command per step. The format of the spec and the whole line: [23-short-factory.md](../23-short-factory.md).

```bash
node new.mjs lyapunov --genre one-life --lang ru        # videos/lyapunov/spec.json + voice.txt from a genre template (--genres lists the 11)
node make.mjs ../videos/lyapunov/spec.json --draft      # lint, voice, page, draft render, review: about 2 minutes
node make.mjs ../videos/lyapunov/spec.json              # final render, review, captions, cover, post text, upload export
node make.mjs ../videos/*/spec.json                     # a batch: the voice is cached per sentence, an unchanged render is skipped
```

| Tool | What it does |
|---|---|
| `make.mjs` | the orchestrator. Options: `--draft`, `--shot id[..id]`, `--out dir`, `--no-render` (stop at the page), `--no-qa`, `--no-post`, `--no-lint`, `--force`, `--inline`, `--strict`. Writes `out/` next to the spec: `film.html`, `voice.*`, `spec.resolved.json`, `<id>.mp4`, `qa/`, `captions.srt`, `cover.jpg`, `post.md`, `exports/`. Exit 0 all passed, 1 lint errors or a failed review, 2 a tool failed |
| `voice.mjs script.txt out/voice` | text to `voice.wav` + word and phrase timings; `--engine edge` (free, `pip install edge-tts`, runs as an external tool) or `openrouter` (paid, `OPENROUTER_API_KEY`); `--voice`, `--rate`, `--gap`, `--sentence-gap`, `--voices ru` lists voices. Synthesizes sentence by sentence, cuts the service's padding, calibrates word times to the audio (its offsets run about 0.16 s ahead) |
| `lint-spec.mjs spec.json [--voice out/voice] [--json]` | checks a spec before anything is made: budgets, anchors against the voice, blocks and their parameters, facts with sources, genre rules, leftover `TODO`s. Exit 1 on errors |
| `qa.mjs film.html --video v.mp4 [--spec s.json] [--out dir] [--strict]` | the automatic review: frame 0 motion, hook, dead stretches, safe zones, overlaps, text-fit warnings, statement and word budgets, voice pace, loudness, black and frozen frames; writes `report.md`, `report.json`, `sheet.png`, `poster/`. Exit 1 on a failure |
| `post.mjs out/` | `captions.srt`/`.vtt` from the voice, `cover.jpg` (1080x1920) and a 4:5 crop, `post.md` (title, hook, description, sources, tags, alt text), `exports/<id>-upload.mp4` (crf 22) |
| `new.mjs id --genre g` | a spec and a voice text from `templates/genres/<g>.json`; refuses to overwrite |
| `textcheck.mjs film.html` | the sweep for text-fit warnings alone |

Edge TTS talks to the service behind Microsoft Edge's "Read aloud": free and keyless, but not an official public API. It is right for drafts and for projects where that is acceptable; for a commercial release use the `openrouter` engine (models such as `openai/gpt-4o-mini-tts` or `mistralai/voxtral-mini-tts-2603`; it returns no word times, so they are spread by letter count and marked `approx`).

## Stills

```bash
node still.mjs ../film.html ../stills/ 12.5 34 61.2          # frames at these timecodes, full size
node still.mjs ../film.html ../stills/ two fast@0.3          # runtime/film.js shots, at 70% or a given fraction
```

## Reference breakdown

```bash
node analyze.mjs ../reference.mp4 ../ref/          # report.md, analysis.json, sheet-NN.png, shots-NN.png
node analyze.mjs ../reference.mp4 ../ref/ --scene 0.1   # more sensitive cut detection
```

The report gives the shot count and lengths, cuts per 10 s, tempo over time (8 s windows), how firmly cuts follow the tracked beat grid, and loudness dips; the sheets hold a frame every 0.5 s and the middle frame of every shot. What to do with it: [14-long-form.md](../14-long-form.md).

## Beat map of a track

```bash
node beatmap.mjs ../track.mp3 ../track.beats.json --trim ../track.wav
```

Tempo map for `Film.create({ tempo })`, beats, downbeats, quiet stretches, strong hits; `--trim` cuts the track so the first downbeat is at 0:00. `audio-analysis.mjs` holds the shared code: decoding through ffmpeg, spectral flux, local tempo, a dynamic-programming beat tracker.

## Speed

Rendering is still slower than real time. Iterate on fragments with `--draft`, render the whole film only for the final cut, and run `--profile` when a render feels slow: it names the timecodes to look at. Rules for writing pages that render fast are in [13-performance.md](../13-performance.md).

## Music report

```bash
node music-report.mjs ../runtime/test/fixtures/score-basic.json ../music-report/ --wav ../track.wav
node music-report.mjs ../film.html ../music-report/       # window.__score and window.__renderAudio() of the page
```

Eyes and lint for music, for an agent that cannot listen. The input is a Score (the format is in the header of [runtime/music-lint.js](../runtime/music-lint.js)): bpm, tracks with events, and optionally key, chords and sections. With a film page the script opens it with `?render`, reads `window.__score` and renders the audio through `window.__renderAudio()` (saved as `audio.wav`); `--wav` uses an existing file instead. A score JSON without `--wav` gets the piano roll and the lint only.

| File | What it shows |
|---|---|
| `report.md` | Lint findings by severity with bar and beat and what to do, the text summary of the score, per-track and per-section tables, loudness (integrated LUFS, max short-term, true peak) per section and overall |
| `piano-roll.png` | 1920 px wide: pitch of the bass, lead, arp and pad tracks (colour by role, opacity = velocity), one lane per drum voice, chord symbols, bars, sections with energy, lint markers, energy bars with notes per beat |
| `spectrogram.png` | ffmpeg `showspectrumpic`, log frequency 20 Hz to Nyquist, bar grid, section boundaries and integrated loudness in every section |
| `lint.json` | `{ findings, stats, score }` as returned by `MusicLint.lint` |

Exit code 1 when the lint has `error` findings (a note outside both the chord and the key on a strong beat), 2 when the tool failed, otherwise 0. Chrome is found like in the other tools (`CHROME_PATH` or the installed Chrome); ffmpeg and ffprobe on PATH. The linter itself is a pure function and also runs without a browser: `const { findings, score } = require('../runtime/music-lint.js').lint(score)`; `MusicLint.describe(score)` gives a compact text summary a model can read. Rules and thresholds are documented in the header of `runtime/music-lint.js` and can be overridden or disabled through `opts` (`{ disable: ['loop'], leapWarn: 14 }`).

What to look at first: errors, then `strong-beat-chord`, `clash` and `parallel-perfects` (harmony), `loop` and `flat-dynamics` (the music feels mechanical), `density-vs-energy` and `drum-groove` (the structure does not lift), and in the loudness table whether the chorus is at least 2 to 3 LU louder than the verse.
