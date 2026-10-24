#!/bin/bash
# Builds helper-install.sh: one self-contained file (installer + helper payload) to host at
# https://getecosphere.com/downloads/helper-install.sh. Run: ./build-helper.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/../helper-install.sh"
ID="$(node -e '
const fs = require("fs"), c = require("crypto");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const hex = c.createHash("sha256").update(Buffer.from(m.key, "base64")).digest("hex").slice(0, 32);
process.stdout.write([...hex].map((x) => String.fromCharCode(97 + parseInt(x, 16))).join(""));
' "$DIR/../manifest.json")"
sed "s/__EXT_ID__\"     #/$ID\"     #/" "$DIR/install.sh" | sed '/^exit 0$/q' > "$OUT"
printf '__PAYLOAD__\n' >> "$OUT"
tar czf - -C "$DIR" lib.js host.js | base64 >> "$OUT"
chmod +x "$OUT"
echo "wrote $OUT (extension id $ID)"
