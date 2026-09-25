#!/usr/bin/env bash
# Contact sheet: N frames per second tiled into one image.
# Usage: ./contact-sheet.sh input.mp4 [sheet.png] [fps=2] [cols=8]
set -euo pipefail
IN="${1:?usage: contact-sheet.sh input.mp4 [sheet.png] [fps] [cols]}"
OUT="${2:-sheet.png}"
FPS="${3:-2}"
COLS="${4:-8}"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
N=$(awk -v d="$DUR" -v f="$FPS" 'BEGIN { n = d * f; c = int(n); if (c < n) c++; print (c < 1 ? 1 : c) }')
ROWS=$(( (N + COLS - 1) / COLS ))
# drawtext needs a font; Windows builds of ffmpeg often have no fontconfig, so point at a system font
FONT="${FONTFILE:-}"
[ -z "$FONT" ] && [ -f /c/Windows/Fonts/consola.ttf ] && FONT='C\:/Windows/Fonts/consola.ttf'
FONTOPT=${FONT:+:fontfile=$FONT}
ffmpeg -v error -y -i "$IN" \
  -vf "fps=${FPS},scale=320:-1,drawtext=text='%{pts\:hms}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6${FONTOPT},tile=${COLS}x${ROWS}:padding=4:margin=4" \
  -frames:v 1 "$OUT"
echo "contact sheet: $OUT (${N} frames, ${COLS}x${ROWS})"
