# Long form: films of 1-3 minutes

A 20-second clip survives on one good image. A two-minute film doesn't: the viewer needs a reason to keep watching, and the agent needs a way to make 20-70 shots that feel like one film. This file covers both halves: the meaning (thesis, spine, through-line, callbacks) and the production (script as data, the runtime in `runtime/film.js`, the loop from animatic to final cut). The worked example is [examples/gps/](examples/gps/): a 90-second explainer on how GPS finds you.

For a vertical film (Reels, Shorts, TikTok, 30-60 s) the same method applies with a different frame ([19-vertical.md](19-vertical.md)), a viewer who has the sound off ([20-silent-social.md](20-silent-social.md)) and pictures that must carry the proof alone ([21-infographics.md](21-infographics.md)); worked example [examples/lyapunov/](examples/lyapunov/).

## What breaks after 60 seconds

- **No question, no reason to stay.** A pretty sequence of facts is a screensaver with captions. A long film is a question asked in the first seconds and answered at the end, with complications in between.
- **Nothing accumulates.** If shot 40 could be swapped with shot 12, the film has no direction. Something must carry state from beginning to end: a number, an image, a list.
- **Style drift.** Every shot written from scratch drifts in type size, line weight and color. A long film needs a system: themes, one illustration grammar, one text grammar.
- **Production cost.** Tempo, transitions, HUD, counters, captions and the score, rewritten for every film, eat the effort that should go into meaning. That is what the runtime is for.

## 1. The thesis: one sentence

Before any shot list, write what the viewer knows or feels at the end, in one sentence. It must be concrete and at least a little surprising.

| Weak | Strong |
|---|---|
| "GPS is amazing technology" | "Your phone never tells the satellites anything: it listens to four clocks, and without Einstein's corrections the map would drift 11 km a day" |
| "The history of civilization" | "Prometheus stole fire and we never gave it back: 2,500 years of one fire, each generation making it burn faster" |
| "How vaccines work" | "A vaccine is a wanted poster: the immune system learns the face before it ever meets the criminal" |
| "Compound interest" | "Save the same amount every year at 7%, and the last ten of forty years add more to the balance than the first thirty" |

Then turn the thesis into **the question the hook asks** ("How does it know?", "Why didn't the fire go out?", "Why does the last decade earn the most?"). The hook poses it in 2-4 s with an everyday image: a blue dot on a map, a match, a bank statement.

## 2. The spine: pick a structure

| Spine | Chapters | What escalates | Typical payoff |
|---|---|---|---|
| **How it works** | question → mechanism step by step → complication → fix | precision, understanding | the everyday image again, now understood |
| **Timeline march** | eras in order, one idea each | pace, scale, the metric | "and it's still going" + the next step |
| **One number** | the number → where it comes from → what changes it → what it means for you | the number itself | the number in the viewer's life |
| **Myth vs fact** | the myth, told straight → the crack → the evidence → the real story | doubt, then clarity | the myth restated, corrected |
| **Life of a thing** | birth → journey → transformations → end or now | distance, change | the thing in the viewer's hand |
| **Before / after** | the world without X → the invention → the ripples | contrast | a split-screen or a direct comparison |
| **Countdown** | N items in reverse order of importance | stakes | number one |

An explainer of 60-100 s usually has 4-6 chapters; a 2-3 minute film 8-17. Complications are what make "how it works" interesting: in the GPS film the mechanism is solved twice and broken twice (cheap phone clocks, then relativity) before the end.

## 3. The through-line: something that carries state

Pick at least one, and put it in the persistent layer (the HUD) so it stays on screen between statements:

- **A metric** that changes through the film: position error (GPS), a Kardashev index (the civilization film), cost, temperature, population, years. It must not be monotonic: drop, reversal, drop. Each reversal is a twist.
- **A motif**: one image that recurs and transforms (a signal ring: the dot's pulse, the satellite's broadcast, the spheres, the final pulse; a flame: match, torch, reactor, sun).
- **A count**: "clocks heard 1 / 4", chapters I-XVII, a list being filled.
- **A clock**: a countdown, a year counter, a timeline rail with a marker.

