# Games: game feel and juice

The difference between "it works" and "it feels good to play" comes almost entirely from feedback on actions. Classic references on the topic: the talks "Juice it or lose it" (Martin Jonasson, Petri Purho) and "Math for Game Programmers: Juicing Your Cameras With Math" (Squirrel Eiserloh, GDC).

## Game loop

Physics on a fixed step, rendering with interpolation. Otherwise behavior depends on frame rate.

```js
const STEP = 1 / 120; let acc = 0, last = performance.now() / 1000;
function frame(){
  const now = performance.now() / 1000; acc += Math.min(.1, now - last); last = now;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  render(acc / STEP);            // alpha for interpolating between the previous and current state
  requestAnimationFrame(frame);
}
```

## Controls

- **Coyote time:** jumping is still allowed for 80–120 ms after leaving a platform.
- **Jump buffer:** pressing jump within 100 ms before landing triggers on landing.
- **Variable jump height:** release the button early, gravity ×2–3.
- **Different gravity:** falling faster than rising (×1.5–2), reduced gravity at the peak of the jump.
- **Acceleration and deceleration:** not instant velocity, but a fast ramp-up (0.05–0.1 s) and a slightly longer deceleration. Longer for a "heavy" character.
- **No-delay input:** react to a press on the same frame; the animation can catch up.

## Juice checklist

| Event | Reaction |
|---|---|
| Hit lands | hitstop 50–120 ms, white flash on the target for 1–2 frames, particles, sound, screen shake |
| Jump | squash before, stretch in the air, dust on takeoff |
| Landing | squash, dust, light screen shake on a high fall |
| Takes damage | knockback, invulnerability flicker, red screen edge, hitstop |
| Enemy dies | particle burst, debris, 0.2–0.4 s slowdown, sound with a tail |
| Pickup | item flies to the counter, counter "bounces" on a spring |
| Shot fired | weapon and camera recoil, shell casing, muzzle flash |
| UI | buttons react to hover and press, numbers tick up instead of jumping |

## Screen shake via trauma

```js
let trauma = 0;                                  // 0..1, events add to it: trauma = Math.min(1, trauma + .4)
function cameraShake(t, dt){
  trauma = Math.max(0, trauma - dt * 1.4);
  const s = trauma * trauma;                     // squared: low trauma barely shakes, high trauma shakes hard
  return {
    x:   (N.n(t * 25, 0)   - .5) * 2 * 28 * s,
    y:   (N.n(0, t * 25)   - .5) * 2 * 28 * s,
    rot: (N.n(t * 25, 99)  - .5) * 2 * 0.06 * s,
  };
}
```

Noise instead of random numbers gives smooth shake instead of jitter.

## Hitstop

```js
let freeze = 0;
function hit(){ freeze = 0.08; trauma = Math.min(1, trauma + .35); }
function update(dt){
  if (freeze > 0) { freeze -= dt; return; }     // the world is frozen, but effects can keep going
  // ...
}
```

## Camera

- Follows the player with lerp (`cam += (target - cam) * (1 - Math.exp(-dt * 8))`), not rigidly.
- Look-ahead in the direction of movement, 10–20% of screen width.
- A dead zone at the center where the camera doesn't move.
- A slight zoom-out at high speed.

## Sound

- Every action has a sound, with ±5–10% pitch variation.
- Hitstop is accompanied by sound: a pause with no sound feels like lag.
- Music reacts to game state (combat intensity, low health).

## Visual style

- Readability matters more than beauty: the player, enemies, hazards, and background must differ in silhouette and color.
- The background is quieter in contrast and saturation than gameplay objects.
- Particles and effects must not obscure hazards.
- Death screen and restart are fast: 1 key, under a second to the next attempt.
- Pause and reset are mandatory.

## Prompt tips for games

- Ask for one polished level rather than ten rough ones.
- Write physics and collisions without libraries: that way the model controls the feel.
- Describe the feel of the controls in words: "responsive, like Celeste," "heavy and inertial," "slippery."
- Require a table of juice reactions to events in the plan before code.
