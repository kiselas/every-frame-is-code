# Пайплайн: как устроен кодовый ролик

## Главная идея

Весь фильм это функция `draw(ctx, t)`, которая по времени `t` рисует кадр целиком. Функция не помнит предыдущих кадров. Отсюда три свойства:

- можно перемотать на любую секунду и получить тот же кадр;
- headless-браузер рендерит покадрово, сколько бы ни занимал один кадр, поэтому тяжёлые эффекты не вызывают рывков в итоговом MP4;
- два рендера дают идентичный результат.

## Скелет страницы

```html
<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block;margin:auto}</style>
</head><body>
<canvas id="c"></canvas>
<script>
const W = 1920, H = 1080, FPS = 60, DURATION = 60; // секунды
const cv = document.getElementById('c');
cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');

// --- сидированный RNG ---
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
// Для частиц: генерируй массив параметров ОДИН раз с фиксированным seed,
// а в draw(t) вычисляй позицию каждой частицы из её параметров и t.
const rnd = mulberry32(1337);
const stars = Array.from({length: 400}, () => ({x: rnd()*W, y: rnd()*H, r: rnd()*1.5+0.3, ph: rnd()*6.28}));

// --- план как данные ---
const BPM = 100, BEAT = 60 / BPM;
const scenes = [
  { id: 'intro', start: 0,  end: 8,  draw: drawIntro },
  { id: 'build', start: 8,  end: 30, draw: drawBuild },
  { id: 'peak',  start: 30, end: 50, draw: drawPeak  },
  { id: 'outro', start: 50, end: 60, draw: drawOutro },
];
const events = [ // читают и картинка, и звук
  { t: 8,  type: 'hit' },
  { t: 30, type: 'drop' },
];

// --- кадр ---
function draw(t){
  ctx.clearRect(0,0,W,H);
  for (const s of scenes) {
    if (t >= s.start && t < s.end) {
      const lt = t - s.start, p = lt / (s.end - s.start);
      s.draw(ctx, lt, p, t);
    }
  }
  // переходы между сценами: см. 05-transitions.md
}

function drawIntro(ctx, lt, p, t){ /* ... */ }
function drawBuild(ctx, lt, p, t){ /* ... */ }
function drawPeak (ctx, lt, p, t){ /* ... */ }
function drawOutro(ctx, lt, p, t){ /* ... */ }

// --- два режима ---
window.__meta = { W, H, FPS, DURATION };
window.__draw = draw;              // рендер-скрипт вызывает это
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

## Эффекты, зависящие от прошлого

Шлейфы, motion blur, «затухающий след» обычно делают через полупрозрачную заливку поверх прошлого кадра. Это ломает детерминизм. Замена: нарисуй объект в нескольких прошлых моментах `t - k*dt` с убывающей прозрачностью. Для motion blur 6–10 выборок на кадр достаточно.

```js
function drawWithTrail(ctx, t, drawObj, samples = 8, span = 0.12){
  for (let i = samples - 1; i >= 0; i--) {
    ctx.globalAlpha = (1 - i / samples) ** 2;
    drawObj(ctx, t - i * span / samples);
  }
  ctx.globalAlpha = 1;
}
```

## Физика и симуляции

Если нужна настоящая симуляция (жидкость, ткань, столкновения), она не является функцией от `t`. Варианты:
- в режиме рендера шагать симуляцию фиксированным `dt = 1/FPS` строго по порядку кадров (рендер-скрипт идёт последовательно, это работает);
- для перемотки в живом режиме кешировать снапшоты состояния каждые N секунд.

## Слои и оффскрин-буферы

Для переходов, постобработки и масок каждая сцена рисуется в свой `OffscreenCanvas` (или обычный canvas вне DOM), потом буферы композируются. Держи 2–3 буфера и переиспользуй, не создавай новые на кадр.

```js
const bufA = new OffscreenCanvas(W, H), bufB = new OffscreenCanvas(W, H);
const ca = bufA.getContext('2d'), cb = bufB.getContext('2d');
```

## Когда переходить на WebGL

Canvas 2D хорош до нескольких тысяч примитивов и простых эффектов. Если нужны: десятки тысяч частиц, bloom, дисторсия, noise-переходы, объём, свет, то используй WebGL (Three.js или сырой фрагментный шейдер). Для 2D-стилистики с шейдерной постобработкой удобна связка: рисуешь в Canvas 2D, передаёшь его как текстуру в полноэкранный шейдер.
