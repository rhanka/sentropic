# Data model (PostgreSQL 17 / Drizzle)

Source of truth: `api/src/db/schema.ts` (Drizzle).  
Conventions: tables in `snake_case`, primary keys `text` (UUID string), multi-tenant via `workspace_id` + `workspace_memberships` (private-by-default).

## Overview (tenancy + business objects)

```mermaid
erDiagram
    users ||--o{ workspaces : "owner_user_id (nullable)"
    users ||--o{ workspace_memberships : "user_id"
    workspaces ||--o{ workspace_memberships : "workspace_id"

    workspaces ||--o{ organizations : "workspace_id"
    workspaces ||--o{ folders : "workspace_id"
    workspaces ||--o{ use_cases : "workspace_id"
    workspaces ||--o{ job_queue : "workspace_id"
    workspaces ||--o{ comments : "workspace_id"
    workspaces ||--o{ extension_tool_permissions : "workspace_id"

    organizations ||--o{ folders : "organization_id (optional)"
    folders ||--o{ use_cases : "folder_id"
    organizations ||--o{ use_cases : "organization_id (optional)"
    users ||--o{ comments : "created_by"
    users ||--o{ comments : "assigned_to (optional)"
    comments ||--o{ comments : "thread_id"
    users ||--o{ extension_tool_permissions : "user_id"

    workspaces {
        text id PK
        text owner_user_id "FK users.id (nullable)"
        text name
        timestamp hidden_at
        timestamp created_at
        timestamp updated_at
    }

    workspace_memberships {
        text workspace_id FK
        text user_id FK
        text role
        timestamp created_at
    }

    users {
        text id PK
        text email "unique"
        text display_name
        text role
        text account_status
        timestamp approval_due_at
        timestamp approved_at
        text approved_by_user_id "self-FK users.id (nullable)"
        timestamp disabled_at
        text disabled_reason
        boolean email_verified
        timestamp created_at
        timestamp updated_at
    }

    organizations {
        text id PK
        text workspace_id FK
        text name
        text status
        jsonb data
        timestamp created_at
        timestamp updated_at
    }

    folders {
        text id PK
        text workspace_id FK
        text organization_id "FK organizations.id (nullable)"
        text name
        text description
        text matrix_config
        text executive_summary
        text status
        timestamp created_at
    }

    use_cases {
        text id PK
        text workspace_id FK
        text folder_id FK
        text organization_id "FK organizations.id (nullable)"
        text status
        text model
        jsonb data
        timestamp created_at
    }

    job_queue {
        text id PK
        text type
        text status
        text workspace_id FK
        text data
        text result
        text error
        timestamp created_at
        text started_at
        text completed_at
    }

    object_locks {
        text id PK
        text workspace_id FK
        text object_type
        text object_id
        text locked_by_user_id FK
        timestamp locked_at
        timestamp expires_at
        timestamp unlock_requested_at
        text unlock_requested_by_user_id "FK users.id (nullable)"
        text unlock_request_message
        timestamp updated_at
    }

    comments {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text section_key
        text created_by FK
        text assigned_to "FK users.id (nullable)"
        text status
        text thread_id
        text content
        text tool_call_id
        timestamp created_at
        timestamp updated_at
    }

    extension_tool_permissions {
        text id PK
        text user_id FK
        text workspace_id FK
        text tool_name
        text origin
        text policy
        timestamp updated_at
        timestamp created_at
    }
```

Notes:
- `organizations.data` is **JSONB** (organization profile: `industry`, `size`, `products`, `processes`, `kpis`, `references`, etc.).
- `use_cases.data` is **JSONB** (contains `name`, `description`, scores, etc. - migration 0008).
- `workspaces.owner_user_id` is **nullable** (no unique constraint).
- `workspaces.hidden_at` indicates visibility (hidden workspaces).
- `workspace_memberships` is the source of truth for roles (`viewer` | `commenter` | `editor` | `admin`).
- `comments` stores comments in flat threads (`thread_id`), scoped by workspace.
- `comments.tool_call_id` traces AI tool-driven notes/comments.
- `extension_tool_permissions` persists extension local-tool authorization policies (`allow` / `deny`) per user/workspace/tool/origin.

## Prompts (current vs target)

### Current state (implemented)

- There are **no** `prompts` / `prompt_versions` tables in `api/src/db/schema.ts`.
- Prompts are stored in `settings` (table `settings`) as a text value (often JSON) - e.g., `settings.key = 'prompts'` or an equivalent API structure.

Consequence:
- Prompt/version traceability in chat and generations is **partial**: some columns exist (`chat_messages.prompt_id`, `chat_messages.prompt_version_id`, `context_modification_history.prompt_id|prompt_version_id|prompt_type`) but do not reference relational tables today.

### Target state (not implemented)

Eventually, normalize with:
- `prompts` (logical definition)
- `prompt_versions` (versioning, content, variables, author)

and make references truly relational (FK) from `chat_messages` / `context_modification_history` / (possibly) a structured runs table.

## Auth (sessions, WebAuthn, magic link, email codes)

```mermaid
erDiagram
    users ||--o{ user_sessions : "user_id"
    users ||--o{ webauthn_credentials : "user_id"
    users ||--o{ webauthn_challenges : "user_id (nullable)"
    users ||--o{ magic_links : "user_id (nullable)"

    users {
        text id PK
        text email
    }

    user_sessions {
        text id PK
        text user_id FK
        text session_token_hash "unique"
        text refresh_token_hash "unique (nullable)"
        timestamp expires_at
        timestamp created_at
        timestamp last_activity_at
    }

    webauthn_credentials {
        text id PK
        text user_id FK
        text credential_id "unique"
        text public_key_cose
        int counter
        text device_name
        boolean uv
        timestamp created_at
        timestamp last_used_at
    }

    webauthn_challenges {
        text id PK
        text challenge "unique"
        text user_id "FK users.id (nullable)"
        text type
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    magic_links {
        text id PK
        text token_hash "unique"
        text email
        text user_id "FK users.id (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    email_verification_codes {
        text id PK
        text code_hash
        text email
        text verification_token "unique (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }
```

## Chat / streaming / tracing

