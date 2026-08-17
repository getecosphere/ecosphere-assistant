#!/bin/bash
# Builds a self-contained helper installer (helper-install.command) for the
# Ecosphere Assistant Chrome extension.
#
# Store-installed users cannot access the extension's native/ folder, so the
# native host is installed from this single downloaded file instead. It embeds
# host.js, installs to ~/.ecosphere-assistant/, and registers the native
# messaging host for Chrome/Edge/Brave/Arc/Chromium.
#
# Run: ./build-helper.sh   -> writes ../helper-install.command
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/../helper-install.command"

HOST_JS="$(cat "$DIR/host.js")"

cat > "$OUT" << OUTER_EOF
#!/bin/bash
# Ecosphere Assistant — one-time helper installer (self-contained).
# Installs the native messaging host that lets the extension start the local
# OpenCode server and deploy estates from your machine.
set -euo pipefail

INSTALL_DIR="\$HOME/.ecosphere-assistant"
mkdir -p "\$INSTALL_DIR"

cat > "\$INSTALL_DIR/host.js" << 'HOST_EOF'
$HOST_JS
HOST_EOF
chmod +x "\$INSTALL_DIR/host.js"

# Resolve a node runtime (the host is a Node script; GUI-launched processes
# have a limited PATH).
NODE_BIN="\$(command -v node 2>/dev/null || true)"
if [ -z "\$NODE_BIN" ]; then
  for c in "\$HOME/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node /opt/homebrew/bin/bun; do
    if [ -x "\$c" ]; then NODE_BIN="\$c"; break; fi
  done
fi
if [ -z "\$NODE_BIN" ]; then
  echo "ERROR: Node.js not found. Install it from https://nodejs.org (or: brew install node), then rerun."
  read -r -n 1 -s -p "Press any key to close..."
  exit 1
fi

# Resolve opencode (optional now; the extension installs it later).
OPENCODE_BIN="\$(command -v opencode 2>/dev/null || true)"
if [ -z "\$OPENCODE_BIN" ]; then
  for c in "\$HOME/.opencode/bin/opencode" /opt/homebrew/bin/opencode /usr/local/bin/opencode; do
    if [ -x "\$c" ]; then OPENCODE_BIN="\$c"; break; fi
  done
fi

# The extension ID. Unpacked dev builds carry a "key" (auto-computed); store
# builds get a Google-assigned ID, so ask for the one shown in the sidebar
# (Step 1) or in chrome://extensions.
EXT_ID="\$(find "\$HOME" -maxdepth 3 -name manifest.json -path '*ecosphere*' 2>/dev/null | head -1 | xargs -I{} node -e 'try{const fs=require("fs"),c=require("crypto");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(m.key){const p=Buffer.from(m.key,"base64");process.stdout.write(c.createHash("sha256").update(p).digest().slice(0,16).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+\$/,""));}}catch(e){}' {} 2>/dev/null || true)"
if [ -z "\$EXT_ID" ]; then
  echo ""
  echo "Paste your extension ID (shown in the sidebar's Step 1, or in chrome://extensions):"
  read -r -p "Extension ID: " EXT_ID || true
  EXT_ID="\$(echo "\$EXT_ID" | tr -d '[:space:]')"
  if [ -z "\$EXT_ID" ]; then
    echo "No ID provided. Aborting."
    read -r -n 1 -s -p "Press any key to close..."
    exit 1
  fi
fi

# Launcher with the absolute node path.
cat > "\$INSTALL_DIR/host" << EOF
#!\$NODE_BIN
require("\$INSTALL_DIR/host.js");
EOF
chmod +x "\$INSTALL_DIR/host"

# Config.
cat > "\$INSTALL_DIR/config.json" << EOF
{
  "opencode": "\${OPENCODE_BIN:-opencode}",
  "defaultPort": 4096
}
EOF

HOST_NAME="com.opencode.sidebar"
mkdir -p "\$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Chromium/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" \\
  "\$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts"

cat > "\$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/\$HOST_NAME.json" << EOF
{
  "name": "\$HOST_NAME",
  "description": "Ecosphere Assistant native host — starts the local OpenCode server and deploys estates",
  "path": "\$INSTALL_DIR/host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://\$EXT_ID/"]
}
EOF

for dir in "Google/Chrome Canary" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Arc/User Data"; do
  cp "\$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/\$HOST_NAME.json" \\
    "\$HOME/Library/Application Support/\$dir/NativeMessagingHosts/\$HOST_NAME.json" 2>/dev/null || true
done

echo ""
echo "Done! The Ecosphere Assistant helper is installed."
echo "Go back to the sidebar and click 'Check again'."
echo ""
read -r -n 1 -s -p "Press any key to close..."
OUTER_EOF

chmod +x "$OUT"
echo "Wrote $OUT ($(wc -c < "$OUT") bytes)"
