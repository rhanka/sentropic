# SPEC EVOL — Workspace Neutral Refactor

Status: Intent (2026-03-23) — not yet scheduled

## 1) Motivation

After hands-on usage of the workspace-type model (ai-ideas, opportunity, code, neutral), several design frictions emerged:

- Workspaces are currently typed, but the type constrains what can happen inside too rigidly.
- Folders are tied to a single generation workflow, but real usage mixes workflows.
- Code workspaces are isolated from ideation/opportunity workflows, preventing continuity.
- Reports/summaries are generated per-initiative but not modeled as first-class folder-level objects.

## 2) Core principles of the refactor

### 2.1 Workspace becomes neutral by default

A workspace is a **collaborative space with access rights**, not a workflow container. It can host multiple workflow types (opportunities, ai-ideas, code, etc.) simultaneously. The current `workspace_type` field becomes a default/preferred workflow hint, not a hard constraint.

### 2.2 Folder becomes a neutral receptacle

A folder is populated by one or more **generation runs** that produce objects (opportunity initiatives, AI ideation initiatives, etc.). The folder itself is workflow-agnostic. Multiple generation types can coexist in the same folder.

### 2.3 Reports/summaries as first-class objects

Executive summaries and synthesis reports become a distinct object type attached to a **collection** (e.g., all initiatives in a folder). They are produced in the folder alongside the initiatives, not as a side-effect of a single initiative.

- Folder view: lists all objects (initiatives + reports + other generated objects)
- Initiatives view: filters to initiatives only
- Reports view: filters to report/summary objects only

### 2.4 Code workspace becomes a folder

A GitHub repo maps to a **folder** inside a workspace, not a separate workspace. This enables:

- Ideation (backlog, issues as opportunities) and coding in the same workspace
- Multi-repo management within one workspace
- Continuity from opportunity discovery → initiative creation → code implementation

### 2.5 Chat contextualization by folder

Chat sessions are scoped to the **folder**, adapting to the content mix:

- `chat_code` mode activates on folders containing code repos
- In VSCode, only sessions associated with a "code folder" are visible
- Mixed folders (code + opportunities) can switch chat mode contextually

## 3) Impact assessment (preliminary)

### Data model
- `workspace_type` becomes optional/hint (not a hard gate for workflows)
- `folder` gains a `content_types[]` or similar to track what's inside
- New object type for reports/summaries at folder level
- Code workspace migration: existing code workspaces become folders in a parent workspace

### Workflows
- Workflow registry must support multiple workflows per workspace (already partially done with generic dispatch)
- Gate system adapts per-object-type, not per-workspace-type

### UI — Purely template-driven entity views

All entity views (initiative, organisation, report/dashboard) must be **purely template-driven**. No per-entity-type page logic.

#### Single dynamic route

```
/entity/[type]/[id]
```

One route, one page file. The `type` param determines the template and API endpoint. This forces generic rendering — no hardcoded per-type pages.

#### EntityPage wrapper

The page file contains only:

```svelte
<EntityPage objectType={type} entityId={id} />
```

`EntityPage` handles all cross-cutting concerns generically:

| Concern | Implementation |
|---|---|
| Template resolution | `resolveViewTemplate(workspaceType, objectType)` |
| Data loading | `apiGet(/entities/{type}/{id})` or type-specific endpoint |
| SSE stream | Subscribe to entity stream, update `data` on events |
| Collaborative editing | `dirtyFields: Set<string>` — SSE updates skip fields being edited locally. EditableInput signals dirty on focus, clean on save. |
| Lock/presence | Acquire lock on mount, release on leave. Pass `locked` prop. |
| Comment counts | Fetch and pass `commentCounts` + `onOpenComments` callback |
| Header | Template-driven — a field `type: "header"` in the template with title, badges, org link |
| FileMenu | Import/export/delete — generic by objectType |
| Save handlers | `apiEndpoint` derived from objectType+entityId, `onFieldSaved` triggers data reload |
| Print mode | `beforeprint`/`afterprint` listeners, pass `isPrinting` prop |

#### TemplateRenderer becomes stateless

Current state (BR-04B): TemplateRenderer manages its own `textBuffers`, `listBuffers`, `scoreBuffers` + SSE reactive sync block (100+ lines).

Target state: TemplateRenderer receives `data` as a read-only prop. No internal buffers. EntityPage manages the data lifecycle:
- EntityPage holds `data` + `dirtyFields`
- SSE update arrives → EntityPage updates `data` for all fields NOT in `dirtyFields`
- User edits a field → EditableInput signals `dirty` → field added to `dirtyFields`
- User saves → EditableInput signals `clean` → field removed from `dirtyFields`, `data` updated with saved value

#### Dashboard becomes a report entity

The current dashboard is not an entity — it's a page with hardcoded layout. In the target state:
- A **report** is a first-class entity created in the folder (type `report`)
- The dashboard page becomes `/entity/report/[id]`
- The report template defines: cover page, sommaire, synthèse, scatter plot, introduction, analyse, recommandation, references, annexes (entity-loop over folder initiatives)
- Scatter plot, cover page, sommaire are `component` slots — EntityPage provides them generically or the template references reusable components

This eliminates: `initiative/[id]/+page.svelte` (635 lines), `organizations/[id]/+page.svelte` (669 lines), `dashboard/+page.svelte` (1800+ lines).

### UI — Other
- Folder view needs multi-type object listing with type filters
- Workspace creation simplified (no mandatory type selection upfront)
- Settings: workflow configuration per workspace becomes "available workflows" (multi-select)

### Chat
- Session context includes folder content types
- chat_code mode triggered by folder content, not workspace type
- VSCode plugin filters by folder type, not workspace type

### Chrome/VSCode plugins
- VSCode: filter sessions by folder containing code, not by workspace type
- Chrome: no change (already folder-agnostic)

## 4) Dependencies and sequencing considerations

### Must be done AFTER
- BR-04B Segment C (view template system) — the view templates provide the rendering flexibility needed for multi-type folder views
- BR-04B Segment D (document generation) — reports as objects needs the document generation infrastructure

### Could be done BEFORE or IN PARALLEL with
- BR-06 (chrome upstream) — independent capability
- BR-19 (agent sandbox) — independent, but skill catalog could benefit from per-folder-type skill scoping

### Breaking changes
- `workspace_type` semantics change — existing data migration needed
- Code workspace → folder migration
- Workflow gate logic refactor (per-object instead of per-workspace)

## 5) Open questions

- Q1: Should workspace_type be fully removed or kept as a "template" for initial setup?
- Q2: How to migrate existing code workspaces to folders? Automatic or manual?
- Q3: Report objects — new DB table or extension of existing initiative/document model?
- Q4: Multi-workflow folders — how to handle conflicting tool sets in chat?