```mermaid
erDiagram
    users ||--o{ chat_sessions : "user_id"
    workspaces ||--o{ chat_sessions : "workspace_id (nullable)"

    chat_sessions ||--o{ chat_messages : "session_id"
    chat_sessions ||--o{ chat_contexts : "session_id"
    chat_messages ||--o{ chat_stream_events : "message_id (nullable)"
    chat_messages ||--o{ chat_message_feedback : "message_id"

    chat_sessions ||--o{ chat_generation_traces : "session_id"
    chat_messages ||--o{ chat_generation_traces : "assistant_message_id"
    users ||--o{ chat_generation_traces : "user_id"
    workspaces ||--o{ chat_generation_traces : "workspace_id (nullable)"
    users ||--o{ chat_message_feedback : "user_id"

    chat_sessions ||--o{ context_modification_history : "session_id (nullable)"
    chat_messages ||--o{ context_modification_history : "message_id (nullable)"
    job_queue ||--o{ context_modification_history : "job_id (nullable)"

    workspaces ||--o{ context_documents : "workspace_id"
    job_queue ||--o{ context_documents : "job_id (nullable)"
    context_documents ||--o{ context_document_versions : "document_id"

    chat_sessions {
        text id PK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text primary_context_type
        text primary_context_id
        text title
        timestamp created_at
        timestamp updated_at
    }

    chat_messages {
        text id PK
        text session_id FK
        text role
        text content
        jsonb contexts
        jsonb tool_calls
        text tool_call_id
        text model
        int sequence
        timestamp created_at
    }

    chat_message_feedback {
        text id PK
        text message_id FK
        text user_id FK
        int vote "1=up, -1=down"
        timestamp created_at
        timestamp updated_at
    }

    chat_stream_events {
        text id PK
        text message_id "FK chat_messages.id (nullable)"
        text stream_id
        text event_type
        jsonb data
        int sequence
        timestamp created_at
    }

    chat_contexts {
        text id PK
        text session_id FK
        text context_type
        text context_id
        jsonb snapshot_before
        jsonb snapshot_after
        jsonb modifications
        timestamp modified_at
        timestamp created_at
    }

    chat_generation_traces {
        text id PK
        text session_id FK
        text assistant_message_id FK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text phase
        int iteration
        text model
        text tool_choice
        jsonb tools
        jsonb openai_messages
        jsonb tool_calls
        jsonb meta
        timestamp created_at
    }

    context_modification_history {
        text id PK
        text context_type
        text context_id
        text session_id "FK chat_sessions.id (nullable)"
        text message_id "FK chat_messages.id (nullable)"
        text job_id "FK job_queue.id (nullable)"
        text field
        jsonb old_value
        jsonb new_value
        text tool_call_id
        int sequence
        timestamp created_at
    }

    context_documents {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text filename
        text mime_type
        int size_bytes
        text storage_key
        text status
        jsonb data
        text job_id "FK job_queue.id (nullable)"
        int version
        timestamp created_at
        timestamp updated_at
    }

    context_document_versions {
        text id PK
        text document_id FK
        int version
        text filename
        text mime_type
        int size_bytes
        text storage_key
        jsonb data
        timestamp created_at
    }
```

Notes:
- `context_modification_history.context_type/context_id` are **logical references** (no DB FK) to `organizations/folders/use_cases` (and `folders` for `executive_summary`).
- `chat_stream_events.message_id` is nullable: structured calls use deterministic `stream_id` (`folder_<id>`, `usecase_<useCaseId>`, etc.).
- `context_documents.context_type/context_id` are **logical references** (no DB FK) to `organizations/folders/use_cases`.
- `chat_message_feedback` stores per-user feedback on assistant messages (unique by `message_id` + `user_id`).

Chat runtime notes (extension local tools):

- `POST /api/v1/chat/messages` can include `localToolDefinitions` (merged with server-side tools before generation).
- `POST /api/v1/chat/messages/:id/tool-results` injects local tool outputs and resumes generation.
- Local tool call state is tracked in stream events (`chat_stream_events`) and resumed in the same assistant message stream.

## Extension local-tool permissions

Table: `extension_tool_permissions` (`api/src/db/schema.ts`)

- Primary role: persist `allow` / `deny` decisions for extension runtime permission prompts.
- Scope key: unique (`user_id`, `workspace_id`, `tool_name`, `origin`).
- Indices:
  - `extension_tool_permissions_user_workspace_idx`
  - `extension_tool_permissions_tool_origin_idx`
- Patterns are normalized at API layer (`/api/v1/chat/tool-permissions`) before persistence:
  - tool patterns: e.g. `tab_read:*`, `tab_action:click`
  - origin patterns: `*`, `https://*`, `*.example.com`, `https://*.example.com`, exact origins
# Data model (PostgreSQL 17 / Drizzle)

Source of truth: `api/src/db/schema.ts` (Drizzle).  
Conventions: tables in `snake_case`, primary keys `text` (UUID string), multi-tenant via `workspace_id` + `workspace_memberships` (private-by-default).

## Overview (tenancy + business objects)

```mermaid
erDiagram
    users ||--o{ workspaces : "owner_user_id (nullable)"
    users ||--o{ workspace_memberships : "user_id"
    workspaces ||--o{ workspace_memberships : "workspace_id"

    workspaces ||--o{ organizations : "workspace_id"
    workspaces ||--o{ folders : "workspace_id"
    workspaces ||--o{ use_cases : "workspace_id"
    workspaces ||--o{ job_queue : "workspace_id"
    workspaces ||--o{ comments : "workspace_id"

    organizations ||--o{ folders : "organization_id (optional)"
    folders ||--o{ use_cases : "folder_id"
    organizations ||--o{ use_cases : "organization_id (optional)"
    users ||--o{ comments : "created_by"
    users ||--o{ comments : "assigned_to (optional)"
    comments ||--o{ comments : "thread_id"

    workspaces {
        text id PK
        text owner_user_id "FK users.id (nullable)"
        text name
        timestamp hidden_at
        timestamp created_at
        timestamp updated_at
    }

    workspace_memberships {
        text workspace_id FK
        text user_id FK
        text role
        timestamp created_at
    }

    users {
        text id PK
        text email "unique"
        text display_name
        text role
        text account_status
        timestamp approval_due_at
        timestamp approved_at
        text approved_by_user_id "self-FK users.id (nullable)"
        timestamp disabled_at
        text disabled_reason
        boolean email_verified
        timestamp created_at
        timestamp updated_at
    }

    organizations {
        text id PK
        text workspace_id FK
        text name
        text status
        jsonb data
        timestamp created_at
        timestamp updated_at
    }

    folders {
        text id PK
        text workspace_id FK
        text organization_id "FK organizations.id (nullable)"
        text name
        text description
        text matrix_config
        text executive_summary
        text status
        timestamp created_at
    }

    use_cases {
        text id PK
        text workspace_id FK
        text folder_id FK
        text organization_id "FK organizations.id (nullable)"
        text status
        text model
        jsonb data
        timestamp created_at
    }

    job_queue {
        text id PK
        text type
        text status
        text workspace_id FK
        text data
        text result
        text error
        timestamp created_at
        text started_at
        text completed_at
    }

    object_locks {
        text id PK
        text workspace_id FK
        text object_type
        text object_id
        text locked_by_user_id FK
        timestamp locked_at
        timestamp expires_at
        timestamp unlock_requested_at
        text unlock_requested_by_user_id "FK users.id (nullable)"
        text unlock_request_message
        timestamp updated_at
    }

    comments {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text section_key
        text created_by FK
        text assigned_to "FK users.id (nullable)"
        text status
        text thread_id
        text content
        text tool_call_id
        timestamp created_at
        timestamp updated_at
    }
```

Notes:
- `organizations.data` is **JSONB** (organization profile: `industry`, `size`, `products`, `processes`, `kpis`, `references`, etc.).
- `use_cases.data` is **JSONB** (contains `name`, `description`, scores, etc. - migration 0008).
- `workspaces.owner_user_id` is **nullable** (no unique constraint).
- `workspaces.hidden_at` indicates visibility (hidden workspaces).
- `workspace_memberships` is the source of truth for roles (`viewer` | `commenter` | `editor` | `admin`).
- `comments` stores comments in flat threads (`thread_id`), scoped by workspace.
- `comments.tool_call_id` traces AI tool-driven notes/comments.

