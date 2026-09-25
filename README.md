<div align="center">

# motion-kit

**Every frame is code.** A knowledge kit that lets an AI agent make graphics with code:<br>
videos, explainers, kinetic typography, 3D scenes and games, and then render them to MP4 on its own.

<img src="examples/demo/teaser.gif" width="720" alt="Demo film teaser: fire, engraving, 3D sphere, palette montage, pixel game, transition catalog, contact sheet, final title">

<sub>Not a single generated pixel: the whole film is one HTML file that draws every frame.<br>
<b><a href="https://kiselas.github.io/every-frame-is-code/">▶ Watch it live in your browser</a></b> · source: <a href="examples/demo/demo.html">examples/demo/demo.html</a> · script: <a href="examples/demo/SCRIPT.md">examples/demo/SCRIPT.md</a></sub>

[![License: MIT](https://img.shields.io/badge/license-MIT-black)](LICENSE)
[![Agent Skill: Claude · Codex · ChatGPT](https://img.shields.io/badge/Agent_Skill-Claude_·_Codex_·_ChatGPT-d97757)](SKILL.md)
![Canvas 2D · WebGL · Three.js · Web Audio](https://img.shields.io/badge/Canvas_2D_·_WebGL_·_Three.js_·_Web_Audio-1d3557)

</div>

## Why

Models can write graphics code, but without rules they produce the same screensaver every time: a dark navy background, a neon gradient, particles "for atmosphere", everything moving linearly and all at once, text on top of objects, and crossfades as the only transition.

motion-kit is a set of rules and recipes that closes those gaps. The core architectural idea: **a frame is a pure function of time**, `draw(ctx, t)`. Everything else follows from it:

- **seek to any second**: a frame does not depend on the previous ones;
- **frame-by-frame rendering without stutter**: headless Chrome waits for every frame, however long it takes to draw;
- **one-line edits**: change an easing curve or a color, re-render, and get the same film with exactly one difference;
- **sound in sync with the picture**: the Web Audio score reads the same event list as the drawing code.

## What's in the demo film

The one-minute film was made strictly by this kit. Each scene shows one capability in its own style:

<table>
<tr>
<td width="33%"><img src="examples/demo/stills/01-terminal.jpg" alt="Terminal"><br><b>Typing and particles</b><br><sub>Text types itself out, then scatters into particles. <a href="08-kinetic-typography.md">08</a> · <a href="07-effects-cookbook.md">07</a></sub></td>
<td width="33%"><img src="examples/demo/stills/02-fire.jpg" alt="Fire"><br><b>Stateless fire</b><br><sub>650 particles, sprites, additive blending, film grain. <a href="07-effects-cookbook.md">07</a></sub></td>
<td width="33%"><img src="examples/demo/stills/03-engraving.jpg" alt="Engraving"><br><b>Determinism</b><br><sub>A line draws an astrolabe, the frame rewinds and replays exactly. <a href="01-pipeline.md">01</a> · <a href="04-motion-easing.md">04</a></sub></td>
</tr>
<tr>
<td><img src="examples/demo/stills/04-sphere.jpg" alt="3D sphere"><br><b>3D when you need it</b><br><sub>Three.js, bloom, ACES, 20,000 shader particles. <a href="11-threejs.md">11</a></sub></td>
<td><img src="examples/demo/stills/05-palettes.jpg" alt="Palettes"><br><b>12 styles, one composition</b><br><sub>Cuts on the beat, accelerating toward the peak. <a href="03-visual-style.md">03</a> · <a href="06-montage.md">06</a></sub></td>
<td><img src="examples/demo/stills/06-game.jpg" alt="Pixel game"><br><b>Game feel</b><br><sub>Hitstop, screen shake, squash &amp; stretch, speed ramp. <a href="10-games-juice.md">10</a></sub></td>
</tr>
<tr>
<td><img src="examples/demo/stills/07-transitions.jpg" alt="Transition catalog"><br><b>Transitions are data</b><br><sub>Iris, push, luma, wave, burn, whip pan. <a href="05-transitions.md">05</a></sub></td>
<td><img src="examples/demo/stills/08-qa.jpg" alt="Contact sheet"><br><b>Checked like a director</b><br><sub>A contact sheet and fixes by timecode. <a href="12-render-qa.md">12</a> · <a href="09-audio-sync.md">09</a></sub></td>
<td><img src="examples/demo/stills/09-finale.jpg" alt="Finale"><br><b>CRT finale</b><br><sub>Shader post-processing: distortion, scanlines, aberration. <a href="07-effects-cookbook.md">07</a></sub></td>
</tr>
</table>

Watch it live at [kiselas.github.io/every-frame-is-code](https://kiselas.github.io/every-frame-is-code/): the page draws every frame in your browser as you watch. Or open [`examples/demo/demo.html`](examples/demo/demo.html) locally in Chrome. Click to turn on sound, space pauses, arrow keys seek.

## Quick start

motion-kit is packaged as a skill in the open [Agent Skills](https://agentskills.io) format: a folder with a `SKILL.md`. The same skill works in Claude and in ChatGPT; only the install location differs.

| Where | How to install |
|---|---|
| **Claude Code** | `git clone https://github.com/kiselas/every-frame-is-code ~/.claude/skills/motion-kit` |
| **Codex** (CLI, IDE, app) | `git clone https://github.com/kiselas/every-frame-is-code ~/.agents/skills/motion-kit` |
| **ChatGPT** | download [motion-kit.zip](https://github.com/kiselas/every-frame-is-code/releases/latest/download/motion-kit.zip), then Plugins → Skills → Create → Upload from computer |
| **Claude.ai / Claude Desktop** | the same [motion-kit.zip](https://github.com/kiselas/every-frame-is-code/releases/latest/download/motion-kit.zip), then Customize → Skills → Upload |

For a single project, clone into `.claude/skills/motion-kit` or `.agents/skills/motion-kit` inside the repository. The agent picks up the skill on its own when the task is about graphics or animation. To call it explicitly: `/motion-kit` in Claude Code, `$motion-kit` in Codex, `@motion-kit` in ChatGPT. Try:

```
Make a 20-second film about the history of clocks in an engraving style, 1080p, with music.
Show the plan as data first, then the code, then render it and review the contact sheet.
```

Rendering to MP4 needs Node, Chrome and ffmpeg, so it works where the agent has a terminal: Claude Code and Codex. In ChatGPT and Claude.ai the skill helps plan and write the film, and you render it locally with the command below.

**Without skill support.** Copy the folder to `docs/motion/` and add this to `CLAUDE.md` or `AGENTS.md`:

```
Before any work on graphics, animation or games, read docs/motion/00-agent-brief.md,
then the files relevant to the task.
```

In a plain chat, attach `00-agent-brief.md` and one or two topic files.

## Rendering

```bash
cd render && npm install
node render.mjs ../film.html ../film.mp4              # the whole film with sound
node render.mjs ../film.html ../part.mp4 --from 20 --to 35
./contact-sheet.sh ../film.mp4 ../sheet.png           # 2 frames per second on one image
```

Requires Node 18+, Google Chrome and ffmpeg. The page must expose `window.__meta`, `window.__draw(t)` and `window.__ready`; details in [01-pipeline.md](01-pipeline.md) and [render/README.md](render/README.md).

The full demo film (1080p, 60 fps, with sound):

```bash
node render.mjs ../examples/demo/demo.html ../examples/demo/demo.mp4
```

## Contents

| File | About |
|---|---|
| [00-agent-brief.md](00-agent-brief.md) | Condensed rules for the agent. The main file |
| [01-pipeline.md](01-pipeline.md) | Architecture: draw(t), scene timeline, determinism, buffers |
| [02-prompting.md](02-prompting.md) | How to brief a task, prompt templates, phrases for revisions |
| [03-visual-style.md](03-visual-style.md) | Palettes, light, composition, texture, color grading |
| [04-motion-easing.md](04-motion-easing.md) | Curves, springs, timing, animation principles, camera |
| [05-transitions.md](05-transitions.md) | Transition catalog: Canvas 2D and GLSL |
| [06-montage.md](06-montage.md) | Editing: cuts, rhythm, structure, speed ramp |
| [07-effects-cookbook.md](07-effects-cookbook.md) | Noise, particles, fire, smoke, glow, grain, shaders |
| [08-kinetic-typography.md](08-kinetic-typography.md) | Animated text and captions for voice-over |
| [09-audio-sync.md](09-audio-sync.md) | Music with Web Audio, offline rendering, voice-over, mixing |
| [10-games-juice.md](10-games-juice.md) | Game feel: controls, hitstop, screen shake, camera |
| [11-threejs.md](11-threejs.md) | 3D: lighting, post-processing, shader particles |
| [12-render-qa.md](12-render-qa.md) | Rendering, contact sheets, review checklist |
| [render/](render/) | Render scripts (Node + Playwright + ffmpeg) |
| [examples/demo/](examples/demo/) | Demo film: script and source |
| [scripts/pack-skill.sh](scripts/pack-skill.sh) | Builds `motion-kit.zip` for ChatGPT and Claude.ai. Releases build it automatically: just push a `vX.Y.Z` tag |
| [sources.md](sources.md) | Sources and further reading |

## Contributing

Pull requests are welcome: new effect recipes, transitions, prompts that worked for you (with the result), fixes to the code. When you submit a prompt, include a link to the video or its contact sheet.

## License

MIT
