# Chiptune: a score as a string

A code-drawn film needs sound that is also code. `Film.audio` gives you instruments to schedule one by one; `runtime/chip.js` gives you a whole score as one short string, the way the [Pyxel](https://github.com/kitao/pyxel) retro engine does: four channels, four tones, a compact text notation (MML, music macro language) that a model can write and read back. For full arrangements with real drums, dynamics, echo and ducking there is a second path: a **Score** (music as data), described in [Scores: music as data](#scores-music-as-data) below; `compose.js` generates them.

```html
<script src="../../runtime/film.js"></script>
<script src="../../runtime/chip.js"></script>
```

No dependencies, no audio files, works from `file://`. Same rules as the rest of the kit: picture and sound read one timeline, nothing uses `Math.random` (the same input gives the same samples, bit for bit), a score is data.

## Why chiptune fits

The constraint is the brief, the same idea as a 16-color palette ([15-pixel-retro.md](15-pixel-retro.md)). Four tones and four channels take away what a model makes badly (pads that turn to mud, reverb on everything, "cinematic" drones) and keep what it makes well: rhythm, a motif, a chord loop. A 100-character string is easy to revise ("move the lead up a third", "drop the arp in bars 1-4"), and it lands on the beat because the beat grid is in the text.

| Tone | Default | Use |
|---|---|---|
| `@0` | triangle | bass, kick, soft lead |
| `@1` | square | lead, hard bass |
| `@2` | pulse, 25% duty | arps, thin lead that cuts through |
| `@3` | noise | hiss, cymbal-ish washes; the note is brightness, not pitch |
| `@4` `@5` `@6` `@7` | drums | kick, snare, hat, open hat: real drum hits, see [Drums](#drums) |
| `@8` `@9` `@10` | drums | tom (the note is its pitch), crash, clap |

Add or replace tones with `opts.tones`: `{ 4: { type: 'sine', gain: .8 } }`, `{ 5: { type: 'pulse', duty: .125 } }`, `{ 6: { type: 'wave', real: [0, .5], imag: [1, 0] } }` (Fourier coefficients). `gain` balances loudness between tones.

## MML cheat sheet

Whitespace, `|` (a bar line for the eye) and `// comments` are ignored; commands are case-insensitive.

| Command | Meaning | Range, default |
|---|---|---|
| `T140` | tempo, BPM | 1-, 120 |
| `L8` | default length: 4 quarter, 8 eighth, 16 sixteenth, 12 triplet eighth | 1-192, 4 |
| `C D E F G A B` | a note; length after it: `F16`, dots after that: `C4.` `C4..` | |
| `C# C+ B-` | sharp, sharp, flat | |
| `R` `R8` `R4.` | rest | |
| `O5` `>` `<` | octave (`O4` A = 440 Hz), one up, one down | -1..9, 4 |
| `@1` | tone | 0-3 (or yours), 0 |
| `V100` | volume | 0-127, 100 |
| `Q80` | gate: percent of the slot that sounds; 100 is legato-tight, 0 is silent | 0-100, 80 |
| `K12` | transpose in semitones | 0 |
| `Y-15` | detune in cents | 0 |
| `C4&16` | tie: same pitch becomes one long note (`C4&C4` too) | |
| `C&D` | slur: different pitch, no gap, one voice, no new attack | |
| `[ ... ]4` | repeat 4 times, nesting allowed; `[ ... ]` with no count repeats until `maxSeconds` | |
| `@ENV1 { 127, 10, 80, 60, 0 }` | volume envelope: start, then (ticks, volume) pairs; linear, the last value holds | slots 1-, `@ENV0` off |
| `@VIB1 { 24, 12, 30 }` | vibrato: delay (ticks), period (ticks), depth (cents, peak) | `@VIB0` off |
| `@GLI1 { 2400, 10 }` | glide: start this many cents away, return to the note in that many ticks; `*` means "from the previous note" and "the note's length" | `@GLI0` off |

Defining a slot also switches to it: `@ENV1 {...}` is "define and use". Use it later with `@ENV1`, turn it off with `@ENV0`.

The time base is **192 ticks per whole note** (48 per quarter), so `L1`-`L192` map straight onto tick counts, and the tick durations in `@ENV`, `@VIB` and `@GLI` are fractions of a beat: 48 ticks = one beat, 12 ticks = a sixteenth. Ticks become seconds with the tempo in force when the note starts.

Details the table does not say:

- Envelope values multiply `V`: level = `V/127 * env/127`. It restarts on every note except inside a slur and inside a tie.
- `Q` shortens the sound, not the slot: `T120 L4 C D` puts the notes at 0 s and 0.5 s and each sounds for 0.4 s (Q80). Use `Q100` for drums with their own envelope.
- Glide runs in cents (exponential in Hz), so it sounds even. On noise it sweeps the brightness.
- Slots belong to a track. To share them, put them in `opts.prefix` (MML placed before every track), and end the prefix with `@ENV0 @VIB0 @GLI0` so no slot is active by accident.

## Two functions

```js
const { end } = Chip.play(ac, t0, out, tracks, opts);      // schedule everything; end = context time when the last note ends
const lead = Chip.instrument('T140 @1 O5 L16 CEGC', opts); // (ac, t, out, gain) like Film.audio.*
lead(ac, at(f.time(8)), bus.out, .7);
```

`tracks` is a string, or an array of strings and `{ mml, gain, pan, tone }` (gain defaults to `.3` per track, pan −1..1, tone is the initial `@`). `opts`: `gain` master (1), `prefix`, `tones`, `seed` (only noise start offsets use it), `maxSeconds`, `limit: false` (no soft limiter).

`Chip.parse(mml, opts)` returns `{ events, length, infinite }` and is pure (also under Node: `require('./runtime/chip.js')`). Use it for visuals that follow the notes, or to check a score:

```js
const { events } = Chip.parse('T120 L4 CDE');
// [{ t: 0, dur: .5, midi: 60, freq: 261.6, vol: .79, tone: 0, gate: .8, env: null, vib: null, gli: null, tie: false }, { t: .5, ... }, { t: 1, ... }]
```

`t` is seconds from the track start (tempo changes honored). `dur` is the note's slot, the time to the next note, and tied notes are merged into one event with the summed slot. `gate` is kept separate, so the note sounds for `dur * gate`. Legato sets the earlier note's `gate` to 1 and marks the next one `tie: true`. `env`, `vib`, `gli` come resolved to seconds. Syntax errors throw with the position: `Chip.parse: unexpected "X" at char 4: "C D >>X<< E"`.

**Infinite repeats.** `[ ... ]` without a count is unrolled until `maxSeconds` and the track is cut there (a note that crosses the limit is shortened). `maxSeconds` is a number (default 60) or `'longest'`, which means "the length of the longest finite track in this call" (60 if all are infinite): a drum loop then ends together with the melody. In a film, give the loop the exact length you need.

**Other helpers.** `Chip.midiToHz(m)`, `Chip.noteToMidi('A4')` (also `'C#5'`, `'Bb3'`), `Chip.TICKS` (192).

## Sync with the film

MML tempo is constant in a string, and so is a `Film` tempo without segments. Give both the same number, start a score on a bar line, and the score and the shots share the grid:

```js
Film.create({ tempo: 140, /* ... */ score });

function score(ac, bus, f, at) {
  const t0 = at(f.bar(2));                                   // the chiptune starts at bar 3
  if (t0 >= 0) Chip.play(ac, t0, bus.out, TRACKS, { prefix: PREFIX, maxSeconds: f.bar(10) - f.bar(2) });
  // an accent on every payoff word
  for (const h of f.hits) { const t = at(h.t); if (t >= 0) Chip.sfx.select(ac, t, bus.out, { seed: h.t * 100 | 0 }); }
}
```

How the grid maps to MML:

| Film | MML |
|---|---|
| beat (`f.time(b)`) | `L4` in a `x/4` meter |
| half a beat | `L8` |
| a bar in 4/4 | 16 sixteenths, or `L1`, or `[C4]4` |
| a bar in 3/4 | 12 sixteenths, `L4` x 3 |
| a triplet on the beat | `L12` (three per quarter) |
| the tempo of the film | `T` with the same BPM in every track |

If the film changes tempo (`tempo: [{ bar: 0, bpm: 120 }, { bar: 16, bpm: 150 }]`), cut the score at the change (a tempo `ramp` cannot be followed by MML at all, use `Film.audio` instruments there): one `Chip.play` per segment with its own `T`, each started at `at(f.bar(n))`. A single string with a different `T` would drift from the shots.

In the live preview a seek starts the score in the middle: `at()` returns −1 for moments that are already past, and `Chip.play` silently skips notes that would start before `ac.currentTime`. For a bed that began before the seek, anchor it on a moment that is still ahead: `const t0 = at(f.bar(8)) - (f.bar(8) - f.bar(2))` (when `at(f.bar(8)) >= 0`). Renders always start at 0 and need none of this.

## A worked loop: 8 bars, 4 channels

A minor, `Am F C G Am F G E`, 140 BPM, 13.7 s. Bass on triangle, lead on square with a vibrato that only shows on long notes, an arpeggio on pulse, drums on one channel that switches between a triangle kick with a pitch drop and noise for snare and hats. Paste it as is.

```js
const K = '@0 @ENV1 @GLI1 O2 C16', S = '@3 @ENV2 @GLI0 O5 C16', H = '@3 @ENV3 @GLI0 O7 C16', _ = 'R16';
const drumBar = [K, _, H, _, S, _, H, _, K, _, H, K, S, _, H, H].join(' ');

const PREFIX = 'T140 @ENV1 { 127, 16, 0 } @ENV2 { 127, 22, 0 } @ENV3 { 80, 6, 0 } '     // kick, snare, hat
             + '@ENV4 { 127, 48, 80 } @ENV5 { 127, 10, 30 } @VIB1 { 24, 12, 30 } '      // lead, arp; lead vibrato
             + '@GLI1 { 2400, 10 } @ENV0 @VIB0 @GLI0';                                  // kick glide; everything off

const TRACKS = [
  { gain: .38, mml: 'O2 L8 Q75 @0 [A>A<]4 [F>F<]4 [C>C<]4 [G>G<]4 [A>A<]4 [F>F<]4 [G>G<]4 [E>E<]4' },      // bass
  { gain: .30, mml: '@1 O5 L8 Q85 @ENV4 @VIB1'                                                              // lead
      + ' E4 C8 E8 A4 G8 E8 | F4 A8 >C8< A4 F8 C8 | G4 E8 G8 >C4< G8 E8 | D4 G8 B8 >D4< B8 G8'
      + ' | E4 C8 E8 A4 >C4< | A4 F8 A8 >C2< | B4 G8 B8 >D4< B8 G8 | G+4 E8 G+8 B4&8 R8' },
  { gain: .22, pan: -.3, mml: '@2 O4 L16 V80 Q90 @ENV5'                                                    // arp
      + ' [A>CEC<]4 [FA>C<A]4 [CEGE]4 [GB>D<B]4 [A>CEC<]4 [FA>C<A]4 [GB>D<B]4 [EG+BG+]4' },
  { gain: .32, pan: .3, mml: `L16 Q100 [ ${drumBar} ]8` },                                                 // drums
];

Chip.play(ac, t0, out, TRACKS, { prefix: PREFIX });
```

Measured on this loop (offline render, 48 kHz, soft limiter on): peak 0.53-0.56 depending on where it starts (the start's sub-block alignment moves a few samples), RMS 0.17 over the loop. Every track is exactly 8 bars long, so it loops by playing again at `t0 + 8 * 4 * 60 / 140`.

Patterns worth copying: `[A>A<]4` an octave-bouncing bass in one repeat per bar; `>C<` for one note above the octave and back; `[ ...bar... ]8` for a drum bar built from named one-step strings (`K`, `S`, `H`, `_`); `B4&8` tying a quarter to an eighth for a long last note.

## Scores: music as data

MML is good for a riff by hand. For anything with drums, dynamics, several sections or a generator behind it, use a **Score**: plain data that `Chip.playScore` plays and `Chip.scoreEvents` reads. [`runtime/compose.js`](runtime/compose.js) generates Scores from a short plan (chords, feel, sections); see [18-music-generation.md](18-music-generation.md). You can also write one by hand:

```js
const SCORE = {
  bpm: 120, beatsPerBar: 4, length: 8,                       // length in beats
  tracks: [
    { name: 'bass', role: 'bass', voice: 'triangle', duck: true,
      events: [{ b: 0, d: .5, n: 33 }, { b: .5, d: .5, n: 33, v: .6 }, { b: 1, d: .5, n: 45 }, { b: 2, d: 2, n: 36 }] },
    { name: 'lead', role: 'lead', voice: 'square', gain: .4, vib: { delay: .3, rate: 5, depth: 15 },
      echo: { time: .75, fb: .4, mix: .3 },
      events: [{ b: 0, d: 1.5, n: 76 }, { b: 1.5, d: .5, n: 72, g: 79 }, { b: 2, d: 2, n: 69 }] },
    { name: 'drums', role: 'drums',
      events: [{ b: 0, voice: 'kick' }, { b: 1, voice: 'snare' }, { b: 1.5, voice: 'hat', v: .4 }, { b: 2, voice: 'kick' }, { b: 3, voice: 'snare' }] },
  ],
  duck: [{ b: 0, depth: .5, rel: .2 }, { b: 2, depth: .5, rel: .2 }],   // the ducked tracks dip under each kick
};
const { end } = Chip.playScore(ac, t0, bus.out, SCORE);
```

Everything is in **beats**; seconds come from `bpm` (or from a `timeOf` you pass, see the Film section). Fields, all optional unless marked:

| Score | |
|---|---|
| `bpm` | tempo, default 120 |
| `beatsPerBar`, `length` | metadata (4, and the length in beats) for you and for `compose.js`; `playScore()` returns `length` as the context time of beat `length`, the point where a loop restarts |
| `tracks` | required, an array of tracks |
| `duck` | `[{ b, depth 0..1, rel seconds }]`: dip events for the tracks that have `duck: true` |

| Track | |
|---|---|
| `name`, `role` | `role` is `'bass' \| 'lead' \| 'arp' \| 'pad' \| 'drums' \| 'fx'`. It picks the default voice and the default envelope; a `'drums'` track takes a drum name on every event |
| `voice` | `'triangle' \| 'square' \| 'pulse' \| 'saw' \| 'sine' \| 'noise'`, the default voice of the events (default from the role) |
| `gain` (`.5`), `pan` (`-1..1`) | track level and stereo position |
| `duty` | pulse width: `.125`, `.25`, `.5` (any `0.02..0.98`), or `[from, to]` for a PWM sweep over each note |
| `env` | `{ a, d, s, r }` in seconds, `s` is the sustain level 0..1; partial objects merge with the role default |
| `vib` | `{ delay, rate, depth }`: seconds, Hz, cents (peak) |
| `echo` | `{ time, fb, mix }`: `time` in beats, `fb` 0..0.6, `mix` 0..1 |
| `duck` | `true` = this track dips on `score.duck` events |
| `events` | required |

| Event | |
|---|---|
| `b`, `d` | start and duration in beats (drums ignore `d`) |
| `n` | MIDI note number, 60 = C4, 69 = A4 (a tom takes it as its pitch) |
| `v` | velocity 0..1, default `.8`; loudness follows `v^1.5` |
| `voice` | overrides the track voice; **required on every drum event**: `'kick' \| 'snare' \| 'hat' \| 'ohat' \| 'tom' \| 'crash' \| 'clap' \| 'rim'` |
| `g`, `gd` | glide: the pitch starts at MIDI note `g` and slides to `n` over `gd` beats (default 60 ms) |

```js
Chip.playScore(ac, t0, out, score, opts)     // -> { end, tail, length }: context times; end = last note off, tail = end plus the echo decay, length = beat `length`
Chip.scoreEvents(score, opts)                // -> [{ t, dur, midi, drum, voice, vel, gain, track, ti, role, b, d, glide }], pure, works in Node
Chip.scoreDucks(score, opts)                 // -> [{ t, depth, rel }] on absolute time
Chip.validateScore(score)                    // throws a readable error, or returns true
```

`opts`: `timeOf(beat)` maps a beat to context time (default `t0 + beat * 60 / bpm`), `from` (skip events that start before this context time; default "now", so a live seek plays only what is still ahead), `gain` (master, 1), `limit: false` (no soft limiter), `seed` (only noise start offsets). `scoreEvents` takes `timeOf`, `t0` and `from` too and is the way to make visuals follow the notes (`e.t`, `e.dur`, `e.track`, `e.drum`, `e.vel`).

A bad Score throws before any sound is made, with the path: `Chip score: track "dr" event 0: a drum event needs voice: one of kick, snare, ...`, `event 3: d (duration) must not be negative, got -1`, `track "lead": unknown voice "wobble" (...)`, `bpm must be a finite number, got NaN`.

## Voices and envelopes

| Voice | What it is | Use |
|---|---|---|
| `triangle` | soft, hollow | bass, pads, a gentle lead |
| `square` | 50% pulse, hard | lead, punchy bass |
| `pulse` | pulse with `duty`; `[from, to]` sweeps it over each note (PWM) | arps, thin leads; a sweep is the classic C64 shimmer |
| `saw` | bright, buzzy | pads, thick basses, brass-like leads |
| `sine` | pure | sub bass, soft bells |
| `noise` | seeded noise through a band-pass centred on the note (higher `n`, brighter) | hiss, risers, wind; for drums use the drum voices |

Envelope defaults follow the `role` (or the voice when there is none). Override any field with `env`:

| Role | a | d | s | r | Sounds like |
|---|---|---|---|---|---|
| `bass` | .004 | .06 | .9 | .06 | tight, full sustain |
| `lead` | .012 | .12 | .75 | .14 | gentle attack, a little bloom |
| `arp` | .002 | .12 | .3 | .05 | a pluck |
| `pad` | .22 | .3 | .8 | .45 | slow swell, long tail |
| `fx` | .004 | .25 | .3 | .2 | a short swell that dies away |

Attack is linear, decay and release are exponential (they sound even). A note shorter than `a + d` releases from wherever the envelope is; every note starts and ends at exactly 0, so there are no clicks. Vibrato is a sine on `detune` scheduled per note (nothing free-runs), starts after `delay` and fades in over its first cycle. Use it on notes of a beat or more; on 16ths it only smears. Glide is an exponential frequency ramp.

Levels are balanced so the same `gain` and `v` sit in the same range across voices (solo, gain .5, v .8: about -17 to -21 LUFS for a sustained note, noise a little lower). Balance roles with track `gain` first, velocity second.

## Drums

Real drum voices, not noise notes: each hit has its own pitch drop or filter, envelope and level, and is deterministic (`seed` only picks the noise slice). Same signature as `Chip.sfx`:

```js
Chip.drums.kick(ac, t, out, { gain: 1, pitch: 1, decay: 1, seed: 0 });   // -> { end }
```

`gain` multiplies the fixed level (1 = a full hit), `pitch` multiplies frequencies, `decay` multiplies the length. `Chip.drums.lengths` (or `Chip.drums.length(name)`) tells when each is silent.

| Drum | Sounds like | Length, s | Use |
|---|---|---|---|
| `kick` | sine falling 150 to 45 Hz, saturated, plus a click | 0.40 | the pulse: beats 1 and 3, syncopations, the drop |
| `snare` | band-passed noise crack + a 190 Hz tone body | 0.30 | backbeat on 2 and 4; rolls for fills |
| `hat` | very short high-passed noise | 0.07 | eighths or sixteenths, the grid |
| `ohat` | the same, longer | 0.42 | off-beat lift; a following `hat` **chokes** it (cuts it short) |
| `tom` | sine dropping from 1.9x its pitch; `n` sets the pitch (60 = about 118 Hz) | 0.45 | fills: run down the notes |
| `crash` | long high-passed noise, bright burst then a slow shimmer | 1.70 | bar 1 of a section, the end of a fill |
| `clap` | three short noise bursts and a longer fourth | 0.32 | with or instead of the snare |
| `rim` | a click and two short tones | 0.09 | soft accents, half-time verses |

**Groove basics.** Kick on 1 and 3, snare on 2 and 4, hats on eighths (accent the on-beats: `v .7` on, `v .4` off). Then vary: a kick a sixteenth before beat 3, an `ohat` on the last off-beat of every fourth bar, a **ghost** snare (`v .3`) just before beat 4. Low velocity is what makes a groove breathe; a flat `v` is a drum machine on a bad day. **Fills** in the last beat or two of a phrase: sixteenth snares rising in `v` (`.5` to `1`), or toms falling in pitch (`n` 55, 52, 48, 45), then a `crash` and a `kick` on the downbeat of the next section.

```js
const fill = [55, 55, 52, 52, 48, 48, 45, 45].map((n, i) => ({ b: 30 + i / 4, voice: 'tom', n, v: .8 + i * .02 }));
drums.events.push(...fill, { b: 32, voice: 'crash' }, { b: 32, voice: 'kick' });
```

**In MML.** Tones `@4` to `@10` are the drums: `@4` kick, `@5` snare, `@6` hat, `@7` ohat, `@8` tom, `@9` crash, `@10` clap. `V` is the velocity, the note length and `Q` and `@ENV` do not apply (the drum has its own envelope), and the note's pitch matters only for the tom.

```js
Chip.play(ac, t0, out, [
  { mml: 'T120 @4 V110 O3 [C4 R4 C4 R4]4', gain: .5 },                       // kick on every other beat
  { mml: 'T120 @5 V100 O4 [R4 C4]8', gain: .4 },                             // snare on 2 and 4
  { mml: 'T120 @6 V60 O4 L8 [C C]16', gain: .25 },                           // hats on eighths
]);
```

## Echo, pan and ducking

```js
{ name: 'lead', echo: { time: .75, fb: .4, mix: .3 }, pan: .2, duck: false, /* ... */ }
```

- **`echo`**: a feedback delay. `time` is in beats at the tempo of the track's first event (`.75` = a dotted eighth, the classic; `.5` an eighth; `1` a quarter), `fb` the feedback (clamped to 0.6), `mix` the level of the repeats relative to the dry signal, which stays at 1. The feedback path is low-passed at 3.2 kHz, so every repeat is darker and sits behind the note. It works best on a sparse lead; on a busy arp it is mud. `playScore().tail` says when the repeats have died away.
- **`pan`** -1..1. Bass and kick stay at 0; spread arps and pads (`-.3`, `.3`).
- **`duck`**: `true` puts the track in a group that dips at every event in `score.duck`: instantly to `1 - depth` (over 3 ms, no click), then linearly back to 1 over `rel` seconds. Put a duck event on every kick (`{ b, depth: .5, rel: .2 }`) and duck the bass, pads and arp: the kick gets its room and the mix pumps in time (the sidechain sound). Overlapping events never jump: a new dip starts from the current level.

**Deterministic by construction.** Chrome sums many inputs of one node in no fixed order, and a float sum of three or more terms depends on the order, so a bus with many overlapping hits does not render the same twice: 12 renders of 48 overlapping drum hits into one gain node gave 12 different files. `playScore` deals overlapping sounds to lanes (a sound sits on the first lane that is free, so at most one sound is audible per lane, and adding silence is exact), and adds lanes, tracks, the ducked group and the echo's wet and dry pairwise. The same score gives the same samples, bit for bit: 12 of 12 renders identical in the lane version.

Measured on the 8-bar demo (bass, arp, lead with echo, drums with a fill, ducking on bass and arp; offline, 48 kHz): integrated **-13.4 LUFS**, sample peak **-2.7 dBFS** (true peak -2.6 dBTP). With the default gains (`.5`) the stems sit at bass -19, lead -18, drums -18, arp -23 LUFS. For a film bed under words, take the master `gain` down to `.5`-`.6` and let `render.mjs --loudnorm` do the final level.

## Using a Score in a Film

Pass the Film's tempo map as `timeOf` and derive the clock once, as in [runtime/README.md](runtime/README.md), so the score also works when the preview starts in the middle:

```js
function score(ac, bus, f, at) {
  const zero = at(f.DURATION) - f.DURATION;                       // film time 0 on the context clock, also after a live seek
  const b0 = f.shot('world').b0;                                  // the score starts with this shot
  Chip.playScore(ac, zero, bus.out, SCORE, { timeOf: b => zero + f.time(b0 + b) });
  // sfx and ducks for words on the same clock
  for (const h of f.hits) { const t = zero + h.t; if (t >= ac.currentTime) Chip.sfx.select(ac, t, bus.out, { seed: h.t * 100 | 0 }); }
}
```

`timeOf` follows tempo changes and ramps because it goes through `f.time`; `from` defaults to the context's current time, so after a seek `playScore` starts only the notes that are still ahead (a note that began before the seek is skipped, like `Chip.play`). A render starts at 0 and needs none of this. To loop a section, call `playScore` again at `zero + f.time(b0 + score.length)`. To make the picture follow the music (a flash on every kick, a bar that jumps with the bass):

```js
const hits = Chip.scoreEvents(SCORE, { timeOf: b => f.time(b0 + b) });        // film time, no context needed
const kicks = hits.filter(e => e.drum === 'kick').map(e => e.t);
```

Duck the music under a voice or a sfx by adding `{ b, depth, rel }` events to `score.duck` before you play it, or with a gain node as in Mix below.

## Sound effects

`Chip.sfx.name(ac, t, out, { gain, pitch, seed })` plays a one-shot; `Chip.sfx.length(name)` (or the table `Chip.sfx.lengths`) tells you when it is silent, so you can schedule what follows or size a gap. `gain` defaults to `.5` (peaks 0.3-0.5), `pitch` multiplies every frequency, `seed` adds a small seeded change (about ±5% pitch, ±8% level): pass a different seed per occurrence so repeats do not grate.

| Name | Length, s | Sounds like | Use |
|---|---|---|---|
| `coin` | 0.34 | two high notes, up | pickup, +1 on a counter |
| `jump` | 0.20 | pulse sweeping up | jump, a rising number, an element leaving |
| `hit` | 0.14 | noise burst and a thump | a hit landing, a cut on the beat, a stamp |
| `explode` | 1.00 | noise falling to a rumble | an explosion, a collapse, a chapter's payoff |
| `laser` | 0.24 | square sweeping down fast | a shot, a scan, a line drawing itself |
| `powerup` | 0.50 | six-step rising arpeggio | a reveal, a level-up, "it works" |
| `blip` | 0.06 | one short tick | a character typed, a UI hover, a counter tick |
| `select` | 0.14 | two blips, up | a click, a menu choice, a shot change |
| `fall` | 0.60 | pulse sliding down | failure, a value dropping, a lost life |
| `land` | 0.10 | short thud | a landing, an object placed, a soft "set down" |

They match the kit's [juice checklist](10-games-juice.md): every action on screen gets a sound, and the sound is on the frame of the action (`at(f.time(beat))`, or the moment from your event list).

## Mix

- **Headroom.** Each track's default gain is `.3`; four full tracks peak around 0.5. A single track alone peaks at 0.13 (square) to 0.24 (triangle), which is right for music under a film and too quiet as a solo: raise `gain`. `Chip.play` ends in a `tanh` soft limiter, so the output stays under 0.964 whatever you set. Turn it off with `limit: false` only if you gain-stage yourself.
- **Route the music through its own gain.** `const music = ac.createGain(); music.connect(bus.out); Chip.play(ac, t0, music, ...)`. Then you can duck it.
- **Duck under sfx and voice.** 0.1 s attack, 0.4 s release, about −6 dB (see [09-audio-sync.md](09-audio-sync.md)):
  ```js
  const duck = (t, dur = .5) => { const g = music.gain; g.setValueAtTime(1, t - .1); g.linearRampToValueAtTime(.5, t); g.setValueAtTime(.5, t + dur); g.linearRampToValueAtTime(1, t + dur + .4); };
  ```
  Keep the ramps in time order: sort the ducks before you schedule them.
- **No sharp isolated hit after silence** (rule 26 of the brief). `explode`, `hit` and `laser` are loud and bright; a lone one after quiet startles. Start the music bed at least a bar before the first sfx, or open with a `blip` or a riser first.
- **Sfx sit above the music on purpose** (peaks 0.3-0.5 against a music RMS of 0.15). If they fight the melody, lower the sfx `gain` before you lower the music.
- **Loudness.** The film bus already has a compressor. For platforms, `render.mjs --loudnorm` brings the final mix to −14 LUFS.

## Pitfalls

- **Octave state sticks.** After `>C` the next note is still an octave up. Return with `<`: `>C<`. Repeats keep state across iterations, so `[C>]3` climbs.
- **`L` sticks too.** After `L16` in the arp, a later `C` is a sixteenth. State `L` at the start of every track and every section that assumes a different one.
- **Slots are per track.** A track that uses `@ENV1` without defining it throws `slot 1 is not defined`. Define in `prefix`, and end it with `@ENV0 @VIB0 @GLI0`, otherwise the last defined slot is active on every track.
- **`T` is per track too.** A track without `T` runs at 120. Put the tempo in `prefix`.
- **Gate 80 cuts every note.** That is right for a lead and wrong for a drum with an envelope or a pad: use `Q100`.
- **Different pitch after `&` is legato, not a repeated note.** For a re-struck same pitch write it without `&`.
- **`-` after a note is a flat.** `B-` is B♭; `O-1` (with `O`) is octave −1; in JS `noteToMidi('Bb3')` uses `b`, in MML `B-`.
- **Noise has no pitch.** The note number sets how bright it is: `O1`-`O3` a thud, `O5` a snare-like body, `O7` a hat. For drums use the drum tones `@4`-`@10` (or a Score); they have a real kick, snare and hat.
- **Drum tones ignore `Q`, `@ENV` and note length.** The hit has its own envelope; `V` is its velocity. Only `@8` (tom) reads the note's pitch.
- **Infinite `[ ... ]` needs a limit.** The default is 60 s of notes; with 4 tracks that is thousands of nodes for a 15-second film. Pass `maxSeconds`.
- **A very long score** (over 100000 notes) throws "runaway repeat"; pass `maxEvents` in `opts` only if you mean it.
- **Two renders are bit-identical only through `Chip.play`.** It adds the tracks pairwise: Chrome sums many inputs of one node in no fixed order and the float sum then differs by an ulp between runs. If you connect many sources to a single node yourself, expect 1-ulp differences (inaudible, but a byte compare of two WAVs fails).
- **The browser blocks sound until a click** (see the preview notes in `runtime/README.md`); the offline render has no such limit.
