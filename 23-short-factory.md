# Short factory: from a spec file to a published short

A spoken, subtitled vertical film is the same job every time: a topic, a script, a voice, a handful of pictures, a pass through the same checks, the same files for the post. This chapter is the line that does the repeatable 90% by machine, from **one data file per video**. The human (or the agent) writes the part that cannot be automated: the facts, the script, the choice of a picture for each claim. Everything after that is a command.

```
topic -> research -> spec.json + voice.txt          (the creative part: 23 §Spec, 20 genres, 21 pictures)
                         |
   node render/new.mjs <id> --genre one-life      scaffold from a genre template
   node render/make.mjs spec.json --draft         lint -> voice (cached) -> film page -> draft render -> QA report
   node render/make.mjs spec.json                 the same, final quality, and the post files
   node render/make.mjs specs/*.json --batch      many videos, the shared steps cached
                         |
   out/<id>/  <id>.mp4  captions.srt  cover.jpg  post.md  report.md  sheet.png
```

| Step | Tool | In | Out |
|---|---|---|---|
| lint | `render/lint-spec.mjs` | spec (+ voice timings) | findings: budgets, genre card, facts, anchors |
| voice | `render/voice.mjs` | `voice.txt` | `voice.wav`, `voice.words.json`, `voice.phrases.json` (cached per sentence) |
| timing | `runtime/timing.js` | spec + voice | shot boundaries, anchors in seconds |
| film | `runtime/short.js` + `runtime/blocks.js` on `runtime/film.js` | spec + voice | the page `film.html` (live preview, renderable) |
| render | `render/render.mjs` | page, `--voice voice.wav`, `--loudnorm` | mp4 |
| review | `render/qa.mjs` | page + mp4 | `report.md`, `sheet.png`, `stills/`, exit code |
| post | `render/post.mjs` | spec + voice + mp4 | `captions.srt/.vtt`, `cover.jpg`, `post.md`, export variants |

## The spec

A JSON file (`spec.json`) next to `voice.txt`. Everything not listed as required has a default.

```jsonc
{
  "id": "lyapunov",                                  // required: [a-z0-9-]+, names the output folder
  "title": "Lyapunov: first the scheme",             // required
  "lang": "ru",
  "genre": "one-life",                               // required: how-it-works | one-life | one-number | timeline | versus | myth-vs-fact | countdown | process | statement | teaser | loop
  "thesis": "one concrete sentence",                 // required
  "hook": "the question the first 2 s ask",          // required
  "format": { "W": 1080, "H": 1920, "FPS": 30 },
  "tempo": 120,                                      // constant BPM: shots are laid on seconds, music and cuts-on-the-beat on this tempo
  "voice": { "engine": "edge", "voice": "ru-RU-DmitryNeural", "rate": "-5%", "file": "voice.txt", "offset": 0 },   // null: a silent film
  "style": {
    "themes": ["paper", "blueprint"],                // preset names (see below) or { "name": { bg, ink, muted, accent, card, ok, hud, texture, grain, vignette } }
    "display": "Oswald", "mono": "IBM Plex Mono",    // Google Fonts families with the scripts the text needs
    "statementSize": 94                              // one size for the whole film
  },
  "music": { "seed": 5, "key": "A minor", "style": "tense", "gain": 0.55 },     // null: no music. Energy per bar comes from the shots' "energy"
  "hud": { "kind": "rail", "key": "year", "span": [1911, 1973], "marks": [1911, 1952, 1955, 1959, 1973] },   // kind: rail | counter | none
  "shots": [ /* Shot */ ],
  "facts": [ { "id": "f1", "text": "Born 8 Oct 1911 in Moscow", "source": "https://ru.wikipedia.org/wiki/…" } ],
  "post": { "title": "…", "description": "…", "tags": ["история", "программирование"], "cover": { "shot": "stamp", "at": 2.0 } }
}
```

### Shot

