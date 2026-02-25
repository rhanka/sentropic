## Functional specification (use cases CU)

> **Summary:** 22 use cases identified (CU-001 to CU-022) covering: object modifications, history, streaming reasoning, replay, context management, model switching, deepening, structured calls vs informal sessions, object creation via chat, consultation/search, cancellation/rollback, multi‑context, suggestions, export/sharing, session management, view integration, long context, validation/confirmation, queue integration, notifications/feedback, error handling, and document context.

- [x] **CU-001: Modify existing objects via chat** (use case only)
  - [x] Modify `use_cases.data.*` via tool `update_usecase_field`
  - [x] Tool `read_usecase` to read the current state
  - [ ] Modify `folders` (coming)
  - [ ] Modify `organizations` (coming)
  - [ ] Modify `executive_summary` (coming)
  - [ ] Modify via full regeneration (coming)
  - [ ] The AI can modify multiple objects in the same session (coming)
- [x] **CU-002: History and traceability** (partial: prompts in settings, no prompts/prompt_versions tables)
  - [x] Each object is associated with its full history (initial generation, regeneration, interactive sessions)
  - [x] Each AI action is stored with the prompt_id used (from settings.prompts JSON)
  - [x] `context_modification_history` stores all modifications
  - [x] `chat_contexts` stores before/after snapshots
  - [x] `chat_stream_events` stores full reasoning
  - [ ] Tables `prompts` and `prompt_versions` (prompts currently in `settings.prompts` JSON)
- [x] **CU-003: Streaming reasoning display**
  - [x] AI reasoning steps are displayed in real time during generation
  - [x] Reasoning is streamed via PostgreSQL LISTEN/NOTIFY and displayed in the UI
  - [x] Full reasoning is stored for later replay
- [x] **CU-004: Session replay (display)**
  - [x] Ability to replay a full session to see how the conversation evolved
  - [x] Messages display reasoning, tool calls, and modifications
  - [x] Endpoints `GET /api/v1/chat/sessions/:id/stream-events` (batch) and `GET /api/v1/chat/messages/:id/stream-events`
- [x] **CU-005: Context and history in sessions** (partial: use case only)
  - [x] `primaryContextType` and `primaryContextId` in `chat_sessions`
  - [x] Automatic context detection from the route (UI)
  - [x] Tool `read_usecase` to access the current state
  - [x] Tool `update_usecase_field` to modify
  - [ ] Access to object modification history (via tools) (coming)
  - [ ] Context summary when too long (coming)
- [x] **CU-006: Language model switch in sessions**
  - [x] Model used for each message stored in `chat_messages.model`
  - [x] User can change provider/model mid‑session (OpenAI/Gemini)
  - [x] User can specify the model for the next response
  - [x] New conversations initialize from user default model (`/api/v1/me/ai-settings`), with admin fallback when user setting is absent
  - [x] Edit/retry uses the current composer model selection
- [ ] **CU-007: Deepen with a higher‑tier model**
  - [ ] User can request deeper analysis with a higher‑tier model
  - [ ] System can suggest using a higher‑tier model
- [x] **CU-008: Structured AI calls (managed prompts)** (partial: streaming works, no structured_generation_runs table)
  - [x] Classic generations use streaming (`executeWithToolsStream`)
  - [x] Events in `chat_stream_events` with `message_id=null`
  - [x] Deterministic `streamId`: `folder_<folderId>`, `usecase_<useCaseId>`, `organization_<organizationId>`
  - [x] Display in object views via `StreamMessage` (jobs)
  - [ ] Table `structured_generation_runs` (not created)
  - [ ] Tables `prompts`/`prompt_versions` (prompts in `settings.prompts` JSON)
- [ ] **CU-009: Object creation via chat**
  - Users cannot create new objects directly via chat (no direct creation)
  - AI can suggest object creation based on the conversation (suggestion only)
  - Create/delete/move operations are done via tools in chat
- [x] **CU-010: Consultation and search (chat history navigation)** (partial: consultation via tools)
  - [x] User can consult object details via chat (tool `read_usecase`)
  - [x] Tool `web_search` for searching information
  - [x] Tool `web_extract` to extract content from references
  - [ ] Text search in session history
  - [ ] Search in object modifications
- [ ] **CU-011: Cancellation and rollback**
  - [x] Snapshots `snapshot_before` and `snapshot_after` in `chat_contexts` (infrastructure ready)
  - [ ] User can cancel an in‑progress modification before it is applied
  - [ ] Rollback system to return to a previous object state
  - [ ] Comparison between two object versions (visual diff)
- [ ] **CU-012: Multi‑context in a session**
  - [x] One main context per session (`primaryContextType`, `primaryContextId`)
  - [x] Active context(s) passed per message (`contexts` array)
  - [x] Tools allowed on the union of active contexts
  - [x] UI provisional context (visible before send, persisted only if used)
  - [ ] A session can modify several different objects
  - [ ] AI can understand hierarchical relations between objects
