#!/usr/bin/env bash
# Starts Google Chrome with a DevTools port on a profile of its own for `pnpm capture`.
# Chrome 136+ ignores --remote-debugging-port on the default profile, so a separate profile is
# required; it lives outside the repository and keeps its sign-ins and the loaded extension.
set -euo pipefail

profile="${BOTDAR_CHROME_PROFILE:-$HOME/Library/Application Support/Botdar/chrome-profile}"
port="${BOTDAR_CDP_PORT:-9222}"
build_dir="$(cd "$(dirname "$0")/../.." && pwd)/.output/chrome-mv3"

mkdir -p "$profile"
open -na "Google Chrome" --args --remote-debugging-port="$port" --user-data-dir="$profile"

cat <<MSG
Chrome is starting with the Botdar capture profile:
  profile  $profile
  port     $port

First time only, in that Chrome window:
  1. Sign in to reddit.com, x.com and bsky.app.
  2. Open chrome://extensions, turn on Developer mode, click "Load unpacked" and choose
     $build_dir
Then record a page with, for example:
  pnpm capture -- --url https://www.reddit.com/r/politics/ --platform reddit --name feed
Quit this Chrome when you are done; the port lets any local process drive it while it runs.
MSG