```jsonc
{
  "id": "label",                                     // required, unique
  "phrases": [1],                                    // voice phrases this shot covers: [a] or [a, b] (0-based). The cut goes into the pause between shots
  "dur": 2.0, "beats": 4, "hold": 0, "tail": 1.2,    // a shot without phrases takes dur or beats; hold adds seconds; tail is for the last shot
  "chapter": "I · ЯРЛЫК",                            // shown in the HUD, inherited by the next shots
  "theme": "paper",                                  // inherited
  "claim": "identity",                               // required: magnitude | comparison | change | part | ranking | mechanism | structure | location | identity | typographic   (21-infographics.md)
  "energy": 0.3,                                     // 0..1, the music's density here (18-music-generation.md)
  "say": { "text": "1954.|*ЛЖЕНАУКА*", "start": { "$word": "лжеучёным", "off": -1.0 }, "payoff": { "$word": "лжеучёным" }, "caption": "Краткий философский словарь, 1954", "out": { "$shot": "end", "off": -0.3 } },
  "picture": { "block": "card", /* params of the block, see Blocks */ },      // or an array: layers, drawn in order
  "set": { "year": 1954 },                           // HUD values; { "to": 1911, "dur": 1.2 } glides
  "in": "push-up",                                   // cut | push-up | push-down | dip | flash | punch | fade | zoom | iris | wipe, or { "type": "dip", "color": "#1b4a8a", "beats": 1.5 }
  "sfx": [ { "at": { "$word": "лжеучёным" }, "kind": "stamp" } ],              // stamp | impact | whoosh | tick | riser | ping | print
  "facts": ["f1"],                                   // the facts this shot states: every number in the shot's text needs one
  "hud": true
}
```

`say.text`: `|` breaks a line, `*word*` is the payoff (accent color, larger when alone on a line). The statement's words appear in order from `start`; `payoff` is the moment the starred word lands (the runtime spaces the words to hit it). The statement is the claim; it is not the subtitle (the subtitle is the voice).

### Anchors: placing things on the voice

Any value in `say`, `picture` and `sfx` that is a time can be a number (seconds from the start of the shot) or an anchor object, resolved by `Timing`:

| Anchor | Meaning |
|---|---|
| `{ "$word": "лжеучёным", "n": 1, "off": 0.1 }` | the start of the n-th spoken occurrence of the word (case, punctuation and е/ё ignored); looked up in this shot first, then in the whole voice. `off` seconds are added |
| `{ "$phrase": 2, "at": "start" \| "end" \| seconds, "off": 0 }` | a phrase of the voice |
| `{ "$beat": 3 }` | the beat of the tempo, from the shot start |
| `{ "$shot": "start" \| "end", "off": -0.5 }` | the shot's edges |

This is the whole trick: the picture does not know the clock, it knows the *words*. Re-record the voice, change a word, and the stamp still lands on "лжеучёным".

### Themes

Presets in `runtime/short.js`: `paper` (cream, ink, stamp red, card and a green `ok` token) and `blueprint` (cyanotype blue, white lines, orange). A theme is `{ bg, ink, muted, accent, card, ok, hud, texture: 'paper'|'grid'|'stars'|'none', grain, vignette }`; every drawing takes colors from the theme tokens (`s.T`), never literals.

## Blocks: pictures that pass the label test

`runtime/blocks.js` is a library of picture components. Each draws one *claim type* from [21-infographics.md](21-infographics.md) with the conventions built in: the yardstick appears first and muted, only the datum is in the accent color, labels touch their marks, the chrome is still and the datum moves, the end state holds, units are on screen. A block is a function of local time (stateless, like everything else here).

```js
Blocks.draw(ctx, s, f, pic, area)        // pic: the resolved picture object ({ block, ...params }), area: { x, y, w, h } (default f.band)
Blocks.register(name, { claim, doc, params, draw(ctx, s, f, p, area) })     // add a custom block
Blocks.list()                             // [{ name, claim, doc, params }]: for lint-spec and for the docs
Blocks.label(ctx, f, kind, text, x, y, opts)   // draws a text label and records its box (f.box) for review
```

