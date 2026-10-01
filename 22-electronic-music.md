# Electronic music from open-source tools

The chiptune generator ([18-music-generation.md](18-music-generation.md)) fits a retro film. For a modern backdrop (house, techno, lo-fi, a driving bed under an explainer) do not write synths: install an open-source engine, ask it for a track at the film's tempo and length, and mix it in with `render.mjs --music`. There is no step "find a track, check its licence": the track is made for the film.

There are two engines, and they are good at different things:

| | **A. ACE-Step 1.5** (a model writes the track) | **B. Strudel** (patterns as text, rendered offline) |
|---|---|---|
| Sound | a finished modern mix; the kit's owner listened to house, tech house, techno, lo-fi, synthwave and disco takes and judged the sound very good | thin: raw oscillators and a few CC0 drum samples. Judged bad by the same listener |
| Control | a text prompt, `bpm`, key, length, a seed. No sections or energy curve (not tested: asking for a drop in the prompt) | every note and every section: `SECTIONS` is the energy curve, bars equal to the film's bars |
| Tempo | close to the request, not exact: it runs 0.1-0.4 bpm off, so a take slips 0.1-0.4 s over a minute. `grid-check.mjs --fit` measures the real tempo | exact by construction |
| Needs | an NVIDIA GPU (a 6 GB laptop card works), 12 GB of disk, [uv](https://docs.astral.sh/uv/) | Node, Chrome, ffmpeg. No GPU |
| Use for | the music of a film | a plain bed when exact section control matters more than sound, or a machine without a GPU |

## The tools and their licences

"Tool licence" is the licence of the program you run. "Output" is what ends up in your WAV. The rule that keeps the kit clean: **a GPL or AGPL tool is fine as a program that you run (Strudel's FAQ: the music you make with it is yours); a sample is not fine unless it is CC0, because the sample itself is in your WAV.**

| Tool | Job | Tool licence | Output | Status here |
|---|---|---|---|---|
| [ACE-Step 1.5](https://github.com/ACE-Step/ACE-Step-1.5) | text to instrumental music, locally | MIT (the repo; the model card on Hugging Face says `license: mit` too) | the model card says the output may be used commercially and that it was trained on licensed, royalty-free and synthetic data; the kit has no means to check that. The project's disclaimer asks you to check originality and to disclose AI involvement: do it where a platform asks | **tested**: Windows, Python 3.12 through uv, RTX A1000 6 GB |
| [strudel-render](https://github.com/BlairCurrey/strudel-render) (`npx`) | pattern text to WAV, in headless Chrome, chunks in parallel, 4x real time | AGPL-3.0 | yours; only the sounds you use matter | **tested** on Windows, Node 24, Chrome |
| [Sonic Pi samples](https://github.com/sonic-pi-net/sonic-pi/blob/dev/etc/samples/README.md) | CC0 drums, hats, basses, risers: `bd_haus`, `bd_klub`, `bd_tek`, `bd_808`, `sn_*`, `hat_*`, `elec_*`, `bass_trance_c`, `ambi_*` | CC0 (each from Freesound, CC0) | free | **tested**, loaded from a pinned commit by URL |
| Strudel's own synths (`sine`, `sawtooth`, `square`, `triangle`, `supersaw`, `white`, `pink`, `zzfx`) | kick (sine with a pitch drop), bass, stabs, pad, noise risers | AGPL-3.0 (the engine) | free: nothing is sampled | **tested** |
| [Mutable Instruments Plaits](https://github.com/pichenettes/eurorack) | MIT code for analog kick, snare, hat, chords, swarm: a reference if the synths are not enough | MIT (STM32 projects) | free; keep the copyright line, do not use the name | read, **not used** |
| [Surge XT](https://surge-synthesizer.github.io/) CLI | MIDI to WAV with a real synth; factory patches are CC0 | GPL-3.0 | free | **not tested**: a Windows installer, an agent cannot just `npm install` it |
| [free-midi-chords](https://github.com/ldrolez/free-midi-chords) | 13k chord progressions as MIDI | MIT | free | **not tested**, pop-flavoured |

**Do not use**, whatever you find on a list: Mutable Instruments Grids (GPL: its pattern table must not be copied), Hydrogen and supersaw sample packs (GPL), `tidal-drum-machines` and `dirt-samples` (no clear licence; Strudel loads them for `s("bd")`), datasets under CC BY such as NRG-CP, EDM-HSE and Groove MIDI (every video would need a credit), anything CC BY-NC (Tegridy, the MusicGen weights), and repositories with no licence file (DnBer). Embedding is another matter: do not copy AGPL or GPL **code** (Strudel, TidalCycles, subsequence) into the kit. Running it is fine.

## A. ACE-Step: install

ACE-Step stays **outside the kit** (about 12 GB with the models). The scripts look for it in `local/ACE-Step-1.5` (add `local/` to `.git/info/exclude`) or in `$ACESTEP_DIR`.

```bash
git clone --depth 1 https://github.com/ACE-Step/ACE-Step-1.5.git local/ACE-Step-1.5
uv sync --project local/ACE-Step-1.5      # Python 3.11-3.12 and torch with CUDA 12.8: a few minutes
```

The models (about 10 GB, from Hugging Face) download on the first generation: 4 minutes at 40 MB/s. Check the GPU first: `uv run --project local/ACE-Step-1.5 python -c "import torch; print(torch.cuda.is_available())"`. A CPU, AMD or Apple route exists upstream and was not tried.

## A. ACE-Step: generate

```bash
uv run --project local/ACE-Step-1.5 python render/ace-gen.py --out local/ace-out --name genres --jobs render/ace-genres.json
node render/ace-batch-check.mjs local/ace-out/genres-report.json
```

[`render/ace-gen.py`](render/ace-gen.py) runs a list of jobs in **one process**, because a cold start costs 1-3 minutes (the import of torch alone took 63 s here, probably the real-time antivirus) and then a take of 60 s costs 14-34 s. It runs in the mode for 6 GB cards: the DiT only, INT8, offload to the CPU, no language model (`thinking=False`). One job is a caption, `bpm`, `keyscale`, `duration` (10-600 s) and a list of `seeds`; one WAV (48 kHz) per seed. The same prompt and seed give **the same file, byte for byte** (checked on five takes), so a good take can always be made again.

[`render/ace-genres.json`](render/ace-genres.json) is the prompt library, one job per genre. A caption that worked: the genre, the drums, the bass, the harmony or lead, the mix and the mood, and **"no vocals"**. Change the genre words and the numbers, keep the shape.

| Genre | BPM asked | BPM fitted | Slip over 60 s | Pulse contrast | Loudness |
|---|---|---|---|---|---|
| deep house | 124 | 123.75 | 0.12 s | 9.5 dB | -13.3 LUFS |
| tech house | 126 | 125.70 | 0.14 s | 7.1 dB | -16.1 |
| melodic house | 122 | 121.70 | 0.15 s | 5.7 dB | -13.7 |
| techno | 130 | 129.70 | 0.14 s | 4.6 dB | -17.0 |
| lo-fi | 84 | 84.50 | 0.36 s | 7.4 dB | -15.8 |
| synthwave | 110 | 109.75 | 0.14 s | 5.9 dB | -20.1 |
| ambient | 70 | 69.75 | 0.21 s | 7.4 dB | -17.3 |
| disco house | 120 | 119.70 | 0.15 s | 5.9 dB | -15.0 |

Drum and bass (174) is left out: its fitted tempo is 171.3 with a pulse contrast of 2.9 dB, so it does not sit on a grid that a script can verify. Other genres were not tried. Measure a new one before you rely on it.

"Fitted" is what `grid-check.mjs --fit` finds: the constant tempo, within 3 bpm of the request, that puts the pulse on a grid for the whole take. The model is a little slow every time (lo-fi is a little fast). **Use the fitted number as the film's tempo**: `Film.create({ tempo: 125.7 })`, and the cuts at bar lines follow the take instead of drifting 0.14 s (three frames at 24 fps) away from it.

## A. ACE-Step: put it in the film

1. Ask for `duration` = the film's length plus 2-3 s, and `bpm` = the tempo you want. Three seeds per prompt: give the human the three and let them pick.
2. `node render/grid-check.mjs take.wav --bpm 126 --sections all:N --fit` (N = whole bars in the take). Take the fitted tempo.
3. The take does not start on a bar line: `node render/beatmap.mjs take.wav take.beats.json --trim take-trimmed.wav` cuts the start so that a downbeat is at 0:00. **Which beat is "one" is a guess**: it takes the beat with the most low end, and in four-on-the-floor music all four are equal. On the Strudel test track, where "one" is known to be 0:00, it said 1.42 s (three beats late); on a tech house take it said 1.42 s again. Shifting by whole beats keeps the cuts on the beat, but the phrases (the 4- and 8-bar sections of the music) may start on the wrong beat of the bar. Listen to the trimmed take, and if it is off, cut by whole beats yourself: the beat times are in `take.beats.json`, a beat is `60 / fitted` s.
4. `Film.create({ tempo: <fitted> })`, with the shot lengths in bars. Render: `node render/render.mjs film.html film.mp4 --music take-trimmed.wav --loudnorm`. If the page plays its own score, add `--no-audio`, or the two are mixed. `--loudnorm` matters: the takes sit between -13 and -20 LUFS.
5. End the music: a take stops at its length, and nobody has checked that it ends on a phrase. Fade the last 2-3 seconds (`afade=t=out`) or cut the film to the music's end.

## Check a take without ears

```bash
node render/grid-check.mjs take.wav --bpm 126 --sections all:15 --fit
```

For a model take `--sections` is only a window (one section of N bars). The script prints the fitted tempo, the contrast of the pulse (the energy of the eighths against the points halfway between them: above 3 dB is a pulse, a kick-driven track gives 7-10 dB), and where the pulse sits against the grid. The phase of a pulse found in the onsets is known only modulo an eighth; the bar line is what `beatmap.mjs --trim` guesses (see step 3 above). A kick that pulses the sub is found in the low band, and its lag is exact. Level, loudness (`ffmpeg -af ebur128`) and the rest of `ace-batch-check.mjs` are numbers only: **whether it is good music is for a human to say**, so give them the takes before the film is rendered.

## A. ACE-Step: what to know

- **Cold start**: 1-3 minutes, then 14-34 s per take. Batch your jobs.
- **Log noise**: `model.to() raised NotImplementedError (AffineQuantizedTensor ...)` at INFO level appears on every offload and is harmless: the takes are fine.
- **No sections, no energy curve.** The prompt is the whole control. A breakdown or a drop on a given bar (the Strudel template's strength) was not tried.
- **Tempo is close, not exact.** `beatmap.mjs` alone misleads here: it counts whole beats (so "130" can be 129.7) and folds very slow and very fast music (70 and 174 bpm read as 140 and 93), which at first made two good genres look bad. `grid-check.mjs --fit` is the check.
- **Another GPU**: other VRAM tiers pick other models and settings by themselves (`acestep/gpu_config.py`); only the 6 GB path was run.
- **A slow first start** (the antivirus scanning torch) can look like a hang.

## B. Strudel: patterns as text

Use it when you need exact structure, no GPU, or a plain bed. Everything below was run and checked.

### Install and render (Strudel)

Needs Node 22 or newer, a Chromium-based browser (Chrome or Edge is found on its own; otherwise add `--install-browser`) and `ffmpeg`. Nothing else is installed: `npx` fetches the tool on first use.

```bash
npx strudel-render examples/house/track.js -o track.wav --end 64 --tail 1 > render.log 2>&1
node render/grid-check.mjs track.wav --bpm 124 --sections intro:8,build:8,drop:16,break:8,drop2:16,outro:8 --riser build,break
```

`--end` is the number of **bars** (Strudel's cycle is one bar when `setcps(BPM / 60 / 4)`). The 64 bars above render in 30-50 s. `--tail` is the ring-out after the end (5 s by default; the film's `-t` cuts the extra). `--bits 32` writes float and cannot clip. Redirect the output to a file: a pipe into `head` closes the pipe and kills the render.

### The Strudel template

[`examples/house/track.js`](examples/house/track.js) is one table and nine layers:

| Layer | Pattern (one bar, 16 steps) |
|---|---|
| kick | four on the floor; it ducks everything on orbit 2 (a sidechain) |
| clap | beats 2 and 4 |
| hat, ohat | offbeat eighths, an open hat or cymbal on the offbeats |
| hat16 | sixteenths, quiet |
| bass | eighth-note saw, the cutoff opens and closes over four bars; the root follows the chords |
| stab | supersaw chord on steps `~ x ~ ~ ~ x ~ x` |
| pad | the chord held for the bar, a slow filter |
| riser | white noise, the low-pass sweeps up over the whole section |

Sections choose layers, and that is the energy curve (the same idea as `energy` in [18](18-music-generation.md)): the intro is a soft kick and a pad, the build adds the kick, hats and bass, the drop all of it, the break strips to pad and stabs, the outro leaves kick, hat and pad. `riser: true` adds the sweep, `gap: true` stops the rhythm for the last beat before a drop, `crash: true` puts a crash on the first beat.

What to change: `BPM` (house is usually 120-128), `CHORDS` and `ROOTS` (one chord per bar, the four loop), `SECTIONS` (`bars` equal to the film's bars, the layer lists) and the layer patterns, which are plain mini-notation strings. Keep the machinery: the orbit and ducking, the `mask` for the gap, one pattern per section, the `postgain` at the end. Only this house template was run; other genres are changes to the layer patterns that nobody has tried yet.

### Lock a Strudel track to the film

1. `Film.create({ tempo: 124 })` with the template's `BPM`, and a `bars` count per shot that adds up to the sections' bars. Build the shot table and `SECTIONS` from one list.
2. Render the track, run `grid-check.mjs`, then `node render/render.mjs film.html film.mp4 --music track.wav --loudnorm`. If the page also plays its own score, add `--no-audio`, or the two are mixed.
3. **Look at the lag.** A sample has its own attack: `bd_haus` peaks about 47 ms after its start, a bit more than one frame at 24 fps, so on a cut the kick is late. `grid-check.mjs` prints it and the fix (`ffmpeg -ss 0.047 -i track.wav track-shifted.wav`). A synthetic sine kick peaks about 25 ms after.
4. Do not run `beatmap.mjs` on a Strudel track. It is for a track you found. On the test track it put the first downbeat at 1.42 s and the first bars at 82 BPM; the grid of a generated track is known by construction.

### Check a Strudel track

`grid-check.mjs` (without `--fit`: the tempo is known) prints, for the 64-bar test track at 124 BPM:

```
section    start s  bars   level dBFS  low dBFS  kick on-grid vs halfway dB
intro         0.00     8      -19.9     -20.9      22.4  (lag 47 ms)
build        15.48     8      -13.3     -14.2      22.8  (lag 47 ms)
drop         30.97    16      -13.0     -14.0      22.2  (lag 47 ms)
break        61.94     8      -26.1     -35.2     no kick
seam build -> drop: beat 3 -> beat 4: full -12.9 -> -24.2 dBFS, low -13.8 -> -34.5 dBFS  (a gap: the rhythm stops)
riser in break: high band per bar -53 -58 -49 -41 -37 -34 -33 -32 dBFS, last third is 23.0 dB above the first (rises)
```

| Reading | Healthy | If not |
|---|---|---|
| kick on grid vs halfway | above 15 dB in every section with a kick | the kick is off the grid: wrong `setcps`, a `.late()` left in, or a different `--bpm` |
| kick lag | under 20 ms, or trimmed | trim the start by the printed amount |
| level per section | grows with the layers; the drop is the loudest | flat levels mean nothing changes between sections: add or remove layers |
| seam gap | `(a gap: the rhythm stops)` before a drop | `gap: true`, and a rhythm layer that has events in the last beat |
| riser | `(rises)` | it restarted in the last bar (a section split in two `arrange` entries) or was masked away |
| peak and loudness | under -1 dBFS before mastering | lower `.postgain`; the sum of nine layers peaks near +4 dBFS |

There is no piano roll and no lint for Strudel code (`music-report.mjs` and `MusicLint` read a Score): the numbers above and the human's ears are the checks. **Give the human the WAV before the film is rendered** and let them pick the BPM, the seed of the chords and the layers.

### Pitfalls (each of these happened while testing)

- **Backticks and double quotes are mini-notation in Strudel.** `` `<${x}>` `` is a parse error; build strings with single quotes and `+`.
- **One section, one pattern.** Splitting a section into two `arrange` entries restarts every `saw`, `slow` and `sine` in the second: the riser fell from -31 to -55 dB in its last bar. Silence the last beat with `mask`.
- **`mask` cuts events that start in the masked part.** A pad or a riser that is already sounding carries over. That is why the gap is "the rhythm stops".
- **`duckorbit` goes on the sound that causes the ducking** (the kick); the ducked sounds say `.orbit(2)`. Checked: the bass drops 15 dB right after the kick, and 0.3 dB with `duckdepth(0)`.
- **The first run can fail** on `error loading ".../piano.json"`: the tool loads the default sample banks from a CDN at start-up, even if the pattern never uses them. Repeat the run. It needs network, and so do the Sonic Pi samples (they are fetched by URL; the pinned commit keeps the render repeatable).
- **No limiter.** The mix clips (peak +3.9 dBFS, 37 thousand samples) unless the master gets headroom; `--normalize` only scales the peak. Mastering is `--loudnorm` in `render.mjs`.
- **Never `s("bd")`-style names**, only the names you registered with `samples({...})` or the synth names.
- **wirbel**, another Strudel renderer, is Linux-only.

## What the Strudel path does not do

The chord stabs loop four chords; there is no developing hook as in `compose.js`, and nothing here judges taste. The numbers prove the track is on the grid, has a structure and does not clip. It sounds thin: the kit's owner judged it bad next to the model's takes.

## Sources

- [ACE-Step 1.5](https://github.com/ACE-Step/ACE-Step-1.5), its [install guide](https://ace-step.github.io/ACE-Step-1.5/en/INSTALL), [inference guide](https://github.com/ACE-Step/ACE-Step-1.5/blob/main/docs/en/INFERENCE.md) and [model card](https://huggingface.co/ACE-Step/Ace-Step1.5): licence, parameters, the low-VRAM mode
- [strudel-render](https://github.com/BlairCurrey/strudel-render), [Strudel FAQ](https://strudel.cc/learn/faq/): the engine and its licence statement
- [Sonic Pi samples](https://github.com/sonic-pi-net/sonic-pi/blob/dev/etc/samples/README.md): CC0 with a link to the source of each sample
- [Mutable Instruments eurorack](https://github.com/pichenettes/eurorack): MIT for the STM32 projects (Plaits), GPL-3.0 for the AVR ones (Grids, Braids)
- [Surge XT](https://surge-synthesizer.github.io/): a headless CLI, CC0 factory patches