## Prompts (current vs target)

### Current state (implemented)

- There are **no** `prompts` / `prompt_versions` tables in `api/src/db/schema.ts`.
- Prompts are stored in `settings` (table `settings`) as a text value (often JSON) - e.g., `settings.key = 'prompts'` or an equivalent API structure.

Consequence:
- Prompt/version traceability in chat and generations is **partial**: some columns exist (`chat_messages.prompt_id`, `chat_messages.prompt_version_id`, `context_modification_history.prompt_id|prompt_version_id|prompt_type`) but do not reference relational tables today.

### Target state (not implemented)

Eventually, normalize with:
- `prompts` (logical definition)
- `prompt_versions` (versioning, content, variables, author)

and make references truly relational (FK) from `chat_messages` / `context_modification_history` / (possibly) a structured runs table.

## Auth (sessions, WebAuthn, magic link, email codes)

```mermaid
erDiagram
    users ||--o{ user_sessions : "user_id"
    users ||--o{ webauthn_credentials : "user_id"
    users ||--o{ webauthn_challenges : "user_id (nullable)"
    users ||--o{ magic_links : "user_id (nullable)"

    users {
        text id PK
        text email
    }

    user_sessions {
        text id PK
        text user_id FK
        text session_token_hash "unique"
        text refresh_token_hash "unique (nullable)"
        timestamp expires_at
        timestamp created_at
        timestamp last_activity_at
    }

    webauthn_credentials {
        text id PK
        text user_id FK
        text credential_id "unique"
        text public_key_cose
        int counter
        text device_name
        boolean uv
        timestamp created_at
        timestamp last_used_at
    }

    webauthn_challenges {
        text id PK
        text challenge "unique"
        text user_id "FK users.id (nullable)"
        text type
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    magic_links {
        text id PK
        text token_hash "unique"
        text email
        text user_id "FK users.id (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    email_verification_codes {
        text id PK
        text code_hash
        text email
        text verification_token "unique (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }
```

## Chat / streaming / tracing

```mermaid
erDiagram
    users ||--o{ chat_sessions : "user_id"
    workspaces ||--o{ chat_sessions : "workspace_id (nullable)"

    chat_sessions ||--o{ chat_messages : "session_id"
    chat_sessions ||--o{ chat_contexts : "session_id"
    chat_messages ||--o{ chat_stream_events : "message_id (nullable)"
    chat_messages ||--o{ chat_message_feedback : "message_id"

    chat_sessions ||--o{ chat_generation_traces : "session_id"
    chat_messages ||--o{ chat_generation_traces : "assistant_message_id"
    users ||--o{ chat_generation_traces : "user_id"
    workspaces ||--o{ chat_generation_traces : "workspace_id (nullable)"
    users ||--o{ chat_message_feedback : "user_id"

    chat_sessions ||--o{ context_modification_history : "session_id (nullable)"
    chat_messages ||--o{ context_modification_history : "message_id (nullable)"
    job_queue ||--o{ context_modification_history : "job_id (nullable)"

    workspaces ||--o{ context_documents : "workspace_id"
    job_queue ||--o{ context_documents : "job_id (nullable)"
    context_documents ||--o{ context_document_versions : "document_id"

    chat_sessions {
        text id PK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text primary_context_type
        text primary_context_id
        text title
        timestamp created_at
        timestamp updated_at
    }

    chat_messages {
        text id PK
        text session_id FK
        text role
        text content
        jsonb contexts
        jsonb tool_calls
        text tool_call_id
        text model
        int sequence
        timestamp created_at
    }

    chat_message_feedback {
        text id PK
        text message_id FK
        text user_id FK
        int vote "1=up, -1=down"
        timestamp created_at
        timestamp updated_at
    }

    chat_stream_events {
        text id PK
        text message_id "FK chat_messages.id (nullable)"
        text stream_id
        text event_type
        jsonb data
        int sequence
        timestamp created_at
    }

    chat_contexts {
        text id PK
        text session_id FK
        text context_type
        text context_id
        jsonb snapshot_before
        jsonb snapshot_after
        jsonb modifications
        timestamp modified_at
        timestamp created_at
    }

    chat_generation_traces {
        text id PK
        text session_id FK
        text assistant_message_id FK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text phase
        int iteration
        text model
        text tool_choice
        jsonb tools
        jsonb openai_messages
        jsonb tool_calls
        jsonb meta
        timestamp created_at
    }

    context_modification_history {
        text id PK
        text context_type
        text context_id
        text session_id "FK chat_sessions.id (nullable)"
        text message_id "FK chat_messages.id (nullable)"
        text job_id "FK job_queue.id (nullable)"
        text field
        jsonb old_value
        jsonb new_value
        text tool_call_id
        int sequence
        timestamp created_at
    }

    context_documents {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text filename
        text mime_type
        int size_bytes
        text storage_key
        text status
        jsonb data
        text job_id "FK job_queue.id (nullable)"
        int version
        timestamp created_at
        timestamp updated_at
    }

    context_document_versions {
        text id PK
        text document_id FK
        int version
        text filename
        text mime_type
        int size_bytes
        text storage_key
        jsonb data
        timestamp created_at
    }
```

Notes:
- `context_modification_history.context_type/context_id` are **logical references** (no DB FK) to `organizations/folders/use_cases` (and `folders` for `executive_summary`).
- `chat_stream_events.message_id` is nullable: structured calls use deterministic `stream_id` (`folder_<id>`, `usecase_<useCaseId>`, etc.).
- `context_documents.context_type/context_id` are **logical references** (no DB FK) to `organizations/folders/use_cases`.
- `chat_message_feedback` stores per-user feedback on assistant messages (unique by `message_id` + `user_id`).
# Data model (PostgreSQL 17 / Drizzle)

Source of truth: `api/src/db/schema.ts` (Drizzle).  
Conventions: tables in `snake_case`, primary keys `text` (UUID string), multi-tenant via `workspace_id` + `workspace_memberships` (private-by-default).

## Overview (tenancy + business objects)

