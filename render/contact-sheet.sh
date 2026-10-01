#!/usr/bin/env bash
# Contact sheet: N frames per second tiled into one image.
# Usage: ./contact-sheet.sh input.mp4 [sheet.png] [fps=2] [cols=8, or 12 for a portrait video]
# Tiles are 320 px wide for a landscape video and 190 px wide for a portrait one (Reels, Shorts), so the sheet stays readable.
set -euo pipefail
IN="${1:?usage: contact-sheet.sh input.mp4 [sheet.png] [fps] [cols]}"
OUT="${2:-sheet.png}"
FPS="${3:-2}"
# portrait video: narrower tiles and more columns
IFS=x read -r VW VH < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$IN")
VH="${VH%%[!0-9]*}"
if [ "$VH" -gt "$VW" ]; then TILE=190; DEFCOLS=12; else TILE=320; DEFCOLS=8; fi
COLS="${4:-$DEFCOLS}"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
N=$(awk -v d="$DUR" -v f="$FPS" 'BEGIN { n = d * f; c = int(n); if (c < n) c++; print (c < 1 ? 1 : c) }')
ROWS=$(( (N + COLS - 1) / COLS ))
# drawtext needs a font; Windows builds of ffmpeg often have no fontconfig, so point at a system font
FONT="${FONTFILE:-}"
[ -z "$FONT" ] && [ -f /c/Windows/Fonts/consola.ttf ] && FONT='C\:/Windows/Fonts/consola.ttf'
# quoted: ffmpeg 5+ no longer accepts the escaped drive colon unquoted
FONTOPT=${FONT:+:fontfile=\'$FONT\'}
ffmpeg -v error -y -i "$IN" \
  -vf "fps=${FPS},scale=${TILE}:-1,drawtext=text='%{pts\:hms}':x=6:y=6:fontsize=$((TILE / 20 + 8)):fontcolor=white:box=1:boxcolor=black@0.6${FONTOPT},tile=${COLS}x${ROWS}:padding=4:margin=4" \
  -frames:v 1 "$OUT"
echo "contact sheet: $OUT (${N} frames, ${COLS}x${ROWS})"
