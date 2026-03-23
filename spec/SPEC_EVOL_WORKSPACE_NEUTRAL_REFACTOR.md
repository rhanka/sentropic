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

### UI
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
