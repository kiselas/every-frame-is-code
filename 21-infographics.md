# Infographics in motion: a picture is an argument

The weak frame of an explainer is almost never the text: it is the picture that looks like a diagram and says nothing. Boxes with words in them, arranged in a circle. A list of names on a line. A big number with no scale. These are *labels in costume*: remove the drawing and read the labels as a list, and nothing is lost. This chapter is how to make a picture that proves the statement above it, in the few seconds a silent viewer gives it. It applies to every genre in [20-silent-social.md](20-silent-social.md) and to landscape films too; the worked critique at the end is of [examples/lyapunov/](examples/lyapunov/).

## What a picture is for

A picture earns its place by answering a question the text cannot answer in eight words. There are only a few such questions, and naming which one a shot answers is the first design decision:

| The claim is about | The question the picture answers | Picture |
|---|---|---|
| **Magnitude** | how much, how many | a bar or a count against a yardstick |
| **Comparison** | more than what | two bars, a split frame, before/after |
| **Change** | how it moved over time | a line, a growing bar, a marker on a rail |
| **Part of whole** | what share | a stacked bar, a unit grid with a filled part (not a pie) |
| **Ranking** | which came first | an ordered column of bars |
| **Mechanism** | what causes what, what happens inside | parts that move, a token on a path, a signal that travels |
| **Structure** | what is made of what, who branches from whom | a tree or a graph that *grows*, with its count |
| **Location** | where | a map with the thing on it, a distance drawn |
| **Identity** | what it looked like | a prop: the page, the stamp, the device, drawn |

If a shot's claim fits none of these, the shot has no picture; it has a statement and a mood. Decide that honestly (a typographic shot is fine), rather than decorating it with a diagram.

## The label test

Cover the drawing and read what is left as a list. If the list says the same thing, the drawing is decoration.

| Fails | Why | Passes |
|---|---|---|
| six professions in boxes around a circle | the list "mathematicians, biologists, linguists..." says the same thing | six *unit icons* that arrive one by one, with a count that ends on 6, or a grid of 40 attendee dots colored by field |
| five names on a vertical line | the names mean nothing to the viewer; the line adds nothing | a tree that fans out: 1 to 5 to 23, the count running in the HUD, one name only if the viewer knows it |
| a gear labeled "PP" | the label does the work | three schemes going in, code lines coming out, two counters: "typed by hand: 0", "lines produced: 19" |
| a large "8" and eight squares | a count without a reference point | the same 8 against what came before it: an empty row for 1951 |
| a flowchart of labeled boxes, static | a list of steps in rectangles | the same chart with a token running it: the loop is *seen* to loop |

The test is cheap and it is the whole chapter: a picture must show something the words cannot say.

## Encoding: how people read quantity

Cleveland and McGill measured how accurately people judge values from different visual encodings. From best to worst: **position on a common scale, position on unaligned scales, length, angle and slope, area, volume, color saturation.** For a phone screen seen for three seconds, use the top of the list and nothing below length:

- **Bars from zero, horizontal when there are labels.** A bar's length is read in a glance and its label fits beside it. Vertical bars suit time; horizontal bars suit categories with words.
- **Counters count.** A running number (`Film.count`) is a bar in disguise: the viewer feels the magnitude from the time it takes to arrive. Give it a unit and a yardstick.
- **Unit pictograms (Isotype)** for counts up to about 50: one icon per unit, arriving one at a time, in rows of 5 or 10. People count icons more reliably than they read areas.
- **No pies, donuts, bubbles, 3D.** Angle and area are read badly, and in a 700 px band the slices are unreadable anyway. A part of a whole is a stacked bar or a unit grid with a filled part.
- **Area only for ratios of 100x and more**, when a bar would leave the room, and say so (`log: true` in `Film.count` and in the caption).

## The yardstick

A number alone is a label. It becomes information next to a reference the viewer already owns:

- a known quantity: *2,800 km, Moscow to Novosibirsk; Moscow to St Petersburg is 700*
- a before: *8 lectures in 1952; courses on programming in the country in 1951: 0*
- a human scale: *a 20 MB file, or 14,000 floppy disks*
- the previous value in the same film: the HUD carries it

The yardstick is drawn in the same encoding and at the same scale as the datum, in the muted color, and it appears first. Then the datum arrives against it. Order matters: reference, then the thing measured.

## Motion is data

A silent viewer reads movement as "the data changed". So:

