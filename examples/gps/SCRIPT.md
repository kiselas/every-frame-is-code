# Four Clocks: script

A 90-second explainer on how GPS finds you, built on [runtime/film.js](../../runtime/film.js) by the method in [14-long-form.md](../../14-long-form.md). Source: [film.html](film.html). Render: `node render/render.mjs examples/gps/film.html examples/gps/film.mp4 --loudnorm`.

## Specs

| | |
|---|---|
| Length | 1:29.5, 21 shots, 5 chapters |
| Frame | 1920×1080, 30 fps |
| Tempo map | 100 BPM (bars 1-17) → 108 (18-24) → 116 (25-32) → 120 (33-40): each chapter a step faster |
| Themes | `paper`: on the ground (off-white, a faint engineering grid, ink, one vermilion accent). `night`: in orbit (graphite, warm off-white lines, the same accent with a glow) |
| Type | Archivo 800 at 112% width for statements, IBM Plex Mono for captions and the HUD |

## Meaning

- **Thesis.** Your phone never tells the satellites anything: it listens to four clocks, and without Einstein the map would drift 11 km a day.
- **Hook question.** "You are here. How does it know?", over an everyday map with a pulsing dot.
- **Spine.** How it works: the signal → the geometry → the first complication (cheap clocks) and its fix → the second complication (relativity) and its fix → the everyday image again.
- **Through-line.** The HUD metric "YOU ARE WITHIN": 20,000 km → 6,000 → 1,000 → 10 m → **300 km** (twist) → 5 m → **11 km** (twist) → 5 m. A second readout counts "CLOCKS HEARD 0 / 4 … 4 / 4". The top right runs a film clock, `T 034.560`: this is a film about clocks.
- **Motif.** The signal ring: the dot's pulse on the map, the satellite's broadcast, the range spheres, the final pulse.
- **Bookend.** The last shots return to the opening map and dot, now with "± 5 M", then the reframing line.

## Shots

| # | Chapter | Bars | Statement | Picture (what it proves) | State | In |
|---|---|---|---|---|---|---|
| 1 | cold open | 2 | YOU ARE \*HERE.\* | a city map draws itself outward from a dot | HUD hidden | |
| 2 | | 1 | HOW DOES IT \*KNOW?\* | the map pulls back | | cut |
| 3 | I · THE SIGNAL | 2 | 31 SATELLITES, \*20,200 KM UP.\* | a small Earth with coastlines inside six orbital planes, satellites appearing, a count to 31 | err 20,000 km | zoom from the dot up into orbit |
| 4 | | 2 | EACH ONE SAYS ONLY ONE THING: \*THE TIME.\* | a satellite broadcasting rings; a GPS clock running to the nanosecond | | cut |
| 5 | | 2 | IT ARRIVES \*A LITTLE LATE.\* | a pulse travels from the satellite to a phone; the delay counts to 0.0674 s | | cut |
| 6 | II · THE SPHERES | 2 | DELAY × SPEED OF LIGHT = \*DISTANCE.\* | a ruler draws out to 20,200 km | | flash |
| 7 | | 2 | ONE CLOCK: YOU ARE SOMEWHERE \*ON A SPHERE.\* | a range sphere around satellite 1 touching the Earth (side view) | 1/4, 6,000 km | cut |
| 8 | | 2 | TWO CLOCKS: \*ON A CIRCLE.\* | sphere 2; the intersection circle as an ellipse | 2/4, 1,000 km | cut |
| 9 | | 2 | THREE: \*TWO POINTS.\* | sphere 3; two points, one on Earth, one in deep space | 3/4, 10 m | cut |
| 10 | III · THE CLOCKS | 2 | BUT YOUR PHONE'S CLOCK IS \*CHEAP.\* | an atomic dial and a wobbling quartz dial; the phone's error grows in ms | | punch |
| 11 | | 2 | 1 MILLISECOND OFF = \*300 KM\* OFF. | the spheres become thick bands | 300 km | cut |
| 12 | | 3 | SO IT LISTENS TO \*A FOURTH.\* | sphere 4; the bands shrink to lines; the deep-space point is crossed out | 4/4, 5 m | cut |
| 13 | IV · EINSTEIN | 2 | AND UP THERE, CLOCKS \*RUN FAST.\* | two clock readouts, ground and orbit, days passing, orbit gaining 38 µs a day | | dip to black |
| 14 | | 2 | SPEED SLOWS TIME: \*−7 µs\* A DAY. | a satellite on its orbit over the globe, streaking at 3.9 km/s | | cut |
| 15 | | 2 | WEAKER GRAVITY SPEEDS IT UP: \*+45 µs.\* | a gravity well: bent grid near the Earth, flat where the satellite is | | cut |
| 16 | | 2 | LEFT ALONE, THE MAP DRIFTS \*11 KM A DAY.\* | the opening map in night colors, the dot sliding away from you | 11 km | punch |
| 17 | V · THE FIX | 2 | SO EVERY SATELLITE CLOCK IS BUILT \*TO RUN SLOW.\* | the clock frequency retyping from 10.23 to 10.22999999543 MHz | 5 m | flash |
| 18 | | 1 | | recap: shots 3, 4, 5, 7, 8, 9, 12, 15 at half a beat each, in night colors, with labels | | punch |
| 19 | | 2 | YOU ARE \*HERE.\* | the opening map and dot, now with "± 5 M" | | flash |
| 20 | | 2 | EVERY TIME YOU OPEN A MAP, YOU ASK \*FOUR CLOCKS\* AND \*EINSTEIN.\* | the map dimmed behind centered text | | cut |
| 21 | | 1 | | title card FOUR CLOCKS, fade to black | HUD hidden | dip to black |

