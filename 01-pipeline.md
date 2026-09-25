# Pipeline: how a code-driven video is built

## Core idea

The whole film is a function `draw(ctx, t)` that renders the entire frame from time `t`. The function doesn't remember previous frames. This gives three properties:

- you can seek to any second and get the same frame;
- the headless browser renders frame by frame, no matter how long a single frame takes, so heavy effects don't cause stutter in the final MP4;
- two renders produce an identical result.

## Page skeleton

```html
<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block;margin:auto}</style>
</head><body>
<canvas id="c"></canvas>
<script>
const W = 1920, H = 1080, FPS = 60, DURATION = 60; // seconds
const cv = document.getElementById('c');
cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');

// --- seeded RNG ---
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
// For particles: generate the parameter array ONCE with a fixed seed,
// then in draw(t) compute each particle's position from its parameters and t.
const rnd = mulberry32(1337);
const stars = Array.from({length: 400}, () => ({x: rnd()*W, y: rnd()*H, r: rnd()*1.5+0.3, ph: rnd()*6.28}));

// --- plan as data ---
const BPM = 100, BEAT = 60 / BPM;
const scenes = [
  { id: 'intro', start: 0,  end: 8,  draw: drawIntro },
  { id: 'build', start: 8,  end: 30, draw: drawBuild },
  { id: 'peak',  start: 30, end: 50, draw: drawPeak  },
  { id: 'outro', start: 50, end: 60, draw: drawOutro },
];
const events = [ // read by both the visuals and the audio
  { t: 8,  type: 'hit' },
  { t: 30, type: 'drop' },
];

// --- frame ---
function draw(t){
  ctx.clearRect(0,0,W,H);
  for (const s of scenes) {
    if (t >= s.start && t < s.end) {
      const lt = t - s.start, p = lt / (s.end - s.start);
      s.draw(ctx, lt, p, t);
    }
  }
  // transitions between scenes: see 05-transitions.md
}

function drawIntro(ctx, lt, p, t){ /* ... */ }
function drawBuild(ctx, lt, p, t){ /* ... */ }
function drawPeak (ctx, lt, p, t){ /* ... */ }
function drawOutro(ctx, lt, p, t){ /* ... */ }

// --- two modes ---
window.__meta = { W, H, FPS, DURATION };
window.__draw = draw;              // called by the render script
const RENDER = new URLSearchParams(location.search).has('render');

document.fonts.ready.then(() => {
  window.__ready = true;
  if (RENDER) return;
  let t0 = null, paused = false, offset = 0;
  addEventListener('keydown', e => {
    if (e.code === 'Space') paused = !paused;
    if (e.code === 'KeyR') { t0 = null; offset = 0; }
  });
  function loop(now){
    if (t0 === null) t0 = now;
    const t = paused ? offset : (offset = ((now - t0) / 1000) % DURATION);
    if (paused) t0 = now - offset * 1000;
    draw(t);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
});
</script></body></html>
```

## Effects that depend on the past

Trails, motion blur, a "fading trail" are usually done by painting a semi-transparent fill over the previous frame. This breaks determinism. Replacement: draw the object at several past moments `t - k*dt` with decreasing opacity. For motion blur, 6-10 samples per frame are enough.

```js
function drawWithTrail(ctx, t, drawObj, samples = 8, span = 0.12){
  for (let i = samples - 1; i >= 0; i--) {
    ctx.globalAlpha = (1 - i / samples) ** 2;
    drawObj(ctx, t - i * span / samples);
  }
  ctx.globalAlpha = 1;
}
```

## Physics and simulations

If you need a real simulation (fluid, cloth, collisions), it isn't a function of `t`. Options:
- in render mode, step the simulation with a fixed `dt = 1/FPS` strictly in frame order (the render script proceeds sequentially, so this works);
- for seeking in live mode, cache state snapshots every N seconds.

## Layers and offscreen buffers

For transitions, post-processing, and masks, each scene is drawn into its own `OffscreenCanvas` (or a regular canvas outside the DOM), then the buffers are composited. Keep 2-3 buffers and reuse them; don't create new ones per frame.

```js
const bufA = new OffscreenCanvas(W, H), bufB = new OffscreenCanvas(W, H);
const ca = bufA.getContext('2d'), cb = bufB.getContext('2d');
```

## When to switch to WebGL

Canvas 2D is good for up to a few thousand primitives and simple effects. If you need tens of thousands of particles, bloom, distortion, noise transitions, volume, or light, use WebGL (Three.js or a raw fragment shader). For a 2D look with shader post-processing, a convenient combo is: draw in Canvas 2D, then pass it as a texture into a full-screen shader.
