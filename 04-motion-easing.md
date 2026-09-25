# Motion and Timing

## Basic utilities

```js
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp  = (a, b, p) => a + (b - a) * p;
const seg   = (t, a, b) => clamp((t - a) / (b - a));   // progress 0..1 over the segment [a,b]
const smooth = p => p * p * (3 - 2 * p);

const ease = {
  inOutCubic: p => p < .5 ? 4*p*p*p : 1 - (-2*p + 2) ** 3 / 2,
  outCubic:   p => 1 - (1 - p) ** 3,
  outQuart:   p => 1 - (1 - p) ** 4,
  outExpo:    p => p === 1 ? 1 : 1 - 2 ** (-10 * p),
  inExpo:     p => p === 0 ? 0 : 2 ** (10 * p - 10),
  inOutExpo:  p => p===0?0:p===1?1:p<.5?2**(20*p-10)/2:(2-2**(-20*p+10))/2,
  outBack:    (p, s = 1.70158) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2,
  inBack:     (p, s = 1.70158) => (s + 1) * p ** 3 - s * p ** 2,
};

// Spring in closed form: deterministic, no integration needed.
// zeta < 1 gives oscillation; omega is stiffness.
function spring(t, zeta = 0.45, omega = 14){
  if (t <= 0) return 0;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
}
```

Usage: `x = lerp(x0, x1, ease.outExpo(seg(t, 2.0, 2.8)))`.

## Which curve to choose

| Situation | Curve |
|---|---|
| An object appears, flies in | outExpo, outQuart |
| An object leaves, flies away | inExpo, inCubic |
| Movement inside the frame | inOutCubic |
| Camera movement | inOutCubic or inOutSine, long |
| Appearance with character | outBack, spring |
| Impact, fall | inQuad until contact, then spring on the bounce |
| Continuous life (breathing, drift) | sin with different phases, noise |

Linear motion is acceptable only for constant processes: a rotating planet, a running text ticker, a conveyor belt.

## Timing

| Action | Duration |
|---|---|
| Micro-accent (pulse, flash) | 0.1-0.25 s |
| Element appearing | 0.3-0.6 s |
| Movement across the frame | 0.5-1.2 s |
| Transition between scenes | 0.4-1.0 s |
| Camera movement | 1.5-6 s |
| Holding a frame for reading | 0.3 s per word + 1 s |

Anchor key moments to the beat: `const beat = n => n * 60 / BPM`.

## Animation principles that actually work in code

- **Anticipation.** A small movement in the opposite direction before a fast move (inBack, or a separate 0.1-0.2 s segment).
- **Follow-through and overlapping action.** Parts of an object don't stop at the same time: a tail, hair, hanging elements lag behind. Simplest approach: the same curve shifted by 50-120 ms, or a spring with a different zeta.
- **Squash & stretch.** Stretch along the direction of motion during acceleration, flatten on impact, preserving area: `sx = 1 + k, sy = 1 / (1 + k)`.
- **Arcs.** Living things move along arcs, not straight lines. Add a perpendicular sine wave to the linear trajectory.
- **Slow in / slow out.** Any easing.
- **Secondary action.** While the main thing moves, something secondary lives too: particles, a shadow, a highlight.
- **Staging.** At every moment it is clear where to look. One primary movement, everything else quieter.
- **Exaggeration.** In code everything looks "textbook" — too modest. Double the amplitudes and look again.

## Stagger

```js
// the i-th element out of n starts with an offset; spread is the total spread of start times
function staggered(t, start, dur, i, n, spread = 0.4, curve = ease.outExpo){
  const s = start + (n > 1 ? i / (n - 1) : 0) * spread;
  return curve(seg(t, s, s + dur));
}
```

Stagger order carries meaning: left to right (reading order), from center outward (explosion, reveal), from the point of contact (reaction), random seeded (organic).

## Continuous life

A static frame longer than 1.5-2 s looks frozen. Minimal life:
- scale breathing of 0.5-1.5% on a sine wave with a period of 3-5 s;
- background and particle drift;
- light flicker of 2-5%;
- a slow camera push-in of 3-8% over the shot.

Different objects get different phases and periods (from a seed), otherwise everything pulses in sync.

## Camera movements

| Movement | Effect | 2D implementation |
|---|---|---|
| Push-in | tension, attention | scale grows around the point of interest |
| Pull-out | reveals scale, ending | scale shrinks |
| Pan | overview, following | translate on x |
| Tilt | reveals height | translate on y |
| Orbit | volume, solemnity | simulated in 2D with layer parallax |
| Handheld | documentary feel, unease | offset and rotation driven by fbm, small amplitude |
| Rack focus | shift of attention | foreground and background blur swap places |
| Whip pan | energy, cut | fast pan with motion blur, see 05-transitions.md |

The camera in 2D is a single `ctx.setTransform` per layer. Parallax: each layer multiplies the camera offset by its own coefficient (background 0.2, midground 1, foreground 1.6).

```js
function applyCamera(ctx, cam, depth = 1){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.translate(W/2, H/2);
  ctx.rotate(cam.rot * depth * 0.3);
  ctx.scale(1 + (cam.zoom - 1) * depth, 1 + (cam.zoom - 1) * depth);
  ctx.translate(-cam.x * depth, -cam.y * depth);
  ctx.translate(-W/2, -H/2);
}
```
