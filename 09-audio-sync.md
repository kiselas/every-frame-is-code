# Audio and Sync

## One timeline

Picture and sound read the same data: BPM, an event list, voice-over timings. Then a hit sounds exactly at the moment of impact on screen, and cuts land on the beat.

```js
const BPM = 100, BEAT = 60 / BPM, BAR = BEAT * 4;
const events = [
  { t: 0,         type: 'pad',   dur: BAR * 8 },
  { t: BAR * 2,   type: 'kick' },
  { t: BAR * 4,   type: 'riser', dur: BAR },
  { t: BAR * 5,   type: 'impact' },
];
```

## Synthesis with Web Audio

All functions take a context (real-time or offline), a start time, and an output.

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

function riser(ac, t, dur, out, gain = .3){          // build-up before the peak
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuffer(ac, dur + .1); f.type = 'bandpass'; f.Q.value = 4;
  f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(8000, t + dur);
  g.gain.setValueAtTime(.001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur);
  s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + dur);
}

function impact(ac, t, out){                         // impact: low end + noise tail
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
  // example rhythm: hi-hats on every eighth note from the second bar
  for (let t = BAR * 2; t < DURATION; t += BEAT / 2) hat(ac, t, out);
}
```

Master chain: everything into one `GainNode`, then a `DynamicsCompressorNode` (threshold −18, ratio 4), then the output. This glues the mix together and shaves off peaks.

## Live playback and offline rendering

In live mode, sound starts on a click (browsers block autoplay), and the picture's time is taken from `ac.currentTime - startTime`, not from `performance.now()`. This keeps them from drifting apart.

For rendering, sound is generated offline and handed to the render script as a WAV:

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

The render script in `render/` calls `__renderAudio` itself, if the function exists, and mixes the sound into the MP4.

## Voice-over

1. Write the text broken into phrases.
2. Generate the voice with any TTS.
3. Get word timings: Whisper with word timestamps enabled (faster-whisper, whisper.cpp, WhisperX) outputs the start and end of each word.
4. Save as JSON `[{ word, start, end }]` and embed it in the HTML as data.
5. Build scenes and captions from these timings. Place scene changes in the pauses between phrases.

The finished voice-over can be mixed in at render time with ffmpeg together with the music from `__renderAudio` (see `render/README.md`).

## Mix

- Music under the voice is 10–15 dB quieter. Ducking: where the voice speaks, automate the music's gain down with a 0.1 s attack and a 0.4 s release.
- No lone loud hits after silence: a hit in silence startles. The same hit inside a groove sounds fine.
- Final loudness for platforms is around −14 LUFS. ffmpeg: `-af loudnorm=I=-14:TP=-1.5:LRA=11`.
- Every action on screen gets a sound: appearance (a soft "whoosh"), hit, click, rustle. Vary pitch and volume slightly with a seed, otherwise repetition grates on the ear.
