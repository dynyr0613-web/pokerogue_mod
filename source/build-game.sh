#!/usr/bin/env bash
# Rebuild the game's code and locale files from source/pokerogue into the installed game folder
# (<game>/resources/game). Art and audio are not touched: they already live in that folder.
#
#   source/build-game.sh            # build, then install into the game folder of this repository
#
# Needs Node 22+ and pnpm. New icons are written by the scripts in tools/port (e.g. make_marks_atlas.py).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME="${1:-$HERE/../포켓로그 - 도주런 없는 엔드리스 에디션/resources/game}"
FORK="$HERE/pokerogue"

[ -f "$GAME/index.html" ] || { echo "game folder not found: $GAME" >&2; exit 1; }

cd "$FORK"
[ -d node_modules ] || pnpm install --frozen-lockfile --ignore-scripts

# The build copies everything under ./assets into dist. The art is already installed, so build against an empty
# folder and put back whatever ./assets was (for `vite` dev runs it is a link to the game folder).
SAVED=""
if [ -e assets ] || [ -L assets ]; then
  SAVED="$(mktemp -u "$FORK/.assets-saved-XXXXXX")"
  mv assets "$SAVED"
fi
restore() {
  rm -rf "$FORK/assets"
  if [ -n "$SAVED" ]; then mv "$SAVED" "$FORK/assets"; fi
}
trap restore EXIT
mkdir assets

rm -rf dist
CI=1 pnpm exec vite build --mode app

# Code: replace the old hashed bundles (source maps stay out of the game folder, as in the shipped build)
find "$GAME/assets" -maxdepth 1 -type f \( -name '*.js' -o -name '*.css' \) -delete
find dist/assets -maxdepth 1 -type f \( -name '*.js' -o -name '*.css' \) -exec cp {} "$GAME/assets/" \;
cp dist/index.html dist/asset-manifest.json "$GAME/"

# Locales
rm -rf "$GAME/locales"
cp -r dist/locales "$GAME/locales"

echo "installed into: $GAME"