- **Animate the datum, never the chrome.** The bar grows, the dot travels, the count runs, the tree branches. Axes, frames, gridlines, titles and the yardstick appear at once or are already there. A frame that draws itself with a flourish is spending the viewer's attention on nothing.
- **Build in reading order.** Setup (the yardstick, the axis) → the datum → the comparison → the annotation. One thing arrives at a time, 300-800 ms apart; the payoff of the picture lands on the payoff word of the statement.
- **Hold the end state.** The final frame of a chart *is* the chart; everything before it is the approach. Hold it for the reading time of its labels: at least 1.5 s, better 2.
- **Change in place, not by replacement.** When two values are compared over time, the same bar grows or shrinks; do not cut to a second chart. Morphing keeps the viewer's frame of reference.
- **One transition per idea.** A picture that changes three times in a shot is three pictures. Split the shot.
- **Looping motion only for mechanisms.** A token circling a loop *is* the claim "this repeats". A pulsing bar is noise.

## Annotation

- **Labels touch their marks.** No legend. In a 50-second film nobody maps colors to a key. The label sits at the end of the bar, next to the dot, inside the box.
- **One accent color, on the datum.** Everything else is ink and muted. The accent appears on the thing the statement is about, and on the payoff word, and nowhere else in the frame.
- **The unit is on screen.** "2 800" is a typo; "2 800 KM" is a distance.
- **The caption is the source**, in the monospace line under the statement: the arithmetic ("0.0674 S × 299,792 KM/S ≈ 20,200 KM"), the dataset, the year, the page.
- **Numbers have at most three significant digits** on screen (2 813 km becomes ≈ 2 800). Precision the viewer cannot use looks like a lie.

## Icons, props and words

- **A thing with a shape gets an icon or a prop**: a page, a stamp, a tool, a satellite, a microscope. Draw it in the film's line grammar (one weight, hatching instead of gradient, see [14-long-form.md](14-long-form.md) §7); never import a clip-art set.
- **A thing without a shape gets a count, not a word.** Professions, institutions, abstractions: the viewer cannot picture "linguists", but can see six unit figures arriving and a count ending on 6.
- **Names are captions.** A name on screen is for the one viewer in a hundred who knows it; the picture for the other ninety-nine is *how many* and *what they did*. Put the name in the caption line or in the HUD, not in the picture.
- **Text in the picture is a label, at most three words**, in the mono face, smaller than the statement. A box with a sentence in it is a slide.

## Scale honesty

- Bars start at zero. A truncated axis makes a 3% difference look like a cliff.
- One scale per sequence: when shots 3, 4 and 5 compare values, the same pixel means the same quantity in all three. If the range makes that impossible, use a log scale and say "log" in the caption.
- Areas scale by area, not by side (a circle for 4x has twice the radius, not four times).
- A map is at its true proportions; a route is the real route, roughly; a distance written on it is the great-circle figure from the coordinates, rounded.
- A timeline's marks are placed by date, not spaced evenly.

## Density on a phone

The picture band is about 940 × 700 px of a 1080 × 1920 frame. What fits, read at arm's length in three seconds:

| Element | Limit |
|---|---|
| marks in a chart (bars, dots, icons) | 5-7 bars; 10-50 unit icons in rows |
| labels inside the picture | 4-6, at 28-32 px mono |
| nodes in a diagram | 5-6, each with a label of at most 2 words |
| numbers on screen at once | 1 datum + 1 yardstick |
| colors | ink, muted, one accent (plus the card or paper color) |

Over any of these, split the shot.

## Working method

1. For every shot in the script table, write the **claim type** (magnitude, comparison, change, part, ranking, mechanism, structure, location, identity) and the **datum with its yardstick**. A shot that has neither is typographic; mark it so.
2. Choose the encoding from the top of the Cleveland-McGill list; write the picture in one line ("a horizontal bar, 2,800 km against 700 km, Moscow to Novosibirsk on a map below").
3. Apply the label test to the line. If the labels say it all, rewrite.
4. Draw the end state first, as a still (`render/still.mjs film.html out/ shot@0.95`). Fix it as a poster: one accent, labels touching marks, unit, source.
5. Then the approach: the order of arrival, the hold, the payoff beat.
6. Review the shot with the statement covered: does the picture alone say what the statement says? Then with the picture covered: does the statement promise what the picture delivers?

## A worked critique: Lyapunov, version 1

The first version of [examples/lyapunov/v1/film.html](examples/lyapunov/v1/film.html) has good typography, a sound structure and a stamp motif that works. Its pictures are the weak layer: five of the eleven fail the label test. Shot by shot:

