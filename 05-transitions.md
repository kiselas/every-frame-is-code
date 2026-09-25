# Transitions

## Transition hierarchy

From best to worst by "cinematic quality":

1. **Motivated.** The scene transitions on its own through movement inside the frame. The viewer doesn't notice the cut.
2. **Graphic.** A match cut by shape, color, motion: a round eye becomes the moon, a falling drop becomes a falling star.
3. **Technical with character.** Whip pan, zoom-through, noise dissolve, glitch, flash of light.
4. **Neutral.** Crossfade, fade to black. Good as a pause, bad as the only tool.

Rule: no more than two or three transition types per video, and each type is tied to a meaning (for example, zoom-through always means "going deeper into a detail," fade to black means "time has passed").

## Motivated transitions

- **Foreground covers the frame.** An object (a column, a bird, a hand, a cloud) crosses close to the camera and fully covers the frame; a new scene is already behind it. Technically: a wipe with a mask shaped like the object.
- **Push-in on a detail.** The camera moves into a pupil, a window, a screen, a crack; the detail fills the frame and becomes a new world.
- **Pan into the sky and back.** Tilt up into the sky or darkness, then tilt down into a different place. The sky hides the cut.
- **Transformation.** One object flows into another: contour points are interpolated between the two shapes.
- **Light.** A flash fills the frame with white; a new scene emerges out of the white.
- **Scale jump.** Pull out from an object to space, push in to atoms. A seamless zoom through scale levels.

## Framework

Each scene is drawn into its own buffer; the transition blends the two buffers by progress `p`.

```js
const transitions = [
  { at: 8, dur: 0.8, type: 'zoomThrough', origin: [960, 420] },
  { at: 30, dur: 0.6, type: 'whip', dir: 1 },
];

function drawFrame(t){
  const tr = transitions.find(x => t >= x.at - x.dur/2 && t < x.at + x.dur/2);
  if (!tr) { renderSceneAt(ctx, t); return; }
  const p = (t - (tr.at - tr.dur/2)) / tr.dur;
  renderSceneAt(ca, tr.at - 1e-3, t);   // outgoing scene (time keeps advancing)
  renderSceneAt(cb, tr.at + 1e-3, t);   // incoming scene
  TRANSITIONS[tr.type](ctx, bufA, bufB, p, tr);
}
```

`renderSceneAt(target, sceneKey, t)` selects a scene by `sceneKey`, but renders it at time `t`, so both scenes keep living during the transition.

## Canvas 2D implementations

```js
const TRANSITIONS = {
  crossfade(ctx, A, B, p){
    const e = ease.inOutCubic(p);
    ctx.globalAlpha = 1; ctx.drawImage(A, 0, 0);
    ctx.globalAlpha = e; ctx.drawImage(B, 0, 0); ctx.globalAlpha = 1;
  },

  dip(ctx, A, B, p, o = {}){          // through a color: black = time has passed, white = revelation
    const col = o.color || '#000';
    ctx.drawImage(p < .5 ? A : B, 0, 0);
    ctx.fillStyle = col;
    ctx.globalAlpha = 1 - Math.abs(p * 2 - 1); ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  },

  wipe(ctx, A, B, p, o = {}){         // soft angled wipe
    const e = ease.inOutCubic(p), ang = o.angle ?? 0.35, feather = o.feather ?? 120;
    ctx.drawImage(A, 0, 0);
    const tmp = scratch();             // helper buffer
    tmp.ctx.clearRect(0,0,W,H);
    tmp.ctx.drawImage(B, 0, 0);
    tmp.ctx.globalCompositeOperation = 'destination-in';
    const L = W + H, x = -feather + e * (L + feather * 2);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const g = tmp.ctx.createLinearGradient(0, 0, dx * L, dy * L);
    const a = clamp((x - feather) / L), b = clamp(x / L);
    g.addColorStop(0, '#000'); g.addColorStop(a, '#000'); g.addColorStop(b, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    tmp.ctx.fillStyle = g; tmp.ctx.fillRect(0, 0, W, H);
    tmp.ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tmp.canvas, 0, 0);
  },

  iris(ctx, A, B, p, o = {}){         // a circle opens up from a point
    const [cx, cy] = o.origin || [W/2, H/2];
    const r = ease.inOutCubic(p) * Math.hypot(W, H);
    ctx.drawImage(A, 0, 0);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(B, 0, 0); ctx.restore();
  },

  push(ctx, A, B, p, o = {}){         // the new scene pushes the old one out
    const e = ease.inOutExpo(p), d = o.dir || 1;
    ctx.drawImage(A, -d * e * W, 0);
    ctx.drawImage(B, d * (1 - e) * W, 0);
  },

  zoomThrough(ctx, A, B, p, o = {}){  // push into a point of the old scene, the new one grows out of it
    const [cx, cy] = o.origin || [W/2, H/2];
    if (p < .5) {
      const s = 1 + ease.inExpo(p * 2) * 14;
      drawScaled(ctx, A, cx, cy, s, 1);
    } else {
      const q = (p - .5) * 2, s = 0.35 + ease.outExpo(q) * 0.65;
      drawScaled(ctx, B, W/2, H/2, s, 1);
      ctx.globalAlpha = 1 - ease.outCubic(q);           // remainder of the flash
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
  },

  whip(ctx, A, B, p, o = {}){          // fast pan with motion blur
    const d = o.dir || 1, e = ease.inOutExpo(p), samples = 10;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const blur = Math.sin(p * Math.PI);                 // maximum blur at the midpoint
    for (let i = 0; i < samples; i++) {
      const k = e + (i / samples - .5) * 0.25 * blur;
      ctx.globalAlpha = 1 / samples * 1.6;
      ctx.drawImage(A, -d * k * W, 0);
      ctx.drawImage(B, d * (1 - k) * W, 0);
    }
    ctx.globalAlpha = 1;
  },

  glitch(ctx, A, B, p){                // offset stripes, seeded by frame number
    const f = Math.floor(p * 24), r = mulberry32(f * 7919 + 1);
    ctx.drawImage(p < .5 ? A : B, 0, 0);
    const src = r() < p ? B : A;
    for (let i = 0; i < 14; i++) {
      const y = r() * H, h = 4 + r() * 60, dx = (r() - .5) * 180 * Math.sin(p * Math.PI);
      ctx.drawImage(src, 0, y, W, h, dx, y, W, h);
    }
  },

  lightLeak(ctx, A, B, p){             // warm film light leak
    TRANSITIONS.crossfade(ctx, A, B, p);
    const a = Math.sin(p * Math.PI);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(W * (.2 + p * .6), H * .4, 0, W * (.2 + p * .6), H * .4, W * .8);
    g.addColorStop(0, `rgba(255,200,120,${a * .9})`);
    g.addColorStop(.4, `rgba(255,90,40,${a * .4})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  },
};