- [ ] **CU-013: Suggestions and recommendations**
  - AI can suggest improvements on request (not proactive)
  - AI can detect inconsistencies and propose corrections on request
  - AI can suggest similar or complementary use cases on request
  - Suggestions are explicit in the conversation (not implicit)
- [ ] **CU-014: Export and sharing**
  - Export a chat session (JSON, Markdown, PDF) — secondary feature
  - Share sessions between users (collaboration)
  - Export object modification history for audit — secondary feature
  - Exports include full reasoning for traceability
- [x] **CU-015: Session management** (partial: create/delete)
  - [x] A user can have multiple active sessions for the same object
  - [x] Session deletion (`DELETE /api/v1/chat/sessions/:id`)
  - [x] Auto‑generated session title (AI, SSE)
  - [ ] Resume an interrupted session (after disconnect)
  - [ ] Rename sessions for organization
- [x] **CU-016: Display in existing views** (partial: streaming visible in QueueMonitor)
  - [x] Real‑time streaming via SSE shown in QueueMonitor
  - [x] Unified `StreamMessage` for chat and jobs
  - [ ] "History" tab in object views (folder, use case, organization)
  - [ ] List sessions that modified the object
  - [ ] Direct link from an object to the latest session
  - [ ] Visual indicator (badge/icon) on objects modified via chat
- [ ] **CU-017: Long‑context management**
  - Token limit for context sent to AI (depends on model)
  - Automatic context summary when session is too long (future feature)
  - Manual selection of messages to include in context (secondary feature)
  - Persistent "memory" system for objects (summary of important changes)
- [ ] **CU-018: Validation and confirmation**
  - [x] Changes applied directly (no confirmation)
  - [ ] Explicit confirmation before applying a change ("Apply" button)
  - [ ] Preview of changes before application (visual diff)
  - [ ] "Auto‑apply" mode for minor changes and confirmation for major ones
- [x] **CU-019: Integration with existing queue** (partial: chat jobs in queue)
  - [x] Chat generations use the same queue (`job_queue`)
  - [x] Queue status displayed in chat UI (QueueMonitor)
  - [ ] Different priority for chat generations
  - [ ] Chat generations cancellable via the queue
- [x] **CU-020: Notifications and feedback** (partial: SSE notifications)
  - [x] Real‑time notifications via SSE (events `usecase_update`, etc.)
  - [x] Automatic UI refresh after modification
  - [x] Session title notification (`chat_session_title_updated`)
  - [ ] Toast/badge for visual notifications
  - [ ] User feedback on AI suggestion quality (👍/👎)
- [x] **CU-021: Error handling** (partial: errors displayed)
  - [x] Error messages in stream (`error` event)
  - [x] Error display in `StreamMessage`
  - [ ] Automatic retry with correction for recoverable errors
  - [ ] Clear error messages with fix suggestions
- [ ] **CU-022: Document context attached to objects**
  - [ ] Attach one or more documents to an organization, folder, or use case
  - [ ] Upload with automatic summary (0.1k token/page)
  - [ ] Consult metadata and summary

## Model runtime baseline (OpenAI + Gemini) — delivered

- Runtime model catalog is exposed by `GET /api/v1/models/catalog` and consumed by grouped selectors in:
  - chat composer,
  - user settings (`/settings`),
  - folder generation (`/folder/new`).
- User-level defaults are managed by:
  - `GET /api/v1/me/ai-settings`,
  - `PUT /api/v1/me/ai-settings`.
- Storage strategy (delivered):
  - existing `settings` table extended with nullable `user_id` (FK `users.id`) for scoped KV entries,
  - admin/global settings remain in rows with `user_id IS NULL`,
  - user defaults are persisted with keys:
    - `default_provider_id`,
    - `default_model`,
  - uniqueness constraints are scoped:
    - global uniqueness on `key` when `user_id IS NULL`,
    - per-user uniqueness on `(user_id, key)` when `user_id IS NOT NULL`.
- Effective default chain:
  1. user scoped default,
  2. admin/workspace default,
  3. hard fallback (`openai` + `gpt-4.1-nano`).
- Conversation behavior:
  - model selection is sticky per conversation when reopening,
  - new conversation starts from current effective user default.
- Structured generation behavior:
  - `/folder/new` can override model per run without mutating user defaults.
- Active user-facing catalog is intentionally reduced to four entries:
  - `gpt-4.1-nano`,
  - `gpt-5.2`,
  - `gemini-2.5-flash-lite`,
  - `gemini-3.1-pro-preview-customtools`.
- Gemini-specific runtime/UI compatibility:
  - UI smooth pseudo-streaming for larger chunk deltas,
  - provider-side schema compatibility compiler before Gemini structured calls (unsupported keywords removed),
  - one-shot structured JSON repair retry using `defaultPrompts.structured_json_repair`.
