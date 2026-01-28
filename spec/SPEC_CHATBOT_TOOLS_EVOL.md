# Spec: Chatbot Tools Evolution (Draft)

## Scope
This document captures agreed evolutions for the chat tools, prompts, and multi-context behavior.
It is intended to be merged into `spec/SPEC_CHATBOT.md` and `spec/TOOLS.md`.

## Goals
- Support multi-context chat sessions with a clear focus context and historical contexts.
- Make document access explicit and consistent across session and view contexts.
- Align system prompting with the document access model and tool availability.
- Improve UX around session documents (attach, status, remove).
- Allow viewers to interact with chat sessions while keeping update tools locked.

## Definitions
- **Focus context**: the view context at the moment the user sends a message.
- **Historical contexts**: previously used contexts during the session (ordered list).
- **Session documents**: documents attached to the chat session.
- **Context documents**: documents attached to business contexts (organization/folder/usecase).

## Multi-Context Session Behavior
1. When the user sends a message, the current view context becomes the **focus context**.
2. All prior contexts are preserved as **historical contexts**.
3. The assistant should prioritize the focus context but may consult historical contexts if needed.
4. The assistant must explicitly state when it uses a non-focus context.
5. The UI can send an explicit list of **active contexts** per message; tools and documents must be allowed across the union of these contexts.
6. Each user message stores its contexts in `chat_messages.contexts` (JSONB array) for traceability.

## Documents Availability Model
Documents available to the assistant depend on focus context, plus session documents.

### Always available (if present)
- Session documents attached to the current chat session.
- Documents attached to any active contexts sent by the UI (if multi‑context is enabled).

### Focus context: usecase
- Usecase documents
- Folder documents (parent folder)
- Organization documents (parent organization)

### Focus context: folder
- Folder documents
- Organization documents
- All usecase documents under the folder

### Focus context: organization
- Organization documents
- All folder documents under the organization
- All usecase documents under the organization

## Documents Tool Listing
`documents.list` must return for each document:
- `context_type`, `context_id` (origin context)
- `filename`, `status`, and summary availability
This allows the assistant to filter and target specific contexts when needed.

## Tool Access Rules
- By default, the assistant should start with `documents.list` on the **focus context** set plus session docs.
- If a document is **uploaded but not ready**, prefer `documents.analyze`.
- If a document is **ready and short**, `documents.get_content` is allowed.
- `documents.get_summary` remains blocked until the document is `ready`.
- Tool availability is filtered by the active contexts and explicit tool toggles from the UI.
- Update tools remain blocked in read‑only contexts (viewer role), even if read tools are allowed.

## Prompt Structure (Centralized)
The chat system prompt must be centralized in `default_prompts` with a single base template and a context block.
The context block must include:
- Focus context type and id
- Historical contexts (ordered)
- Explicit statement of available documents by context (session + focus-derived)
- Rule: prioritize focus context; use historical contexts only if needed
The prompt set includes:
- `chat_system_base` (base template with injected context/doc blocks)
- `chat_conversation_auto` (mini prompt for automation rules)
- `chat_session_title` (title generation prompt)

## Session Title Generation
- If a session has no title, a background job generates one from the first user message.
- Model: `gpt-4.1-nano`.
- The UI is updated via SSE event `chat_session_title_updated`.

## UI/UX Requirements
- The attach control is a single paperclip entry in the composer “+” menu.
- The menu lists contexts and tools with icon buttons (toggle active/inactive).
- Toggling contexts/tools is persisted per session in local storage.
- Context labels use object names/titles (no raw UUIDs in UI).
- The menu closes on outside click and after selecting an item.
- The chat input shows a file widget per attached document (multi‑file).
- Each widget displays filename and status (uploading/processing/ready/failed).
- Each widget includes a remove (X) action to delete the document.

## Testing Notes
- Ensure tool listing reflects document context origin.
- Verify document availability on focus/historical contexts.
- Verify session documents are usable by tools immediately after upload.
- Verify viewers can create sessions, send/retry messages, upload and delete session docs.
- Verify update tools remain disabled for viewer role.
- Verify session titles are generated and updated via SSE after the first user message.
