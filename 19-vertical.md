# Vertical video: Reels, Shorts, TikTok

A phone held upright is a different screen, not a cropped one. The frame is 9:16, the viewer's thumb and the platform's own interface cover the edges, the first second decides whether the next fifty are watched, and the text must be read at arm's length. This chapter is what changes against the landscape rules in the *frame*: size, safe zones, type, fonts, tools. What the silent viewer needs from the *film* (the word budget, the hook, the genres and their requirements) is [20-silent-social.md](20-silent-social.md); what a picture must do to prove a statement is [21-infographics.md](21-infographics.md). Everything else (a frame as a pure function of time, easing, stagger, depth, one bold choice) holds as it is. The worked example is [examples/lyapunov/](examples/lyapunov/): a 50-second film about the mathematician Alexey Lyapunov, in Russian.

## The format

| | |
|---|---|
| Frame | 1080×1920, 30 fps (60 doubles the render time and gains nothing on a phone) |
| Length | 30-60 s. Shorter is easier to finish; the retention math of a feed punishes slack |
| Build | `Film.create({ W: 1080, H: 1920, ... })` on `runtime/film.js`. Everything in [14-long-form.md](14-long-form.md) applies: thesis, spine, through-line, script as data |
| Render | `node render/render.mjs film.html film.mp4 --loudnorm`. The renderer sizes the browser from `window.__meta`, nothing to configure |

## What the runtime does when H > W

`Film.create` switches to portrait on its own (`f.portrait`, and `f.u = min(W, H) / 1080`, the unit for anything you draw in "1080p pixels"). Landscape films are untouched; this is checked byte for byte on the shipped examples.

| Setting | Landscape | Portrait |
|---|---|---|
| `safe` (sides, top, bottom; bottom defaults to top) | `[.065, .1]` | `[.07, .1, .22]` |
| Statement size (default) | 5.8% of the height | 9.5% of the width |
| Counter size (default) | 12% of the height | 20% of the width |
| Statement wider than its room | overflows | shrinks to fit, with a `console.warn` naming it. `fit: false` turns this off, `maxWidth` sets the room |
| Caption wider than its room | overflows | shrinks to fit once, with a warning |
| HUD (`Film.hudFrame`) | scales by height | scales by width; bottom readouts sit inside the bottom margin; the rail is wider |
| `push`, `whip` | sideways | also vertical with `axis: 'y'` (`dir: 1`: the old shot leaves upward, the new one comes from below: the swipe of a feed) |
| Vignette, `wipe` slant | | measured on the short side |
| Fonts | | loaded for the characters the film draws, see below |

Treat the warnings as errors: a statement that had to shrink is one more size in the film. Pick one size for the whole film that fits the longest line (`size: 94` in the example), or rewrite the line.

## Safe zones and the three bands

The feed draws its own interface over your frame: the account and caption at the bottom, a column of buttons on the right, a title bar at the top. Platforms differ and change; a conservative frame keeps the top 10-17% and the bottom 22% or more clear of anything that matters, and the sides at 7%. If the video will go out with a long caption, move content up.

Compose in three bands, and keep each in its place for the whole film so the eye learns where to look:

| Band | y of 1920 | What lives there |
|---|---|---|
| Top | 0-330 | the HUD: a year, a chapter, a progress rail. Decorative, so it may sit near the top edge |
| Middle | 330-760 | the statement (up to three lines) and its caption |
| Picture | 790-1500 | the proof of the statement; a vertical flow reads best: a stack of steps, a tree, a timeline running down |
| Bottom | 1500-1920 | empty. Platform UI covers it. Do not fill it to avoid "wasted" space |

## Type and composition

- **Condensed, heavy faces.** A phone is 1080 px of width; a line of capitals in a condensed bold (Oswald, Bebas, Archivo Narrow) fits half again as many letters at the same height as a wide face. Aim for 14-16 capitals a line at most, three lines a statement, one idea.
- **Text is large and the picture is simple.** Body text under 28 px at 1080 wide is unreadable on a phone; monospace captions at 24-30 px are the floor, and only for sources.
- **The picture flows vertically.** A landscape explainer lays things out left to right; here a scheme is a column, a family a tree growing upward, a journey a diagonal. When something must be wide, stack it.
- **Frame 0 must move.** There is no slow fade from black and no title card held for a second. The example opens with a stamp already growing out of the screen. See [06-montage.md](06-montage.md).
- **No dead stretch.** The viewer has a thumb. A held shot needs a slow push-in or sway under it (`drift()` in the example: a rotation of 0.2 degrees, a 3.5% scale over the shot, a few pixels of sway), plus one thing that keeps moving: a token on a path, a counter, a scanline.
- **Hook, then proof.** The first 2-3 s ask the question; the last shot calls back to the first frame. A 50-second film has room for about 11 shots of 2-6 s.