- Settings save propagation:
  - saving user defaults triggers a browser event to refresh new-conversation defaults immediately (no page reload).
- Display normalization:
  - long Gemini model IDs are compacted for badges (example: `gemini-3.1`).

## Admin scoped chat (Chat‑1 + read‑only)

Decision (linked to workspace sharing model):

- Admin **remains the owner** of their sessions (no access to user chat history).
- When admin is **scoped** to a shared user workspace (`shareWithAdmin=true`):
  - chat can **read** workspace data (e.g., `read_usecase`, reference reading),
  - chat must be **read‑only** for writes (e.g., `update_usecase_field` forbidden).

Expected implementation:

- Store scope in `chat_sessions.workspace_id`.
- Server computes a `readOnly` flag based on:
  - user role
  - current workspace scope
  - `shareWithAdmin` of the target workspace

## Streaming OpenAI → DB → NOTIFY → SSE

- [x] Transport: OpenAI streaming call on API/worker (Hono). Each chunk is written to `chat_stream_events` then a `NOTIFY` (minimal payload: `stream_id`, `sequence`, optionally `event_type`) signals new data. SvelteKit UI (static SPA) consumes a global SSE endpoint `GET /api/v1/streams/sse` subscribed to PG NOTIFY; no direct OpenAI → SSE forwarding. WebSocket optional later, SSE by default.
- [x] Stream identifiers: `stream_id` = `message_id` for informal sessions; for structured calls `stream_id` = `folder_<folderId>`, `usecase_<useCaseId>`, `organization_<organizationId>` (deterministic per entity).
- [x] Events stored in `chat_stream_events` (ordered by `sequence` on `stream_id`), `message_id` nullable for structured calls.

Event types (JSON payload, key `type` + `data`):
- `reasoning_delta`: `{ delta: string }` (reasoning tokens)
- `content_delta`: `{ delta: string }` (assistant tokens)
- `tool_call_start`: `{ tool_call_id, name, args }`
- `tool_call_delta`: `{ tool_call_id, delta }`
- `tool_call_result`: `{ tool_call_id, result }`
- `status`: `{ state: 'started' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled', job_id? }`
- `error`: `{ code?, message }`
- `done`: `{}` (end of stream)

Persisted:
- `chat_stream_events`: `stream_id`, `message_id` (nullable), `event_type`, `data`, `sequence`.
- `structured_generation_runs`: `stream_id`, `status`, `job_id`, `prompt_version_id`, `context_type/id`, timestamps.
- PG LISTEN/NOTIFY: used only as a real‑time signal (no storage). The full payload stays in the DB (`chat_stream_events`). If NOTIFY payload exceeds 8k, send only a pointer (`stream_id`, `sequence`) and the SSE re‑loads the event from the DB.

Rules:
- Sequence strictly increasing per `stream_id`.
- `status.started` at stream open, `done` or `error` closes.
- Tool calls: `tool_call_start`, then zero or more `tool_call_delta`, then `tool_call_result`.
- Reasoning/content deltas can alternate; UI aggregates.

## Chat tracing (debug) — 7 days (20–30 lines)

Goal: debug “agent” issues (tool loops, malformed payloads, context loss) by storing **the exact payload sent to OpenAI** and the tool calls executed.

Activation (env):
- `CHAT_TRACE_ENABLED=true|false`
- `CHAT_TRACE_RETENTION_DAYS=7` (default 7)

Storage (DB):
- Table `chat_generation_traces`:
  - identifiers: `session_id`, `assistant_message_id`, `user_id`, `workspace_id`
  - `phase` (`pass1`/`pass2`), `iteration`, `model`, `tool_choice`
  - `tools` (**full definitions**: description + schema)
  - `openai_messages` / `input` (**exact payload**) + `previous_response_id` when applicable
  - `tool_calls` (args + results)
  - `meta` (callSite, readOnly flags, etc.)

Purge:
- sweep once at startup then every 24h
- delete traces older than `CHAT_TRACE_RETENTION_DAYS`

Useful SQL:

```sql
SELECT phase, iteration, model, tool_choice, created_at
FROM chat_generation_traces
WHERE assistant_message_id = '<messageId>'
ORDER BY created_at ASC;
```

## UI components & streaming (SvelteKit)

- [x] **Key components implemented**:
  - [x] `StreamMessage.svelte`: unified chat/jobs component, shows ongoing reasoning, generated content, and tool call sub‑sections (start/deltas/result)
  - [x] `ChatWidget.svelte`: global floating widget (bubble + panel) with Chat ↔ QueueMonitor switch
  - [x] `ChatPanel.svelte`: sessions + messages + composer
  - [x] `QueueMonitor.svelte`: job list with streaming
  - [x] Streaming history: reconstructed from `chat_stream_events` for replay (via `historySource="chat"` or `historySource="stream"`)
  - [ ] `DiffViewer.svelte`: before/after for objects (coming)
  - [ ] Control bar: model selection, stop/cancel (coming)

