#!/usr/bin/env bash
# Собирает motion-kit.zip для загрузки скилла в ChatGPT или Claude.ai:
# папка motion-kit/ с SKILL.md, справочником и скриптами рендера, без examples/.
# Использование: bash scripts/pack-skill.sh [out.zip]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-motion-kit.zip}"
git archive --format=zip --prefix=motion-kit/ -o "$OUT" HEAD \
  SKILL.md LICENSE sources.md [0-9][0-9]-*.md \
  render/README.md render/package.json render/render.mjs render/contact-sheet.sh
echo "skill archive: $OUT"
