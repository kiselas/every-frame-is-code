# Кулинарная книга эффектов

Все рецепты детерминированы: состояние вычисляется из `t` и сидированных параметров.

## Шум

```js
// 2D value noise + fbm, сидированно
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

Применения: дрожь линий, дрейф частиц, handheld-камера, неровные края, мерцание, облака.

## Система частиц без состояния

Каждая частица получает постоянные параметры при инициализации. В кадре её возраст вычисляется циклически из `t`.

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
    y: p.vy * tt + 0.5 * (p.g || 0) * tt * tt };         // p.g: гравитация, если нужна
}
```

`cycle` можно использовать как дополнительный seed, чтобы каждая «жизнь» частицы немного отличалась.

## Спрайты вместо градиентов

`createRadialGradient` на каждую частицу в каждом кадре медленный. Предрисуй спрайты один раз:

```js
function makeGlowSprite(r, color){
  const c = new OffscreenCanvas(r * 2, r * 2), x = c.getContext('2d');
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, color); g.addColorStop(.35, color.replace(/[\d.]+\)$/, '0.35)')); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, r * 2, r * 2); return c;
}
```

## Огонь

Цветовая рампа по возрасту частицы, аддитивное смешивание, спрайты на 16 шагов рампы.

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

Добавь поверх отдельный слой искр: мелкие частицы с долгой жизнью, летят выше и дальше, с дугой по шуму.

## Дым

Как огонь, но: обычное смешивание (не `lighter`), спрайты серые с низкой альфой, размер растёт с возрастом (×3–5), движение медленное, сильный дрейф по fbm, поворот спрайта.

## Свечение и bloom в 2D

```js
// двухслойное свечение объекта: ядро + широкий ореол
function glow(ctx, drawShape, color, core = 8, halo = 40){
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = `blur(${halo}px)`; ctx.globalAlpha = .5; drawShape(ctx, color);
  ctx.filter = `blur(${core}px)`; ctx.globalAlpha = .9; drawShape(ctx, color);
  ctx.filter = 'none'; ctx.globalAlpha = 1; drawShape(ctx, '#fff');   // горячий центр почти белый
  ctx.restore();
}
```

Bloom для всего кадра: уменьши кадр в 4 раза, оставь только яркие участки (в 2D грубо через `filter: brightness() contrast()`), размой, растяни обратно с `lighter`. Для качественного bloom переходи на WebGL (UnrealBloomPass или свой шейдер).

`ctx.filter = 'blur()'` тяжёлый на больших радиусах. Размывай уменьшенную копию и растягивай: blur(40px) на полном разрешении ≈ blur(10px) на четверти.

## Зерно плёнки

```js
const grainTiles = Array.from({ length: 8 }, (_, k) => {
  const c = new OffscreenCanvas(256, 256), x = c.getContext('2d'), img = x.createImageData(256, 256), r = mulberry32(100 + k);
  for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i+1] = img.data[i+2] = v; img.data[i+3] = 255; }
  x.putImageData(img, 0, 0); return c;
});
function drawGrain(ctx, t, amount = .06){
  const tile = grainTiles[Math.floor(t * 24) % grainTiles.length];   // зерно меняется 24 раза в секунду
  ctx.save(); ctx.globalAlpha = amount; ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(tile, 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();
}
```

## Виньетка

```js
function vignette(ctx, strength = .45){
  const g = ctx.createRadialGradient(W/2, H/2, Math.min(W, H) * .35, W/2, H/2, Math.hypot(W, H) * .6);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
```

## Рисованная линия и line boil

```js
// дрожащая линия; seed меняется 10 раз в секунду, как у рисованной анимации
function inkLine(ctx, pts, t, amp = 1.6, fps = 10){
  const r = mulberry32(Math.floor(t * fps) * 131 + pts.length);
  ctx.beginPath();
  pts.forEach(([x, y], i) => { const jx = (r() - .5) * amp, jy = (r() - .5) * amp; i ? ctx.lineTo(x + jx, y + jy) : ctx.moveTo(x + jx, y + jy); });
  ctx.stroke();
}
```

Для рисования линии по ходу анимации: `ctx.setLineDash([len, len]); ctx.lineDashOffset = len * (1 - p)`.

## Звёздное небо и туманности

- Звёзды: 3 слоя с разной яркостью и параллаксом, мерцание `0.7 + 0.3 * sin(t * k + phase)` с индивидуальными k и phase.
- Туманность: fbm, раскрашенный рампой, рендеренный один раз в низком разрешении, растянутый и медленно смещающийся. Второй слой fbm с другим масштабом поверх в `lighter`.

## Туман и атмосфера

Полупрозрачные слои fbm между планами глубины, каждый со своей скоростью дрейфа. Дальние объекты смешивай с цветом тумана: `mix(color, fogColor, depth)`.

## Шейдерная постобработка (WebGL)

Раннер из 05-transitions.md подходит и для постобработки одного кадра (передай тот же буфер в `from` и `to`).

```glsl
// хроматическая аберрация + виньетка + зерно
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
// god rays: радиальное размытие от источника света
uniform vec2 light;
void main(){
  vec2 dir = (uv - light) / 64.; vec2 p = uv; vec3 acc = vec3(0); float w = 1.;
  for (int i = 0; i < 64; i++){ p -= dir; acc += texture2D(from, p).rgb * w; w *= .96; }
  gl_FragColor = vec4(texture2D(from, uv).rgb + acc * .025, 1.);
}
```

Если используешь `time` в шейдере, добавь в раннер uniform и передавай `t`, а не системное время.

## Другие эффекты, которые стоит знать

- **CRT:** сканлайны (горизонтальные полосы с альфой 0.1–0.2), бочкообразная дисторсия, свечение, лёгкое мерцание.
- **Тепловое марево:** смещение UV по fbm, анимированному вверх.
- **Блики объектива:** цепочка кругов на линии между источником и центром кадра, разного размера и цвета, аддитивно.
- **Пикселизация:** рисуй в маленький буфер, растягивай с `imageSmoothingEnabled = false`.
- **Дизеринг:** упорядоченный (матрица Байера) в шейдере для ретро-стиля с ограниченной палитрой.
- **Частицы в текст:** рендер текста в скрытый canvas, сэмплинг непрозрачных пикселей в точки, частицы летят в эти точки со stagger.
