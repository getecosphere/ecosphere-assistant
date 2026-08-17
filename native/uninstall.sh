#!/bin/bash
set -euo pipefail

HOST_NAME="com.opencode.sidebar"

rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json" \
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts/$HOST_NAME.json" \
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts/$HOST_NAME.json" \
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/$HOST_NAME.json" \
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/$HOST_NAME.json" \
  "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts/$HOST_NAME.json"

echo "Uninstalled. OpenCode server processes are left running; stop them with:"
echo "  pkill -f \"opencode serve\""