- [x] **Simplified architecture**: components integrated in the app instead of a standalone module. `StreamMessage` unifies chat and jobs.

- [x] **Global SSE**: single endpoint `GET /api/v1/streams/sse` with client‑side filtering by `streamId` (instead of per‑stream endpoints).

## Technical architecture (queue + PG LISTEN/Notify)

- [x] **Happy path (informal session)**:
  1. `POST /api/v1/chat/messages` → creates `chat_message` (user), starts OpenAI stream (assistant) via `chat_message` job in queue
  2. Streaming → push `chat_stream_events` (+ NOTIFY); global SSE reads on `stream_id` (client filtering)
  3. Optional tool call → execution, then `context_modification_history` + snapshots in `chat_contexts`
  4. End: `done` + status update (message/stream)

- [x] **Structured calls path (classic generations)**:
  1. Classic generations (use_case_list, use_case_detail, executive_summary, organization_enrich) → queued job
  2. Worker runs OpenAI stream → writes `chat_stream_events` (message_id null) with deterministic `streamId` (`folder_<id>`, `usecase_<id>`, etc.)
  3. Modifications → `context_modification_history` (`session_id` null for classic generations)
  4. NOTIFY → SSE client subscribed to `stream_id` via global endpoint

- [ ] **Cancellation / errors**:
  - [x] `error` event sent, UI propagation
  - [ ] Cancellation via `job_id` (cancel queue + stop stream)

- [x] **Indexes/constraints**:
  - [x] `chat_stream_events(stream_id, sequence)` unique
  - [ ] `structured_generation_runs` (table not created)

## Data model

### Database schema

The chatbot data model enables:
- Manage user chat sessions
- Link sessions to business objects (organizations, folders, usecases, executive_summary)
- Store full message history with reasoning
- Track object modifications via sessions
- Allow session replay
- Stream responses in real time via PostgreSQL LISTEN/NOTIFY

#### Context document tables (to add)
- `context_documents`: id, context_type (organization|folder|usecase), context_id, filename, mime_type, size_bytes, storage_key (S3/MinIO), status (`uploaded|processing|ready|failed`), summary, summary_lang, prompt_id/prompt_version_id for the summary, created_at/updated_at, version.
- `context_document_versions` (optional): file/summary history (document_id, version, summary, storage_key, created_at).
- Traceability: `document_added` / `document_summarized` events in `context_modification_history` (with summary prompt_version_id and summary job_id).

### ERD diagram

See `spec/DATA_MODEL.md` (section **Chat / streaming / tracing**): the ERD is centralized there to avoid duplication and stay aligned with `api/src/db/schema.ts`.

### Main tables

#### Created tables ✅
- [x] `chat_sessions`
- [x] `chat_messages`
- [x] `chat_contexts`
- [x] `chat_stream_events`
- [x] `context_modification_history`

#### Planned tables (not created)
- [ ] `structured_generation_runs` (classic generations tracked via `chat_stream_events` with `message_id=null`)
- [ ] `prompts` (prompts currently in `settings.prompts` JSON)
- [ ] `prompt_versions` (prompts currently in `settings.prompts` JSON)
- [ ] `context_documents` (planned Lot B)

#### `chat_sessions`
Main table for user chat sessions.

**Columns:**
- `id` (PK): unique session identifier
- `user_id` (FK → users.id): session owner user
- `primary_context_type`: primary context type ('organization' | 'folder' | 'usecase' | 'executive_summary')
- `primary_context_id`: primary object ID (query helper)
- `title`: session title (can be auto‑generated)
- `created_at`: creation date
- `updated_at`: last update

**Indexes:**
- `chat_sessions_user_id_idx`: on `user_id`
- `chat_sessions_primary_context_idx`: on `primary_context_type, primary_context_id`

#### `chat_messages`
Conversation messages (user and assistant).

**Columns:**
- `id` (PK): unique message ID
- `session_id` (FK → chat_sessions.id): session the message belongs to
- `role`: message role ('user' | 'assistant' | 'system' | 'tool')
- `content`: text content (nullable for tool calls)
- `contexts` (JSONB): contexts associated with the message (array `{ contextType, contextId }`)
- `tool_calls` (JSONB): tools called (array of OpenAI tool calls)
- `tool_call_id`: tool call ID if this message is a tool result
- `reasoning`: reasoning tokens (for models with reasoning like o1)
- `model`: OpenAI model used for this response
- `prompt_id`: prompt ID used (references prompts in settings)
- `prompt_version_id` (FK → prompt_versions.id): precise prompt version used (nullable for informal sessions)
- `sequence`: message order in the conversation
- `created_at`: creation date

**Indexes:**
- `chat_messages_session_id_idx`: on `session_id`
- `chat_messages_sequence_idx`: on `session_id, sequence`
- `chat_messages_prompt_version_idx`: on `prompt_version_id`

#### `chat_contexts`
Join table between chat sessions and modified business objects.

