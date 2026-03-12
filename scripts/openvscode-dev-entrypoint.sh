#!/bin/sh
set -eu

mkdir -p /home/.openvscode-server/extensions
rm -rf /home/.openvscode-server/extensions/top-ai-ideas.top-ai-ideas-vscode-extension-dev
ln -s /workspace/ui/vscode-ext /home/.openvscode-server/extensions/top-ai-ideas.top-ai-ideas-vscode-extension-dev

if [ ! -f /workspace/ui/vscode-ext/dist/extension.cjs ] || [ ! -f /workspace/ui/vscode-ext/dist/webview-entry.js ]; then
  echo "warning: run make build-ext-vscode before using the mounted dev lane" >&2
fi

exec "${OPENVSCODE_SERVER_ROOT:-/home/.openvscode-server}/bin/openvscode-server" \
  --host 0.0.0.0 \
  --port 3000 \
  --without-connection-token \
  --telemetry-level off \
  /workspace
