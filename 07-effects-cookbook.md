# Effects Cookbook

All recipes are deterministic: state is computed from `t` and seeded parameters.

## Noise

```js
// 2D value noise + fbm, seeded
function makeNoise(seed = 1){
  const r = mulberry32(seed), P = new Uint8Array(512), G = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; G[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const h = (x, y) => G[P[P[x & 255] + (y & 255)]];
  const n = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v); };
  const fbm = (x, y, oct = 5) => { let s = 0, a = .5; for (let i = 0; i < oct; i++) { s += a * n(x, y); x *= 2; y *= 2; a *= .5; } return s; };
  return { n, fbm };
}
const N = makeNoise(42);
```

Uses: line jitter, particle drift, handheld camera, rough edges, flicker, clouds.

## Stateless particle system

Each particle gets constant parameters at init. In a frame, its age is computed cyclically from `t`.

```js
const rp = mulberry32(7);
const particles = Array.from({ length: 800 }, () => ({
  off: rp() * 10, life: .8 + rp() * 1.4,
  x0: (rp() - .5) * 60, vx: (rp() - .5) * 40, vy: -(140 + rp() * 180),
  size: 6 + rp() * 16, wob: rp() * 6.28,
}));

function particleState(p, t){
  const cycle = Math.floor((t + p.off) / p.life);
  const age = ((t + p.off) % p.life) / p.life;          // 0..1
  const tt = age * p.life;
  return { age, cycle,
    x: p.x0 + p.vx * tt + Math.sin(t * 3 + p.wob) * 12 * age,
    y: p.vy * tt + 0.5 * (p.g || 0) * tt * tt };         // p.g: gravity, if needed
}
```

`cycle` can be used as an extra seed so each particle "life" differs slightly.

## Sprites instead of gradients

`createRadialGradient` per particle per frame is slow. Pre-render sprites once:

```js
function makeGlowSprite(r, color){
  const c = new OffscreenCanvas(r * 2, r * 2), x = c.getContext('2d');
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, color); g.addColorStop(.35, color.replace(/[\d.]+\)$/, '0.35)')); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, r * 2, r * 2); return c;
}
```

## Fire

Color ramp by particle age, additive blending, sprites for 16 ramp steps.

```js
const FIRE_RAMP = [[255,250,230],[255,214,120],[255,140,60],[220,60,30],[90,20,10],[20,5,5]];
function rampColor(ramp, a){
  const x = clamp(a) * (ramp.length - 1), i = Math.floor(x), f = x - i, c0 = ramp[i], c1 = ramp[Math.min(i + 1, ramp.length - 1)];
  return c0.map((v, k) => Math.round(lerp(v, c1[k], f)));
}
const fireSprites = Array.from({ length: 16 }, (_, i) => {
  const [r, g, b] = rampColor(FIRE_RAMP, i / 15);
  return makeGlowSprite(64, `rgba(${r},${g},${b},1)`);
});

function drawFire(ctx, t, cx, cy, scale = 1){
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const s = particleState(p, t);
    const x = cx + s.x * scale + (N.n(s.x * .02, t * 1.5) - .5) * 40 * s.age * scale;
    const y = cy + s.y * scale;
    const r = p.size * (1 - s.age * .6) * scale;
    ctx.globalAlpha = (1 - s.age) ** 1.5 * .8;
    const spr = fireSprites[Math.min(15, Math.floor(s.age * 16))];
    ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}
```

Add a separate sparks layer on top: small particles with a long life, flying higher and farther, arcing by noise.

## Smoke

Like fire, but: normal blending (not `lighter`), sprites are gray with low alpha, size grows with age (×3–5), motion is slow, strong fbm drift, sprite rotation.

## Glow and bloom in 2D

```js
// two-layer glow of an object: core + wide halo.
// Two filter blurs per call: fine for one hero object per frame. For anything drawn many times
// (particles, letters, UI elements) render the glowing shape once into a sprite and drawImage it.
function glow(ctx, drawShape, color, core = 8, halo = 40){
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = `blur(${halo}px)`; ctx.globalAlpha = .5; drawShape(ctx, color);
  ctx.filter = `blur(${core}px)`; ctx.globalAlpha = .9; drawShape(ctx, color);
  ctx.filter = 'none'; ctx.globalAlpha = 1; drawShape(ctx, '#fff');   // hot center is almost white
  ctx.restore();
}
```

