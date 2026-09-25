# 3D with Three.js

## Setup

ES modules via importmap, with a pinned version:

```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
} }
</script>
<script type="module">
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
</script>
```

## Basic setup

```js
const W = 1920, H = 1080;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0c14, 0.035);
const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 500);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.8, 0.5, 0.85)); // strength, radius, threshold
composer.addPass(new OutputPass());
```

`preserveDrawingBuffer: true` is needed to capture frames. Use `setPixelRatio(1)` in render mode so the frame size matches the one you set.

## Determinism

Don't use `THREE.Clock` or `performance.now()` for animation. Everything updates from `t`:

```js
function update(t){
  camera.position.copy(camPath.getPointAt(ease.inOutCubic(seg(t, 0, 20))));
  camera.lookAt(target);
  core.material.emissiveIntensity = 2 + Math.sin(t * 3) * .4;
}
window.__draw = t => { update(t); composer.render(); };
```

## Lighting

- Three-point setup: key light (DirectionalLight or SpotLight, with shadow), fill light (weak, opposite tint), rim/back light (behind, bright, outlines the silhouette).
- `HemisphereLight` for soft ambient lighting instead of flat `AmbientLight`.
- For glowing objects, use `emissive` + `emissiveIntensity > 1`; bloom will pick them up via its threshold.
- For environment reflections, use `RoomEnvironment` from addons and `PMREMGenerator`: metals and glass look dead without an environment.

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
```

## Camera

- A narrow field of view (fov 25–40) looks more cinematic than a wide one.
- Camera flythroughs on a spline: `THREE.CatmullRomCurve3` through 4–8 points, progress driven by easing; `lookAt` follows its own spline too, or lerps between targets.
- A subtle handheld feel via noise on position and rotation (amplitude in hundredths).
- Depth of field: `BokehPass` from addons, focused on the main subject.

## Many objects

- `InstancedMesh` for thousands of identical objects; matrices update inside `update(t)`.
- `THREE.Points` with a custom `ShaderMaterial` for tens of thousands of particles; compute positions in the vertex shader from `uTime` and attributes, so the CPU stays out of it.

```js
const mat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    uniform float uTime; attribute float aSeed; varying float vA;
    void main(){
      vec3 p = position; float a = fract(uTime * .1 + aSeed);
      p.y += a * 20.0; p.x += sin(uTime + aSeed * 40.0) * a * 2.0; vA = 1.0 - a;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = (1.0 - a) * 120.0 / -mv.z; gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying float vA;
    void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard;
      gl_FragColor = vec4(vec3(1., .6, .25) * 2.0, (1. - d * 2.) * vA); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
```

## Materials and look

- `MeshStandardMaterial` / `MeshPhysicalMaterial` with reasonable roughness (0.3–0.8); roughness 0 and metalness 1 with no environment give black objects.
- Procedural textures via `CanvasTexture` (draw noise, hatching, or a pattern in a 2D canvas).
- Stylization: `MeshToonMaterial` with a gradient map for cel-shading; outlines via an enlarged copy of the mesh with `side: BackSide`.

## Common problems

- Everything is black: no light or environment, or roughness/metalness are at their extremes.
- Everything is blown out: bloom threshold is too low, exposure is too high.
- Blurry/soft image: pixelRatio below 1, or bloom radius is large.
- Flickering of distant objects: the camera's near plane is too small; increase it to 0.5–1.
- Text in 3D: `TextGeometry` from addons with a loaded typeface JSON; for titles it's often simpler to draw text in 2D over the rendered frame.
