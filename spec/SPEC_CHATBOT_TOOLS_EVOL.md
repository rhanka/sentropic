# Spec: Chatbot Tools Evolution (Draft)

## Scope
This document captures agreed evolutions for the chat tools, prompts, and multi-context behavior.
It is intended to be merged into `spec/SPEC_CHATBOT.md` and `spec/TOOLS.md`.

## Goals
- Support multi-context chat sessions with a clear focus context and historical contexts.
- Make document access explicit and consistent across session and view contexts.
- Align system prompting with the document access model and tool availability.
- Improve UX around session documents (attach, status, remove).

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

## Documents Availability Model
Documents available to the assistant depend on focus context, plus session documents.

### Always available (if present)
- Session documents attached to the current chat session.

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

## Prompt Structure (Centralized)
The chat system prompt must be centralized in `default_prompts` with a single base template and a context block.
The context block must include:
- Focus context type and id
- Historical contexts (ordered)
- Explicit statement of available documents by context (session + focus-derived)
- Rule: prioritize focus context; use historical contexts only if needed

## UI/UX Requirements
- The chat input shows a file widget per attached document (multi-file).
- Each widget displays filename and status (uploading/processing/ready/failed).
- Each widget includes a remove (X) action to delete the document.
- The attach control is a single paperclip button (ChatGPT/Gemini style).

## Testing Notes
- Ensure tool listing reflects document context origin.
- Verify document availability on focus/historical contexts.
- Verify session documents are usable by tools immediately after upload.
