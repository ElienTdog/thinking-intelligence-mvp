#!/bin/bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 https://your-private-thinking-site.example"
  exit 1
fi

ROOT="/Users/bytedance/Documents/思考"
SYNC_LABEL="com.thinking.wiki-inbox-sync"
BRIDGE_LABEL="com.thinking.wechat-capture-bridge"
SYNC_PLIST="$HOME/Library/LaunchAgents/$SYNC_LABEL.plist"
BRIDGE_PLIST="$HOME/Library/LaunchAgents/$BRIDGE_LABEL.plist"
PYTHON="$(python3 -c 'import os, sys; print(os.path.realpath(sys.executable))')"
DOMAIN="gui/$(id -u)"

security find-generic-password -a wiki-sync -s thinking-wiki-sync -w >/dev/null
security find-generic-password -a wiki-sync -s thinking-wiki-sites-bypass -w >/dev/null
security find-generic-password -a deepseek -s thinking-wiki-deepseek -w >/dev/null
"$PYTHON" "$ROOT/tools/wechat_capture_bridge.py" --root "$ROOT" --ensure-token

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/.logs"
cat > "$BRIDGE_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$BRIDGE_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$PYTHON</string>
    <string>$ROOT/tools/wechat_capture_bridge.py</string>
    <string>--root</string><string>$ROOT</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$ROOT/.logs/wechat-capture-bridge.log</string>
  <key>StandardErrorPath</key><string>$ROOT/.logs/wechat-capture-bridge-error.log</string>
</dict></plist>
EOF

cat > "$SYNC_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$SYNC_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$PYTHON</string>
    <string>$ROOT/tools/wiki_inbox_sync.py</string>
    <string>--server</string><string>$1</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>120</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$ROOT/.logs/wiki-inbox-sync.log</string>
  <key>StandardErrorPath</key><string>$ROOT/.logs/wiki-inbox-sync-error.log</string>
</dict></plist>
EOF

if launchctl print "$DOMAIN/$BRIDGE_LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN" "$BRIDGE_PLIST"
fi
if launchctl print "$DOMAIN/$SYNC_LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN" "$SYNC_PLIST"
fi
launchctl bootstrap "$DOMAIN" "$BRIDGE_PLIST"
launchctl bootstrap "$DOMAIN" "$SYNC_PLIST"
echo "Installed $BRIDGE_LABEL (always on) and $SYNC_LABEL (every 120 seconds)."
echo "Load web/capture-bridge-extension as an unpacked extension, then run:"
echo "  python3 tools/wechat_capture_bridge.py --show-token"
