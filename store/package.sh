#!/usr/bin/env bash
# Build the Chrome Web Store package (store/ecosphere-assistant-cws.zip).
#
# NEVER ship these — they are gitignored because they are secrets or machine
# specific, and a previous package leaked them:
#   native/key.pem     a private key (nothing in the extension consumes it)
#   native/config.json, native/host   generated on the user's machine by the installer
# The helper itself is NOT in the store package: users get it from the one-line installer
# (helper-install.sh, built by native/build-helper.sh and hosted on getecosphere.com/downloads).
set -euo pipefail
cd "$(dirname "$0")/.."

version="$(node -p 'require("./manifest.json").version')"
desc_len="$(node -p 'require("./manifest.json").description.length')"
if [ "$desc_len" -gt 132 ]; then echo "manifest description is $desc_len chars (max 132)"; exit 1; fi
if grep -R --include='*.js' -nE 'eval\(|new Function\(' js page background.js >/dev/null; then echo "remote/dynamic code found"; exit 1; fi

out="store/ecosphere-assistant-cws.zip"
rm -f "$out"
zip -q -r "$out" \
  manifest.json background.js sidepanel.html sidepanel.css \
  js page fonts icons \
  -x '*/test/*' '*.DS_Store'

# helper installer, for hosting at https://getecosphere.com/downloads/helper-install.sh
native/build-helper.sh >/dev/null

echo "built $out (v$version)"
unzip -l "$out" | tail -n +4
