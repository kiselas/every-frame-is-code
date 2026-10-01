---
name: motion-kit
description: Code-drawn motion graphics, animated videos, explainers of 1-3 minutes with a story, silent vertical videos for Reels, Shorts and TikTok (biographies, data stories, how-it-works, timelines, versus, myth vs fact, lists), motion infographics, kinetic typography, transitions, editing, Three.js scenes, pixel-art and retro films (fixed palettes, dithering, chiptune, demoscene effects) and browser games with strong game feel. Use when you need to make a good-looking animation, video, explainer, intro, interactive scene or game in HTML/JS and render it to MP4, or to break down a reference video.
---

# Motion Kit

1. Read `00-agent-brief.md` in full. These rules are mandatory.
2. Read the files for the task:
   - any video: `01-pipeline.md`, `04-motion-easing.md`, `06-montage.md`, `12-render-qa.md`, `13-performance.md`;
   - choosing a style: `03-visual-style.md`;
   - transitions between scenes: `05-transitions.md`;
   - fire, particles, glow, grain, shaders: `07-effects-cookbook.md`;
   - titles and animated text: `08-kinetic-typography.md`;
   - music, sound effects, voice-over: `09-audio-sync.md`;
   - games: `10-games-juice.md`;
   - 3D: `11-threejs.md`;
   - pixel art, retro or fixed-palette looks, Mode 7 floors, dithered transitions, turning any scene into pixel art: `15-pixel-retro.md` and `runtime/pixel.js`, see `examples/pixel/`;
   - chiptune music and 8-bit sound effects as text (MML) and as data (Scores, real drums, echo, ducking): `16-chiptune.md` and `runtime/chip.js`;
   - a whole score from a short plan (key, style, an energy per section), with a linter and an audio report so you can fix music you cannot hear: `18-music-generation.md`, `runtime/compose.js`, `runtime/music-lint.js`, `render/music-report.mjs`;
   - modern electronic music for a film (house, techno, lo-fi, synthwave, ambient) with no track to find or license: a local open-source model writes it at the film's tempo (ACE-Step 1.5), a tempo fit and a grid check tell you what it did, Strudel patterns are the fallback: `22-electronic-music.md`, `render/ace-gen.py`, `render/ace-genres.json`, `render/ace-batch-check.mjs`, `render/grid-check.mjs`, `examples/house/track.js`;
   - demoscene effects (plasma, tunnel, rotozoom, copper bars, metaballs, starfield) as functions of x, y, t: `17-demoscene.md` and `runtime/pixel-fx.js`;
   - a vertical video for Reels, Shorts or TikTok (1080×1920): safe zones, type, fonts for Cyrillic and other non-Latin text, text-fit checks: `19-vertical.md`, build on `runtime/film.js` with `H > W`, see `examples/lyapunov/`;
   - any film watched without sound (all social video): the silent contract, the word budget, the genre map (how it works, one life, one number, timeline, versus, myth vs fact, countdown, process, statement, teaser, loop) and each genre's requirements: `20-silent-social.md`;
   - the pictures of an explainer: claim types, the label test, encodings, yardsticks, motion as data, density limits for a phone: `21-infographics.md`;
   - a series of spoken, subtitled vertical shorts made on a line (one `spec.json` per video: voice-over, shots tied to the spoken words, picture blocks, music, facts with sources; then `render/new.mjs`, `render/make.mjs`, `render/qa.mjs`, `render/post.mjs`): `23-short-factory.md`, `runtime/short.js`, `runtime/blocks.js`, see `examples/lyapunov/`;
   - a reference video to learn from: `node render/analyze.mjs ref.mp4 out/`, then read its report and sheets.
   - a film longer than ~45 s, an explainer, a story on any topic: `14-long-form.md` and `runtime/README.md`, build on `runtime/film.js`, see `examples/gps/`;
3. Show the plan as data first (style, beat grid, shots, events), then write the code. For a long film, the plan is `SCRIPT.md`: thesis, spine, through-line and the shot table (`14-long-form.md`).
4. Write the page to render fast from the start (`13-performance.md`): sprites instead of per-draw blur, no pixel readbacks in the frame loop, static layers cached. Iterate with `render.mjs --draft` on fragments.
5. After rendering, build a contact sheet (`render/contact-sheet.sh`), look at it, and fix issues by specific timecodes. Check single frames at full size with `render/still.mjs`.