Transition meanings: a cut continues a thought; `zoom` goes up or inside; `flash` is an answer; `punch` is a problem; `dip` is a new chapter.

## Sound

Everything is synthesized on the same tempo map (`score()` in film.html).

- **The clock motif**: a tick on every beat from the first frame to the last; in "clocks run fast" it doubles to eighths.
- **Layers by chapter**: I adds a kick on 1 and 3 and hats; II adds kick on every beat, claps on 2 and 4, a bass on the chord roots (Am-F-C-G); III adds a plucked arpeggio on eighths; IV darkens to Dm-E with sixteenth hats; the finale resolves to A major.
- **Silence before the twist**: drums and bass drop out a beat before chapter IV, which lands on a sub drop.
- **Accents from the text**: a soft kick and hat on every payoff word, taken from `f.hits`.
- **Pings**: the satellite broadcast in shot 4, the signal's arrival in shot 5, the dot landing in shots 1 and 19.
- **Transitions**: a riser into every punch and an impact on it, a whoosh on every flash.

## Facts and sources

| Claim | Value | Source |
|---|---|---|
| Operational GPS satellites | 31 (the number varies by year, 24 are needed) | gps.gov, Space Segment |
| Orbit altitude | about 20,200 km, 12-hour orbits, 6 planes at 55° | gps.gov, Space Segment |
| Signal delay straight overhead | 20,200 km ÷ 299,792 km/s ≈ 0.0674 s | arithmetic |
| 1 ms of clock error | 299,792 km/s × 0.001 s ≈ 300 km | arithmetic |
| Four satellites for four unknowns | x, y, z and the receiver clock offset | standard GPS navigation solution |
| Special relativity (orbital speed ~3.9 km/s) | clocks run slow by ~7 µs a day | N. Ashby, "Relativity in the Global Positioning System", Living Reviews in Relativity 6 (2003) |
| General relativity (weaker gravity) | clocks run fast by ~45 µs a day; net +38 µs | Ashby 2003 |
| Uncorrected drift | 38 µs × 299,792 km/s ≈ 11.4 km a day | arithmetic |
| The fix | satellite clocks set to 10.22999999543 MHz instead of 10.23 MHz before launch | Ashby 2003 |
| Phone accuracy | about 5 m in open sky (gps.gov gives ≤ 4.9 m, 95%) | gps.gov, GPS Accuracy |

The sphere shots are a side view, not to scale, and say so on screen. The intermediate "you are within" values (6,000 km, 1,000 km) are illustrative orders of magnitude; the 300 km, 11 km and 5 m values are the computed ones.