| Shot | Claim | Claim type | What v1 shows | Verdict | What it should show |
|---|---|---|---|---|---|
| 1 `stamp` | the word was a verdict | identity | a dictionary page, a stamp lands | **holds**: a prop that is the claim | as is |
| 2 `who` | a mathematician returned it | identity + setup | the name, dates, three facts as a list | **weak**: three facts are captions, not a picture | the name and dates stay; the three facts become one picture: the life as a bar on the timeline, 1911-1973, with the war years hatched and 1952 marked where the deed starts |
| 3 `course` | the first programming course in the country | magnitude (a first) | a big "8", eight squares filling | **weak**: 8 has no yardstick, and 8 lectures is not the claim; "first" is | a row for 1951 with zero courses, a row for 1952 with one; the "8 lectures" as the caption |
| 4 `numbers` | the machine knew only numbers | identity | scrolling octal, one digit flickers | **holds**: the texture is the claim; the flicker is decoration without a reason | keep the columns; drop the flicker, or make it the one wrong digit that a scheme would have caught |
| 5 `scheme` | first the scheme, split the task into operators | mechanism | a flowchart draws itself, a token runs two loops | **holds, incomplete**: a mechanism that runs is right; but the claim "first the scheme" is a *before/after* and only the after is shown | split the band: left, the octal column from shot 4 (the before); right, the scheme (the after); the token runs on the right while the left stays dead |
| 6 `compile` | the program assembles them itself | mechanism + magnitude | three blocks feed a gear "ПП", code lines print, counters "typed by hand: 0 / lines: 19" | **mixed**: the counters are the best infographic in the film; the gear is a label in a shape | keep the counters and the printing; replace the gear with the three schemes visibly turning into lines (a block enters, three lines leave) |
| 7 `seminar` | he gathers an interdisciplinary seminar | structure (many kinds) | six profession labels in boxes around a labeled circle | **fails** the label test outright | unit figures arriving one by one in six colors, 1954 → 1964 on the HUD as the count grows; the professions as a caption; or a 10-year bar with the seminar's span against a career |
| 8 `article` | the first article in its defence | identity + change | the article lands on the old page, three names | **holds**: the prop; the names are right (a joint claim must name all three) | add the yardstick of time: a two-mark rail, 1953 "against", 1955 "for", in the caption or the HUD |
| 9 `council` | a council at the Academy | identity (the reversal) | the old stamp struck out, "НАУКА" lands | **holds**: the motif pays off | as is |
| 10a `siberia` | Siberia, from 1961 | location + magnitude | a route on a map, a distance counter to ≈ 2,800 km | **holds**: the one shot with a datum and a unit; missing the yardstick | a faint second route, Moscow to St Petersburg, 700 km, drawn first |
| 10b `siberia` | he raised a school | structure (fan-out) | five names on a vertical line | **fails**: names the viewer does not know, and no magnitude | a tree that fans out: 1 → 5 → 20-odd, the count in the HUD; one name at most (Ershov) in the caption |
| 11 `end` | the label peeled off, the science stayed | identity (callback) | the page again, the stamp dissolves, a scheme runs | **holds** | as is |

Three patterns behind the failures: a **list dressed as a diagram** (shots 2, 7, 10b), a **number without a yardstick** (3, 10a), and a **before/after with only the after** (5). The fixes are not more drawing: in every case the fix is a count, a comparison or a second state, and they are all data the script already had.

## Checklist

- [ ] Every shot has a claim type written in `SCRIPT.md`, or is marked typographic
- [ ] Every picture passes the label test
- [ ] Encodings are position, length or counts; no pies, donuts, areas, 3D
- [ ] Every number has a yardstick in the frame, drawn first, in the same encoding and scale
- [ ] Only the datum moves; the chrome is still; the end state holds for at least 1.5 s
- [ ] Labels touch marks; no legend; one accent color, on the datum and the payoff word
- [ ] Units on screen, sources in the caption, at most three significant digits
- [ ] Bars from zero; one scale per sequence; timelines placed by date
- [ ] Within the density limits for a phone; split the shot otherwise
- [ ] A "X replaced Y" claim shows Y and X together

## Sources

- William S. Cleveland and Robert McGill, [Graphical Perception: Theory, Experimentation, and Application to the Development of Graphical Methods](https://www.textbookofusability.com/references/clevelandmcgill1984.html), 1984: the ranking of visual encodings by accuracy of judgment.
- Edward Tufte, *The Visual Display of Quantitative Information*: data-ink, chartjunk, graphical integrity. A summary: [Tufte's principles](https://thedoublethink.com/tuftes-principles-for-visualizing-quantitative-information/). On why minimal is not always best: [the Goldilocks charts](https://scienceux.org/articles/data-ink-ideal-vs-minimal).
- Otto Neurath, Isotype: unit pictograms, one icon per unit, counted not measured.
- Claus Wilke, [Fundamentals of Data Visualization](https://clauswilke.com/dataviz/introduction.html): a free, modern treatment of encoding, color and annotation.
- Shu et al., [What Makes a Data-GIF Understandable?](https://arxiv.org/abs/2008.07227), IEEE VIS 2020: a study of animated charts; the recommendations behind "animate the datum, hold the end state, one transition per idea".
- One message per scene in animated infographics: [data storytelling in motion](https://rendercomp.com/blog/animated-infographics-remotion-data-storytelling/).
