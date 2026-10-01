# Sources and further reading

The ideas and observations in this kit come from open community material published after the release of Claude Opus 5.5 (September 2026) and from the classics of animation, film editing and game design.

## Code animation with Opus

- [iArt: How to Make an Animation Where Every Frame Is Drawn in JavaScript](https://www.iart.ai/blog/ai-javascript-animation): the draw(t) architecture, seeded randomness, a shared timeline for picture and sound, contact sheets, typical first-draft mistakes. The article comes from a commercial service, but the method it describes is open.
- [iart-ai/javascript-animation-skills](https://github.com/iart-ai/javascript-animation-skills): open agent skills (drawing, storyboard, MP4 rendering, Web Audio soundtrack), MIT.
- [Anthropic: Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5): official guidance, including naming the frontend patterns to avoid explicitly.
- [newfacedesign: Opus 5.5 paints, animates and scores music with code alone](https://newfacedesign.com/blog/claude-opus-5-5-art-animation-from-code): a review of videos shared on social media and a sober look at survivorship bias.
- [vc.ru: Opus 5.5 for graphics, games and animation](https://vc.ru/ai/3154245-opus-5-5-anthropic-grafika-animatsiya) (in Russian)

## Prompt collections

- [TripoGrowthLab/awesome-opus-5-5-prompts](https://github.com/TripoGrowthLab/awesome-opus-5-5-prompts): 3D scenes, games, animation and simulations with links to the originals.
- [Hyper3D: Claude Opus 5.5 prompts & examples](https://hyper3d.ai/3d-prompts/models/claude-opus-5.5)
- [FavTutor: 10 things people created with Opus 5.5](https://favtutor.com/claude-opus-5-5-real-examples/)

## Classics

- Walter Murch, *In the Blink of an Eye*: film editing, the rule of six.
- Frank Thomas, Ollie Johnston, *The Illusion of Life*: the twelve principles of animation.
- Martin Jonasson, Petri Purho, the talk "Juice it or lose it".
- Squirrel Eiserloh, GDC, "Math for Game Programmers: Juicing Your Cameras With Math".
- gl-transitions: an open collection of GLSL transitions with a common interface.
- The Book of Shaders: an introduction to fragment shaders, noise and patterns.

## Pixel, retro and demoscene

- [Pyxel](https://github.com/kitao/pyxel): a retro game engine for Python; its 16-color palette, `pal`, `dither(alpha)`, `blt3d`, [MML commands](https://github.com/kitao/pyxel/blob/main/docs/mml-commands.md) and text-based [resource format](https://github.com/kitao/pyxel/blob/main/docs/pyxres-format.md) are the source of `runtime/pixel.js` and `runtime/chip.js`.
- [PICO-8 dither tutorial](https://www.lexaloffle.com/bbs/?pid=69408), [palette ramps](https://nerdyteachers.com/PICO-8/Guide/PALETTES) and [tweetcart studies](https://demobasics.pixienop.net/tweetcarts/): the `pal`/`fillp` techniques and the per-pixel effect formulas of `runtime/pixel-fx.js`.
- [SizeCoding: PICO-8](http://www.sizecoding.org/wiki/PICO-8): demoscene effects in a few characters.
- [Ditherpunk](https://surma.dev/things/ditherpunk/) by Surma and [Ordered dithering](https://en.wikipedia.org/wiki/Ordered_dithering): why a Bayer matrix is stateless and suits real-time; the look of *Return of the Obra Dinn*.
- [Lospec palette list](https://lospec.com/palette-list): a large catalog of ready palettes.
- [ChatMusician](https://arxiv.org/pdf/2402.16153) and [ComposerX](https://arxiv.org/html/2404.18081v1): why one-shot note writing by an LLM fails on structure, and why staged composition works better (behind `runtime/compose.js`).
- [Euclidean rhythm](https://en.wikipedia.org/wiki/Euclidean_rhythm), [Tonal](https://github.com/tonaljs/tonal), [Strudel](https://strudel.cc/) (patterns as text; AGPL, so it is run as a tool through `strudel-render` and never embedded, see `22-electronic-music.md`) and [chiptune arrangement guides](https://ozzed.net/how-to-make-8-bit-music.shtml): the music-generation background.
- [ACE-Step 1.5](https://github.com/ACE-Step/ACE-Step-1.5): an MIT text-to-music model run locally for film music (`render/ace-gen.py`), its [model card](https://huggingface.co/ACE-Step/Ace-Step1.5), see `22-electronic-music.md`.
- [Fantasy console overview](https://www.davideaversa.it/blog/how-choose-fantasy-console/): PICO-8, TIC-80 and their constraints as a creative tool.

## Vertical video and non-Latin text

- [MDN: FontFaceSet.load()](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load) and [MDN: unicode-range](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/unicode-range): why `document.fonts.load(font)` without text fetches only the Latin file of a family split by script, and how `Film.create` loads fonts for the text it draws.
- [Google Fonts CSS API](https://developers.google.com/fonts/docs/css2): one `@font-face` per subset (`cyrillic`, `latin`, ...); the way to check that a family has the script you need.
- The facts and sources of the worked example (a vertical film about A. A. Lyapunov) are listed in [examples/lyapunov/SCRIPT.md](examples/lyapunov/SCRIPT.md).

## Silent social video and infographics

- Muted viewing and captions: [Digiday on Facebook's 85%](https://digiday.com/media/silent-world-facebook-video/), the [Verizon/Publicis survey](https://digiday.com/sponsored/75-percent-of-people-watch-mobile-videos-on-mute/) (69% muted in public, captions raise completion by about 80%).
- Hooks and retention benchmarks: [TikTok 3-second hook statistics](https://insights.ttsvibes.com/tiktok-first-3-seconds-hook-retention-rate/), [TikTok view-rate benchmarks](https://www.shortimize.com/blog/what-is-a-good-view-rate-for-tiktok), [retention curves for TikTok ads](https://sociavault.com/blog/tiktok-ad-retention-curves-hook-optimization).
- Reading speed for on-screen text: [University of Melbourne captioning style guide](https://www.unimelb.edu.au/accessibility/video-captioning/style-guide), [Netflix's 20 characters per second](https://en.wikipedia.org/wiki/Closed_captioning).
- Cleveland and McGill, [Graphical Perception](https://www.textbookofusability.com/references/clevelandmcgill1984.html) (1984): the ranking of encodings behind `21-infographics.md`.
- Edward Tufte, *The Visual Display of Quantitative Information*; Otto Neurath, Isotype; Claus Wilke, [Fundamentals of Data Visualization](https://clauswilke.com/dataviz/introduction.html).
- Shu et al., [What Makes a Data-GIF Understandable?](https://arxiv.org/abs/2008.07227), IEEE VIS 2020: animated charts, what helps and hurts comprehension.
