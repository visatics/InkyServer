#!/usr/bin/env bash
#
# End-to-end device-protocol verification (PRD §4.1, §7, §8, §9.1, §10).
#
# Unlike test/*.test.ts — which cover the pure state engine and cache key — this
# exercises the whole request path against a running server and a real Supabase
# backend: render, upload, cache lookup, and the bytes actually served. The
# cross-screen cache collision fixed in src/lib/cacheKey.ts lived precisely here,
# where the unit tests cannot reach.
#
# Usage:
#   npm run dev            # in another shell
#   ./test/protocol.sh     # or: BASE_URL=https://... ./test/protocol.sh
#
# Requires: curl, jq, node (for sharp metadata). Exits non-zero on any failure.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

[ -f .env ] || { echo "error: .env not found — copy .env.example and fill it in"; exit 2; }
set -a && . ./.env && set +a

BASE="${BASE_URL:-${PUBLIC_BASE_URL:-http://localhost:8080}}"
U="$BASE/$DEVICE_UUID"
WIDTH=600 HEIGHT=448   # must match DEVICE in src/config/device.ts

for bin in curl jq node; do
  command -v "$bin" >/dev/null || { echo "error: $bin not found on PATH"; exit 2; }
done
curl -sf -o /dev/null "$BASE/placeholder.jpg" || {
  echo "error: no server at $BASE — start it with 'npm run dev'"; exit 2; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then printf "  \033[32mPASS\033[0m %-46s %s\n" "$1" "$2"; pass=$((pass+1))
  else printf "  \033[31mFAIL\033[0m %-46s got=%s want=%s\n" "$1" "$2" "$3"; fail=$((fail+1)); fi
}
neq() { # neq <label> <a> <b>  -- asserts a != b
  if [ "$2" != "$3" ]; then printf "  \033[32mPASS\033[0m %-46s differs\n" "$1"; pass=$((pass+1))
  else printf "  \033[31mFAIL\033[0m %-46s both=%s\n" "$1" "$2"; fail=$((fail+1)); fi
}
# SHA-1 of an asset pushed through the same pipeline as src/render/pipeline.ts.
expected_sha() {
  node -e '
    const sharp = require("sharp"), { createHash } = require("crypto");
    const [src, w, h] = [process.argv[1], +process.argv[2], +process.argv[3]];
    sharp(src)
      .resize(w, h, { fit: "cover", position: "centre", background: { r: 255, g: 255, b: 255 } })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 90, progressive: false, mozjpeg: false })
      .toBuffer()
      .then((b) => console.log(createHash("sha1").update(b).digest("hex")));
  ' "$1" "$WIDTH" "$HEIGHT"
}

echo "== §7.1/7.3 state transitions =="
check "first boot -> default screen, idx 0" \
  "$(curl -s "$U" | jq -c '.state')" '{"screen":1,"idx":0}'
check "timer poll advances sequential slideshow" \
  "$(curl -s "$U?screen=1&idx=0" | jq -c '.state')" '{"screen":1,"idx":1}'
check "sequential wraps at end (idx 2 -> 0)" \
  "$(curl -s "$U?screen=1&idx=2" | jq -c '.state')" '{"screen":1,"idx":0}'

echo "== §8.2 button actions =="
check "A from screen 2 -> goto 1, resets idx" \
  "$(curl -s "$U?screen=2&idx=1&button=A" | jq -c '.state')" '{"screen":1,"idx":0}'
check "C -> goto debug screen, initial mode" \
  "$(curl -s "$U?screen=1&idx=0&button=C" | jq -c '.state')" '{"screen":3,"mode":"light"}'
check "E on screen 3 cycles mode light->dark" \
  "$(curl -s "$U?screen=3&mode=light&button=E" | jq -c '.state')" '{"screen":3,"mode":"dark"}'
check "E cycle wraps blue->light" \
  "$(curl -s "$U?screen=3&mode=blue&button=E" | jq -c '.state')" '{"screen":3,"mode":"light"}'
check "D on screen 3 overrides device default (set)" \
  "$(curl -s "$U?screen=3&mode=dark&button=D" | jq -c '.state')" '{"screen":3,"mode":"light"}'
check "D on screen 1 = device default, next photo" \
  "$(curl -s "$U?screen=1&idx=0&button=D" | jq -c '.state')" '{"screen":1,"idx":1}'
check "E on screen 1 is a no-op (device default none)" \
  "$(curl -s "$U?screen=1&idx=2&button=E" | jq -c '.state')" '{"screen":1,"idx":2}'
check "unknown button Z is a no-op" \
  "$(curl -s "$U?screen=1&idx=0&button=Z" | jq -c '.state')" '{"screen":1,"idx":0}'

