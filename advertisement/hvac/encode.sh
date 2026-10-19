#!/bin/bash
# The hvac2 landing's demo videos: source/*.mp4 (40 s, silent, 30 fps) re-encoded
# for the web, no re-cut. Two-pass at a fixed bitrate so every file lands under
# its cap; no audio track (-an: iOS autoplays only a muted/silent video);
# moov at the front (+faststart) for the MP4s.
#   bash advertisement/hvac/encode.sh
#   FFMPEG=<path to ffmpeg> when it is not on PATH (the encode used ffmpeg-static 5.2.0, ffmpeg 6.0)
set -euo pipefail
cd "$(dirname "$0")"
FF="${FFMPEG:-ffmpeg}"
OUT=../../public/landing-e
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
NULL=/dev/null; [ "${OS:-}" = "Windows_NT" ] && NULL=NUL

# h264 <src> <dst> <kbit/s> [scale]
h264() {
  local vf=(); [ -n "${4:-}" ] && vf=(-vf "scale=$4:flags=lanczos")
  for pass in 1 2; do
    local dst="$NULL" fmt=(-f mp4); [ $pass = 2 ] && dst="$2" && fmt=(-movflags +faststart)
    "$FF" -v error -y -i "$1" -an -map_metadata -1 "${vf[@]}" -c:v libx264 -preset veryslow -tune animation \
      -b:v "$3k" -pass $pass -passlogfile "$TMP/x264" -profile:v high -pix_fmt yuv420p -r 30 "${fmt[@]}" "$dst"
  done
}
# vp9 <src> <dst> <kbit/s> [scale]
vp9() {
  local vf=(); [ -n "${4:-}" ] && vf=(-vf "scale=$4:flags=lanczos")
  for pass in 1 2; do
    local dst="$NULL"; [ $pass = 2 ] && dst="$2"
    "$FF" -v error -y -i "$1" -an -map_metadata -1 "${vf[@]}" -c:v libvpx-vp9 -b:v "$3k" -pass $pass -passlogfile "$TMP/vp9" \
      -deadline good -cpu-used 1 -row-mt 1 -tile-columns 2 -pix_fmt yuv420p -r 30 -f webm "$dst"
  done
}
# poster <src> <dst> <seconds> <quality> [scale]
poster() {
  local vf="null"; [ -n "${5:-}" ] && vf="scale=$5:flags=lanczos"
  "$FF" -v error -y -ss "$3" -i "$1" -frames:v 1 -vf "$vf" -c:v libwebp -quality "$4" -compression_level 6 "$2"
}

S169=source/jobflex-hvac-demo-40-16x9.mp4
S45=source/jobflex-hvac-demo-40-4x5.mp4
h264 "$S169" "$OUT/hvac-demo-16x9.mp4" 1000
vp9  "$S169" "$OUT/hvac-demo-16x9.webm" 650
h264 "$S45"  "$OUT/hvac-demo-4x5.mp4" 760
vp9  "$S45"  "$OUT/hvac-demo-4x5.webm" 560
# the poster: the equipment step (load on top, Good · Better · Best with prices), 22 s
poster "$S169" "$OUT/hvac-demo-poster-16x9.webp" 22 55
poster "$S45"  "$OUT/hvac-demo-poster-4x5.webp" 22 75
ls -l "$OUT"/hvac-demo-16x9.* "$OUT"/hvac-demo-4x5.* "$OUT"/hvac-demo-poster-*
