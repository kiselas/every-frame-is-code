# 3D на Three.js

## Подключение

ES-модули через importmap, версия закреплена:

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

## Базовая настройка

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

`preserveDrawingBuffer: true` нужен для захвата кадров. `setPixelRatio(1)` в режиме рендера, чтобы размер кадра совпадал с заданным.

## Детерминизм

Не используй `THREE.Clock` и `performance.now()` для анимации. Всё обновляется из `t`:

```js
function update(t){
  camera.position.copy(camPath.getPointAt(ease.inOutCubic(seg(t, 0, 20))));
  camera.lookAt(target);
  core.material.emissiveIntensity = 2 + Math.sin(t * 3) * .4;
}
window.__draw = t => { update(t); composer.render(); };
```

## Свет

- Три точки: ключевой (DirectionalLight или SpotLight, с тенью), заполняющий (слабый, противоположного оттенка), контровой (сзади, яркий, обрисовывает силуэт).
- `HemisphereLight` для мягкого окружения вместо плоского `AmbientLight`.
- Для светящихся объектов `emissive` + `emissiveIntensity > 1`, bloom подхватит их через threshold.
- Для отражений окружения используй `RoomEnvironment` из addons и `PMREMGenerator`: металлы и стекло без окружения выглядят мёртвыми.

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
```

## Камера

- Узкое фокусное (fov 25–40) выглядит кинематографичнее широкого.
- Пролёты по сплайну: `THREE.CatmullRomCurve3` через 4–8 точек, прогресс по easing, `lookAt` тоже по своему сплайну или lerp между целями.
- Лёгкий handheld через шум на позиции и повороте (амплитуда в сотые доли).
- Глубина резкости: `BokehPass` из addons, фокус на главном объекте.

## Много объектов

- `InstancedMesh` для тысяч одинаковых объектов, матрицы обновляются в `update(t)`.
- `THREE.Points` с собственным `ShaderMaterial` для десятков тысяч частиц; позиции считай в вершинном шейдере из `uTime` и атрибутов, тогда CPU не участвует.

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

## Материалы и вид

- `MeshStandardMaterial` / `MeshPhysicalMaterial` с разумными roughness (0.3–0.8); roughness 0 и metalness 1 без окружения дают чёрные объекты.
- Процедурные текстуры через `CanvasTexture` (нарисуй шум, штриховку, узор в 2D canvas).
- Стилизация: `MeshToonMaterial` с градиентной картой для cel-shading; обводка через увеличенную копию меша с `side: BackSide`.

## Типичные проблемы

- Всё чёрное: нет света или окружения, либо roughness/metalness крайние.
- Всё выжжено: bloom threshold слишком низкий, экспозиция высокая.
- Мыло: pixelRatio меньше 1 или bloom radius большой.
- Мерцание дальних объектов: слишком маленький near у камеры, увеличь до 0.5–1.
- Текст в 3D: `TextGeometry` из addons с загрузкой typeface JSON; для титров часто проще рисовать текст в 2D поверх отрендеренного кадра.
