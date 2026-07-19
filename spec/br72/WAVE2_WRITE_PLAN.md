# BR-72 Wave-2 WRITE-Capability Plan

This document outlines the Wave-2 plan for introducing write/mutation capabilities to the three Wave-1 connectors: GitHub (`github`), Google Drive (`googledrive`), and Gmail (`gmail`). It aligns the raw capabilities from the OOMOL capability matrix with the Sentropic platform core contracts defined in `packages/mcp-platform/src/manifest.ts` and `runtime.ts`.

## 1. Architectural Foundations

Every write capability routing through the Sentropic MCP Provider Platform must conform to the strict safety boundaries and contract requirements:

1. **Mutation Gating**: Write/mutation tools are completely segregated from read tools. They are routed through the experimental `mutation-gate` framework under the connector subpath `./experimental` to prevent unauthorized execution.
2. **Authoritative Context**: Capabilities rely on `StpConnectorContext` and its core-resolved parameters. A capability must not perform raw/unverified operations; they must check policy (`requiresPolicy: true`) and principal authorization (`requiresPrincipalGate: true`) Authoritatively.
3. **Idempotency keys**: Every mutating call is subject to `idempotency.required: true` with a scope of `principal` (the individual user boundary). The client must supply an `idempotencyKey` inside the `AppInvocationEnvelope` to ensure safety across retries.
4. **Destructive Safety**: Capabilities that represent destructive, irreversible, or high-risk actions (e.g. deleting repository resources, files, or sending outbound communications to the real world) enforce `requiresHumanConfirmation: true`.

---

## 2. Capability Mutation Matrices

Below are the detailed mutation capability tables mapped from the matrix §7. All capabilities in these tables have `mutatesExternalSystem: true`, `idempotency.required: true` (with `principal` scope), `requiresPrincipalGate: true`, and `requiresPolicy: true`.

### 2.1 GitHub (`github`)

The GitHub connector maps **66 write capabilities** out of its total 145 actions. Destructive operations (all `github.delete_*` tools) enforce `requiresHumanConfirmation: true` to prevent accidental loss of workspace state.