**Columns:**
- `id` (PK): unique identifier
- `session_id` (FK → chat_sessions.id): session that modifies the object
- `context_type`: object type ('organization' | 'folder' | 'usecase' | 'executive_summary')
- `context_id`: modified object ID
- `snapshot_before` (JSONB): object state before modification (for compare/revert)
- `snapshot_after` (JSONB): object state after modification
- `modifications` (JSONB): details of changed fields and values
- `modified_at`: last modification date
- `created_at`: creation date

**Indexes:**
- `chat_contexts_session_id_idx`: on `session_id`
- `chat_contexts_context_idx`: on `context_type, context_id`
- `chat_contexts_context_type_id_idx`: on `context_type, context_id` (composite)

**Relations:**
- `context_type='organization'` + `context_id` → reference `organizations.id`
- `context_type='folder'` + `context_id` → reference `folders.id`
- `context_type='usecase'` + `context_id` → reference `use_cases.id`
- `context_type='executive_summary'` + `context_id` → reference `folders.id` (executive_summary lives in folders)

#### `chat_stream_events`
Real‑time streaming events for each message or structured call.

**Columns:**
- `id` (PK): unique identifier
- `message_id` (FK → chat_messages.id, nullable): associated message (nullable for structured calls)
- `stream_id`: stream identifier (message_id for sessions, `folder_<folderId>`, `usecase_<useCaseId>`, `organization_<organizationId>` for structured calls)
- `event_type`: event type ('content_delta' | 'reasoning_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_result' | 'status' | 'error' | 'done')
- `data` (JSONB): event data (delta, tool call, etc.)
- `sequence`: event order for this stream
- `created_at`: creation date

**Indexes:**
- `chat_stream_events_message_id_idx`: on `message_id`
- `chat_stream_events_stream_id_idx`: on `stream_id`
- `chat_stream_events_sequence_idx`: on `stream_id, sequence`

**Usage:**
- Event storage for replay (informal sessions and structured calls)
- Notifications via PostgreSQL NOTIFY for real‑time streaming
- Reconstruct full response stream
- **Note**: for structured calls, `message_id` is null and `stream_id` is deterministic per entity (`folder_<id>`, `usecase_<id>`, etc.)

#### `context_modification_history`
Detailed history of all object modifications (all sessions combined).

**Columns:**
- `id` (PK): unique identifier
- `context_type`: modified object type ('organization' | 'folder' | 'usecase' | 'executive_summary')
- `context_id`: modified object ID
- `session_id` (FK → chat_sessions.id): session that modified (nullable if not session‑linked)
- `message_id` (FK → chat_messages.id): message that triggered modification (nullable)
- `field`: modified field name (e.g., 'name', 'description', 'data.value_scores')
- `old_value` (JSONB): old value
- `new_value` (JSONB): new value
- `tool_call_id`: tool call ID if modification via tool
- `prompt_id`: prompt ID used for this modification (required for structured calls)
- `prompt_type`: prompt type for structured calls ('organization_info' | 'folder_name' | 'use_case_list' | 'use_case_detail' | 'executive_summary') — nullable for informal sessions
- `prompt_version_id` (FK → prompt_versions.id): exact prompt version used (required for structured calls)
- `job_id` (FK → job_queue.id): generation job (structured calls)
- `sequence`: modification order for this object
- `created_at`: creation date

**Indexes:**
- `context_modification_history_context_idx`: on `context_type, context_id`
- `context_modification_history_session_id_idx`: on `session_id`
- `context_modification_history_sequence_idx`: on `context_type, context_id, sequence`

**Usage:**
- Full history of object modifications
- Traceability of changes by session (`session_id` not null) or by structured call (`session_id` null)
- See object evolution over time

**Structured calls vs informal sessions:**
- **Structured calls**: `session_id = null`, `prompt_id` required, `prompt_type` and `prompt_version_id` set, `job_id` set if orchestrated via queue
  - These are existing classic generations (e.g., `/api/v1/use-cases/generate`, `/api/v1/organizations/ai-enrich`)
  - Prompt types: 'organization_info', 'folder_name', 'use_case_list', 'use_case_detail', 'executive_summary'
  - Single calls with a fixed system prompt, tracked directly in `context_modification_history` and `structured_generation_runs`
  - No chat session associated, no messages in `chat_messages` (unless triggered from a session: `message_id` remains nullable)
  - Streaming/reasoning tracked via `chat_stream_events` with specific identification (shared model with informal sessions)
  - Display in object views: expandable tool with specific title (e.g., "Use case list generation")
  - Integration in sessions: via tool if the AI chooses it (not by default)
- **Informal sessions**: `session_id` not null, `prompt_id` optional, `prompt_type` and `prompt_version_id` null
  - Freeform conversations with AI, tracked in `chat_sessions` and `chat_messages`
  - Modifications via tools in the conversation context