In the runtime, a metric is a shot field: `set: { err: { to: 5, b: [5, 9], log: true } }` animates it inside the shot, and every later shot inherits the value. The HUD reads it with `h.val('err')`.

## 4. The statement: one idea per beat

Most of a long explainer is statements: a short line of text with a picture that shows it.

- **Grammar: setup + payoff.** The setup is small ("TWO CLOCKS:"), the payoff is the new idea, in the accent color, larger, on a strong beat ("ON A CIRCLE."). Mark it in the data: `'TWO CLOCKS:|*ON A CIRCLE.*'`. A line of only payoff words is drawn 1.5x larger.
- **Anaphora carries rhythm.** Repeating openings ("WE INVENTED... WE BUILT... WE ASKED...", "ONE CLOCK... TWO CLOCKS... THREE...") let the viewer predict the form and focus on the new word.
- **The caption is the proof.** A small monospace line under the statement gives the source, the date or the arithmetic: "0.0674 S × 299,792 KM/S ≈ 20,200 KM", "ATTRIBUTED TO ARCHIMEDES · c. 250 BC". It makes a claim credible and costs no screen time.
- **The picture shows the mechanism**, not a mood. "On a circle" draws the circle where two spheres meet. If the picture could illustrate a different sentence equally well, it is decoration.
- **Length.** At most 8 words per statement; 1-2 bars each at 100-120 BPM; 0.3 s of reading per word plus 1 s. About 12-15 statements per minute for an explainer, up to 30 for a montage-heavy film.
- **Numbers count.** A number that matters is a counter that runs to its value (`Film.count`), not a static label.

## 5. Chapters, tempo and pacing

- **A chapter is 12-25 s** with its own mini-peak. Its boundary is marked three ways at once: a transition type, a change in the music (a new layer, a drop, a tempo step), and often a theme change.
- **Tempo follows tension.** A tempo map instead of one BPM: `tempo: [{ bar: 0, bpm: 100 }, { bar: 17, bpm: 108 }, { bar: 24, bpm: 116 }, { bar: 32, bpm: 120 }]`. The civilization reference goes 110 → 128 → 140 → 150 and ends on the word "ACCELERATE".
- **Silence before a twist.** A beat or two with the drums out before the complication; the dip transition into "IV · EINSTEIN" lands on a sub drop after a gap in the bass.
- **Acceleration toward the end.** Statements shorten from two bars to one, then a recap montage at half-beats.
- **The exhale.** After the last peak, one held shot: the callback image with the final line.

## 6. Callbacks: how the film closes

- **Bookend.** The last image is the first image, transformed by what the viewer now knows. GPS: the same map and dot, now with "± 5 M"; the reference: the same flame, now surrounded by every earlier icon.
- **Recap montage.** Earlier shots replayed at half a beat each, in the other theme, with one label each. `Film.recap(ids, { per: .5, label })` does it: it calls the earlier shots' `draw()` frozen near their end. This only works if every `draw()` takes its colors from `s.T`.
- **The last line reframes the thesis.** Not a summary: a consequence for the viewer ("EVERY TIME YOU OPEN A MAP, YOU ASK FOUR CLOCKS AND EINSTEIN").
- **The metric lands.** The HUD value arrives at its final, meaningful number.

## 7. A visual system for many shots

- **Two themes that mean something**: ground and space, past and future, problem and solution, inside and outside. Themes are token sets (`bg, ink, muted, accent, hud, texture, glow, grain, vignette`); a shot names its theme and inherits it until the next change. The HUD crossfades between themes during transitions.
- **One illustration grammar.** Line art at 1.5-3 px, hatching instead of gradients, one accent color used only on the payoff and the thing the payoff is about. Don't mix styles per shot.
- **Layout zones.** Text in one third (usually top left), the picture in the other two. Keep the zone per chapter; a zone change is a signal.
- **A transition vocabulary tied to meaning**, 3-5 types per film:

