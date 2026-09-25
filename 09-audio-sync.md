# Звук и синхронизация

## Одна шкала времени

Картинка и звук читают одни и те же данные: BPM, список событий, тайминги озвучки. Тогда удар звучит ровно в момент удара на экране, и склейки ложатся на бит.

```js
const BPM = 100, BEAT = 60 / BPM, BAR = BEAT * 4;
const events = [
  { t: 0,         type: 'pad',   dur: BAR * 8 },
  { t: BAR * 2,   type: 'kick' },
  { t: BAR * 4,   type: 'riser', dur: BAR },
  { t: BAR * 5,   type: 'impact' },
];
```

## Синтез на Web Audio

Все функции принимают контекст (обычный или офлайн), время начала и выход.

```js
function noiseBuffer(ac, seconds = 1, seed = 9){
  const b = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate), d = b.getChannelData(0), r = mulberry32(seed);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return b;
}

function kick(ac, t, out, gain = .9){
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + .12);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.001, t + .45);
  o.connect(g).connect(out); o.start(t); o.stop(t + .5);
}

function hat(ac, t, out, gain = .25){
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuffer(ac, .1); f.type = 'highpass'; f.frequency.value = 7000;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.001, t + .06);
  s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + .1);
}

function pad(ac, t, dur, out, freqs = [110, 164.8, 220, 277.2], gain = .12){
  const f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(1800, t + dur * .6);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 2); g.gain.setValueAtTime(gain, t + dur - 2); g.gain.linearRampToValueAtTime(0, t + dur);
  f.connect(g).connect(out);
  freqs.forEach((fr, i) => [-7, 7].forEach(det => {
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det + i;
    o.connect(f); o.start(t); o.stop(t + dur);
  }));
}

function riser(ac, t, dur, out, gain = .3){          // нарастание перед пиком
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuffer(ac, dur + .1); f.type = 'bandpass'; f.Q.value = 4;
  f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(8000, t + dur);
  g.gain.setValueAtTime(.001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur);
  s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + dur);
}

function impact(ac, t, out){                         // удар: низ + шумовой хвост
  kick(ac, t, out, 1);
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuffer(ac, 2.5, 3); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(200, t + 2);
  g.gain.setValueAtTime(.4, t); g.gain.exponentialRampToValueAtTime(.001, t + 2.4);
  s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + 2.5);
}

function buildScore(ac, out){
  for (const e of events) {
    if (e.type === 'kick') kick(ac, e.t, out);
    if (e.type === 'pad') pad(ac, e.t, e.dur, out);
    if (e.type === 'riser') riser(ac, e.t, e.dur, out);
    if (e.type === 'impact') impact(ac, e.t, out);
  }
  // пример ритма: хэты на каждую восьмую со второго такта
  for (let t = BAR * 2; t < DURATION; t += BEAT / 2) hat(ac, t, out);
}
```

Мастер-цепочка: всё в один `GainNode`, затем `DynamicsCompressorNode` (threshold −18, ratio 4), затем выход. Это склеивает микс и срезает пики.

## Живое воспроизведение и офлайн-рендер

В живом режиме звук стартует по клику (браузеры блокируют автозапуск), время картинки берётся из `ac.currentTime - startTime`, а не из `performance.now()`. Так они не расходятся.

Для рендера звук генерируется офлайн и отдаётся рендер-скрипту как WAV:

```js
window.__renderAudio = async () => {
  const sr = 48000, oac = new OfflineAudioContext(2, Math.ceil(sr * DURATION), sr);
  const master = oac.createGain(), comp = oac.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 4;
  master.connect(comp).connect(oac.destination);
  buildScore(oac, master);
  return encodeWavBase64(await oac.startRendering());
};

function encodeWavBase64(ab){
  const ch = ab.numberOfChannels, sr = ab.sampleRate, n = ab.length, bytesPer = 2;
  const buf = new ArrayBuffer(44 + n * ch * bytesPer), v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * ch * bytesPer, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * bytesPer, true); v.setUint16(32, ch * bytesPer, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, n * ch * bytesPer, true);
  const data = Array.from({ length: ch }, (_, c) => ab.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
  }
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
```

Рендер-скрипт в `render/` сам вызывает `__renderAudio`, если функция есть, и сводит звук в MP4.

## Озвучка

1. Напиши текст с разбивкой на фразы.
2. Сгенерируй голос любым TTS.
3. Получи тайминги слов: Whisper с включёнными word timestamps (faster-whisper, whisper.cpp, WhisperX) выдаёт начало и конец каждого слова.
4. Сохрани как JSON `[{ word, start, end }]` и встрой в HTML как данные.
5. Сцены и титры строй от этих таймингов. Смены сцен ставь в паузы между фразами.

Готовую озвучку при рендере можно подмешать ffmpeg-ом вместе с музыкой из `__renderAudio` (см. `render/README.md`).

## Микс

- Музыка под голосом на 10–15 дБ тише. Приглушение (ducking): в местах, где звучит голос, автоматизируй gain музыки вниз с атакой 0.1 с и отпусканием 0.4 с.
- Нет одиночных громких ударов после тишины: в тишине удар пугает. Внутри грува тот же удар звучит нормально.
- Финальная громкость для площадок около −14 LUFS. ffmpeg: `-af loudnorm=I=-14:TP=-1.5:LRA=11`.
- Каждое действие на экране получает звук: появление (мягкий «вух»), удар, щелчок, шорох. Высоту и громкость слегка варьируй сидированно, иначе повтор режет слух.