Bloom for the whole frame: downscale the frame 4x, keep only bright areas (in 2D, roughly via `filter: brightness() contrast()`), blur, scale back up with `lighter`. For quality bloom, move to WebGL (UnrealBloomPass or your own shader).

`ctx.filter = 'blur()'` is paid per draw call, on a canvas-sized layer: one blur of the whole frame costs ~2 ms at 1080p, but a blur on each of 24 letters costs ~17 ms. Blur whole layers, or bake the blur into sprites. For large radii, blur a downscaled copy and scale it up: blur(40px) at full resolution ≈ blur(10px) at a quarter. Measurements: 13-performance.md.

## Film grain

```js
const grainTiles = Array.from({ length: 8 }, (_, k) => {
  const c = new OffscreenCanvas(256, 256), x = c.getContext('2d'), img = x.createImageData(256, 256), r = mulberry32(100 + k);
  for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i+1] = img.data[i+2] = v; img.data[i+3] = 255; }
  x.putImageData(img, 0, 0); return c;
});
function drawGrain(ctx, t, amount = .06){
  const tile = grainTiles[Math.floor(t * 24) % grainTiles.length];   // grain changes 24 times per second
  ctx.save(); ctx.globalAlpha = amount; ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(tile, 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();
}
```

## Vignette

```js
function vignette(ctx, strength = .45){
  const g = ctx.createRadialGradient(W/2, H/2, Math.min(W, H) * .35, W/2, H/2, Math.hypot(W, H) * .6);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
```

## Hand-drawn line and line boil

```js
// jittery line; seed changes 10 times per second, like hand-drawn animation
function inkLine(ctx, pts, t, amp = 1.6, fps = 10){
  const r = mulberry32(Math.floor(t * fps) * 131 + pts.length);
  ctx.beginPath();
  pts.forEach(([x, y], i) => { const jx = (r() - .5) * amp, jy = (r() - .5) * amp; i ? ctx.lineTo(x + jx, y + jy) : ctx.moveTo(x + jx, y + jy); });
  ctx.stroke();
}
```

To draw a line progressively over the animation: `ctx.setLineDash([len, len]); ctx.lineDashOffset = len * (1 - p)`.

## Starfield and nebulas

- Stars: 3 layers with different brightness and parallax, flicker `0.7 + 0.3 * sin(t * k + phase)` with individual k and phase.
- Nebula: fbm, colored with a ramp, rendered once at low resolution, scaled up and drifting slowly. A second fbm layer at a different scale on top in `lighter`.

## Fog and atmosphere

Semi-transparent fbm layers between depth planes, each with its own drift speed. Blend distant objects with the fog color: `mix(color, fogColor, depth)`.

## Shader post-processing (WebGL)

The runner from 05-transitions.md also works for post-processing a single frame (pass the same buffer as both `from` and `to`).

```glsl
// chromatic aberration + vignette + grain
uniform float time;
void main(){
  vec2 d = (uv - .5) * .004;
  vec3 c = vec3(texture2D(from, uv + d).r, texture2D(from, uv).g, texture2D(from, uv - d).b);
  float v = smoothstep(.9, .3, length(uv - .5));
  float g = hash(uv * 1000. + fract(time * 24.)) - .5;
  gl_FragColor = vec4(c * mix(.6, 1., v) + g * .05, 1.);
}
```

```glsl
// god rays: radial blur from a light source
uniform vec2 light;
void main(){
  vec2 dir = (uv - light) / 64.; vec2 p = uv; vec3 acc = vec3(0); float w = 1.;
  for (int i = 0; i < 64; i++){ p -= dir; acc += texture2D(from, p).rgb * w; w *= .96; }
  gl_FragColor = vec4(texture2D(from, uv).rgb + acc * .025, 1.);
}
```

If you use `time` in the shader, add a uniform to the runner and pass `t`, not system time.

## Other effects worth knowing

- **CRT:** scanlines (horizontal stripes with alpha 0.1–0.2), barrel distortion, glow, slight flicker.
- **Heat haze:** UV offset by fbm, animated upward.
- **Lens flare:** a chain of circles along the line between the light source and the frame center, varying size and color, additive.
- **Pixelation:** draw into a small buffer, scale it up with `imageSmoothingEnabled = false`.
- **Dithering:** ordered dithering (Bayer matrix) in a shader for a retro look with a limited palette.
- **Particles into text:** render text into a hidden canvas, sample opaque pixels into points, particles fly to these points with stagger.