echo "== §7.5 untrusted state sanitisation =="
check "unknown screen ordinal resets to default" \
  "$(curl -s "$U?screen=99&idx=5" | jq -c '.state')" '{"screen":1,"idx":0}'
check "garbage screen resets to default" \
  "$(curl -s "$U?screen=abc" | jq -c '.state')" '{"screen":1,"idx":0}'
check "out-of-range idx is modulo-normalised" \
  "$(curl -s "$U?screen=1&idx=97&button=E" | jq -c '.state')" '{"screen":1,"idx":1}'
check "negative idx normalised" \
  "$(curl -s "$U?screen=1&idx=-1&button=E" | jq -c '.state')" '{"screen":1,"idx":2}'
check "unknown uuid -> 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/not-a-real-uuid")" '404'

echo "== §7.4 SHA stability / render cache =="
A=$(curl -s "$U?screen=3&mode=dark" | jq -r '.sha')
B=$(curl -s "$U?screen=3&mode=dark" | jq -r '.sha')
check "identical inputs -> byte-stable SHA" "$A" "$B"
IMGA=$(curl -s "$U?screen=3&mode=dark" | jq -r '.image')
IMGB=$(curl -s "$U?screen=3&mode=dark" | jq -r '.image')
check "identical inputs -> same image URL" "$IMGA" "$IMGB"
C=$(curl -s "$U?screen=3&mode=light" | jq -r '.sha')
neq "different mode -> different SHA" "$A" "$C"
S0=$(curl -s "$U?screen=1&idx=0&button=E" | jq -r '.sha')
S1=$(curl -s "$U?screen=1&idx=1&button=E" | jq -r '.sha')
neq "different slideshow idx -> different SHA" "$S0" "$S1"

echo "== §4.1 cache key isolates screens (regression) =="
# Screens 1 and 2 are both provider=slideshow over different asset sets. Before
# the cacheKey fix they hashed identically and screen 2 served screen 1's photo.
X0=$(curl -s "$U?screen=1&idx=0&button=E" | jq -r '.sha')
Y0=$(curl -s "$U?screen=2&idx=0&button=E" | jq -r '.sha')
neq "screen 1 vs 2 at idx0 -> different image" "$X0" "$Y0"
X1=$(curl -s "$U?screen=1&idx=1&button=E" | jq -r '.sha')
Y1=$(curl -s "$U?screen=2&idx=1&button=E" | jq -r '.sha')
neq "screen 1 vs 2 at idx1 -> different image" "$X1" "$Y1"
# Stronger than "they differ": each must match its own asset set byte-for-byte.
check "screen 1 serves slideshow-a/01" "$X0" "$(expected_sha assets/slideshow-a/01.jpg)"
check "screen 2 serves slideshow-b/01" "$Y0" "$(expected_sha assets/slideshow-b/01.jpg)"

echo "== §7.2 response shape =="
R=$(curl -s "$U?screen=1&idx=0&button=E")
check "has image/refresh/sha/state keys" \
  "$(echo "$R" | jq -c 'has("image") and has("refresh") and has("sha") and has("state")')" 'true'
check "refresh is minutes (screen 1 = 1)" "$(echo "$R" | jq -r '.refresh')" '1'
check "debug screen refresh = 5" \
  "$(curl -s "$U?screen=3&mode=light" | jq -r '.refresh')" '5'
check "sha is 40-char lowercase hex" \
  "$(echo "$R" | jq -r '.sha' | grep -cE '^[0-9a-f]{40}$')" '1'
check "state never echoes the button" \
  "$(echo "$R" | jq -r '.state | has("button")')" 'false'
check "image URL is the public supabase bucket" \
  "$(echo "$R" | jq -r '.image' | grep -c 'storage/v1/object/public/renders/')" '1'

echo "== §9.1/§10 served image is a real, correct JPEG =="
IMG=$(echo "$R" | jq -r '.image')
SHA_JSON=$(echo "$R" | jq -r '.sha')
check "image downloads from public URL (unauthenticated)" \
  "$(curl -s -o "$TMP/img.jpg" -w '%{http_code}' "$IMG")" '200'
check "SHA in JSON matches downloaded bytes" \
  "$(shasum -a 1 "$TMP/img.jpg" | cut -d' ' -f1)" "$SHA_JSON"
META=$(node -e '
  const sharp = require("sharp");
  sharp(process.argv[1]).metadata().then((m) =>
    console.log(`${m.width}x${m.height}|${m.format}|progressive=${m.isProgressive}`));
' "$TMP/img.jpg" 2>&1)
check "baseline JPEG at device resolution" "$META" "${WIDTH}x${HEIGHT}|jpeg|progressive=false"

echo
echo "-------------------------------------------"
printf "  \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$pass" "$fail"
echo "-------------------------------------------"
[ "$fail" -eq 0 ]