```mermaid
erDiagram
    users ||--o{ workspaces : "owner_user_id (nullable)"
    users ||--o{ workspace_memberships : "user_id"
    workspaces ||--o{ workspace_memberships : "workspace_id"

    workspaces ||--o{ organizations : "workspace_id"
    workspaces ||--o{ folders : "workspace_id"
    workspaces ||--o{ use_cases : "workspace_id"
    workspaces ||--o{ job_queue : "workspace_id"
    workspaces ||--o{ comments : "workspace_id"

    organizations ||--o{ folders : "organization_id (optional)"
    folders ||--o{ use_cases : "folder_id"
    organizations ||--o{ use_cases : "organization_id (optional)"
    users ||--o{ comments : "created_by"
    users ||--o{ comments : "assigned_to (optional)"
    comments ||--o{ comments : "thread_id"

    workspaces {
        text id PK
        text owner_user_id "FK users.id (nullable)"
        text name
        timestamp hidden_at
        timestamp created_at
        timestamp updated_at
    }

    workspace_memberships {
        text workspace_id FK
        text user_id FK
        text role
        timestamp created_at
    }

    users {
        text id PK
        text email "unique"
        text display_name
        text role
        text account_status
        timestamp approval_due_at
        timestamp approved_at
        text approved_by_user_id "self-FK users.id (nullable)"
        timestamp disabled_at
        text disabled_reason
        boolean email_verified
        timestamp created_at
        timestamp updated_at
    }

    organizations {
        text id PK
        text workspace_id FK
        text name
        text status
        jsonb data
        timestamp created_at
        timestamp updated_at
    }

    folders {
        text id PK
        text workspace_id FK
        text organization_id "FK organizations.id (nullable)"
        text name
        text description
        text matrix_config
        text executive_summary
        text status
        timestamp created_at
    }

    use_cases {
        text id PK
        text workspace_id FK
        text folder_id FK
        text organization_id "FK organizations.id (nullable)"
        text status
        text model
        jsonb data
        timestamp created_at
    }

    job_queue {
        text id PK
        text type
        text status
        text workspace_id FK
        text data
        text result
        text error
        timestamp created_at
        text started_at
        text completed_at
    }

    object_locks {
        text id PK
        text workspace_id FK
        text object_type
        text object_id
        text locked_by_user_id FK
        timestamp locked_at
        timestamp expires_at
        timestamp unlock_requested_at
        text unlock_requested_by_user_id "FK users.id (nullable)"
        text unlock_request_message
        timestamp updated_at
    }

    comments {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text section_key
        text created_by FK
        text assigned_to "FK users.id (nullable)"
        text status
        text thread_id
        text content
        text tool_call_id
        timestamp created_at
        timestamp updated_at
    }
```

Notes:
- `organizations.data` is **JSONB** (organization profile: `industry`, `size`, `products`, `processes`, `kpis`, `references`, etc.).
- `use_cases.data` is **JSONB** (contains `name`, `description`, scores, etc. - migration 0008).
- `workspaces.owner_user_id` is **nullable** (no unique constraint).
- `workspaces.hidden_at` indicates visibility (hidden workspaces).
- `workspace_memberships` is the source of truth for roles (`viewer` | `commenter` | `editor` | `admin`).
- `comments` stores comments in flat threads (`thread_id`), scoped by workspace.
- `comments.tool_call_id` traces AI tool-driven notes/comments.

## Prompts (current vs target)

### Current state (implemented)

- There are **no** `prompts` / `prompt_versions` tables in `api/src/db/schema.ts`.
- Prompts are stored in `settings` (table `settings`) as a text value (often JSON) - e.g., `settings.key = 'prompts'` or an equivalent API structure.

Consequence:
- Prompt/version traceability in chat and generations is **partial**: some columns exist (`chat_messages.prompt_id`, `chat_messages.prompt_version_id`, `context_modification_history.prompt_id|prompt_version_id|prompt_type`) but do not reference relational tables today.

### Target state (not implemented)

Eventually, normalize with:
- `prompts` (logical definition)
- `prompt_versions` (versioning, content, variables, author)

and make references truly relational (FK) from `chat_messages` / `context_modification_history` / (possibly) a structured runs table.

## Auth (sessions, WebAuthn, magic link, email codes)

```mermaid
erDiagram
    users ||--o{ user_sessions : "user_id"
    users ||--o{ webauthn_credentials : "user_id"
    users ||--o{ webauthn_challenges : "user_id (nullable)"
    users ||--o{ magic_links : "user_id (nullable)"

    users {
        text id PK
        text email
    }

    user_sessions {
        text id PK
        text user_id FK
        text session_token_hash "unique"
        text refresh_token_hash "unique (nullable)"
        timestamp expires_at
        timestamp created_at
        timestamp last_activity_at
    }

    webauthn_credentials {
        text id PK
        text user_id FK
        text credential_id "unique"
        text public_key_cose
        int counter
        text device_name
        boolean uv
        timestamp created_at
        timestamp last_used_at
    }

    webauthn_challenges {
        text id PK
        text challenge "unique"
        text user_id "FK users.id (nullable)"
        text type
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    magic_links {
        text id PK
        text token_hash "unique"
        text email
        text user_id "FK users.id (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    email_verification_codes {
        text id PK
        text code_hash
        text email
        text verification_token "unique (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }
```

## Chat / streaming / tracing

```mermaid
erDiagram
    users ||--o{ chat_sessions : "user_id"
    workspaces ||--o{ chat_sessions : "workspace_id (nullable)"

    chat_sessions ||--o{ chat_messages : "session_id"
    chat_sessions ||--o{ chat_contexts : "session_id"
    chat_messages ||--o{ chat_stream_events : "message_id (nullable)"
    chat_messages ||--o{ chat_message_feedback : "message_id"

    chat_sessions ||--o{ chat_generation_traces : "session_id"
    chat_messages ||--o{ chat_generation_traces : "assistant_message_id"
    users ||--o{ chat_generation_traces : "user_id"
    workspaces ||--o{ chat_generation_traces : "workspace_id (nullable)"
    users ||--o{ chat_message_feedback : "user_id"

    chat_sessions ||--o{ context_modification_history : "session_id (nullable)"
    chat_messages ||--o{ context_modification_history : "message_id (nullable)"
    job_queue ||--o{ context_modification_history : "job_id (nullable)"

    workspaces ||--o{ context_documents : "workspace_id"
    job_queue ||--o{ context_documents : "job_id (nullable)"
    context_documents ||--o{ context_document_versions : "document_id"

    chat_sessions {
        text id PK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text primary_context_type
        text primary_context_id
        text title
        timestamp created_at
        timestamp updated_at
    }

    chat_messages {
        text id PK
        text session_id FK
        text role
        text content
        jsonb contexts
        jsonb tool_calls
        text tool_call_id
        text model
        int sequence
        timestamp created_at
    }

    chat_message_feedback {
        text id PK
        text message_id FK
        text user_id FK
        int vote "1=up, -1=down"
        timestamp created_at
        timestamp updated_at
    }

    chat_stream_events {
        text id PK
        text message_id "FK chat_messages.id (nullable)"
        text stream_id
        text event_type
        jsonb data
        int sequence
        timestamp created_at
    }

    chat_contexts {
        text id PK
        text session_id FK
        text context_type
        text context_id
        jsonb snapshot_before
        jsonb snapshot_after
        jsonb modifications
        timestamp modified_at
        timestamp created_at
    }

    chat_generation_traces {
        text id PK
        text session_id FK
        text assistant_message_id FK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text phase
        int iteration
        text model
        text tool_choice
        jsonb tools
        jsonb openai_messages
        jsonb tool_calls
        jsonb meta
        timestamp created_at
    }

    context_modification_history {
        text id PK
        text context_type
        text context_id
        text session_id "FK chat_sessions.id (nullable)"
        text message_id "FK chat_messages.id (nullable)"
        text job_id "FK job_queue.id (nullable)"
        text field
        jsonb old_value
        jsonb new_value
        text tool_call_id
        int sequence
        timestamp created_at
    }

    context_documents {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text filename
        text mime_type
        int size_bytes
        text storage_key
        text status
        jsonb data
        text job_id "FK job_queue.id (nullable)"
        int version
        timestamp created_at
        timestamp updated_at
    }

    context_document_versions {
        text id PK
        text document_id FK
        int version
        text filename
        text mime_type
        int size_bytes
        text storage_key
        jsonb data
        timestamp created_at
    }
```

