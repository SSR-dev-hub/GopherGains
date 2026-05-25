#!/bin/bash
# GopherGains — generate app icons from build/gopher-chart.png
# Run once from the repo root: ./build/setup-icon.sh
# Requires: macOS (sips + iconutil), Python 3

set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$DIR/build/gopher-chart.png"
ICONSET="$DIR/build/AppIcon.iconset"
OUT="$DIR/build/icons"

if [ ! -f "$SRC" ]; then
  echo "✗ Source image not found: $SRC"
  exit 1
fi

echo "→ Generating GopherGains icons from $(basename $SRC)..."
mkdir -p "$ICONSET" "$OUT"

# Resize to all needed sizes using macOS sips
for SIZE in 16 32 48 64 128 256 512 1024; do
  echo "  ${SIZE}x${SIZE}..."
  sips -z $SIZE $SIZE "$SRC" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" > /dev/null
done

# @2x variants for iconset
for SIZE in 16 32 64 128 256 512; do
  cp "$ICONSET/icon_$((SIZE*2))x$((SIZE*2)).png" "$ICONSET/icon_${SIZE}x${SIZE}@2x.png"
done

# 512×512 PNG for electron-builder
cp "$ICONSET/icon_512x512.png" "$OUT/icon.png"
echo "✓ $OUT/icon.png"

# ICO for Windows (16, 32, 48, 256) — written by Python
python3 - "$ICONSET" "$OUT" << 'PYEOF'
import sys, struct

iconset, out = sys.argv[1], sys.argv[2]

ico_sizes = [16, 32, 48, 256]
images = []
for s in ico_sizes:
    with open(f"{iconset}/icon_{s}x{s}.png", "rb") as f:
        images.append((s, f.read()))

num    = len(images)
header = struct.pack("<HHH", 0, 1, num)
offset = 6 + num * 16
entries = b""
data    = b""
for s, png_data in images:
    sz = s if s < 256 else 0
    entries += struct.pack("<BBBBHHII", sz, sz, 0, 0, 1, 32, len(png_data), offset)
    offset  += len(png_data)
    data    += png_data

with open(f"{out}/icon.ico", "wb") as f:
    f.write(header + entries + data)
print(f"✓ {out}/icon.ico")
PYEOF

# Convert iconset → icns
iconutil -c icns "$ICONSET" -o "$OUT/icon.icns"
rm -rf "$ICONSET"
echo "✓ $OUT/icon.icns"

echo ""
echo "Done. Icons written to build/icons/"
