#!/bin/bash
# Ecosphere Assistant — helper installer (macOS and Linux).
# Registers the native messaging host for Chrome, Chromium, Brave, Edge, Vivaldi and Arc.
# Run from the repo (uses native/host.js + lib.js), or as the self-contained helper-install.sh
# (payload appended below the __PAYLOAD__ marker by build-helper.sh).
set -euo pipefail

HOST_NAME="com.ecosphere.assistant"
EXT_ID="__EXT_ID__"     # replaced by build-helper.sh; computed from manifest.json when run from the repo
STORE_ID="__STORE_ID__"     # the Chrome Web Store id, filled by build-helper.sh from native/store-id (empty until published)
INSTALL_DIR="$HOME/.ecosphere-assistant"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
SRC="$(dirname "$SELF")"

os="$(uname -s)"
case "$os" in Darwin|Linux) ;; *) echo "Unsupported OS: $os (Windows via WSL is on the roadmap)"; exit 1 ;; esac

echo "== Ecosphere Assistant helper =="

# node: the helper is a small Node program
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for c in "$HOME/.local/bin/node" "$HOME/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$c" ] && NODE_BIN="$c" && break
  done
fi
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: Node.js (18+) not found. Install it from https://nodejs.org (or: brew install node / apt install nodejs), then run this again."
  exit 1
fi
echo "node: $NODE_BIN"

mkdir -p "$INSTALL_DIR"
if [ -f "$SRC/lib.js" ] && [ -f "$SRC/host.js" ]; then
  cp "$SRC/lib.js" "$SRC/host.js" "$SRC/claude-server.js" "$SRC/perm-mcp.js" "$INSTALL_DIR/"
else
  sed -n '/^__PAYLOAD__$/,$p' "$SELF" | tail -n +2 | base64 -d | tar xz -C "$INSTALL_DIR"
fi

if [ "$EXT_ID" = "__EXT_ID__" ]; then
  EXT_ID="$("$NODE_BIN" -e '
    const fs = require("fs"), c = require("crypto");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const hex = c.createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32);
    process.stdout.write([...hex].map((x) => String.fromCharCode(97 + parseInt(x, 16))).join(""));
  ' "$SRC/../manifest.json")"
fi
if [ "$STORE_ID" = "__STORE_ID__" ]; then STORE_ID="$(tr -d '[:space:]' < "$SRC/store-id" 2>/dev/null || true)"; fi
ORIGINS="\"chrome-extension://$EXT_ID/\""
if [[ "$STORE_ID" =~ ^[a-p]{32}$ ]]; then ORIGINS="$ORIGINS, \"chrome-extension://$STORE_ID/\""; fi
echo "extension id: $EXT_ID${STORE_ID:+ and store id $STORE_ID}"

cat > "$INSTALL_DIR/host" <<LAUNCH
#!$NODE_BIN
require("$INSTALL_DIR/host.js");
LAUNCH
chmod +x "$INSTALL_DIR/host"

manifest() {
  cat <<JSON
{
  "name": "$HOST_NAME",
  "description": "Ecosphere Assistant helper: runs eco and OpenCode for the side panel",
  "path": "$INSTALL_DIR/host",
  "type": "stdio",
  "allowed_origins": [$ORIGINS]
}
JSON
}

if [ "$os" = "Darwin" ]; then
  base="$HOME/Library/Application Support"
  browsers=("Google/Chrome" "Google/Chrome Beta" "Google/Chrome Canary" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Vivaldi" "Arc/User Data")
else
  base="${XDG_CONFIG_HOME:-$HOME/.config}"
  browsers=("google-chrome" "google-chrome-beta" "chromium" "BraveSoftware/Brave-Browser" "microsoft-edge" "vivaldi")
fi

n=0
for b in "${browsers[@]}"; do
  if [ -d "$base/$b" ]; then
    mkdir -p "$base/$b/NativeMessagingHosts"
    manifest > "$base/$b/NativeMessagingHosts/$HOST_NAME.json"
    echo "registered: $b"
    n=$((n + 1))
  fi
done
if [ "$n" -eq 0 ]; then
  d="${browsers[0]}"
  mkdir -p "$base/$d/NativeMessagingHosts"
  manifest > "$base/$d/NativeMessagingHosts/$HOST_NAME.json"
  echo "registered: $d (no browser profile found yet)"
fi

echo
echo "Done. Reopen the Ecosphere Assistant panel and press \"Check again\"."
exit 0