Notes:
- `context_modification_history.context_type/context_id` are **logical references** (no DB FK) to `organizations/folders/use_cases` (and `folders` for `executive_summary`).
- `chat_stream_events.message_id` is nullable: structured calls use deterministic `stream_id` (`folder_<id>`, `usecase_<useCaseId>`, etc.).
- `context_documents.context_type/context_id` are **logical references** (no DB FK) to `organizations/folders/use_cases`.
- `chat_message_feedback` stores per-user feedback on assistant messages (unique by `message_id` + `user_id`).
# Data model (PostgreSQL 17 / Drizzle)

Source of truth: `api/src/db/schema.ts` (Drizzle).  
Conventions: tables in `snake_case`, primary keys `text` (UUID string), multi-tenant via `workspace_id` + `workspace_memberships` (private-by-default).

## Overview (tenancy + business objects)

```mermaid
erDiagram
    users ||--o{ workspaces : "owner_user_id (nullable)"
    users ||--o{ workspace_memberships : "user_id"
    workspaces ||--o{ workspace_memberships : "workspace_id"

    workspaces ||--o{ organizations : "workspace_id"
    workspaces ||--o{ folders : "workspace_id"
    workspaces ||--o{ use_cases : "workspace_id"
    workspaces ||--o{ job_queue : "workspace_id"
    workspaces ||--o{ comments : "workspace_id"

    organizations ||--o{ folders : "organization_id (optional)"
    folders ||--o{ use_cases : "folder_id"
    organizations ||--o{ use_cases : "organization_id (optional)"
    users ||--o{ comments : "created_by"
    users ||--o{ comments : "assigned_to (optional)"
    comments ||--o{ comments : "thread_id"

    workspaces {
        text id PK
        text owner_user_id "FK users.id (nullable)"
        text name
        timestamp hidden_at
        timestamp created_at
        timestamp updated_at
    }

    workspace_memberships {
        text workspace_id FK
        text user_id FK
        text role
        timestamp created_at
    }

    users {
        text id PK
        text email "unique"
        text display_name
        text role
        text account_status
        timestamp approval_due_at
        timestamp approved_at
        text approved_by_user_id "self-FK users.id (nullable)"
        timestamp disabled_at
        text disabled_reason
        boolean email_verified
        timestamp created_at
        timestamp updated_at
    }

    organizations {
        text id PK
        text workspace_id FK
        text name
        text status
        jsonb data
        timestamp created_at
        timestamp updated_at
    }

    folders {
        text id PK
        text workspace_id FK
        text organization_id "FK organizations.id (nullable)"
        text name
        text description
        text matrix_config
        text executive_summary
        text status
        timestamp created_at
    }

    use_cases {
        text id PK
        text workspace_id FK
        text folder_id FK
        text organization_id "FK organizations.id (nullable)"
        text status
        text model
        jsonb data
        timestamp created_at
    }

    job_queue {
        text id PK
        text type
        text status
        text workspace_id FK
        text data
        text result
        text error
        timestamp created_at
        text started_at
        text completed_at
    }

    object_locks {
        text id PK
        text workspace_id FK
        text object_type
        text object_id
        text locked_by_user_id FK
        timestamp locked_at
        timestamp expires_at
        timestamp unlock_requested_at
        text unlock_requested_by_user_id "FK users.id (nullable)"
        text unlock_request_message
        timestamp updated_at
    }

    comments {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text section_key
        text created_by FK
        text assigned_to "FK users.id (nullable)"
        text status
        text thread_id
        text content
        text tool_call_id
        timestamp created_at
        timestamp updated_at
    }
```

Notes:
- `organizations.data` is **JSONB** (organization profile: `industry`, `size`, `products`, `processes`, `kpis`, `references`, etc.).
- `use_cases.data` is **JSONB** (contains `name`, `description`, scores, etc. - migration 0008).
- `workspaces.owner_user_id` is **nullable** (no unique constraint).
- `workspaces.hidden_at` indicates visibility (hidden workspaces).
- `workspace_memberships` is the source of truth for roles (`viewer` | `commenter` | `editor` | `admin`).
- `comments` stores comments in flat threads (`thread_id`), scoped by workspace.
- `comments.tool_call_id` traces AI tool-driven notes/comments.

## Prompts (current vs target)

### Current state (implemented)

- There are **no** `prompts` / `prompt_versions` tables in `api/src/db/schema.ts`.
- Prompts are stored in `settings` (table `settings`) as a text value (often JSON) - e.g., `settings.key = 'prompts'` or an equivalent API structure.

Consequence:
- Prompt/version traceability in chat and generations is **partial**: some columns exist (`chat_messages.prompt_id`, `chat_messages.prompt_version_id`, `context_modification_history.prompt_id|prompt_version_id|prompt_type`) but do not reference relational tables today.

### Target state (not implemented)

Eventually, normalize with:
- `prompts` (logical definition)
- `prompt_versions` (versioning, content, variables, author)

and make references truly relational (FK) from `chat_messages` / `context_modification_history` / (possibly) a structured runs table.

## Auth (sessions, WebAuthn, magic link, email codes)

```mermaid
erDiagram
    users ||--o{ user_sessions : "user_id"
    users ||--o{ webauthn_credentials : "user_id"
    users ||--o{ webauthn_challenges : "user_id (nullable)"
    users ||--o{ magic_links : "user_id (nullable)"

    users {
        text id PK
        text email
    }

    user_sessions {
        text id PK
        text user_id FK
        text session_token_hash "unique"
        text refresh_token_hash "unique (nullable)"
        timestamp expires_at
        timestamp created_at
        timestamp last_activity_at
    }

    webauthn_credentials {
        text id PK
        text user_id FK
        text credential_id "unique"
        text public_key_cose
        int counter
        text device_name
        boolean uv
        timestamp created_at
        timestamp last_used_at
    }

    webauthn_challenges {
        text id PK
        text challenge "unique"
        text user_id "FK users.id (nullable)"
        text type
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    magic_links {
        text id PK
        text token_hash "unique"
        text email
        text user_id "FK users.id (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    email_verification_codes {
        text id PK
        text code_hash
        text email
        text verification_token "unique (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }
```

## Chat / streaming / tracing