#### `prompts` (not created, prompts in `settings.prompts` JSON)
Planned table for managed prompts used by structured AI calls (classic generations).

**Current state**: prompts are stored in `settings.prompts` (JSON). The `prompts` table will normalize and track version history.

**Prompt → object mapping:**
- `organization_info` → modifies `organizations` (`name` + `data.*`: industry, size, products, processes, kpis, challenges, objectives, technologies, references)
- `folder_name` → modifies `folders` (name, description)
- `use_case_list` → creates multiple `use_cases` (name, description in JSONB data)
- `use_case_detail` → modifies `use_cases` (all fields in JSONB data + scoring)
- `executive_summary` → modifies `folders.executive_summary`

#### `prompt_versions` (not created)
Planned table for version history of each prompt for full traceability.

#### `structured_generation_runs` (not created)
Planned table for operational traceability of a structured call (classic generation) and its execution.

**Current state**: classic generations are tracked via `chat_stream_events` with `message_id=null` and deterministic `streamId`. Status is managed via `job_queue`.

### Relations with existing business objects

#### Organizations
- **Relation**: `chat_contexts.context_type='organization'` + `context_id=organizations.id`
- **Possible modifications**: `organizations.name` + profile fields in `organizations.data` (industry, size, products, processes, kpis, challenges, objectives, technologies, references)
- **History**: stored in `context_modification_history` with `context_type='organization'`

#### Folders
- **Relation**: `chat_contexts.context_type='folder'` + `context_id=folders.id`
- **Possible modifications**: name, description, matrix_config, executive_summary
- **History**: stored in `context_modification_history` with `context_type='folder'`
- **Note**: `executive_summary` is stored in `folders.executive_summary` but can be treated as a separate context (`context_type='executive_summary'`)

#### Use Cases
- **Relation**: `chat_contexts.context_type='usecase'` + `context_id=use_cases.id`
- **Possible modifications**: all fields in `use_cases.data` (JSONB): name, description, problem, solution, domain, technologies, valueScores, complexityScores, etc.
- **History**: stored in `context_modification_history` with `context_type='usecase'`
- **Note**: modifications to JSONB `data` fields are tracked with `field` like 'data.name', 'data.valueScores', etc.

### Usage examples

#### Create a session to modify a folder
```typescript
const sessionId = await createChatSession({
  userId: 'user-123',
  contextType: 'folder',
  contextId: 'folder-456',
  title: 'Modify AI Manufacturing folder'
});
```

#### Send a message and stream the response
```typescript
const { messageId, streamPromise } = await sendChatMessage({
  sessionId: 'session-789',
  content: 'Can you improve the description of use case X?',
  model: 'o1-preview',
  promptId: 'use_case_detail'
});

// Listen to streaming events
const eventSource = new EventSource(`/api/v1/chat/stream/${messageId}`);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'reasoning_delta') {
    console.log('Reasoning:', data.data.delta);
  } else if (data.type === 'content_delta') {
    console.log('Content:', data.data.delta);
  }
};
```

#### Retrieve use case modification history
```typescript
const history = await db
  .select()
  .from(contextModificationHistory)
  .where(
    and(
      eq(contextModificationHistory.contextType, 'usecase'),
      eq(contextModificationHistory.contextId, 'usecase-123')
    )
  )
  .orderBy(contextModificationHistory.sequence);
```

#### Replay a full session
```typescript
const replay = await replayChatSession('session-789');
// Returns all messages with content, reasoning, tool calls, etc.
```

### Prompt integration

**Current state**: prompts are stored in `settings.prompts` (JSON). Tables `prompts` and `prompt_versions` are not created yet.

**Available prompt types (structured calls):**

| `prompt_id` | `prompt_type` | Generated object | Description |
|-------------|---------------|------------------|-------------|
| `organization_info` | `organization_info` | `organizations` | Organization enrichment (`name` + `data.*`: industry, size, products, processes, kpis, challenges, objectives, technologies, references) |
| `folder_name` | `folder_name` | `folders` | Folder name and description generation |
| `use_case_list` | `use_case_list` | `use_cases` (multiple) | Use case list generation (title + description) |
| `use_case_detail` | `use_case_detail` | `use_cases` (detail) | Detailed use case generation with scoring (JSONB data) |
| `executive_summary` | `executive_summary` | `folders.executive_summary` | Full executive summary generation for a folder |

### Data flows

#### Informal sessions (chat)
1. **Session creation** → `chat_sessions` + `chat_contexts`
2. **Message send** → `chat_messages` (user) + streaming → `chat_messages` (assistant) + `chat_stream_events`
3. **Object modification via tool** → `context_modification_history` (with `session_id`) + object update (organizations/folders/use_cases)
4. **Real‑time notification** → PostgreSQL NOTIFY → client via SSE
5. **Replay** → `chat_stream_events` to rebuild the stream
6. **History** → `context_modification_history` to see all object modifications

