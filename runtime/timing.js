// Timing of a spoken short: the spec's shots, laid on the voice-over's phrases and words. Pure functions, no DOM: used by runtime/short.js in the
// browser and by render/make.mjs, lint-spec.mjs, qa.mjs and post.mjs in Node. Format of the spec and of the anchors: 23-short-factory.md.
//
//   const T = Timing.resolve(spec, voice)      voice: { words: [...], phrases: [...] } from render/voice.mjs, or null for a silent film
//   T.duration                                  seconds
//   T.bpm, T.beat                               tempo and the length of a beat in seconds (shots are laid on a constant tempo)
//   T.shots[i] = { id, i, start, end, dur, beats, b0, phrases: [a, b], words: [i0, i1) }       film seconds
//   T.anchor(i, a)                              an anchor in shot i -> seconds LOCAL to the shot (number | { $word, n, off } | { $phrase, at, off } | { $beat } | { $shot, off })
//   T.resolveDeep(i, obj)                       a copy of obj with every anchor object replaced by its local seconds
//   T.wordTime(word, n, from)                   film seconds of the n-th occurrence of a spoken word (throws if there is none)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Timing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const norm = w => String(w).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');
  const isAnchor = o => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).some(k => k[0] === '$');

  function resolve(spec, voice) {
    const bpm = spec.tempo || 120, beat = 60 / bpm, words = voice && voice.words || [], phrases = voice && voice.phrases || [];
    const offset = (spec.voice && spec.voice.offset) || 0;
    const wtime = (w) => ({ ...w, start: w.start + offset, end: w.end + offset, n: norm(w.word) });
    const W = words.map(wtime), P = phrases.map(p => ({ ...p, start: p.start + offset, end: p.end + offset }));
    const shots = spec.shots, out = [];
    let cursor = 0;
    for (let i = 0; i < shots.length; i++) {
      const sh = shots[i], ph = sh.phrases ? (sh.phrases.length > 1 ? sh.phrases : [sh.phrases[0], sh.phrases[0]]) : null;
      let end;
      if (ph) {
        if (!P[ph[0]] || !P[ph[1]]) throw new Error(`shot "${sh.id}": phrase ${ph[1]} does not exist (the voice has ${P.length})`);
        const next = shots[i + 1], nph = next && next.phrases;
        if (nph) {
          // the cut goes into the pause between this shot's last phrase and the next shot's first one
          const a = P[ph[1]].end, b = P[nph[0]].start; end = b >= a ? (a + b) / 2 : a;
        } else end = P[ph[1]].end + (sh.tail ?? spec.tail ?? 1.2);
      } else end = cursor + (sh.dur ?? (sh.beats ? sh.beats * beat : 2));
      end += sh.hold || 0;
      if (end <= cursor) throw new Error(`shot "${sh.id}" would end at ${end.toFixed(2)} s, before it starts (${cursor.toFixed(2)} s): check its phrases`);
      const w0 = ph ? W.findIndex(w => w.start >= P[ph[0]].start - 1e-6) : -1, w1 = ph ? W.reduce((m, w, k) => w.end <= P[ph[1]].end + 1e-6 ? k + 1 : m, 0) : -1;
      out.push({ id: sh.id, i, start: cursor, end, dur: end - cursor, beats: (end - cursor) / beat, b0: cursor / beat, phrases: ph, words: ph ? [w0, w1] : null });
      cursor = end;
    }
    const duration = cursor;

    function wordTime(word, n = 1, from = -1, to = Infinity) {
      const k = norm(word); let c = 0;
      for (const w of W) if (w.n === k && w.start >= from - 1e-6 && w.start < to && ++c === n) return w.start;
      throw new Error(`the word "${word}" (occurrence ${n}) is not in the voice-over${from >= 0 ? ' after ' + from.toFixed(2) + ' s' : ''}`);
    }
    function anchor(i, a) {
      const sh = out[i];
      if (typeof a === 'number') return a;
      if (!isAnchor(a)) throw new Error(`shot "${sh.id}": not an anchor: ${JSON.stringify(a)}`);
      const off = a.off || 0;
      if ('$word' in a) {
        // first look inside this shot, then anywhere in the film
        let t; try { t = wordTime(a.$word, a.n || 1, sh.start - 1e-6, sh.end); } catch (e) { t = wordTime(a.$word, a.n || 1); }
        return t - sh.start + off;
      }
      if ('$phrase' in a) {
        const p = P[a.$phrase]; if (!p) throw new Error(`shot "${sh.id}": phrase ${a.$phrase} does not exist`);
        const at = a.at === 'end' ? p.end : typeof a.at === 'number' ? p.start + a.at : p.start;
        return at - sh.start + off;
      }
      if ('$beat' in a) return a.$beat * beat + off;
      if ('$shot' in a) return (a.$shot === 'end' ? sh.dur : 0) + off;
      throw new Error(`shot "${sh.id}": unknown anchor ${JSON.stringify(a)}`);
    }
    function resolveDeep(i, o) {
      if (Array.isArray(o)) return o.map(x => resolveDeep(i, x));
      if (isAnchor(o)) return anchor(i, o);
      if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolveDeep(i, v)]));
      return o;
    }
    return { duration, bpm, beat, shots: out, anchor, resolveDeep, wordTime, words: W, phrases: P, norm };
  }
  return { resolve, norm, isAnchor };
});
