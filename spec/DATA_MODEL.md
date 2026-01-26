# Modèle de données (PostgreSQL 16 / Drizzle)

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

    organizations ||--o{ folders : "organization_id (optional)"
    folders ||--o{ use_cases : "folder_id"
    organizations ||--o{ use_cases : "organization_id (optional)"

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
```

Notes :
- `organizations.data` est **JSONB** (profil organisation : `industry`, `size`, `products`, `processes`, `kpis`, `references`, etc.).
- `use_cases.data` est **JSONB** (contient `name`, `description`, scores, etc. – migration 0008).
- `workspaces.owner_user_id` est **nullable** (plus de contrainte unique).
- `workspaces.hidden_at` indique la visibilité (workspaces cachés).
- `workspace_memberships` est la source de vérité des rôles (`viewer` | `editor` | `admin`).

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


