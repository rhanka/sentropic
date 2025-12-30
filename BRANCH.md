# Feature: Show folder and organization on use case detail view

## Objective
Improve the use case detail view by displaying:
- The folder name the use case belongs to
- The organization (company) owning that folder

Scope is UI-only unless the API is missing required fields.

## Plan / Todo
- [x] UI: Load folder details on `/cas-usage/[id]` and display folder name (with link to folder page)
- [x] UI: Resolve and display organization name (with link to organization page)
- [x] Tests: Run UI tests via Make before committing
- [x] Docs: Update TODO.md (check items + reference branch/PR) and update RELEASE.md if needed
- [ ] UI Fix post stream 'blink' (when message finished in chat)


Notes:
- Display changes were iterated based on feedback:
  - Use case detail now shows an organization pill next to the model badge (no folder banner).
  - Use cases main page shows the folder name (editable) instead of the generic page title.
  - Folder cards show organization name in blue.

## Commits & Progress
- [x] **Commit 1** (5c5936f): UI: show organization badge on use case detail
- [x] **Commit 2** (874e56c): UI: make folder name editable on use cases page (2/3 editable + 1/3 tags)
- [x] **Commit 3** (6749d83): UI: folder cards show organization name in blue
- [x] **Commit 4** (bdb7371): Fix: prevent chat response blink on stream completion

## Status
## Follow-up: UI Fix post stream "blink" (chat)

Reference (TODO.md):
- [ ] UI Fix post stream 'blink' (when message finished in chat) 

### Observed behavior
When an assistant message finishes streaming (terminal `done`/`error`), the chat UI briefly "blinks":
- the assistant response bubble visually flashes/repaints when switching from streamed markdown to the final persisted markdown, especially for large markdown payloads

### Likely root cause
The blink is local to the assistant response bubble, not the whole list.

In `ui/src/lib/components/StreamMessage.svelte` (chat variant), rendering uses two different branches:
- while streaming: `Streamdown content={st.contentText}`
- after completion: `Streamdown content={finalContent}`

When `finalContent` becomes available, Svelte switches branches, which effectively replaces the DOM subtree for the bubble. For large markdown, `Streamdown` re-parses and re-renders a big tree, which can cause a visible flash/repaint.

### Proposed fix (minimal, low-risk)
Avoid branch swapping for the chat bubble, so the same container stays mounted:
- Render a single bubble for chat with a computed content:
  - `displayContent = (finalContent?.trim() ? finalContent : st.contentText)`
  - `<Streamdown content={displayContent} />`

This keeps the DOM stable and turns the completion into a simple prop update (often identical text), reducing the flash for large markdown.

### Alternative (if needed)
- Delay the switch to `finalContent` until the browser is idle (`requestIdleCallback`) or next paint (`requestAnimationFrame`) for smoother UX.
- Add a min-height reservation (measured once) to reduce layout jumps during the final re-render.

Expected outcome: no full-list unmount/repaint, no visual blink on stream completion.

## Status
- **Progress**: Use case view improvements completed; chat blink fix is a follow-up item
- **Progress**: Use case view improvements completed; chat blink fix implemented
- **Current**: Ready to push branch
- **Next**: Push to origin, then open/update PR