```mermaid
erDiagram
    users ||--o{ chat_sessions : "user_id"
    workspaces ||--o{ chat_sessions : "workspace_id (nullable)"

    chat_sessions ||--o{ chat_messages : "session_id"
    chat_sessions ||--o{ chat_contexts : "session_id"
    chat_messages ||--o{ chat_stream_events : "message_id (nullable)"
    chat_messages ||--o{ chat_message_feedback : "message_id"

    chat_sessions ||--o{ chat_generation_traces : "session_id"
    chat_messages ||--o{ chat_generation_traces : "assistant_message_id"
    users ||--o{ chat_generation_traces : "user_id"
    workspaces ||--o{ chat_generation_traces : "workspace_id (nullable)"
    users ||--o{ chat_message_feedback : "user_id"

    chat_sessions ||--o{ context_modification_history : "session_id (nullable)"
    chat_messages ||--o{ context_modification_history : "message_id (nullable)"
    job_queue ||--o{ context_modification_history : "job_id (nullable)"

    workspaces ||--o{ context_documents : "workspace_id"
    job_queue ||--o{ context_documents : "job_id (nullable)"
    context_documents ||--o{ context_document_versions : "document_id"

    chat_sessions {
        text id PK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text primary_context_type
        text primary_context_id
        text title
        timestamp created_at
        timestamp updated_at
    }

    chat_messages {
        text id PK
        text session_id FK
        text role
        text content
        jsonb contexts
        jsonb tool_calls
        text tool_call_id
        text model
        int sequence
        timestamp created_at
    }

    chat_message_feedback {
        text id PK
        text message_id FK
        text user_id FK
        int vote "1=up, -1=down"
        timestamp created_at
        timestamp updated_at
    }

    chat_stream_events {
        text id PK
        text message_id "FK chat_messages.id (nullable)"
        text stream_id
        text event_type
        jsonb data
        int sequence
        timestamp created_at
    }

    chat_contexts {
        text id PK
        text session_id FK
        text context_type
        text context_id
        jsonb snapshot_before
        jsonb snapshot_after
        jsonb modifications
        timestamp modified_at
        timestamp created_at
    }

    chat_generation_traces {
        text id PK
        text session_id FK
        text assistant_message_id FK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text phase
        int iteration
        text model
        text tool_choice
        jsonb tools
        jsonb openai_messages
        jsonb tool_calls
        jsonb meta
        timestamp created_at
    }

    context_modification_history {
        text id PK
        text context_type
        text context_id
        text session_id "FK chat_sessions.id (nullable)"
        text message_id "FK chat_messages.id (nullable)"
        text job_id "FK job_queue.id (nullable)"
        text field
        jsonb old_value
        jsonb new_value
        text tool_call_id
        int sequence
        timestamp created_at
    }

    context_documents {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text filename
        text mime_type
        int size_bytes
        text storage_key
        text status
        jsonb data
        text job_id "FK job_queue.id (nullable)"
        int version
        timestamp created_at
        timestamp updated_at
    }

    context_document_versions {
        text id PK
        text document_id FK
        int version
        text filename
        text mime_type
        int size_bytes
        text storage_key
        jsonb data
        timestamp created_at
    }
```

Notes:
- `context_modification_history.context_type/context_id` are **logical references** (no DB FK) to `organizations/folders/use_cases` (and `folders` for `executive_summary`).
- `chat_stream_events.message_id` is nullable: structured calls use deterministic `stream_id` (`folder_<id>`, `usecase_<id>`, etc.).
- `context_documents.context_type/context_id` are **logical references** (no DB FK) to `organizations/folders/use_cases`.
- `chat_message_feedback` stores per-user feedback on assistant messages (unique by `message_id` + `user_id`).
# Data model (PostgreSQL 17 / Drizzle)

Source of truth: `api/src/db/schema.ts` (Drizzle).  
Conventions: tables in `snake_case`, primary keys `text` (UUID string), multi‑tenant via `workspace_id` + `workspace_memberships` (private‑by‑default).

## Overview (tenancy + business objects)

```mermaid
erDiagram
    users ||--o{ workspaces : "owner_user_id (nullable)"
    users ||--o{ workspace_memberships : "user_id"
    workspaces ||--o{ workspace_memberships : "workspace_id"

    workspaces ||--o{ organizations : "workspace_id"
    workspaces ||--o{ folders : "workspace_id"
    workspaces ||--o{ use_cases : "workspace_id"
    workspaces ||--o{ job_queue : "workspace_id"
    workspaces ||--o{ comments : "workspace_id"

    organizations ||--o{ folders : "organization_id (optional)"
    folders ||--o{ use_cases : "folder_id"
    organizations ||--o{ use_cases : "organization_id (optional)"
    users ||--o{ comments : "created_by"
    users ||--o{ comments : "assigned_to (optional)"
    comments ||--o{ comments : "thread_id"

    workspaces {
        text id PK
        text owner_user_id "FK users.id (nullable)"
        text name
        timestamp hidden_at
        timestamp created_at
        timestamp updated_at
    }

    workspace_memberships {
        text workspace_id FK
        text user_id FK
        text role
        timestamp created_at
    }

    users {
        text id PK
        text email "unique"
        text display_name
        text role
        text account_status
        timestamp approval_due_at
        timestamp approved_at
        text approved_by_user_id "self-FK users.id (nullable)"
        timestamp disabled_at
        text disabled_reason
        boolean email_verified
        timestamp created_at
        timestamp updated_at
    }

    organizations {
        text id PK
        text workspace_id FK
        text name
        text status
        jsonb data
        timestamp created_at
        timestamp updated_at
    }

    folders {
        text id PK
        text workspace_id FK
        text organization_id "FK organizations.id (nullable)"
        text name
        text description
        text matrix_config
        text executive_summary
        text status
        timestamp created_at
    }

    use_cases {
        text id PK
        text workspace_id FK
        text folder_id FK
        text organization_id "FK organizations.id (nullable)"
        text status
        text model
        jsonb data
        timestamp created_at
    }

    job_queue {
        text id PK
        text type
        text status
        text workspace_id FK
        text data
        text result
        text error
        timestamp created_at
        text started_at
        text completed_at
    }

    object_locks {
        text id PK
        text workspace_id FK
        text object_type
        text object_id
        text locked_by_user_id FK
        timestamp locked_at
        timestamp expires_at
        timestamp unlock_requested_at
        text unlock_requested_by_user_id "FK users.id (nullable)"
        text unlock_request_message
        timestamp updated_at
    }

    comments {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text section_key
        text created_by FK
        text assigned_to "FK users.id (nullable)"
        text status
        text thread_id
        text content
        text tool_call_id
        timestamp created_at
        timestamp updated_at
    }
```

Notes:
- `organizations.data` is **JSONB** (organization profile: `industry`, `size`, `products`, `processes`, `kpis`, `references`, etc.).
- `use_cases.data` is **JSONB** (contains `name`, `description`, scores, etc. – migration 0008).
- `workspaces.owner_user_id` is **nullable** (no unique constraint).
- `workspaces.hidden_at` indicates visibility (hidden workspaces).
- `workspace_memberships` is the source of truth for roles (`viewer` | `commenter` | `editor` | `admin`).
- `comments` stores comments in flat threads (`thread_id`), scoped by workspace.
- `comments.tool_call_id` traces AI‑assisted notes/comments.

## Prompts (current vs target)

### Current state (implemented)

- There are **no** `prompts` / `prompt_versions` tables in `api/src/db/schema.ts`.
- Prompts are stored in `settings` (table `settings`) as a text value (often JSON) — e.g., `settings.key = 'prompts'` or an equivalent API structure.

Consequence:
- Prompt/version traceability in chat and generations is **partial**: some columns exist (`chat_messages.prompt_id`, `chat_messages.prompt_version_id`, `context_modification_history.prompt_id|prompt_version_id|prompt_type`) but do not reference relational tables today.

### Target state (not implemented)

Eventually, normalize with:
- `prompts` (logical definition)
- `prompt_versions` (versioning, content, variables, author)

and make references truly relational (`FK`) from `chat_messages` / `context_modification_history` / (possibly) a structured runs table.

## Auth (sessions, WebAuthn, magic link, email codes)

