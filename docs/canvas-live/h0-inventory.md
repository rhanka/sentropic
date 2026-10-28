# Canvas live H0: consumer and save-authority inventory

H0 is preparation for existing Canvas L2-CB3, not an implementation or adoption receipt. Measured on 2026-10-28 at `origin/main` / branch base `5e986a0b6cd2dfecfbde6a588d30055271124696`. All source line references in this note resolve at that commit. See [transfer receipts](h0-transfer-receipts.md), [gates](h0-gates.md) and [corpus](h0-corpus.md).

## Baseline and drift

The approved host plan is SHA-256 `f130f04c4597b483b089ef5b3b6d6d9502b61a36111859f62f835b37c9bc19e2`, H0 lines 69–81. Its survey pin is `de7ab8d3157b1859648e0404b78c182ea9cd21e4`. `git diff <survey> <base> -- <the ten files below> packages/chat-core/src/ports.ts ui/src/lib/extensions` returned no output: **zero drift** in those evidence paths. No statement of zero drift elsewhere is implied.

`rg -n '<EditableInput' ui/src` yields **24 mounts across 10 files**, including layout alternatives and repeated rows only once per source site. Every row below has one class and one host save authority. Citation decoration is an overlay, not an additional mount/class. `migrated 0/24`; all seven adoption classes remain `not-started`.

| Alias | Source file under `ui/src/` | Count |
| --- | --- | --- |
| T | `lib/components/TemplateRenderer.svelte` | 8 |
| S | `lib/components/ScoreTable.svelte` | 1 |
| FN | `routes/folder/new/+page.svelte` | 2 |
| FD | `routes/folders/[id]/+page.svelte` | 2 |
| M | `routes/matrix/+page.svelte` | 3 |
| C | `lib/components/chat/AppChatPanel.svelte` | 3 |
| O | `lib/components/OrganizationForm.svelte` | 2 |
| I | `lib/components/InitiativeDetail.svelte` | 1 |
| D | `routes/dashboard/+page.svelte` | 1 |
| W | `lib/components/WorkspaceSettingsPanel.svelte` | 1 |

| Mount | Site | Field / mode | Exactly one class | Save authority |
| --- | --- | --- | --- | --- |
| T1 | T:499 | Main span `field.key`, Markdown | templater-prose-score | A-T |
| T2 | T:520 | Main span list, `forceList=true` | templater-list | A-T |
| T3 | T:539 | Main grid text, Markdown | templater-prose-score | A-T |
| T4 | T:560 | Main grid list, `forceList=true` | templater-list | A-T |
| T5 | T:580 | Sidebar text, Markdown | templater-prose-score | A-T |
| T6 | T:600 | Sidebar list, `forceList=true` | templater-list | A-T |
| T7 | T:660 | Flat row text, Markdown | templater-prose-score | A-T |
| T8 | T:684 | Flat row list, `forceList=true` | templater-list | A-T |
| S1 | S:73 | Axis score `description`, Markdown | templater-prose-score | A-S |
| FN1 | FN:446 | Folder name, plain multiline | plain | A-FN |
| FN2 | FN:614 | Folder description/context, Markdown | folder-context | A-FN |
| FD1 | FD:541 | Folder name, plain multiline | plain | A-F |
| FD2 | FD:648 | Folder description/context, Markdown | folder-context | A-F |
| M1 | M:1142 | Value-axis name, Markdown | matrix | A-M |
| M2 | M:1245 | Complexity-axis name, Markdown | matrix | A-M |
| M3 | M:1483 | Level description, Markdown | matrix | A-M |
| C1 | C:3131 | Comments string composer, shell disabled | chat-composer-edit | A-COM |
| C2 | C:3228 | Message edit, no lock/disabled prop | chat-composer-edit | A-EDIT |
| C3 | C:3369 | AI string composer, typeable during send | chat-composer-edit | A-CHAT |
| O1 | O:124 | Organization name, plain multiline | plain | A-O |
| O2 | O:157 | Organization industry, plain single-line | plain | A-O |
| I1 | I:203 | Initiative name, plain multiline | plain | A-I |
| D1 | D:1154 | Folder name, plain multiline | plain | A-F |
| W1 | W:278 | Workspace name, plain single-line | plain | A-W |

Class totals: templater-prose-score **5**, templater-list **4**, folder-context **2**, matrix **3**, chat-composer-edit **3**, plain **7** = **24**. Mode totals: **17 Markdown + 7 plain**. The citation overlay gate applies to T/S/C without counting them twice.

## Save authorities and server enforcement observed

These are current source facts, not claims that H5 conditional-save/publication qualification has passed. `EditableInput.svelte:142–163` obtains the current getter payload and calls `apiPut`; its lock prop is only a client gate. Server rejection and atomic version/base checks must be witnessed independently.

