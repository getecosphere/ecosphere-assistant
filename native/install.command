#!/bin/bash
cd "$(dirname "$0")"
chmod +x install.sh uninstall.sh 2>/dev/null
./install.sh
echo ""
echo "Press any key to close this window..."
read -r -n 1 -s
