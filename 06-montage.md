# Editing

A code-driven video is an edit too. Most videos "look like a screensaver" not because of the graphics, but because of missing editing logic.

## The six criteria for a cut (Walter Murch)

In descending order of importance: emotion, story, rhythm, eye-trace, screen plane, space. A cut that works for emotion forgives violations of everything else. A cut that is technically correct but delivers nothing emotionally is useless.

## Cutting rules

- **Cut on action.** A cut in the middle of a movement (a wind-up, a turn, a fall) hides the seam: the brain follows the motion.
- **Eye-trace.** The point of interest after the cut should be near the point of interest before the cut. If the main object was in the upper right, the new shot starts with interest in the same place, and can move away from there.
- **Change of shot size.** Don't cut between two similar shots (a jump cut) unless it's a deliberate device. Alternate: wide -> medium -> close-up -> extreme close-up.
- **Direction of motion.** If an object exits to the right, in the next shot it enters from the left (the 180-degree rule).
- **Shot length depends on information.** A wide shot needs more time than a close-up. Hold a complex frame longer, a simple one shorter.
- **J-cut and L-cut.** The sound of the next scene starts before its picture (J), or the sound of the previous scene carries on after the cut (L). The cheapest way to make an edit feel smooth.

## Rhythm

- **Beat grid.** Choose a BPM (80-100 for calm, 110-130 for energetic). Cuts and accents land on strong beats. Scene changes land on phrase boundaries of 4 or 8 bars.
- **Acceleration toward the peak.** Shot length shrinks toward the climax: 4 bars, 2, 1, half.
- **Pause before the peak.** A short silence or freeze (0.5-1.5 s) before the main moment makes it many times stronger.
- **Exhale after the peak.** A long calm shot after the climax.
- **Not everything on the beat.** If every event lands on a beat, it's a metronome. Leave free movement between beats.

## Structure by length

| Length | Structure |
|---|---|
| 10-20 s | hook (0-2 s), one idea, payoff with a title card |
| 30 s | hook, 3 beats of development, peak, ending |
| 60 s | intro, setup, 2 acts of development, pause, peak, exit |
| 2-3 min | chapters of 20-30 s, each with its own mini-peak; a shared visual motif that evolves |

For vertical platforms, the first 1-2 seconds decide everything: motion and contrast from the first frame, no slow fade-in from black.

## Visual motif

A recurring image that runs through the whole video and changes along with the story (a spark -> a torch -> a fire -> stars; a single line that draws everything). A motif ties scenes together more strongly than any transition and gives the edit meaning.

## Editing techniques

- **Match cut:** a cut on similarity of shape, motion, color, composition.
- **Smash cut:** an abrupt switch from quiet to loud (or the reverse) with no lead-in. Works through contrast.
- **Montage sequence:** a series of short shots on a single thesis (time passing, progress building). Works well with stagger and acceleration.
- **Parallel editing:** alternating two storylines that converge at the end.
- **Split screen:** dividing the frame into parts, simultaneous events.
- **Freeze frame:** a stop-frame at the peak with a title card.
- **Speed ramp:** slowing down at a key moment, then a sharp speed-up. In code this is a nonlinear function of scene time: `sceneT = rampTime(t)`.

```js
// speed ramp: normal speed, slowdown around tc, then a catch-up speed-up
function rampTime(t, tc, width = 0.8, slow = 0.2){
  const x = (t - tc) / width;
  const k = 1 - (1 - slow) * Math.exp(-x * x * 4);   // local speed
  // integral of speed: approximate numerically, deterministically
  let acc = 0, steps = 200, t0 = Math.min(t, tc - 3 * width);
  const dt = (t - t0) / steps;
  for (let i = 0; i < steps; i++) { const xi = (t0 + (i + .5) * dt - tc) / width; acc += (1 - (1 - slow) * Math.exp(-xi * xi * 4)) * dt; }
  return t0 + acc;
}
```

## Plan as data

```js
const shots = [
  { id: 'spark',    start: 0,  end: 4,  size: 'detail', cam: 'pushIn',  motive: 'spark' },
  { id: 'torch',    start: 4,  end: 12, size: 'medium', cam: 'tiltUp',  motive: 'torch', in: 'match' },
  { id: 'city',     start: 12, end: 24, size: 'wide',   cam: 'pullOut', motive: 'lights', in: 'zoomThrough' },
];
```

Ask the model to show this table first and check it by eye: shot sizes alternate, lengths shrink toward the peak, every transition has a reason.