| OOMOL Action ID | Category | Mutability | HC Gate | Descriptors Exercised |
| :--- | :--- | :--- | :---: | :--- |
| `github.add_issue_assignees` | write | patch | false | mutation-gate, idempotency |
| `github.add_issue_labels` | write | patch | false | mutation-gate, idempotency |
| `github.add_repository_collaborator` | write | patch | false | mutation-gate, idempotency, follow-up chaining |
| `github.cancel_workflow_run` | workflow | state-transition | false | mutation-gate, idempotency, async lifecycle |
| `github.clear_issue_labels` | write | patch | false | mutation-gate, idempotency |
| `github.create_commit_comment` | write | append | false | mutation-gate, idempotency |
| `github.create_commit_status` | write | append | false | mutation-gate, idempotency |
| `github.create_issue` | write | append | false | mutation-gate, idempotency, follow-up chaining |
| `github.create_issue_comment` | write | append | false | mutation-gate, idempotency |
| `github.create_issue_comment_reaction` | write | append | false | mutation-gate, idempotency |
| `github.create_issue_reaction` | write | append | false | mutation-gate, idempotency |
| `github.create_label` | write | append | false | mutation-gate, idempotency |
| `github.create_milestone` | write | append | false | mutation-gate, idempotency |
| `github.create_or_update_file` | write | state-transition | false | mutation-gate, idempotency, upsert/composite, rate-limit |
| `github.create_pull_request` | write | append | false | mutation-gate, idempotency, follow-up chaining |
| `github.create_pull_request_review` | write | append | false | mutation-gate, idempotency, follow-up chaining |
| `github.create_pull_request_review_comment` | write | append | false | mutation-gate, idempotency |
| `github.create_ref` | write | append | false | mutation-gate, idempotency |
| `github.create_release` | write | append | false | mutation-gate, idempotency, follow-up chaining |
| `github.create_repository` | write | append | false | mutation-gate, idempotency, follow-up chaining |
| `github.delete_file` | transaction | delete | **true** | mutation-gate, idempotency, rate-limit |
| `github.delete_issue_comment` | transaction | delete | **true** | mutation-gate, idempotency |
| `github.delete_label` | transaction | delete | **true** | mutation-gate, idempotency |
| `github.delete_milestone` | transaction | delete | **true** | mutation-gate, idempotency |
| `github.delete_pending_pull_request_review` | transaction | delete | **true** | mutation-gate, idempotency |
| `github.delete_pull_request_review_comment` | transaction | delete | **true** | mutation-gate, idempotency |
| `github.delete_ref` | transaction | delete | **true** | mutation-gate, idempotency |
| `github.delete_release` | transaction | delete | **true** | mutation-gate, idempotency |
| `github.delete_release_asset` | transaction | delete | **true** | mutation-gate, idempotency |
| `github.delete_repository` | transaction | delete | **true** | mutation-gate, idempotency |
| `github.disable_workflow` | write | patch | false | mutation-gate, idempotency |
| `github.dismiss_pull_request_review` | write | state-transition | false | mutation-gate, idempotency |
| `github.dispatch_workflow` | workflow | state-transition | false | mutation-gate, idempotency, async lifecycle |
| `github.enable_workflow` | write | patch | false | mutation-gate, idempotency |
| `github.fork_repository` | write | append | false | mutation-gate, idempotency, async lifecycle |
| `github.lock_issue` | write | patch | false | mutation-gate, idempotency |
| `github.merge_branch` | write | state-transition | false | mutation-gate, idempotency |
| `github.merge_pull_request` | write | state-transition | false | mutation-gate, idempotency |
| `github.remove_issue_assignees` | write | patch | false | mutation-gate, idempotency |
| `github.remove_issue_label` | write | patch | false | mutation-gate, idempotency |
| `github.remove_pull_request_reviewers` | write | patch | false | mutation-gate, idempotency |
| `github.remove_repository_collaborator` | write | patch | false | mutation-gate, idempotency |
| `github.rename_branch` | write | patch | false | mutation-gate, idempotency |
| `github.replace_repository_topics` | write | patch | false | mutation-gate, idempotency |
| `github.reply_pull_request_review_comment` | transaction | append | false | mutation-gate, idempotency |
| `github.request_pull_request_reviewers` | write | state-transition | false | mutation-gate, idempotency, follow-up chaining |
| `github.rerequest_check_run` | write | state-transition | false | mutation-gate, idempotency |
| `github.rerequest_check_suite` | write | state-transition | false | mutation-gate, idempotency |
| `github.rerun_failed_jobs` | workflow | state-transition | false | mutation-gate, idempotency, async lifecycle |
| `github.rerun_workflow` | workflow | state-transition | false | mutation-gate, idempotency, async lifecycle |
| `github.set_issue_labels` | write | patch | false | mutation-gate, idempotency |
| `github.star_repository` | write | state-transition | false | mutation-gate, idempotency |
| `github.submit_pull_request_review` | workflow | state-transition | false | mutation-gate, idempotency |
| `github.sync_fork_branch_with_upstream` | workflow | state-transition | false | mutation-gate, idempotency, async lifecycle |
| `github.unlock_issue` | write | patch | false | mutation-gate, idempotency |
| `github.unstar_repository` | write | state-transition | false | mutation-gate, idempotency |
| `github.update_issue` | write | patch | false | mutation-gate, idempotency |
| `github.update_issue_comment` | write | patch | false | mutation-gate, idempotency |
| `github.update_label` | write | patch | false | mutation-gate, idempotency |
| `github.update_milestone` | write | patch | false | mutation-gate, idempotency |
| `github.update_pull_request` | write | patch | false | mutation-gate, idempotency |
| `github.update_pull_request_branch` | write | patch | false | mutation-gate, idempotency |
| `github.update_pull_request_review_comment` | write | patch | false | mutation-gate, idempotency |
| `github.update_ref` | write | patch | false | mutation-gate, idempotency |
| `github.update_release` | write | patch | false | mutation-gate, idempotency |
| `github.update_repository` | write | patch | false | mutation-gate, idempotency |

---

### 2.2 Google Drive (`googledrive`)

The Google Drive connector maps **23 write capabilities** out of 43 total actions. In addition to file/metadata deletions, `googledrive.permissions.create` is marked as requiring human confirmation (`HC Gate = true`) due to the irreversible and security-sensitive nature of granting external system access/sharing folders and files.

