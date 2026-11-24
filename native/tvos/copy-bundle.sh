#!/bin/sh
# Copy the staged game (native/tvos/stage.mjs: game.js and public/) into the app being built.
# Run by Xcode after the link (native/CMakeLists.txt), so the copy is inside the app when Xcode
# signs it. The destination comes from Xcode's own build settings rather than a path fixed when
# CMake configured: `xcodebuild archive` builds the app somewhere else than `build` does.
set -eu
stage="$1"
app="${TARGET_BUILD_DIR:?run by Xcode}/${CONTENTS_FOLDER_PATH:?run by Xcode}"
if [ ! -f "$stage/game.js" ] || [ ! -d "$stage/public" ]; then
  echo "error: no staged game in $stage: run node native/tvos/stage.mjs (native/tvos/build.mjs does)" >&2
  exit 1
fi
rsync -a --delete "$stage/public/" "$app/public/"
cp "$stage/game.js" "$app/game.js"