| Authority | Payload / trigger | Server route and existing authority |
| --- | --- | --- |
| A-T | Caller endpoint; `getTextFullData` normalizes/strips trailing empty paragraphs; `getListFullData` converts array/Markdown; nested keys rebuild sibling data (T:343–359) | `/organizations/:id`, `/initiatives/:id` or `/folders/:id` according to caller object; corresponding product business router below. Empty endpoint keeps local creation state. |
| A-S | Caller endpoint with `getScoreFullData(axis.id)`; full score array preserves axis/rating/siblings (T:360 onward) | Same object-selected product business router as A-T; no separate score writer. |
| A-FN | Local buffer before ID; persisted draft uses `/folders/:id`; initial creation is `POST /folders` | `api/src/services/business/folders.ts:246,389`; workspace editor and folder lock on existing object. |
| A-F | `{name}` or `{description}`, selected folder ID | `PUT /folders/:id`, `api/src/services/business/folders.ts:389–438`; editor + workspace editor, workspace-scoped lookup, `requireLockOwnershipForMutation`. |
| A-M | `getMatrixFullData()` whole current matrix; both axis arrays/weights/levels/thresholds preserved | `PUT /folders/:id/matrix`, same file:546–574; editor + workspace editor, folder lock, workspace-scoped update. |
| A-O | Current organization getter payload; empty endpoint is local creation; caller at `routes/organizations/[id]/+page.svelte:609` | `POST /organizations` / `PUT /organizations/:id`, `api/src/services/business/organizations.ts:196,321–360`; editor + workspace editor, existing-object workspace lookup and organization lock. |
| A-I | `getNameFullData()` merges current initiative data; empty endpoint remains local | `POST /initiatives` / `PUT /initiatives/:id`, `api/src/services/business/initiatives.ts:373,438–473`; registry schema, editor + workspace editor, workspace lookup and initiative lock. |
| A-W | `{name: editedSelectedWorkspaceName}`; no mount lock prop | `PUT /workspaces/:id`, `api/src/routes/namespaces/workspaces/product-workspaces.ts:90–120`; editor + `requireWorkspaceAdmin`, immutable type, name length 1–128. No live lock/version/base parameter in this handler. |
| A-COM | Shell comment send consumes string; no `apiEndpoint` autosave | `POST /comments` (edit: `PATCH /comments/:id`); `packages/comments/src/hono.ts:142,210`, product authz in `api/src/routes/namespaces/comments-ports.ts:51–78`: authentication, workspace commenter, tenant target/thread existence; edit author/admin. No object text-lock or live-version guard in these handlers. |
| A-EDIT | `saveEditMessage` trims text, calls `ctrl.edit`, clears edit state then retries (C:1632–1644) | `PATCH /chat/messages/:messageId`, `packages/chat-server/src/index.ts:907–928,1280`; `api/src/routes/namespaces/chat.ts:23–33` requires workspace editor; service receives authenticated user ID. No client lock gate and no live-version guard in this handler. |
| A-CHAT | `ctrl.send` consumes composer capture (C:2829); no autosave | `POST /chat/messages`, `packages/chat-server/src/index.ts:1252`; product auth and workspace access plus chat service's session/message authority. No object text-lock gate; send/edit permissions differ and must remain distinct. |

Business routes are injected through `api/src/routes/namespaces/business/{folders,initiatives,organizations}.ts` into `api/src/services/business/*` and the business cutover author fence. `lock-service.ts:50–58` permits mutation if no lock exists or the caller owns it, otherwise rejects. That check and a subsequent write do **not** establish H5's required atomic lock/version/base authority. H0 changes none of these policies.

## Server-side descriptors and stored shapes

| Source | Inventory / limits |
| --- | --- |
| `api/src/services/view-template-service.ts:379–604` | Seeds for `ai-priorities`, `opportunity`, `code`; `neutral` has no detail views. Common organization/dashboard/solution/product/proposal descriptors; initiative descriptors vary by workspace. `tabs → rows → main/sidebar/fields`; editable `text`, `list`, `scores`; other field types `scores-summary`, `chart`, `component`, `child-list`, `entity-loop` are not extra EditableInput sites. |
| Same file:418–456 | Organization text: size, technologies, products, processes, kpis, challenges, objectives; references list. Dashboard text: executiveSummary.synthese_executive/introduction/analyse/recommandation; references list; initiative print loop. |
| Same file:515–600 | Initiative text: deadline, description, problem, solution, contact, domain. Lists: benefits, constraints, metrics, risks, technologies, nextSteps, references; AI-priorities also dataSources/dataObjects. Scores: valueScores/complexityScores. Reference arrays render through a special static branch. |
| `api/src/services/business/view-templates.ts:96–140`; `api/src/db/schema.ts:1473` | Descriptor stored as JSONB, accepted as `z.record(z.string(), z.unknown())`; admin/editor CRUD, code/user resolution and cache in view-template service. Not an exhaustive runtime validator for legal field vocabulary. No DB export was read; custom stored descriptor/content coverage remains unmeasured. |
| `api/src/services/business/folders.ts:17–81` | Matrix string names/descriptions, numeric weights/levels/thresholds; folder name/description, executive summary strings and reference array. No declared rich-text profile. |
| `api/src/services/business/initiatives.ts:49–52`; `api/src/services/object-registry/` | Opportunity JSON schema drives initiative Zod input; existing JSONB business fields and score descriptions are not CRDT structures. |
| `api/src/services/catalog/types.ts:154–174`; `sources/canvas-template-source.ts:59–108` | Separate discovery-only `CanvasTemplate` with `initialContent`; `blank-markdown` and `structured-plan` seeds. Do not confuse catalog canvas descriptors with business view descriptors. |

Source inventory is complete for the ten mounts' code paths. Persisted custom descriptors and production content require an authorized export before claiming population coverage; no mount count is used as a count of business fields.
