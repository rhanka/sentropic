# @sentropic/cowork-bridge

Portable client bridge for **Sentropic Cowork**. It consolidates the
transport/storage-agnostic client core shared by the Sentropic web app, the Chrome
extension, and the (forthcoming) Cowork desktop binary.

## Contents

- **`core`** — `ApiClient` config injection, `ContextProvider`, `NavigationAdapter`,
  and the chat-widget handoff contract. Extracted verbatim from the SvelteKit web app
  (`ui/src/lib/core`); already free of `$app/*` and `chrome.*`.
- **`auth`** — the portable session lifecycle of the Chrome extension's `extension-auth`:
  JWT exp decoding, refresh-skew, user normalization, and the
  `extension-token` / `refresh` / logout HTTP contracts. Storage is abstracted behind a
  `StorageAdapter` (persistent + session); `fetch` is injected. Each host supplies its own
  adapter (the extension uses `chrome.storage`; the desktop binary uses an OS file store).
- **`tools`** — local-tool protocol types (`ToolDefinition`, `ToolCall`, `ToolResult`,
  `ToolExecutor`, `ToolExecutionContext`). Execution is supplied per host.
- **`permissions`** — the portable tool-permission schema + pattern matching
  (tool-name / origin normalization, wildcard matching, specificity scoring). Persistence
  and backend sync stay host-side.

SSE streaming is **not** duplicated here: consume `@sentropic/chat-ui`'s `StreamHub`.

## Publishing

This is a published `@sentropic/*` workspace package (`tsc` build to `dist/`, ESM, OIDC
trusted publisher). The **first** publish requires the one-shot bootstrap
(`workflow_dispatch` with `bootstrap_publish_target=cowork-bridge`, uses `NPM_TOKEN`)
followed by attaching the OIDC trusted publisher on npmjs.com. See
`rules/workflow.md → Package Publication`.