| OOMOL Action ID | Category | Mutability | HC Gate | Descriptors Exercised |
| :--- | :--- | :--- | :---: | :--- |
| `googledrive.comments.create` | write | append | false | mutation-gate, idempotency |
| `googledrive.comments.delete` | transaction | delete | **true** | mutation-gate, idempotency |
| `googledrive.comments.update` | write | patch | false | mutation-gate, idempotency |
| `googledrive.drives.create` | write | append | false | mutation-gate, idempotency, follow-up chaining |
| `googledrive.drives.delete` | transaction | delete | **true** | mutation-gate, idempotency |
| `googledrive.drives.hide` | write | state-transition | false | mutation-gate, idempotency |
| `googledrive.drives.unhide` | write | state-transition | false | mutation-gate, idempotency |
| `googledrive.drives.update` | write | patch | false | mutation-gate, idempotency |
| `googledrive.files.copy` | write | append | false | mutation-gate, idempotency, follow-up chaining, rate-limit |
| `googledrive.files.create` | write | append | false | mutation-gate, idempotency, follow-up chaining, rate-limit |
| `googledrive.files.delete` | transaction | delete | **true** | mutation-gate, idempotency, rate-limit |
| `googledrive.files.emptyTrash` | write | state-transition | false | mutation-gate, idempotency |
| `googledrive.files.generateIds` | write | state-transition | false | mutation-gate, idempotency |
| `googledrive.files.modifyLabels` | write | state-transition | false | mutation-gate, idempotency |
| `googledrive.files.update` | write | patch | false | mutation-gate, idempotency, rate-limit |
| `googledrive.permissions.create` | transaction | state-transition | **true** | mutation-gate, idempotency |
| `googledrive.permissions.delete` | transaction | delete | **true** | mutation-gate, idempotency |
| `googledrive.permissions.update` | write | patch | false | mutation-gate, idempotency |
| `googledrive.replies.create` | write | append | false | mutation-gate, idempotency |
| `googledrive.replies.delete` | transaction | delete | **true** | mutation-gate, idempotency |
| `googledrive.replies.update` | write | patch | false | mutation-gate, idempotency |
| `googledrive.revisions.delete` | transaction | delete | **true** | mutation-gate, idempotency |
| `googledrive.revisions.update` | write | patch | false | mutation-gate, idempotency |

---

### 2.3 Gmail (`gmail`)

The Gmail connector maps **26 write capabilities** out of 46 total actions. Outbound communication (`gmail.send_email`) is gated as requiring human confirmation (`HC Gate = true`) as sending an email to external users is irreversible.

| OOMOL Action ID | Category | Mutability | HC Gate | Descriptors Exercised |
| :--- | :--- | :--- | :---: | :--- |
| `gmail.add_label_to_email` | write | patch | false | mutation-gate, idempotency |
| `gmail.batch_modify_messages` | workflow | state-transition | false | mutation-gate, idempotency, batch, rate-limit |
| `gmail.create_draft` | write | append | false | mutation-gate, idempotency, follow-up chaining |
| `gmail.create_email_draft` | write | append | false | mutation-gate, idempotency, follow-up chaining |
| `gmail.create_filter` | write | append | false | mutation-gate, idempotency |
| `gmail.create_label` | write | append | false | mutation-gate, idempotency |
| `gmail.delete_draft` | transaction | delete | **true** | mutation-gate, idempotency |
| `gmail.delete_filter` | transaction | delete | **true** | mutation-gate, idempotency |
| `gmail.delete_label` | transaction | delete | **true** | mutation-gate, idempotency |
| `gmail.modify_thread_labels` | write | state-transition | false | mutation-gate, idempotency |
| `gmail.move_thread_to_trash` | write | patch | false | mutation-gate, idempotency |
| `gmail.move_to_trash` | write | state-transition | false | mutation-gate, idempotency |
| `gmail.patch_label` | write | patch | false | mutation-gate, idempotency |
| `gmail.reply_email` | transaction | append | false | mutation-gate, idempotency, rate-limit |
| `gmail.reply_to_thread` | transaction | append | false | mutation-gate, idempotency, rate-limit |
| `gmail.send_draft` | transaction | append | false | mutation-gate, idempotency, rate-limit |
| `gmail.send_email` | transaction | append | **true** | mutation-gate, idempotency, rate-limit |
| `gmail.stop_watch` | workflow | state-transition | false | mutation-gate, idempotency, async lifecycle |
| `gmail.untrash_message` | write | state-transition | false | mutation-gate, idempotency |
| `gmail.untrash_thread` | write | state-transition | false | mutation-gate, idempotency |
| `gmail.update_draft` | write | patch | false | mutation-gate, idempotency |
| `gmail.update_imap_settings` | write | patch | false | mutation-gate, idempotency |
| `gmail.update_label` | write | patch | false | mutation-gate, idempotency |
| `gmail.update_language_settings` | write | patch | false | mutation-gate, idempotency |
| `gmail.update_pop_settings` | write | patch | false | mutation-gate, idempotency |
| `gmail.update_vacation_settings` | write | patch | false | mutation-gate, idempotency |

---

## 3. Wave-2 Build Lots

