# Prompting: how to phrase the task

## Two prompt modes

**Short, about the subject.** When style doesn't matter, or you want the model to surprise you. Subject, audience, length, format, required words. No shot list needed — the model plans it. Community observation: the subject and the wording of the prompt shape the look far more than style presets and references do, which tend to pull everything toward the same look.

```
How does noise cancellation work in headphones? Vertical explainer for TikTok, ~20 s.
```

**Precise, about the mechanics.** When you need specific mechanics: a game, pixel art, a simulation, physics, a strict grid. Here specifics work: resolution, palette, character states, physics rules, controls.

```
Self-contained HTML, 128x96, fixed 24-color palette, x6 scale with image-rendering: pixelated.
A mage character with a state machine: idle → charge → cast → recover.
Spell particles are snapped to the pixel grid and shift color along the palette toward the end of their life.
Screen shake on cast, in whole-pixel steps.
```

## What's always worth specifying

- **The question or story.** What the viewer will understand or feel by the end.
- **Who it's for.** "For a two-year-old" and "for a fintech blog" produce completely different pacing and look.
- **Length and platform.** The platform immediately sets the format (9:16, 16:9, 1:1).
- **Exact text**, if it must appear on screen: a title, a tagline, a final line.
- **Style in words**, if it matters: "in the spirit of a 1950s science textbook," "engraving," "Soviet filmstrip," "Swiss poster," "blueprint on tracing paper." Not a moodboard.
- **What to avoid**, specifically. A generic "don't make it look AI-generated" just swaps one default for another. Named patterns work: "no neon gradients, no centered text, no dark blue with amber."

## Templates

### Explainer
```
[Question]? Animated explainer, [length], [format], for [audience].
Style: [description in words, or "pick a style from the subject itself and explain the choice"].
Required final title: "...".
One continuous world, the camera moves through it. Music generated in code with Web Audio, cuts on the beat.
Show the plan first: beat grid, shot list, events. Then the code.
```

### Cinematic video for voice-over
```
Video, [length], 16:9, for an existing voice-over. Text and line timecodes below.
Visual motif: [one central image, e.g. fire / light / water / a network].
Captions: key phrases in large typography, appearing in sync with the voice-over lines.
Each voice-over line gets its own visual beat. Transitions are motivated by motion
(an object carries the camera into the next scene), not crossfades.
Timecodes:
0.00-4.20 "..."
4.20-9.80 "..."
```

### Kinetic typography
```
Kinetic typography for [text/poem/quote], [length], [format].
Font: [name from Google Fonts], or pick one to match the tone.
Each word appears with its own mechanic depending on its meaning
(heavy words drop, fast words fly past, quiet words fade in). Rhythm at [BPM].
```

### Game
```
Browser game in a single HTML file: [genre], [setting].
Core loop: [what the player does over and over].
Controls: [keys]. Feel of the controls: [responsive / heavy / slippery].
Juice: hitstop on impact, camera shake driven by "trauma," particles, squash & stretch, a sound for every action.
One level, but polished. Pause and restart menus.
Write the physics yourself, no libraries.
```

### 3D scene
```
Three.js (ES modules via an importmap from jsdelivr), single HTML file.
Scene: [description]. Mood: [time of day, weather, emotion].
Light: one key source [from where], fill light, rim light.
Post-processing: bloom, a light vignette, film grain. ACES tonemapping.
Camera: [push-through / orbit / static with breathing], motion on easing.
```

### Recreating a reference
```
Recreate this frame fully procedurally (without using the image itself) as an animated scene.
Keep the composition, palette, and lighting. Add living motion: [what should move].
```

## Phrases for iteration

Edits tied to specific frames work better than general ones:
- "At 0:14 the title sits on top of the character. Move it to the lower third."
- "From 0:22 to 0:27 nothing happens. Add a slow push-in and particle drift."
- "The glow is flat. Make the core brighter and add a wide, faint halo as a second layer."
- "The second act drags. Cut it to 12 s, with cuts every 2 bars instead of 4."
- "Less orange. Keep the accent only on the key word."
- "The outlines are thick and rounded, it looks childish. Make them thinner, with slight line jitter."

## Working tips

- Ask for the plan first, then the code. Checking a plan is cheaper.
- Don't ask the model to "think step by step": modern models (Claude Opus, GPT) reason on their own, and such phrases only slow things down.
- Hand over the whole task at once, not as a series of separate commands.
- If the video is long (more than 60-90 s), build it in parts within a single project with a shared style and timeline.
