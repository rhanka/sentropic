---
description: "Chrome and VSCode extension architecture — tools, auth, build, multi-host"
alwaysApply: false
paths: ["ui/chrome-ext/**", "ui/vscode-ext/**"]
globs: ["ui/chrome-ext/**", "ui/vscode-ext/**"]
tags: [extensions, chrome, vscode]
---

# Extension Architecture

## Chrome Extension (MV3)

- Service worker: `background.ts` (977 lines) — handles auth, messaging, tool dispatch.
- Content script: injected into pages, uses shadow DOM for UI isolation.
- Side panel: main UI surface for chat interaction.
- Popup: lightweight config and status display.

## Chrome Auth

- Refresh token stored in `chrome.storage.local`.
- Session token stored in `.session` (ephemeral).
- JWT decoded client-side for expiry check.
- 60-second refresh skew — token refreshed before actual expiry.

## Chrome Tab Tools

- 8 tools: `tab_read`, `tab_action`, `tab_read_dom`, `tab_screenshot`, `tab_click`, `tab_type`, `tab_scroll`, `tab_info`.
- Tab resolution cascade:
  1. `sender.tab` (the tab that sent the message).
  2. Active tab in current window.
  3. Last focused window's active tab.
  4. Fallback error.
- Each tool validates permissions before execution.

## Chrome Permissions

- Allow/deny policies per tool + origin combination.
- Remote sync with TTL 60 seconds.
- Offline queue for permission changes made without connectivity.
- Permissions cached locally, refreshed on next sync.

## VSCode Extension

- CommonJS bundle produced by esbuild (not ESM).
- Webview bridge IPC:
  - Communication via `postMessage`.
  - Request/response correlation using `requestId`.
  - 10-second timeout on unanswered requests.
- Extension activates on specific commands and view visibility.

## VSCode Local Tools

- Available tools: `bash`, `ls`, `rg`, `file_read`, `file_edit`, `git`.
- All tools are workspace-scoped — cannot escape the workspace root.
- Sensitive paths blocked: `.env`, `.pem`, `id_rsa`, `secrets/`, `.aws/`, `.ssh/`.
- Tool output is sanitized before returning to the LLM.

## VSCode Workspace Fingerprint

- Computed as `SHA256(normalized_path + git_origin_url)`.
- Used to map workspace to server-side workspace record.
- Moving or renaming a workspace directory breaks existing mappings.
- Re-association required if fingerprint changes.

## No Shared Types

- Chrome and VSCode type definitions are independently maintained.
- Duplication between the two is intentional — they evolve at different rates.
- Do not attempt to create a shared types package.

## Build

- `make build-ext-chrome` — builds Chrome extension, output in `ui/static/`.
- `make build-ext-vscode` — builds VSCode extension, output in `ui/static/`.
- Both targets must pass before release.
