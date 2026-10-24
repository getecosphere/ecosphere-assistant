#!/bin/bash
# Removes the helper registration and files. Stops the OpenCode servers it started.
set -u
HOST_NAME="com.ecosphere.assistant"
DIR="$HOME/.ecosphere-assistant"
if [ -f "$DIR/servers.json" ]; then
  node -e 'try{for(const s of Object.values(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))))try{process.kill(s.pid)}catch{}}catch{}' "$DIR/servers.json"
fi
for f in "$HOME/Library/Application Support"/*/NativeMessagingHosts/$HOST_NAME.json "$HOME/Library/Application Support"/*/*/NativeMessagingHosts/$HOST_NAME.json "${XDG_CONFIG_HOME:-$HOME/.config}"/*/NativeMessagingHosts/$HOST_NAME.json "${XDG_CONFIG_HOME:-$HOME/.config}"/*/*/NativeMessagingHosts/$HOST_NAME.json; do
  [ -f "$f" ] && rm -f "$f" && echo "removed $f"
done
rm -rf "$DIR" && echo "removed $DIR"
