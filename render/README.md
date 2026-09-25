# render

Покадровый рендер HTML-анимаций в MP4 и контакт-листы для проверки.

## Установка

Нужны Node 18+, Google Chrome и ffmpeg в PATH.

```bash
npm install
```

Если Chrome стоит не в стандартном месте: `CHROME_PATH=/path/to/chrome node render.mjs ...`

## Рендер

```bash
node render.mjs ../film.html ../film.mp4
node render.mjs ../film.html ../part.mp4 --from 20 --to 35      # фрагмент
node render.mjs ../film.html ../film.mp4 --voice ../voice.wav     # подмешать озвучку к музыке
```

Контракт страницы:

```js
window.__meta = { W: 1920, H: 1080, FPS: 60, DURATION: 60 };
window.__draw = t => { /* нарисовать кадр для времени t */ };
window.__ready = true;                         // после document.fonts.ready
window.__renderAudio = async () => base64Wav;  // необязательно
```

Страница открывается с `?render`: в этом режиме она не должна запускать свой requestAnimationFrame.

## Контакт-лист

```bash
./contact-sheet.sh ../film.mp4 ../sheet.png        # 2 кадра/с, 8 колонок
./contact-sheet.sh ../film.mp4 ../sheet.png 4 10   # 4 кадра/с, 10 колонок
```

Нужен ffmpeg со сборкой drawtext (freetype). Если drawtext недоступен, убери его из фильтра в скрипте.

## Скорость

Скриншот на каждый кадр медленнее реального времени: минута в 60 fps обычно рендерится несколько минут. Для черновиков ставь `FPS: 30` и меньшее разрешение в `__meta`.
