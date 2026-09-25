# Agent brief: code-driven graphics and animation

Short rules. Details in the neighboring files.

## Architecture
1. A single self-contained HTML file. No external images or audio — everything is drawn and synthesized in code. Libraries only from a CDN.
2. A frame is a pure function of time: `draw(ctx, t)`. No accumulated state between frames. This gives you seeking, frame-by-frame rendering, and reproducibility.
3. Randomness is seeded only (mulberry32 or similar). `Math.random()` is forbidden in drawing code.
4. Start with the plan as data: beat grid, shot list, event list. Then the drawing code. Image and sound read from the same timing structure.
5. The page supports two modes: live preview (requestAnimationFrame) and render (`window.__draw(t)` called externally). Details in 01-pipeline.md.

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

## Review
18. After every version, render a contact sheet (one frame every 0.5 s) and look at it yourself. Look for: text overlaps, empty frames, static stretches longer than 2 s, elements running off the edges, brightness jumps.
19. Fix issues by specific frame, citing the timecode.
20. No sharp isolated hits in the audio right after silence.