| Transition | Meaning in the example |
|---|---|
| cut on the beat | the next step of the same thought |
| `zoom` into a point | going up or inside (the map's dot → orbit) |
| `flash` | revelation, the answer (delay × c = distance; the fix) |
| `punch` | a problem, a twist (cheap clocks; the map drifts) |
| `dip` to black | a new chapter, time passes |

## 8. The script as data

Write the script in `SCRIPT.md` next to the film before any drawing code, as a table. Checking a table is cheaper than checking a render.

| # | Chapter | Bars | Statement | Picture (what it proves) | State change | In | Sound |
|---|---|---|---|---|---|---|---|
| 7 | II · THE SPHERES | 2 | ONE CLOCK: YOU ARE SOMEWHERE \*ON A SPHERE.\* | a range circle around satellite 1 touching the Earth | n = 1, err → 6,000 km | cut | kick every beat |
| 8 | | 2 | TWO CLOCKS: \*ON A CIRCLE.\* | the second sphere, their intersection as an ellipse | n = 2, err → 1,000 km | cut | clap enters |

The same table becomes the `shots` array of `Film.create` one to one:

```js
{ id: 'two', bars: 2, draw: drawTwo,
  set: { n: 2, err: { to: 1e6, b: [1, 3], log: true } },
  say: { text: 'TWO CLOCKS:|*ON A CIRCLE.*', per: .4 } },
```

## 9. The production loop

1. **Research and script.** Thesis, spine, through-line, the table. Verify every number and write its source in `SCRIPT.md`; a wrong number ends a long film's credibility.
2. **Animatic.** All shots with their `say` and HUD values, `draw` empty or a placeholder. Render a draft: it checks reading time, rhythm and total length before any illustration exists. Cut here, not later.
3. **Illustrate chapter by chapter.** Look at single frames at full size with `node render/still.mjs film.html out/ two fast@0.3`; render one shot or chapter with `node render/render.mjs film.html part.mp4 --shot "II · THE SPHERES" --draft`.
4. **Score.** Written against the same tempo map (`score(ac, bus, f, at)`), with accents on `f.hits`: the moments payoff words land.
5. **Review.** Full draft, contact sheet, fixes by timecode (12-render-qa.md). Check text against the HUD: long films put labels in corners where the HUD lives.
6. **Final.** Full render with `--loudnorm`, then `node runtime/inline.mjs film.html` for a single self-contained page.

## Learning from references

`node render/analyze.mjs reference.mp4 out/` breaks a video down: shots and their lengths, cutting pace per 10 s, tempo over time, how firmly cuts are locked to the beat, loudness dips, contact sheets and the middle frame of every shot. Then read the sheets and write down, in words: the text grammar, the persistent layer and what it carries, each chapter's length and palette, the transition types, the through-line. Borrow the structure, not the look. `node render/beatmap.mjs track.mp3 beats.json --trim track.wav` turns a music track into a tempo map for `Film.create`, so a film can be cut to existing music.

## Script checklist

- [ ] The thesis is one concrete sentence; the hook asks its question in the first 2-4 s
- [ ] The spine is named; each chapter has a mini-peak and a marked boundary
- [ ] A through-line lives in the HUD and changes at least three times, with at least one reversal
- [ ] Every statement is at most 8 words, with one payoff; the picture proves it
- [ ] Every number has its arithmetic or source in a caption, and is verified
- [ ] Shots shorten toward the end; there is a pause before the main twist
- [ ] The ending calls back to the opening image, and the last line reframes the thesis
- [ ] Every `draw()` takes its colors from `s.T` (so recaps and theme changes work)
- [ ] 3-5 transition types, each with one meaning