## Fonts and non-Latin text

Google Fonts (and most hosts) split a family into several files by `unicode-range`: Latin, Cyrillic, Greek, accented. `document.fonts.load('700 100px "Oswald"')` with no text fetches only the Latin file, and Cyrillic silently falls back to a default font. `Film.create` therefore loads each of `fonts` for the text it will draw: every statement and caption, plus `fontText` for text drawn inside `draw()` functions:

```js
Film.create({
  fonts: ['700 100px "Oswald"', '500 30px "IBM Plex Mono"'],
  fontText: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789 .,:;?!«»№·—',
  ...
```

The kit's default display face, Archivo, has no Cyrillic. Faces that do and suit a poster look: Oswald (condensed), Rubik, Unbounded (wide), Montserrat, Onest, Golos Text, Playfair Display (serif), and for mono IBM Plex Mono or JetBrains Mono. Check a family before you build on it: `curl -A "Mozilla/5.0 Chrome/130" "https://fonts.googleapis.com/css2?family=Oswald:wght@700"` lists one `@font-face` per subset, labelled `/* cyrillic */`, `/* latin */`. A font file missing from that list is a font that falls back.

## Facts, people and pictures

A short film about a real person is a claim on every frame.

- **Every number and date has a source** in `SCRIPT.md`; where sources disagree, the film says less (the example drops a volume count that two sources gave differently).
- **Do not credit one person for what several did.** Name all the authors on screen.
- **Check every supplied image against the facts before it goes on screen.** The brief for the example came with a portrait whose print carries the date stamp 1902; the subject was born in 1911. It was left out, and the film is typographic. A portrait is a drop-in only with a source and a licence.
- A rubber stamp, a headline or an archive page on screen should be an *illustration of the claim*, not a forged document: show the stamped word and the title of the source, not an invented quote.

## Audio

- Music as data ([18-music-generation.md](18-music-generation.md)): one section per shot or group of shots, an energy curve that follows the story, a silence (`breakBefore`) before the peak. Run `node render/music-report.mjs film.html report/` and read the piano roll.
- Effects on the same clock as the picture: the stamp's impact on the beat it lands, a riser into a reveal, a ticking printer under typed lines.
- Phones play through a small speaker and many people watch muted: the picture carries the film, so captions are part of the design, not a subtitle track. Master with `--loudnorm` (about −14 LUFS) and check the true peak in the report.

## Review

1. `node render/render.mjs film.html part.mp4 --shot id --draft` per shot while building; a vertical draft is 540×960.
2. `render/contact-sheet.sh film.mp4 sheet.png 2` (tiles 190 px wide and 12 columns for a portrait video, so the sheet stays readable). Look for: text over the platform's UI zones, a line that shrank (`console.warn`), a held shot with no motion, two things stamped on top of each other.
3. `render/still.mjs film.html stills/ shot@0.9` at full size for the details.
4. `node render/textcheck.mjs film.html`: sweeps the whole film and lists every statement or caption that had to shrink, and any page error. Exit code 1 if there is anything to report.
5. Preview on a phone: the live page in portrait works as is (`?t=12`, `?shot=id`).

## Checklist

- [ ] 1080×1920, 30 fps; the longest line fits the room at the film's one statement size, no fit warnings
- [ ] Nothing important in the top 10% or the bottom 22%; the HUD is decorative
- [ ] Frame 0 moves; the question is asked in 2-3 s
- [ ] No held shot without a push-in or something alive; the stamp, token or counter keeps going
- [ ] Every non-Latin character is in `fonts` + `fontText`, and the font really has the subset
- [ ] Every number and date has a source; no unverified portrait, no invented quote
- [ ] The ending calls back to the first frame; the last line reframes the thesis
- [ ] `--loudnorm`, true peak under −1 dBTP; the contact sheet reviewed

## Pitfalls

- A landscape layout stretched to 9:16: text at the top left of a 1920-wide frame had 1800 px; here it has 940.
- Tuning the size per shot to make a line fit: the type wanders. Fix the size once, rewrite the long lines.
- Cyrillic (or any non-Latin text) set in a font that does not have it, rendered in a fallback you never saw because the machine you tested on had the fallback installed.
- Filling the bottom fifth because it looks empty.
- Two stamps, two headlines or two cards in the same place at once: on a 1080 px screen overlap reads as a mistake.
- File size: `--crf 18 --preset slow` makes a 50-second 1080×1920 file of about 70 MB; platforms recompress anyway, `--crf 22` is plenty for an upload.