All times in `p` are seconds from the start of the shot (anchors are already resolved). Every block accepts `at` (seconds, when its build starts; default 0), `dur` (seconds the build takes; default per block), `area` (override), `tone` (`accent` | `ok` | `ink`, the datum's color).

| Block | Claim | Parameters |
|---|---|---|
| `bars` | magnitude, comparison, ranking | `items: [{ label, value, ref?: true, accent?: true }]`, `unit`, `max?`, `log?`, `order: 'given' \| 'desc'`, `showValue: true`. Horizontal bars from zero; `ref` bars (the yardstick) build first, muted; the accented bar grows last and its value counts up. At most 7 items |
| `counter` | magnitude | `value`, `from: 0`, `unit`, `format: 'int' \| 1 \| 2`, `log?`, `ref?: { label, value }`, `label?`. One large number counting up; with `ref`, a muted bar of the reference value is drawn first and the number's bar is drawn against it |
| `rail` | change, location in time | `span: [a, b]`, `marks: [{ t, label, accent? }]`, `spans: [{ a, b, label?, style: 'solid' \| 'hatch' }]`, `cursor?`, `title?`. A horizontal timeline (a life, an era); spans are bars on it, marks are flags; builds left to right |
| `tree` | structure | `root`, `levels: [n1, n2, …]` (counts per level), `names: [{ label, level, accent? }]`, `countLabel?`, `grow: 'up' \| 'down'`. A tree that fans out and grows; leaves are dots, a running count in the corner; only the listed names are written |
| `units` | part of a whole, magnitude | `n`, `perRow: 10`, `icon: 'dot' \| 'square' \| 'person'`, `groups: [{ n, label?, tone? }]`, `unit?`. Unit pictogram: icons arrive one at a time in rows; groups differ by ink / muted / accent only |
| `split` | comparison (before/after) | `left: { label, pic }`, `right: { label, pic }`, `dead?: 'left' \| 'right'`, `deadAt?`, `divider: true`. Two sub-pictures side by side at the same scale; `dead` dims one at `deadAt` |
| `flow` | mechanism | `nodes: [{ id, kind: 'pill' \| 'box' \| 'diamond', label, letter? }]` (auto-laid in a column), `edges: [[from, to, { label? }]]`, `token: { route: [ids…], at, dur }`, `counters?: [{ label, from, to, at, dur }]`. A scheme that draws itself and then *runs*: a token moves along the route and lights the nodes |
| `columns` | identity (texture of a thing) | `cols: 5`, `rows: 11`, `base: 8 \| 10 \| 16`, `digits: 5`, `scroll: 70`, `glitch?: { at, col, row }`, `label?`. Scrolling columns of numbers/codes; a glitch turns one cell accent |
| `map` | location | `from: { label, at: [x, y] }`, `to: { label, at: [x, y] }` (fractions of the area), `km`, `ref?: { label, km }`, `curve: 0.3`. A route with a distance counter; the reference route is drawn first |
| `card` | identity (a prop) | `layers: [{ kind: 'dictionary' \| 'article' \| 'plain', title, heading?, meta?, lines?: 9, offset?: [x, y], rot?, scale?, dim?, alpha?, stamps?: [{ text, at, tone: 'accent' \| 'ok', rot?, size?, pos?: [x, y] }], strike?: { at }, out?: { at, dur } }]`. Documents and stamps: a stamp lands (anticipation, shake, ink) at `at`; `strike` draws a slash through the layer's earlier stamps |
| `plate` | identity (a name) | `title`, `sub?`, `years?`, `facts?: [{ k, v }]`. A typographic name plate; the letters rise one by one |
| `type` | typographic | `lines: [{ text, size?, tone? }]`. The picture is the text itself, for shots with `claim: "typographic"` |

Sub-pictures (in `split`) are `{ block: …, … }` objects again, so `split` of `columns` and `flow` is the "before/after" of the Lyapunov film. A block that needs a time not in the list takes it as `at`/`dur`.

**Box contract.** Every piece of text a block draws goes through `Blocks.label` (or calls `f.box(kind, x0, y0, x1, y1, text)` itself), so that `render/qa.mjs` can check safe zones and overlaps. Kinds: `label` (text in a picture), `number` (a counter), `stamp`, `name`. The runtime itself records `say`, `caption`, `subtitle`.

## The page

`render/make.mjs` writes `out/<id>/film.html`:

```html
<canvas></canvas>
<script src="…/runtime/film.js"></script><script src="…/runtime/chip.js"></script><script src="…/runtime/compose.js"></script>
<script src="…/runtime/timing.js"></script><script src="…/runtime/blocks.js"></script><script src="…/runtime/short.js"></script>
<script>const SPEC = {…}, VOICE = {…}; Short.create(SPEC, VOICE);</script>
```

`Short.create(spec, voice)` builds the `Film.create` config: shots from `Timing`, statements spaced so their payoff words land on their anchors, subtitles and ducking from the voice, a HUD of the chosen kind, the music plan from the shots' energies (sections per bar, merged), effects scheduled by anchor on `bus.sfx`, pictures drawn by `Blocks.draw`. It also exposes `window.__short = { spec, timing }` for the review tools. `node runtime/inline.mjs film.html` makes it one self-contained file for publishing; `make.mjs --inline` does it.

## Review: `render/qa.mjs`

```bash
node render/qa.mjs out/lyapunov/film.html --video out/lyapunov/lyapunov.mp4 --out out/lyapunov/qa      # exit 0 pass, 1 fail, 2 tool error
```

Draws the page frame by frame (`window.__draw(t)`, then `window.__film.boxes`) and analyses the video; writes `report.md`, `report.json`, `sheet.png` (contact sheet), `poster/` (three frames from fixed fractions plus the cover candidate). Every check is a rule from chapters 19-21 with a severity:

| Check | Rule | Severity |
|---|---|---|
| frame 0 moves | mean difference between frame 0 and frame at 0.3 s above a threshold | fail |
| hook | a `say` or `subtitle` box is visible by 2.0 s | fail |
| dead stretch | no frame difference above the threshold for more than 2.0 s (excluding the last 1.5 s of the film) | warn |
| safe zones | a `say`/`caption`/`subtitle`/`label`/`number` box enters the top 10%, the bottom 22%, or the right 11% of the frame (HUD exempt in the top) | fail |
| overlap | two boxes of different kinds overlap by more than 8% of the smaller | fail |
| fit warnings | the page logged a "had to shrink" warning (as `render/textcheck.mjs`) or an error | fail |
| statement | more than 8 words; a line over 16 characters at the film's size; shown for under 2 s | warn |
| word budget | statements + captions + voice words over 2.5 words per second (voice alone over 2.2) | warn |
| voice pace | a phrase faster than 2.6 words per second | warn |
| loudness | integrated outside -14 ± 1.5 LUFS, or true peak above -1.0 dBTP | fail / warn |
| black / frozen | a frame with mean luminance < 4 (outside a transition) or 20 identical frames in a row | warn |
| poster test | saves frames; a human or the agent looks at them (not graded) | info |

`--strict` turns warnings into failures. The report ends with the checklist of chapters 19-21 with each line ticked, failed or "needs a human" (the label test, the yardstick, the facts).

## Spec lint: `render/lint-spec.mjs`

Runs before any rendering, in milliseconds. Findings (error / warn): required fields; genre and claim names; unique shot ids; phrases covered in order and each used once; every `$word` anchor found in the voice; block names exist and required params present (`Blocks.list`); statements ≤ 8 words and lines ≤ 16 characters; word budget; hook shot ≤ 3.5 s with a statement by 2 s; transitions ≤ 5 types; the HUD key exists; **every number in a shot's `say.text`, `caption` or voice phrase has a fact in `facts` listed on that shot** (numbers written as words in the voice are matched by the shot's declared facts, not parsed); every fact has a source URL; the genre card's structural rules (a `one-number` film needs a `counter` or `bars` block with `ref`; a `versus` film needs `split`; a `countdown` needs a rail or counter in the HUD; a `loop` has no voice and no `say`).

