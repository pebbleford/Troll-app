#!/usr/bin/env bash
# Mac / Linux launcher.
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org and run this again."
  exit 1
fi
[ -d node_modules ] || npm install || exit 1
npm start
