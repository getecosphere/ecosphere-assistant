#!/bin/bash
set -euo pipefail

HOST_NAME="com.opencode.sidebar"
DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(cd "$DIR/.." && pwd)"

echo "== OpenCode Sidebar installer =="

OPENCODE_BIN="$(command -v opencode 2>/dev/null || true)"
if [ -z "$OPENCODE_BIN" ]; then
  for c in "$HOME/.opencode/bin/opencode" "/opt/homebrew/bin/opencode" "/usr/local/bin/opencode"; do
    if [ -x "$c" ]; then OPENCODE_BIN="$c"; break; fi
  done
fi
if [ -z "$OPENCODE_BIN" ]; then
  echo "ERROR: 'opencode' binary not found."
  echo "Install it first with:  curl -fsSL https://opencode.ai/install | bash"
  exit 1
fi
echo "OpenCode: $OPENCODE_BIN"

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for c in "$HOME/node/bin/node" "/opt/homebrew/bin/node" "/usr/local/bin/node" "/usr/local/bin/bun"; do
    if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: 'node' runtime not found."
  echo "The native host needs Node.js. Install it from https://nodejs.org or via: brew install node"
  exit 1
fi
echo "Node runtime: $NODE_BIN"

DEFAULT_DIR="$HOME"
for cand in "$HOME/ar-rahman/estates/getecosphere/frontend" "$HOME/getecosphere/frontend" "$HOME/estates/getecosphere/frontend"; do
  if [ -d "$cand" ]; then DEFAULT_DIR="$cand"; break; fi
done

cat > "$DIR/config.json" <<EOF
{
  "opencode": "$OPENCODE_BIN",
  "defaultPort": 4096,
  "directory": "$DEFAULT_DIR"
}
EOF

cat > "$DIR/host" <<EOF
#!$NODE_BIN
require("$DIR/host.js");
EOF
chmod +x "$DIR/host" "$DIR/host.js"

HAS_KEY="$(node -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(m.key ? "yes" : "no");
' "$EXT_DIR/manifest.json")"

if [ "$HAS_KEY" = "yes" ]; then
  EXT_ID="$(node -e '
const fs = require("fs"), crypto = require("crypto");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const pub = Buffer.from(m.key, "base64");
process.stdout.write(
  crypto.createHash("sha256").update(pub).digest().slice(0, 16).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
);
' "$EXT_DIR/manifest.json")"
  echo "Extension ID (from manifest key): $EXT_ID"
else
  echo ""
  echo "This manifest has no \"key\", so the extension ID cannot be computed."
  echo "Copy the ID shown in chrome://extensions (or in the side panel's Step 1)"
  echo "and paste it below. Press Enter to abort."
  read -r -p "Extension ID: " EXT_ID || true
  EXT_ID="$(echo "$EXT_ID" | tr -d '[:space:]')"
  if [ -z "$EXT_ID" ]; then
    echo "No ID provided. Aborting."
    exit 1
  fi
  echo "Using extension ID: $EXT_ID"
fi

mkdir -p "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" \
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts"

cat > "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Starts the OpenCode web server for the OpenCode Sidebar extension",
  "path": "$DIR/host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

for dir in "Google/Chrome Canary" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Arc/User Data"; do
  cp "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json" \
    "$HOME/Library/Application Support/$dir/NativeMessagingHosts/$HOST_NAME.json" 2>/dev/null || true
done

echo ""
echo "Done! Native host registered for Chrome (and Brave / Edge / Arc / Chromium if present)."
echo ""
echo "Next steps:"
echo "  1. Open chrome://extensions, enable Developer mode, click 'Load unpacked',"
echo "     and select: $EXT_DIR"
echo "  2. Click the OpenCode Sidebar icon. The server auto-starts on first open."
echo ""
echo "Server log: $DIR/opencode-server.log"