## Post: `render/post.mjs`

```bash
node render/post.mjs out/lyapunov                # everything below, from spec.resolved.json + voice + the mp4
```

`captions.srt` and `captions.vtt` (the platform's own captions: subtitle groups from the voice), `cover.jpg` (the frame at `post.cover`, 1080×1920, plus a 1080×1350 crop), `post.md` (the title, the hook as the first line, the description, the sources from `facts`, the tags, an alt text from the shot statements), `exports/<id>-upload.mp4` (re-encoded at `--crf 22`, the size to upload; the final render stays the master). File sizes are printed.

## Scaffolds: `render/new.mjs`

```bash
node render/new.mjs lyapunov --genre one-life --lang ru        # creates videos/lyapunov/spec.json + voice.txt from the genre template
node render/new.mjs --genres                                    # lists the templates with their promise and length
```

`render/templates/genres/<genre>.json` are spec skeletons with the structure of the genre's card in [20-silent-social.md](20-silent-social.md): the right number of shots, the claim types, placeholder statements marked `TODO`, the blocks that genre needs, the transitions vocabulary, an energy curve, the fact slots. The linter fails on any remaining `TODO`.

## The loop for one video

1. `node render/new.mjs <id> --genre <genre>`; fill `facts` first (every claim with its source), then `voice.txt`, then the shots.
2. `node render/make.mjs videos/<id>/spec.json --draft` (about 2 minutes). Read `report.md`; fix the findings; listen to the voice and look at `sheet.png` and `poster/`.
3. `node render/make.mjs videos/<id>/spec.json` for the final render and the post files.
4. A human looks at the film once with the sound off and once with it on, reads `post.md`, publishes.

Edit-and-rerun is cheap: the voice is cached per sentence, so changing one sentence re-synthesizes only that sentence; `--shot id` renders one shot.

## Pitfalls

- **Writing the spec before the facts.** The lint ties numbers to `facts`; start there.
- **A block for everything.** If a claim fits no block, the shot is `typographic` (the `type` block) or needs a new block: add it with `Blocks.register` in the spec's own folder (`blocks.js` next to `spec.json` is loaded automatically) and, if it is reusable, promote it into `runtime/blocks.js`.
- **Anchors on a word the voice reads differently** (numerals, abbreviations): anchor on a neighbouring plain word or write the number as words in `voice.txt`.
- **Hand-tuned seconds.** Use anchors; a number of seconds in a spec is a bug waiting for the next re-record.