Each connector's implementation is structured as an isolated, self-contained development lot. All mutation tools must be housed under the `./experimental` subpath to allow rigorous gating checks without contaminating the stable read-only surfaces. 

**General Lot Rules & Constraints**:
- **Zero Real Network**: All tests must use local mock adapters/interceptors. No live API endpoints are reached.
- **Zero OOMOL Code Dependency**: Do not import or execute any library from the parent OOMOL project; use local structures mapping to the contract defined in `packages/mcp-platform/src/manifest.ts` and `runtime.ts`.
- **Branch Enforcement**: Every worktree must enforce its path scope mechanically with `@sentropic/harness check scope` and pass version bump audits upon modification of packages.

### Lot 1: `github-write`
* **Target Package**: `packages/mcp-connector-github/`
* **Actionable Scope**:
  1. Establish `packages/mcp-connector-github/src/experimental/` to declare the 66 write capabilities.
  2. Implement the `invokeTool` contract on the adapter, routing capabilities classified as `write`, `transaction`, or `workflow` to the experimental `mutation-gate`.
  3. Create synthetic fixtures (`packages/mcp-connector-github/tests/fixtures/`) defining the mock inputs and expected outputs for all 66 capabilities.
  4. Write Vitest unit tests (e.g. `packages/mcp-connector-github/tests/experimental-gates.test.ts`) asserting that:
     - All 66 write capabilities correctly declare `mutatesExternalSystem: true` and category properties.
     - All 66 write capabilities declare `idempotency: { required: true, scope: 'principal' }`.
     - The 10 destructive delete capabilities declare `gates.requiresHumanConfirmation: true`.
     - Non-destructive capabilities declare `gates.requiresHumanConfirmation: false` but enforce principal gates and policies.
  5. **Upsert Composite Resolution**: Note that the capability `github.create_or_update_file` is historically treated as a single composite operation. Under the Sentropic contract, this creates a gap. The connector must either:
     - Route it through a custom composite-mutation descriptor mapping.
     - Split the capability internally into distinct `append` (create) and `patch` (update) mutability schemas.

### Lot 2: `googledrive-write`
* **Target Package**: `packages/mcp-connector-googledrive/`
* **Actionable Scope**:
  1. Establish `packages/mcp-connector-googledrive/src/experimental/` to declare the 23 write capabilities.
  2. Implement the `invokeTool` contract, routing Google Drive writes to the `mutation-gate`.
  3. Populate synthetic fixtures under `packages/mcp-connector-googledrive/tests/fixtures/` representing comment structures, file metadata templates, and permissions payloads.
  4. Write Vitest unit tests (e.g. `packages/mcp-connector-googledrive/tests/write-gates.test.ts`) asserting that:
     - All 23 write capabilities correctly declare `mutatesExternalSystem: true`.
     - All 23 write capabilities declare `idempotency: { required: true, scope: 'principal' }`.
     - The 7 high-risk capabilities (`googledrive.comments.delete`, `googledrive.drives.delete`, `googledrive.files.delete`, `googledrive.permissions.create`, `googledrive.permissions.delete`, `googledrive.replies.delete`, `googledrive.revisions.delete`) declare `gates.requiresHumanConfirmation: true`.
     - Remaining capabilities declare `gates.requiresHumanConfirmation: false` and declare policy/principal gate enforcement.

### Lot 3: `gmail-write`
* **Target Package**: `packages/mcp-connector-gmail/`
* **Actionable Scope**:
  1. Establish `packages/mcp-connector-gmail/src/experimental/` to declare the 26 write capabilities.
  2. Implement the `invokeTool` contract, routing Gmail writes/sends to the `mutation-gate`.
  3. Populate synthetic fixtures under `packages/mcp-connector-gmail/tests/fixtures/` representing email drafts, filters, labels, and send payload envelopes.
  4. Write Vitest unit tests (e.g. `packages/mcp-connector-gmail/tests/gmail-gates.test.ts`) asserting that:
     - All 26 write capabilities correctly declare `mutatesExternalSystem: true`.
     - All 26 write capabilities declare `idempotency: { required: true, scope: 'principal' }`.
     - The 4 high-risk capabilities (`gmail.delete_draft`, `gmail.delete_filter`, `gmail.delete_label`, `gmail.send_email`) declare `gates.requiresHumanConfirmation: true`.
     - The batch capability `gmail.batch_modify_messages` declares the batch/partial-failure descriptor and handles input lists.
     - Remaining capabilities declare `gates.requiresHumanConfirmation: false` and declare policy/principal gate enforcement.