```mermaid
erDiagram
    users ||--o{ user_sessions : "user_id"
    users ||--o{ webauthn_credentials : "user_id"
    users ||--o{ webauthn_challenges : "user_id (nullable)"
    users ||--o{ magic_links : "user_id (nullable)"

    users {
        text id PK
        text email
    }

    user_sessions {
        text id PK
        text user_id FK
        text session_token_hash "unique"
        text refresh_token_hash "unique (nullable)"
        timestamp expires_at
        timestamp created_at
        timestamp last_activity_at
    }

    webauthn_credentials {
        text id PK
        text user_id FK
        text credential_id "unique"
        text public_key_cose
        int counter
        text device_name
        boolean uv
        timestamp created_at
        timestamp last_used_at
    }

    webauthn_challenges {
        text id PK
        text challenge "unique"
        text user_id "FK users.id (nullable)"
        text type
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    magic_links {
        text id PK
        text token_hash "unique"
        text email
        text user_id "FK users.id (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    email_verification_codes {
        text id PK
        text code_hash
        text email
        text verification_token "unique (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }
```

## Chat / streaming / tracing

```mermaid
erDiagram
    users ||--o{ chat_sessions : "user_id"
    workspaces ||--o{ chat_sessions : "workspace_id (nullable)"

    chat_sessions ||--o{ chat_messages : "session_id"
    chat_sessions ||--o{ chat_contexts : "session_id"
    chat_messages ||--o{ chat_stream_events : "message_id (nullable)"
    chat_messages ||--o{ chat_message_feedback : "message_id"

    chat_sessions ||--o{ chat_generation_traces : "session_id"
    chat_messages ||--o{ chat_generation_traces : "assistant_message_id"
    users ||--o{ chat_generation_traces : "user_id"
    workspaces ||--o{ chat_generation_traces : "workspace_id (nullable)"
    users ||--o{ chat_message_feedback : "user_id"

    chat_sessions ||--o{ context_modification_history : "session_id (nullable)"
    chat_messages ||--o{ context_modification_history : "message_id (nullable)"
    job_queue ||--o{ context_modification_history : "job_id (nullable)"

    workspaces ||--o{ context_documents : "workspace_id"
    job_queue ||--o{ context_documents : "job_id (nullable)"
    context_documents ||--o{ context_document_versions : "document_id"

    chat_sessions {
        text id PK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text primary_context_type
        text primary_context_id
        text title
        timestamp created_at
        timestamp updated_at
    }

    chat_messages {
        text id PK
        text session_id FK
        text role
        text content
        jsonb contexts
        jsonb tool_calls
        text tool_call_id
        text model
        int sequence
        timestamp created_at
    }

    chat_message_feedback {
        text id PK
        text message_id FK
        text user_id FK
        int vote "1=up, -1=down"
        timestamp created_at
        timestamp updated_at
    }

    chat_stream_events {
        text id PK
        text message_id "FK chat_messages.id (nullable)"
        text stream_id
        text event_type
        jsonb data
        int sequence
        timestamp created_at
    }

    chat_contexts {
        text id PK
        text session_id FK
        text context_type
        text context_id
        jsonb snapshot_before
        jsonb snapshot_after
        jsonb modifications
        timestamp modified_at
        timestamp created_at
    }

    chat_generation_traces {
        text id PK
        text session_id FK
        text assistant_message_id FK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text phase
        int iteration
        text model
        text tool_choice
        jsonb tools
        jsonb openai_messages
        jsonb tool_calls
        jsonb meta
        timestamp created_at
    }

    context_modification_history {
        text id PK
        text context_type
        text context_id
        text session_id "FK chat_sessions.id (nullable)"
        text message_id "FK chat_messages.id (nullable)"
        text job_id "FK job_queue.id (nullable)"
        text field
        jsonb old_value
        jsonb new_value
        text tool_call_id
        int sequence
        timestamp created_at
    }

    context_documents {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text filename
        text mime_type
        int size_bytes
        text storage_key
        text status
        jsonb data
        text job_id "FK job_queue.id (nullable)"
        int version
        timestamp created_at
        timestamp updated_at
    }

    context_document_versions {
        text id PK
        text document_id FK
        int version
        text filename
        text mime_type
        int size_bytes
        text storage_key
        jsonb data
        timestamp created_at
    }
```

Notes:
- `context_modification_history.context_type/context_id` are **logical references** (no DB FK) to `organizations/folders/use_cases` (and `folders` for `executive_summary`).
- `chat_stream_events.message_id` is nullable: structured calls use deterministic `stream_id` (`folder_<id>`, `usecase_<id>`, etc.).
- `context_documents.context_type/context_id` are **logical references** (no DB FK) to `organizations/folders/use_cases`.
- `chat_message_feedback` stores per‑user feedback on assistant messages (unique by `message_id` + `user_id`).

Source de vérité : `api/src/db/schema.ts` (Drizzle).  
Conventions : tables en `snake_case`, clés primaires `text` (UUID string), multi-tenant via `workspace_id` + `workspace_memberships` (private-by-default).

## Vue d’ensemble (tenancy + objets métier)

```mermaid
erDiagram
    users ||--o{ workspaces : "owner_user_id (nullable)"
    users ||--o{ workspace_memberships : "user_id"
    workspaces ||--o{ workspace_memberships : "workspace_id"

    workspaces ||--o{ organizations : "workspace_id"
    workspaces ||--o{ folders : "workspace_id"
    workspaces ||--o{ use_cases : "workspace_id"
    workspaces ||--o{ job_queue : "workspace_id"
    workspaces ||--o{ comments : "workspace_id"

    organizations ||--o{ folders : "organization_id (optional)"
    folders ||--o{ use_cases : "folder_id"
    organizations ||--o{ use_cases : "organization_id (optional)"
    users ||--o{ comments : "created_by"
    users ||--o{ comments : "assigned_to (optional)"
    comments ||--o{ comments : "thread_id"

    workspaces {
        text id PK
        text owner_user_id "FK users.id (nullable)"
        text name
        timestamp hidden_at
        timestamp created_at
        timestamp updated_at
    }

    workspace_memberships {
        text workspace_id FK
        text user_id FK
        text role
        timestamp created_at
    }

    users {
        text id PK
        text email "unique"
        text display_name
        text role
        text account_status
        timestamp approval_due_at
        timestamp approved_at
        text approved_by_user_id "self-FK users.id (nullable)"
        timestamp disabled_at
        text disabled_reason
        boolean email_verified
        timestamp created_at
        timestamp updated_at
    }

    organizations {
        text id PK
        text workspace_id FK
        text name
        text status
        jsonb data
        timestamp created_at
        timestamp updated_at
    }

    folders {
        text id PK
        text workspace_id FK
        text organization_id "FK organizations.id (nullable)"
        text name
        text description
        text matrix_config
        text executive_summary
        text status
        timestamp created_at
    }

    use_cases {
        text id PK
        text workspace_id FK
        text folder_id FK
        text organization_id "FK organizations.id (nullable)"
        text status
        text model
        jsonb data
        timestamp created_at
    }

    job_queue {
        text id PK
        text type
        text status
        text workspace_id FK
        text data
        text result
        text error
        timestamp created_at
        text started_at
        text completed_at
    }

    object_locks {
        text id PK
        text workspace_id FK
        text object_type
        text object_id
        text locked_by_user_id FK
        timestamp locked_at
        timestamp expires_at
        timestamp unlock_requested_at
        text unlock_requested_by_user_id "FK users.id (nullable)"
        text unlock_request_message
        timestamp updated_at
    }

    comments {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text section_key
        text created_by FK
        text assigned_to "FK users.id (nullable)"
        text status
        text thread_id
        text content
        text tool_call_id
        timestamp created_at
        timestamp updated_at
    }
```

