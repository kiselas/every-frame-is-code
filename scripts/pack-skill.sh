#!/usr/bin/env bash
# Builds motion-kit.zip for uploading the skill to ChatGPT or Claude.ai:
# a motion-kit/ folder with SKILL.md, the reference docs, the runtime, the render scripts and the
# long-form examples (the demo film and its stills stay out).
# Usage: bash scripts/pack-skill.sh [out.zip]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-motion-kit.zip}"
git archive --format=zip --prefix=motion-kit/ -o "$OUT" HEAD \
  SKILL.md LICENSE sources.md [0-9][0-9]-*.md \
  runtime/film.js runtime/timing.js runtime/blocks.js runtime/short.js runtime/pixel.js runtime/pixel-fx.js runtime/chip.js runtime/compose.js runtime/music-lint.js runtime/inline.mjs runtime/README.md \
  render/README.md render/package.json render/render.mjs render/contact-sheet.sh \
  render/music-report.mjs render/textcheck.mjs render/voice.mjs render/voice.py render/make.mjs render/qa.mjs render/qa-lib.mjs render/lint-spec.mjs render/spec-lib.mjs render/post.mjs render/new.mjs render/templates/genres render/still.mjs render/analyze.mjs render/beatmap.mjs render/audio-analysis.mjs \
  examples/gps/film.html examples/gps/SCRIPT.md examples/lyapunov/spec.json examples/lyapunov/voice.txt examples/lyapunov/SCRIPT.md examples/pixel/film.html examples/pixel/SCRIPT.md examples/pixel/music-lab.html
echo "skill archive: $OUT"
