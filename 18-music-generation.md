# Music generation: from intent to score

A model cannot hear, and music written note by note in one go comes out as a four-bar loop that repeats until the film ends: one chord progression, one melody, drums that never change. The fix is the same as for pictures in this kit: write **data**, not pixels. The agent writes an *intent* (key, tempo, style, and an energy for each section of the film), seeded generators write the notes, a linter and a report tell the agent what is wrong, and a human listens at the end.

For a modern electronic sound (house, a four-on-the-floor bed) rendered from open-source tools instead of chip voices, see [22-electronic-music.md](22-electronic-music.md).

```
plan  ->  Compose.generate  ->  Score (data)  ->  Chip.playScore  ->  sound
              ^                    |
              |             MusicLint + music-report (piano roll, spectrogram, loudness)
              +---- fix the PLAN, not the notes
```

| Piece | File | Chapter |
|---|---|---|
| Generators: harmony, voice leading, bass, arpeggio, hook, groove, fills | `runtime/compose.js` | this one |
| The sound engine: voices, real drums, envelopes, echo, ducking | `runtime/chip.js` | [16-chiptune.md](16-chiptune.md) |
| The linter | `runtime/music-lint.js` | this one |
| Piano roll, spectrogram, loudness per section | `render/music-report.mjs` | [render/README.md](render/README.md) |
| An audition page for the human | [examples/pixel/music-lab.html](examples/pixel/music-lab.html) | this one |

```html
<script src="../../runtime/compose.js"></script>
<script src="../../runtime/chip.js"></script>
```

## The plan

```js
const score = Compose.generate({
  seed: 7, bpm: 120, key: 'C major', style: 'adventure',
  sections: [
    { name: 'intro',  bars: 4, energy: .15 },
    { name: 'verse',  bars: 6, energy: .4 },
    { name: 'build',  bars: 4, energy: .65 },
    { name: 'drop',   bars: 8, energy: .95, breakBefore: true },
    { name: 'outro',  bars: 2, energy: .2, key: 'A minor' },
  ],
});
```

| Field | What it does |
|---|---|
| `seed` | the whole score is a function of the plan and the seed. Try 6 seeds and keep the best |
| `bpm`, `beatsPerBar` | tempo (4/4 for now) |
| `key` | `'C major'`, `'A minor'`, `'D dorian'`, also `mixolydian`, `lydian`, `phrygian`, `harmonic` |
| `style` | `adventure` (bright, eighth-note bass, arps), `tense` (minor, half-time, syncopated bass), `chill` (swing, walking bass, sparse), `drive` (four on the floor, sixteenth bass) |
| `sections[].bars` | length in bars; **match the film's shots** (`bars` of the shot, or a group of shots) so the music follows the picture |
| `sections[].energy` | 0..1, the main knob, see below |
| `sections[].key` | modulate for this section (`'D major'` lifts a whole step) |
| `sections[].prog` | `'A'`, `'B'`, or your own numerals `'I V vi IV'` (the default: a quiet progression under .6 energy, a fuller one above) |
| `sections[].melody` | `'none' \| 'sparse' \| 'hook' \| 'high'` (default from energy) |
| `sections[].breakBefore` | a one-beat gap in everything before this section starts: the "drop" |
| `styleOverrides` | e.g. `{ swing: .12, bassMain: 'walk' }` |

### What energy does

Energy is not volume, it is *density*: which layers exist and how busy they are. Chapters of a film map to it naturally: the quiet start is .1-.3, the reveal is .9-1.

| Energy | Layers |
|---|---|
| < .15 | a pad, and a soft kick each bar from .1 |
| .15-.3 | + bass on whole notes |
| .3-.45 | + a sparse version of the melody, kick on 1 and 3 |
| .45-.65 | + an arpeggio in eighths, hats on eighths; from .5 a snare on 2 and 4 and the bass on half notes and pulses |
| .65-.78 | the full hook, a sixteenth-note arpeggio, a busier groove, the bass in the style's main pattern; **a fill and a riser before the next section if it is louder** |
| .78-.85 | the hook an octave higher, an open hat (from .8) |
| .85+ | four-on-the-floor kick (in `adventure`), a clap on the snare, sixteenth hats |

A **crash** lands where a section arrives at least .2 louder (or at .8+); a **riser** (noise sweeping up) fills the last two beats before a jump; every kick **ducks** the bass, pad and arp a little.

## How the notes are made