function drawScaled(ctx, img, cx, cy, s, alpha){
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
  ctx.drawImage(img, 0, 0); ctx.restore();
}

let _scratch;
function scratch(){
  if (!_scratch) { const c = new OffscreenCanvas(W, H); _scratch = { canvas: c, ctx: c.getContext('2d') }; }
  return _scratch;
}
```

## Shader transitions (WebGL)

Noise dissolve, distortion, waves, luma wipes need a fragment shader. A minimal runner that takes two 2D buffers and returns a canvas with the result:

```js
function makeTransitionGL(W, H, frag){
  const cv = new OffscreenCanvas(W, H), gl = cv.getContext('webgl', { preserveDrawingBuffer: true });
  const vs = 'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}';
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(pr); gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const tex = [0, 1].map(i => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; });
  gl.uniform1i(gl.getUniformLocation(pr, 'from'), 0);
  gl.uniform1i(gl.getUniformLocation(pr, 'to'), 1);
  const uP = gl.getUniformLocation(pr, 'progress'), uR = gl.getUniformLocation(pr, 'ratio');
  return (A, B, p) => {
    [A, B].forEach((src, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); });
    gl.uniform1f(uP, p); gl.uniform1f(uR, W / H);
    gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return cv;
  };
}
// usage: const burn = makeTransitionGL(W, H, BURN_FRAG); ctx.drawImage(burn(bufA, bufB, p), 0, 0);
```

### Common shader header

```glsl
precision highp float;
uniform sampler2D from, to; uniform float progress, ratio; varying vec2 uv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.; a *= .5; } return v; }
```

### Burn dissolve

```glsl
void main(){
  vec2 q = vec2(uv.x * ratio, uv.y);
  float n = fbm(q * 3.0);
  float edge = mix(-0.1, 1.1, progress);
  float m = smoothstep(edge - 0.03, edge + 0.03, n);         // 1 = still the old scene
  vec4 c = mix(texture2D(to, uv), texture2D(from, uv), m);
  float rim = 1.0 - smoothstep(0.0, 0.05, abs(n - edge));
  gl_FragColor = c + vec4(1.0, 0.5, 0.15, 0.0) * rim * 2.0;
}
```

### Wave distortion

```glsl
void main(){
  float s = sin(progress * 3.14159);
  vec2 d = vec2(sin(uv.y * 30.0 + progress * 12.0), cos(uv.x * 24.0 + progress * 9.0)) * 0.03 * s;
  gl_FragColor = mix(texture2D(from, uv + d), texture2D(to, uv - d), smoothstep(0.35, 0.65, progress));
}
```

### Chromatic split

```glsl
void main(){
  float s = sin(progress * 3.14159) * 0.04;
  vec2 dir = uv - 0.5;
  vec4 a = vec4(texture2D(from, uv + dir*s).r, texture2D(from, uv).g, texture2D(from, uv - dir*s).b, 1.);
  vec4 b = vec4(texture2D(to,   uv + dir*s).r, texture2D(to,   uv).g, texture2D(to,   uv - dir*s).b, 1.);
  gl_FragColor = mix(a, b, smoothstep(0.4, 0.6, progress));
}
```

### Luma wipe (the new scene appears out of the bright areas)

```glsl
void main(){
  vec4 b = texture2D(to, uv);
  float l = dot(b.rgb, vec3(.299, .587, .114));
  float m = smoothstep(1.0 - progress * 1.2, 1.2 - progress * 1.2, l);
  gl_FragColor = mix(texture2D(from, uv), b, m);
}
```

A large collection of ready-made GLSL transitions with a common `from / to / progress` interface is available in the gl-transitions project; they are easy to adapt to the runner above.

## Shape morphing

To morph one contour into another: sample both shapes to the same number of points (e.g. 200) along the contour length, align the starting point (minimize the sum of distances under a cyclic shift), then interpolate pairwise with easing and a slight stagger by index. For text: letter contours via `opentype.js` (CDN), or render the text to a canvas and sample pixels into particle points that fly into the new caption.
