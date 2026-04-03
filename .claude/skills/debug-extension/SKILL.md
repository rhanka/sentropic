---
name: debug-extension
description: Debug Chrome or VSCode extension issues — auth, tools, build, IPC
paths: "ui/chrome-ext/**,ui/vscode-ext/**"
allowed-tools: Read Bash Grep Glob
---

## Chrome Extension Debug
- **Build**: `make build-ext-chrome`
- **Auth**: refresh token (`chrome.storage.local`) → session token (`.session`). JWT decode for expiry. 60s refresh skew.
- **Tab tools**: 8 tools. Resolution cascade: sender.tab → active tab → last focused window → fallback.
- **Permissions**: allow/deny per tool+origin. Remote sync TTL 60s, offline queue.
- **Shadow DOM**: Content script injects chatwidget in isolated shadow root. Missing CSS = unstyled UI.

## VSCode Extension Debug
- **Build**: `make build-ext-vscode`
- **IPC bridge**: postMessage between host (`extension.ts`) and webview. RequestId correlation, 10s timeout.
- **Workspace fingerprint**: SHA256(normalized_path + git_origin_url). Moving workspace breaks mappings.
- **Local tools**: bash, ls, rg, file_read, file_edit, git. Workspace-scoped. Sensitive paths blocked (`.env*`, `.pem`, `id_rsa`, `secrets/`, `.aws/`, `.ssh/`).
- **Stream proxy**: SSE parsed line-by-line, emitted as frames to webview port.

## E2E VSCode lane
`make up-e2e-vscode ENV=e2e-$BRANCH`
`make test-e2e-vscode E2E_SPEC=tests/vscode/01-vscode-chat-streaming.spec.ts ENV=e2e-$BRANCH`
