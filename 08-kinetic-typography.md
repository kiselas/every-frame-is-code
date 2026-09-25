# Kinetic Typography

## Basics

- Load fonts before the first frame: include Google Fonts, wait for `document.fonts.ready`. For reliability, call `document.fonts.load('700 120px "Cinzel"')` for each weight used.
- Maximum two families. Contrast must be explicit: serif and sans-serif, wide and narrow.
- Hierarchy: one phrase per frame is primary, everything else noticeably smaller.
- Safe zones: 5–8% from the edges; for vertical platforms, more at the bottom (UI overlays there).
- Reading time: 0.3 s per word + 1 s. Less than that, and the viewer won't have time.
- Text does not sit on the brightest or most detailed part of the frame. Text needs a quiet zone or a backing (darkening, background blur under the line).

## Layout

```js
function layoutLine(ctx, text, font, tracking = 0){
  ctx.font = font;
  const chars = [...text]; let x = 0; const out = [];
  for (const ch of chars) { const w = ctx.measureText(ch).width; out.push({ ch, x, w }); x += w + tracking; }
  return { chars: out, width: x - tracking };
}
```

Measuring character by character breaks kerning. For large titles, measure prefixes (`measureText(text.slice(0, i))`); the position of character i is the prefix width.

## Techniques

**Character-by-character reveal with blur**
```js
function revealText(ctx, text, font, cx, cy, t, t0, per = .04, dur = .6){
  const L = layoutLine(ctx, text, font, 4); ctx.font = font; ctx.textBaseline = 'middle';
  L.chars.forEach((c, i) => {
    const p = ease.outExpo(seg(t, t0 + i * per, t0 + i * per + dur));
    if (p <= 0) return;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.filter = `blur(${(1 - p) * 12}px)`;
    ctx.translate(cx - L.width / 2 + c.x, cy + (1 - p) * 30);
    ctx.fillText(c.ch, 0, 0);
    ctx.restore();
  });
}
```

**Mask reveal.** Text slides out from under an invisible line: `clip` to the line's rectangle, text shifts from bottom to top by its own height. Very clean, suits serious topics.

**Tracking.** Letters spread from tight to loose over 2–4 s against a slow push-in. Solemn, cinematic.

**Hit on the beat.** A word appears scaling from 1.3–1.6 down to 1 on a spring, together with a short frame shake and a flash. Only on key words.

**Word swap.** The phrase stays put, one word in it changes (a vertical slot, like a split-flap display). Good for lists.

**Typewriter.** Characters appear at a fixed interval, the cursor blinks with a 1 s period. A key sound on each character with slight pitch variation.

**Disintegration.** Letters turn into particles (sampling the text's pixels) and scatter or burn away. Reverse: particles assemble into a new word.

**Text on a path.** Characters along a curve: for each position along the length, find the point and tangent, rotate the character to match the tangent.

**Meaning-driven motion.** Each word behaves according to its meaning: "fall" falls, "growth" grows, "silence" appears slowly and quietly, "explosion" scatters. This is the main technique that separates good kinetic typography from generic.

## Variable fonts

`ctx.font` does not support variable font axes. Options: load several fixed weights and switch between them; render the text in the DOM with `font-variation-settings` on top of the canvas (in render mode this will be captured if you screenshot the whole page, not just the canvas).

## Captions for voice-over

Get word timings (see 09-audio-sync.md) and turn them into data:

```js
const captions = [
  { text: 'WE NEVER', start: 118.2, end: 119.4 },
  { text: 'GAVE IT BACK.', start: 119.4, end: 124.0, style: 'hero' },
];
```

Show phrases of 2–5 words; the phrase's key word can be emphasized with weight or size, but not with color every time.
