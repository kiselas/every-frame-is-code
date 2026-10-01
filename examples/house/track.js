// House template for strudel-render (see 22-electronic-music.md).  Render:
//   npx strudel-render examples/house/track.js -o track.wav --end 64 --tail 1
// ONE table drives the track: SECTIONS. `bars` of a section = bars of the film's shots, and BPM = the film's tempo
// (Film.create({ tempo: BPM })), so every cut lands on a downbeat. Change SECTIONS, BPM and the chords; keep the rest.
//
// Sounds: the drums are CC0 samples from Sonic Pi (a pinned commit, so the render is repeatable); everything else is
// synthesis. Never use Strudel's default sample names (s("bd"), s("piano")...): those banks have no clear licence.
const BPM = 124
setcps(BPM / 60 / 4)                                        // one Strudel cycle = one bar of 4/4

samples({
  kick: 'bd_haus.flac', clap: 'sn_generic.flac', hat: 'hat_zan.flac', ohat: 'drum_cymbal_open.flac', crash: 'drum_splash_hard.flac',
}, 'https://raw.githubusercontent.com/sonic-pi-net/sonic-pi/7fefaeb318c8d0c99c5e2d18233709866ca546c1/etc/samples/')

const CHORDS = '<[c3,eb3,g3,bb3] [ab2,c3,eb3,g3] [bb2,d3,f3,a3] [g2,bb2,d3,f3]>'   // Cm9, Abmaj7, Bb, Gm7: one chord per bar
const ROOTS = '<c2 ab1 bb1 g1>'

// ---- layers: each is a pattern for ONE bar. The kick ducks everything on orbit 2 (sidechain), so the others say .orbit(2)
const L = {
  kick:  s('kick*4').gain(1.0).duckorbit(2).duckattack(.2).duckdepth(.65),
  kickS: s('kick ~ ~ ~').gain(.9).duckorbit(2).duckattack(.2).duckdepth(.4),             // a soft pulse for the intro
  clap:  s('~ clap ~ clap').gain(.7).room(.15),
  hat:   s('~ hat ~ hat ~ hat ~ hat').gain(.45),                                         // the offbeat hat
  hat16: s('hat*16').gain(.22).hpf(7000),
  ohat:  s('~ ohat ~ ohat').gain(.25).hpf(6000).decay(.18),
  bass:  note(ROOTS).struct('x*8').s('sawtooth').lpf(sine.range(300, 1100).slow(4)).decay(.11).sustain(0).gain(.55).orbit(2),
  stab:  note(CHORDS).s('supersaw').struct('~ x ~ ~ ~ x ~ x').lpf(3400).decay(.2).sustain(0).gain(.3).room(.3).orbit(2),
  pad:   note(CHORDS).s('sawtooth').lpf(sine.range(500, 1800).slow(8)).attack(.4).release(.8).gain(.16).room(.5).orbit(2),
}

// ---- the arrangement. The layers are the energy: few at the start, all of them at the drop.
// riser: a noise sweep over the whole section.  gap: the rhythm stops for the last beat (the pad and the riser carry over).
// crash: one crash on the first beat.
const SECTIONS = [
  { name: 'intro', bars: 8,  layers: ['kickS', 'pad'] },
  { name: 'build', bars: 8,  layers: ['kick', 'hat', 'bass', 'pad'], riser: true, gap: true },
  { name: 'drop',  bars: 16, layers: ['kick', 'clap', 'hat', 'hat16', 'ohat', 'bass', 'stab', 'pad'], crash: true },
  { name: 'break', bars: 8,  layers: ['pad', 'stab'], riser: true, gap: true },
  { name: 'drop2', bars: 16, layers: ['kick', 'clap', 'hat', 'hat16', 'ohat', 'bass', 'stab', 'pad'], crash: true },
  { name: 'outro', bars: 8,  layers: ['kick', 'hat', 'pad'] },
]

const riser = bars => s('white').lpf(saw.range(400, 12000).slow(bars)).hpf(300).gain(saw.range(.05, .8).slow(bars)).attack(.01)
const section = ({ bars, layers, riser: r, gap, crash }) => {
  let body = stack(...layers.map(n => L[n]))
  if (r) body = stack(body, riser(bars))
  if (crash) body = stack(body, s('crash').gain(.6).slow(bars))
  // The section stays ONE pattern: splitting it in two arrange() entries would restart the riser's saw in the last bar.
  // And no backticks: Strudel reads `...` and "..." as mini-notation, so the mask string is built from single quotes.
  if (gap) body = body.mask('<' + '1 '.repeat(bars - 1) + '[1 1 1 0]>')
  return [[bars, body]]
}

// Headroom: the sum of all layers peaks near +4 dBFS, so the master gets -6 dB. strudel-render has no limiter; mastering is render.mjs --loudnorm.
arrange(...SECTIONS.flatMap(section)).postgain(.5)
