# SPEC EVOL — Config UX Alignment (Agent / Workflow / Template)

Status: Validated (2026-03-23)

## 1) Problem

Three config surfaces (agent config, workflow config, view template catalog) have inconsistent UX:
- Different button labels ("Fork" / "Detach" / "Copy" / "Delete")
- Different behaviors (fork creates a 2nd object on agents but does nothing on templates — API missing)
- No "reset to default" anywhere
- Labels are developer jargon ("Fork", "Detach") in a user-facing UI
- "Detach" breaks the link to parent permanently with no way back

## 2) Aligned pattern

All three surfaces use the same 4 actions with the same behavior.

### Actions

| Action | Label FR | Label EN | Icon (Lucide) | When visible | Behavior |
|---|---|---|---|---|---|
| **Copier** | Copier | Copy | `Copy` | System configs only (source=`code`) | Creates a workspace-local copy linked to parent (`parentId` set, `isDetached=false`). The copy appears with "(personnalisé)" badge. |
| **Modifier** | Modifier | Edit | `Pencil` | Copied or user-created configs | Opens the editor. Not available on system configs. |
| **Réinitialiser** | Réinitialiser | Reset to default | `RotateCcw` | Copied configs only (has `parentId`) | Deletes the workspace copy. The system default becomes active again. Confirmation dialog required. |
| **Supprimer** | Supprimer | Delete | `Trash2` | User-created configs only (`sourceLevel='user'`, no `parentId`) | Permanently deletes. Confirmation dialog required. |

### Config source types (mapped to existing schema)

Existing schema fields: `sourceLevel` ('code' | 'admin' | 'user'), `parentId` (nullable), `isDetached` (boolean).

| State | `sourceLevel` | `parentId` | `isDetached` | Badge | Available actions |
|---|---|---|---|---|---|
| System default | `code` | `null` | `false` | `Lock` (gray) | Copier |
| Copied (linked) | `user` | set (→ system parent) | `false` | `UserPen` (blue) + "(personnalisé)" | Modifier, Réinitialiser |
| User-created | `user` | `null` | `false` | none | Modifier, Supprimer |

Note: `isDetached` is **no longer used** in the new UX. Copies are always linked (`isDetached=false`). The "Detach" action is removed. Future evolution: if needed, a "Détacher" action could be added to break the link, but it's out of scope.

### Behavior rules

1. **System configs are never editable** — user must "Copy" first.
2. **Copy** creates a new row: `sourceLevel='user'`, `parentId=<system id>`, `isDetached=false`. Appears in list with "(personnalisé)" badge.
3. **One copy per system config per workspace** — if a copy already exists, "Copier" is hidden; "Modifier" is shown on the existing copy.
4. **Réinitialiser** deletes the copy row. The system default reappears as active.
5. **Supprimer** only for rows with `sourceLevel='user'` AND `parentId=null`. 403 otherwise.
6. **Admin-created configs** (`sourceLevel='admin'`): treated same as system for UX purposes (read-only, copyable).

## 3) API contract

All three routers expose the same endpoints:

| Endpoint | Action | Notes |
|---|---|---|
| `POST /:id/copy` | Copier | Creates workspace copy with `parentId` linked. Returns new object. |
| `PUT /:id` | Modifier | Only on `sourceLevel='user'`. 403 on `code`/`admin`. |
| `POST /:id/reset` | Réinitialiser | Deletes the copy (must have `parentId`). Returns restored system default. |
| `DELETE /:id` | Supprimer | Only on `sourceLevel='user'` with `parentId=null`. 403 otherwise. |

Legacy aliases (deprecated, kept for backward compat):
- `POST /:id/fork` → redirects to `/:id/copy`
- `POST /:id/detach` → **removed** (no longer a valid action)

## 4) Delta per surface

### Agent config (`api/src/routes/api/agent-config.ts` + `ui/src/routes/settings/+page.svelte`)

**Existing state**: `POST /:id/fork` ✅ works (creates 2nd object), `POST /:id/detach` ✅ works (sets `isDetached=true`), no delete, no reset.

**Changes needed**:
- API: rename `fork` → `copy` (keep `fork` as alias). Add `POST /:id/reset` (delete the copy row, return system default). Remove `detach` endpoint (or make it 410 Gone).
- API: add `DELETE /:id` with guard (`sourceLevel='user'` + `parentId=null` only).
- UI: replace "Fork" button → "Copier" (`Copy` icon). Replace "Detach" button → "Réinitialiser" (`RotateCcw` icon). Add "Supprimer" (`Trash2` icon) for user-created. Add `Lock` badge on system, `UserPen` + "(personnalisé)" on copies.
- UI: hide "Copier" when a copy already exists for that parent in the workspace.

### Workflow config (`api/src/routes/api/workflow-config.ts` + `ui/src/routes/settings/+page.svelte`)

**Existing state**: identical to agent config — `POST /:id/fork` ✅, `POST /:id/detach` ✅, no delete, no reset.

**Changes needed**: identical to agent config (same refactoring pattern).

### View template catalog (`api/src/routes/api/view-templates.ts` + `ui/src/lib/components/ViewTemplateCatalog.svelte`)

**Existing state**: `POST /:id/fork` ❌ **NOT IMPLEMENTED** (BUG-C1 — UI calls it but API has no endpoint). `POST /:id/detach` — unclear if implemented. `DELETE /:id` ✅ exists. No reset.

**Changes needed**:
- API: implement `POST /:id/copy` (new — this is BUG-C1 fix). Logic: duplicate the view_template row with `sourceLevel='user'`, `parentId=<source id>`, same `workspaceId`.
- API: implement `POST /:id/reset` (delete copy row).
- API: guard `DELETE /:id` — only allow on `sourceLevel='user'` + `parentId=null`.
- UI: same button/icon/badge changes as agent/workflow.
- UI: hide "Copier" when copy already exists.

## 5) i18n changes

```json
// fr.json — replace
"fork": "Copier",
"detach": "Réinitialiser",
// add
"resetToDefault": "Réinitialiser",
"customized": "personnalisé",
"systemDefault": "Par défaut",

// en.json — replace
"fork": "Copy",
"detach": "Reset to default",
// add
"resetToDefault": "Reset to default",
"customized": "customized",
"systemDefault": "Default",
```

## 6) Icons (Lucide)

| Usage | Icon | Import |
|---|---|---|
| Copier button | `Copy` | `import { Copy } from 'lucide-svelte'` |
| Modifier button | `Pencil` | `import { Pencil } from 'lucide-svelte'` |
| Réinitialiser button | `RotateCcw` | `import { RotateCcw } from 'lucide-svelte'` |
| Supprimer button | `Trash2` | `import { Trash2 } from 'lucide-svelte'` |
| System badge | `Lock` | `import { Lock } from 'lucide-svelte'` |
| Customized badge | `UserPen` | `import { UserPen } from 'lucide-svelte'` |