#### Structured calls (classic generations)
1. **Structured AI call** → OpenAI call with fixed system prompt (e.g., `use_case_detail`, `organization_info`, `folder_name`, `use_case_list`, `executive_summary`)
2. **Prompt used** → reference in `settings.prompts` JSON (tables `prompts`/`prompt_versions` not created)
3. **Streaming** → `chat_stream_events` (with `message_id=null`, `stream_id` = `folder_<folderId>`, `usecase_<useCaseId>`, `organization_<organizationId>` — deterministic per entity)
4. **Run traceability** → via `job_queue` and `chat_stream_events` (table `structured_generation_runs` not created)
5. **Object modification** → `context_modification_history` (with `session_id=null` for classic generations) + object update
6. **Real‑time notification** → PostgreSQL NOTIFY → client via global SSE (same mechanism)
7. **History** → `context_modification_history` for all modifications (structured calls + sessions)

#### Context documents
1. **Upload** → POST `/api/documents` (context_type/id, file) → S3/MinIO storage, `context_documents` record (status=uploaded)
2. **Auto summary** → “document_summary” queue job launched immediately (versioned summary prompt, 0.1k token/page, configurable language, default FR) → update `context_documents` (status=processing→ready/failed, summary, prompt_version_id, job_id) + event `document_summarized`
3. **Consultation** → GET `/api/documents?context_type=&context_id=` + GET `/api/documents/:id` (metadata + summary); no rich viewer (simple download via GET `/api/documents/:id/content` if needed)
4. **Notifications** → AI is notified on upload for acknowledgement; any use‑case processing depending on the doc waits for status ready (summary available)
5. **Traceability** → `context_modification_history` events `document_added` / `document_summarized` with `prompt_version_id` and `job_id`

## Technical impact study (API/UI/DB/queue anchor)

- [x] **Database**:
  - [x] Main schema: `api/src/db/schema.ts` with tables `chat_sessions`, `chat_messages`, `chat_contexts`, `chat_stream_events`, `context_modification_history`
  - [x] Index/constraint: `chat_stream_events(stream_id, sequence)` unique; `chat_contexts` snapshots
  - [ ] Tables `prompts`, `prompt_versions`, `structured_generation_runs` (not created, prompts in `settings.prompts` JSON)

- [x] **Queue**:
  - [x] `chat_message` jobs in queue
  - [x] Classic generations via queue with streaming
  - [ ] Cancellation via queue (to finalize)

- [x] **API (Hono)**:
  - [x] Router `api/src/routes/api/chat.ts` mounted in `api/src/routes/api/index.ts`
  - [x] Endpoints: `POST /api/v1/chat/messages`, `GET /api/v1/chat/sessions`, `GET /api/v1/chat/sessions/:id/messages`, `GET /api/v1/chat/sessions/:id/stream-events`, `GET /api/v1/chat/messages/:id/stream-events`, `DELETE /api/v1/chat/sessions/:id`
  - [x] Global SSE endpoint: `GET /api/v1/streams/sse`
  - [x] History endpoint: `GET /api/v1/streams/events/:streamId`
  - [x] Services: `chat-service.ts`, `stream-service.ts`, `tool-service.ts`
  - [ ] Document routes (planned Lot B)

- [x] **Backend streaming**:
  - [x] Global SSE handler (`GET /api/v1/streams/sse`), PG LISTEN/NOTIFY subscriptions
  - [x] `chat_stream_events` writes during stream + NOTIFY with minimal payload

- [x] **UI (SvelteKit)**:
  - [x] Integrated components: `ChatWidget.svelte`, `ChatPanel.svelte`, `StreamMessage.svelte`, `QueueMonitor.svelte`
  - [x] Global chat available everywhere via `+layout.svelte`
  - [x] Automatic context detection from the route
  - [ ] "Documents" block on object pages (planned Lot B)

- [x] **Tests**:
  - [x] API unit tests (SSE aggregation, tool calls)
  - [x] API integration tests (chat endpoints, streams, tool calls)
  - [x] UI unit tests (`streamHub` store)
  - [x] Playwright E2E tests (chat/stream/tool‑calls)

## Value‑oriented lots (deliverable workplan)

### Lot A — "Targeted update of an object" ✅ Done (functional + tests)

**Value**: client demo from the first increment. The AI proposes and applies a targeted improvement on an existing business object with real‑time reasoning and traceability.

**Functional scope**: update `use_cases.data.*` via tool `update_usecase_field` (use case only).

