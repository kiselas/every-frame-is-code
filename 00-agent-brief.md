# Agent brief: code-driven graphics and animation

Short rules. Details in the neighboring files.

## Architecture
1. One HTML page. No external images or audio — everything is drawn and synthesized in code. Libraries only from a CDN. Films longer than ~45 s build on the kit's `runtime/film.js` (tempo map, shots, transitions, HUD, text, score) and are folded into one self-contained file with `runtime/inline.mjs` for publishing.
2. A frame is a pure function of time: `draw(ctx, t)`. No accumulated state between frames. This gives you seeking, frame-by-frame rendering, and reproducibility.
3. Randomness is seeded only (mulberry32 or similar). `Math.random()` is forbidden in drawing code.
4. Start with the plan as data: beat grid, shot list, event list. Then the drawing code. Image and sound read from the same timing structure.
5. The page supports two modes: live preview (requestAnimationFrame) and render (`window.__draw(t)` called externally). Details in 01-pipeline.md.

## Meaning (films over ~45 s, details in 14-long-form.md)
- A one-sentence thesis, and a hook that asks its question in the first 2-4 s.
- A through-line that carries state across the film (a metric in the HUD, a motif, a count) and reverses at least once.
- One idea per statement, with a picture that proves it; every number has its arithmetic or source in a caption.
- The ending calls back to the opening image; the last line reframes the thesis.

## Visuals
6. One world, not slides. The camera moves through continuous space; scenes flow into one another.
7. At least three depth layers: background, midground, foreground. Parallax between them.
8. One light source per scene; all lighting is consistent with it.
9. Boldness in one place. One memorable choice per video, everything else disciplined.
10. Don't fall back on the default: a dark-blue background with an amber accent, a neon gradient, centered text for everything, random particles to fill empty space. If no style is specified, propose a style that follows from the subject.

## Motion
11. Nothing moves linearly. Every motion follows an easing curve; large objects have anticipation and overshoot.
12. Stagger instead of simultaneity: elements in a group start with a 30-80 ms offset.
13. No dead stretches: something in the frame is always alive (breathing, drift, flicker), but not everything at once.
14. Cuts and accents land on strong beats.

## Text
15. Fonts are loaded before the first frame (`document.fonts.ready`).
16. Text never overlaps important objects or the brightest spot in the frame. Safe zones are 5-8% from the edges.
17. Reading time: at least 0.3 s per word plus 1 s of margin.

## Performance
18. No `getImageData` in the frame loop, not even for timing: Chrome moves the canvas to the CPU and every draw gets several times slower. Read pixels only at init.
19. Blur and glow go into sprites rendered once: no `ctx.filter` per draw call, no `shadowBlur` on many shapes, no gradient per particle. One blur of a whole layer per frame is fine.
20. Static layers are rendered once into offscreen buffers; buffers are allocated at init and reused.
21. Expensive composites (motion blur, whip, bloom) run on a half- or quarter-size buffer and are scaled up once.
22. Caches are keyed by look (glyph, color, blur level), never by time or frame order: parallel workers render chunks out of order. Details and measurements in 13-performance.md.

## Pixel and retro (15-17)
27. Say the limits in the plan (resolution, palette, sound channels) and keep to them: 160x90, one fixed palette, 4-6 colors per scene. Draw with `runtime/pixel.js` in palette indexes, never CSS colors, so palette maps and swaps work.
28. Pixel motion is whole-pixel: round positions, camera and shake; scale and rotate by nearest neighbor only; never let `imageSmoothingEnabled` stay on.
29. Fades, shadows and transparency are dither (`scr.dither`, `Pixel.transitions`) and palette maps (`Pixel.fadeMap`), not alpha.
30. Music is data, not hand-typed loops: write a plan (key, style, one energy per shot or chapter, matching the film's bars), let `runtime/compose.js` generate the Score and `runtime/chip.js` play it on the film's tempo map. You cannot hear: run `MusicLint` and `render/music-report.mjs`, fix the plan, and give the human the audition page (`18-music-generation.md`). MML is for short hand-written parts. Retro backdrops are per-pixel formulas of (x, y, t) from `runtime/pixel-fx.js`: stateless, so they seek and render in parallel.

## Vertical (19)
31. For Reels, Shorts and TikTok build on `runtime/film.js` with `W: 1080, H: 1920` (`Film.create` switches to portrait defaults on its own). Keep important content out of the top 10% and the bottom 22%; frame 0 must already move; use one statement size for the whole film that fits the longest line, and run `node render/textcheck.mjs film.html`: a line that had to shrink is a bug in the script, not a feature.
32. Every character the film draws must be in the loaded font: `fonts` plus `fontText` (text drawn inside `draw()`), and the family must really have the subset (Archivo has no Cyrillic; Oswald and IBM Plex Mono do). Check a supplied image or a quote against the facts before it goes on screen.

## Silent social video and infographics (20, 21)
33. Social video is watched without sound: the picture is the film, music is a bonus layer. Review once with the sound off. Word budget 2.5 words per second of film; a statement is at most 8 words and stays at least 2 s; frame 0 moves and the question is on screen by 2 s. Name the genre in `SCRIPT.md` and check its requirement card (`20-silent-social.md`).
34. A picture proves the statement or it is not a picture. Write the claim type per shot (magnitude, comparison, change, mechanism, structure, location, identity); apply the label test (cover the drawing, read the labels as a list: if nothing is lost, redraw); encode with position, length or counts, never area; every number has a yardstick drawn first and a source in the caption; animate the datum, keep the chrome still, hold the end state at least 1.5 s (`21-infographics.md`).

## Review
23. Iterate on fragments with `render.mjs --draft`; run `--profile` when a render is slow, it names the slowest timecodes.
24. After every version, render a contact sheet (one frame every 0.5 s) and look at it yourself. Look for: text overlaps, empty frames, static stretches longer than 2 s, elements running off the edges, brightness jumps.
25. Fix issues by specific frame, citing the timecode.
26. No sharp isolated hits in the audio right after silence.