Notes :
- `organizations.data` est **JSONB** (profil organisation : `industry`, `size`, `products`, `processes`, `kpis`, `references`, etc.).
- `use_cases.data` est **JSONB** (contient `name`, `description`, scores, etc. – migration 0008).
- `workspaces.owner_user_id` est **nullable** (plus de contrainte unique).
- `workspaces.hidden_at` indique la visibilité (workspaces cachés).
- `workspace_memberships` est la source de vérité des rôles (`viewer` | `commenter` | `editor` | `admin`).
- `comments` stocke les commentaires dans des conversations à plat (`thread_id`), scoppés par workspace.
- `comments.tool_call_id` trace AI-assisted notes/comments.

## Prompts (état actuel vs cible)

### État actuel (implémenté)

- Il n’y a **pas** de tables `prompts` / `prompt_versions` dans `api/src/db/schema.ts`.
- Les prompts sont stockés dans `settings` (table `settings`) dans une valeur text (souvent JSON) — ex: `settings.key = 'prompts'` ou via une structure équivalente côté API.

Conséquence :
- La traçabilité “prompt/version” dans le chat et les générations est **partielle** : certaines colonnes existent (`chat_messages.prompt_id`, `chat_messages.prompt_version_id`, `context_modification_history.prompt_id|prompt_version_id|prompt_type`) mais ne pointent pas vers des tables relationnelles aujourd’hui.

### Cible (non implémentée)

À terme, on pourra normaliser avec :
- `prompts` (définition logique)
- `prompt_versions` (versioning, contenu, variables, auteur)

et rendre les références réellement relationnelles (`FK`) depuis `chat_messages` / `context_modification_history` / (éventuellement) une table de runs structurés.

## Auth (sessions, WebAuthn, magic link, codes email)

```mermaid
erDiagram
    users ||--o{ user_sessions : "user_id"
    users ||--o{ webauthn_credentials : "user_id"
    users ||--o{ webauthn_challenges : "user_id (nullable)"
    users ||--o{ magic_links : "user_id (nullable)"

    users {
        text id PK
        text email
    }

    user_sessions {
        text id PK
        text user_id FK
        text session_token_hash "unique"
        text refresh_token_hash "unique (nullable)"
        timestamp expires_at
        timestamp created_at
        timestamp last_activity_at
    }

    webauthn_credentials {
        text id PK
        text user_id FK
        text credential_id "unique"
        text public_key_cose
        int counter
        text device_name
        boolean uv
        timestamp created_at
        timestamp last_used_at
    }

    webauthn_challenges {
        text id PK
        text challenge "unique"
        text user_id "FK users.id (nullable)"
        text type
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    magic_links {
        text id PK
        text token_hash "unique"
        text email
        text user_id "FK users.id (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }

    email_verification_codes {
        text id PK
        text code_hash
        text email
        text verification_token "unique (nullable)"
        timestamp expires_at
        boolean used
        timestamp created_at
    }
```

## Chat / streaming / tracing

```mermaid
erDiagram
    users ||--o{ chat_sessions : "user_id"
    workspaces ||--o{ chat_sessions : "workspace_id (nullable)"

    chat_sessions ||--o{ chat_messages : "session_id"
    chat_sessions ||--o{ chat_contexts : "session_id"
    chat_messages ||--o{ chat_stream_events : "message_id (nullable)"
    chat_messages ||--o{ chat_message_feedback : "message_id"

    chat_sessions ||--o{ chat_generation_traces : "session_id"
    chat_messages ||--o{ chat_generation_traces : "assistant_message_id"
    users ||--o{ chat_generation_traces : "user_id"
    workspaces ||--o{ chat_generation_traces : "workspace_id (nullable)"
    users ||--o{ chat_message_feedback : "user_id"

    chat_sessions ||--o{ context_modification_history : "session_id (nullable)"
    chat_messages ||--o{ context_modification_history : "message_id (nullable)"
    job_queue ||--o{ context_modification_history : "job_id (nullable)"

    workspaces ||--o{ context_documents : "workspace_id"
    job_queue ||--o{ context_documents : "job_id (nullable)"
    context_documents ||--o{ context_document_versions : "document_id"

    chat_sessions {
        text id PK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text primary_context_type
        text primary_context_id
        text title
        timestamp created_at
        timestamp updated_at
    }

    chat_messages {
        text id PK
        text session_id FK
        text role
        text content
        jsonb contexts
        jsonb tool_calls
        text tool_call_id
        text model
        int sequence
        timestamp created_at
    }

    chat_message_feedback {
        text id PK
        text message_id FK
        text user_id FK
        int vote "1=up, -1=down"
        timestamp created_at
        timestamp updated_at
    }

    chat_stream_events {
        text id PK
        text message_id "FK chat_messages.id (nullable)"
        text stream_id
        text event_type
        jsonb data
        int sequence
        timestamp created_at
    }

    chat_contexts {
        text id PK
        text session_id FK
        text context_type
        text context_id
        jsonb snapshot_before
        jsonb snapshot_after
        jsonb modifications
        timestamp modified_at
        timestamp created_at
    }

    chat_generation_traces {
        text id PK
        text session_id FK
        text assistant_message_id FK
        text user_id FK
        text workspace_id "FK workspaces.id (nullable)"
        text phase
        int iteration
        text model
        text tool_choice
        jsonb tools
        jsonb openai_messages
        jsonb tool_calls
        jsonb meta
        timestamp created_at
    }

    context_modification_history {
        text id PK
        text context_type
        text context_id
        text session_id "FK chat_sessions.id (nullable)"
        text message_id "FK chat_messages.id (nullable)"
        text job_id "FK job_queue.id (nullable)"
        text field
        jsonb old_value
        jsonb new_value
        text tool_call_id
        int sequence
        timestamp created_at
    }

    context_documents {
        text id PK
        text workspace_id FK
        text context_type
        text context_id
        text filename
        text mime_type
        int size_bytes
        text storage_key
        text status
        jsonb data
        text job_id "FK job_queue.id (nullable)"
        int version
        timestamp created_at
        timestamp updated_at
    }

    context_document_versions {
        text id PK
        text document_id FK
        int version
        text filename
        text mime_type
        int size_bytes
        text storage_key
        jsonb data
        timestamp created_at
    }
```

Notes :
- `context_modification_history.context_type/context_id` sont des **références logiques** (pas de FK DB) vers `organizations/folders/use_cases` (et `folders` pour `executive_summary`).
- `chat_stream_events.message_id` est nullable : les appels structurés utilisent `stream_id` déterministe (`folder_<id>`, `usecase_<id>`, etc.).
- `context_documents.context_type/context_id` sont des **références logiques** (pas de FK DB) vers `organizations/folders/use_cases`.
- `chat_message_feedback` stocke le feedback par utilisateur sur les messages assistant (unique par `message_id` + `user_id`).