- **Harmony**: a weighted graph of chord moves (`I` goes to `IV`, `V`, `vi`; `V` resolves to `I`...) for major and minor. A section starts on the tonic and ends on a dominant when another section follows, on the tonic at the end of the film. A second, fuller progression is used above .6 energy. Chords come from Roman numerals (`Compose.chord('V7', key)`), and are voiced with **voice leading**: the inversion that moves least from the previous chord, so pads and arpeggios glide instead of jump.
- **Bass**: whole notes, half notes, an eighth-note pulse with octave jumps, a walk, or a syncopated Euclidean pattern; a passing note into the next chord.
- **Arpeggio**: a chord-tone pattern (up, up-down, broken) through the voice-led chord, at eighths or sixteenths.
- **The hook**: a four-bar melody made once per score from a rhythm cell and a contour: bar 1 states a motif, bar 2 is a *sequence* of it, bar 3 a variation, bar 4 a cadence with a long last note. The motif is written as scale-degree offsets from the *chord root*, so it follows the harmony, and notes on strong beats snap to chord tones. It returns in every section, developed: sparse in quiet sections, mirrored on the second phrase, an octave up at the peak. A returning, developing hook is what makes a score memorable instead of a loop.
- **Groove**: 16-step grids per style and energy tier, velocity accents on the beat, ghost notes; [Euclidean rhythms](https://en.wikipedia.org/wiki/Euclidean_rhythm) (`Compose.euclid(5, 16)`) for the syncopated bass. Swing for `chill`.
- **Seams**: fills (a snare crescendo or a tom run), crashes, risers, the drop gap, ducking.

Independent random streams keep parts stable: changing `seed` changes everything, but a code change to the drums never reshuffles the melody.

## Play it in a film

```js
const SCORE = Compose.generate(plan);
window.__score = SCORE;                         // lets render/music-report.mjs read it

function score(ac, bus, f, at) {
  const zero = at(f.DURATION) - f.DURATION;     // the film clock in context time, also mid-film in the live preview
  Chip.playScore(ac, 0, bus.out, SCORE, { timeOf: b => zero + f.time(b), from: ac.currentTime });
  // sound effects on top, on the same clock: Chip.sfx.coin(ac, zero + f.time(24), bus.out)
}
```

`f.time(beat)` follows the film's tempo map, so if the film has one, keep `plan.bpm` equal to its tempo (a music-only tempo change is `bpm` in `Film.create({ tempo })`). The sections' `bars` must add up to the film's bars: build both from one table.

## The loop an agent runs

1. Write the plan from the film's shot table: one section per shot or chapter, energy from the through-line (quiet start, peak at the reveal).
2. `Compose.variants(plan, 6)` and lint each: `MusicLint.lint(score)` -> `{ score, findings, stats }`.
3. `node render/music-report.mjs film.html report/`: the piano roll (are there sections that look empty? is the lead always on the same notes?), the spectrogram (is there low end under the kick? is the top crowded?), loudness per section (does it grow with the energy?).
4. Fix the **plan**: raise or lower energies, change style or key, break before the drop, another seed. Do not hand-edit notes unless you must: a Score is data, so `score.tracks.find(t => t.name === 'lead').events` can be transposed or muted, and stingers can be appended, but the next seed throws that away.
5. Give the human the audition page with the best three seeds. The linter cannot judge taste; ears can.

### What the linter says, and the fix at plan level

| Finding | Meaning | Fix |
|---|---|---|
| `loop` | one bar repeats many times in a row, few unique bars | lower energy (fewer layers repeating), change `melody`, add sections or a key change |
| `density-vs-energy` | the loud sections are not the busiest | raise the gap between energies, or a lower energy in the quiet sections |
| `drum-groove`, `transitions` | no backbeat, no fill or crash at a jump | raise the energy of the section after the seam (a rise of at least .2 triggers the crash, fill and riser) |
| `strong-beat-chord`, `out-of-key`, `clash` | notes fight the harmony | a bug in a hand-made edit; the generator does not produce them |
| `flat-dynamics` | all velocities equal | happens only in hand-made scores |
| `dead-air` | a span with no sound | shorten `breakBefore` sections, or raise the energy of the quiet part |

## Pitfalls

- Energy steps that are too small: .5 to .55 changes nothing you can hear. Move by .2 or more where the picture changes.
- `bars` that do not match the shots: the music comes to its cadence in the middle of a scene.
- Everything at .9: there is no peak. Write the curve the way you would write the story.
- A key that fights the picture: a minor key section for a "machines" chapter works because it contrasts; a random modulation does not.
- Trusting the lint score as taste: 100 means "no rule broken", not "good". Always listen.
- Very short sections (1 bar): no room for a cadence; merge them into a neighbor.

## Sources

- [Euclidean rhythms](https://en.wikipedia.org/wiki/Euclidean_rhythm): Toussaint's even-spread rhythms, behind `Compose.euclid`
- [Algorithmic composition, rule-based music](https://blog.landr.com/algorithmic-composition/): the approaches this generator combines
- [ChatMusician](https://arxiv.org/pdf/2402.16153) and [ComposerX](https://arxiv.org/html/2404.18081v1): why one-shot note writing by an LLM fails on structure and bass lines, and why staged composition works better
- [Tonal](https://github.com/tonaljs/tonal): a full music theory library for JavaScript; `compose.js` keeps its own small theory layer to stay dependency-free
- [Chiptune arrangement guides](https://ozzed.net/how-to-make-8-bit-music.shtml): one job per channel, arpeggios as chords, triangle for bass