**Implemented**:
- [x] API: POST `/api/v1/chat/messages` (informal chat) + global SSE `/api/v1/streams/sse`
- [x] Tools: `read_usecase`, `update_usecase_field`, `web_search`, `web_extract`
- [x] Rehydration: GET `/api/v1/chat/sessions/:id/stream-events` (batch) and GET `/api/v1/chat/messages/:id/stream-events`
- [x] UI: `ChatWidget` (bubble + panel), `ChatPanel` (sessions + messages), `StreamMessage` (reasoning + content + tools)
- [x] Automatic context detection from the route
- [x] Data: `chat_stream_events` filled (reasoning/content/tools), `context_modification_history` written for update, snapshots in `chat_contexts`
- [x] Automatic UI refresh after modification (SSE events)
- [x] API unit tests (`stream-service`, `tool-service`, `tools`)
- [x] API integration tests (chat endpoints, streams, tool calls)
- [x] UI unit tests (`streamHub` store)
- [x] Playwright E2E tests (chat, tool calls, AI generation)

**Coming**:
- [ ] Extend to other objects (folder, organization, executive_summary)

**CU coverage**: CU-001 (use case), CU-002 (partial), CU-003, CU-004, CU-005 (use case), CU-010 (partial), CU-015 (partial), CU-016 (partial), CU-019 (partial), CU-020 (partial), CU-021 (partial)

### Lot B — "Document context (ingestion + summary + consultation)"

**Value**: attach documents to objects (organization/folder/usecase), automatically summarize (0.1k token/page, configurable language, default FR), consult summary and status.

**CU coverage**: CU-022

**Implemented (partial)**:
- [x] Chat session documents (upload/list/delete, auto summary, tool `documents`).

**To implement**:
- [ ] API: POST `/api/documents` (upload + context_type/id); GET `/api/documents?context_type=&context_id=` (list); GET `/api/documents/:id` (meta+summary); GET `/api/documents/:id/content` (download)
- [ ] "document_summary" queue job triggered on upload; status in `context_documents`; events `document_added` / `document_summarized`
- [ ] Tables `context_documents` (+ optional `context_document_versions`); S3/MinIO storage
- [ ] UI: "Documents" block on object pages (folders, use cases, organizations): upload, list, status, summary
- [ ] Tests: Unit/int/E2E for upload → summary job → ready/failed status

### Lot C — "Parallel tool‑calls and structured calls"

**Value**: run multiple actions in parallel, see status/cancel/apply. Finalize structured call traceability.

**CU coverage**: CU-008 (finalization), CU-011 (cancellation), CU-012 (multi‑context), CU-019 (queue cancellation)

**Partially implemented**:
- [x] Parallel tool calls functional (iterative loop in `runAssistantGeneration`)
- [x] Tool call display in `StreamMessage` (accordion per tool_call_id)
- [x] Classic generations streamed via `chat_stream_events` (message_id null)

**To implement**:
- [ ] Table `structured_generation_runs` for full traceability
- [ ] Tables `prompts`/`prompt_versions` for prompt versioning
- [ ] Endpoint POST `/api/structured/:prompt_id` for dedicated structured calls
- [ ] Cancellation via queue (PATCH `/api/structured/:run_id/cancel`)
- [ ] Multi‑context in a session (multiple objects)
- [ ] **UndoBar**: "Undo" button + preview of last modification (via `context_modification_history` + `chat_contexts`), human confirmation option for ⚠️ actions
- [ ] Tests: Unit/int/E2E for parallel structured calls, cancellation

### Lot D — "Audit, diff and resilience"

**Value**: user can visualize diffs, rollback, UI integrated with theme, increased resilience.

**CU coverage**: CU-011 (rollback), CU-016 (History tab), CU-017 (long context), CU-018 (validation/confirmation)

**Infrastructure ready**:
- [x] Snapshots `snapshot_before` and `snapshot_after` in `chat_contexts`
- [x] SSE resync functional (via `historySource` and batch endpoints)

**To implement**:
- [ ] `DiffViewer` component to display before/after differences
- [ ] Rollback via snapshots (API + UI)
- [ ] "History" tab in object views (folder, use case, organization)
- [ ] List of sessions that modified the object
- [ ] Preview of changes before applying (visual diff)
- [ ] Explicit confirmation before applying a change ("Apply" button)
- [ ] Long context management (token limit, auto summary)
- [ ] Tests: Unit/int/E2E for diff/rollback, SSE resume

### Lot E — "Robustness + advanced features"

**Value**: full flow tested E2E, advanced features (model switch, suggestions, export, voice).

**CU coverage**: CU-006 (model switch), CU-007 (deepening), CU-009 (object creation), CU-013 (suggestions), CU-014 (export/sharing), CU-017 (long context), CU-020 (feedback), CU-021 (improved error handling)

**To implement**:
- [x] Model switch in sessions (UI + API)
- [ ] Deepen with higher‑tier model
- [ ] Object creation via chat (tools)
- [ ] Suggestions and recommendations (proactive AI)
- [ ] Export and sharing (JSON, Markdown, PDF)
- [ ] User feedback (👍/👎) on suggestions
- [ ] Automatic retry with correction for recoverable errors
- [ ] Voice extension: stub `audio_chunk` (event type) in SSE
- [ ] Tests: Unit/int/E2E covering a full flow (chat + structured + tool‑calls + rollback)
