# P0 — Conductor dispositions and held decisions

Effective dispatch date: **2026-10-28**. Source: approved plan §6 and Opus r2 refinements. These are the bounded defaults applied to this migration contract. They do not retrospectively ratify historical proposals or grant owner/domain/registry authority. [Contract and acknowledgement ledger](CHAT_MIGRATION_P0.md).

The Sentropic conductor is the accountable single writer for the corresponding Track decision/disposition events, recording scope, date and this evidence. The code author records the dispositions here and requested that conductor trace over h2a; no Track event is claimed merely because this document exists. No local `.track` write, import or reparent is performed in P0.

| Decision / open since | Applied migration default | Owner / scope / review |
| --- | --- | --- |
| cited-source-viewer / 2026-07-18 | Park activation and transfer; reopen only with a named citation host and end-to-end acceptance case. | Sentropic package maintainer; F11; review park at M4. |
| P0/M0 inventory | Inventory behaviors, runtime/visual files, consumers and deletion candidates now; assign existing lane roles. M0 remains paper only. | Sentropic integration conductor + DS counterpart; no DS import/custody/publisher/source-deletion act before U0's two GOs. |
| Local tools | Default deny: missing permission adapter, explicit denial and timeout execute nothing; show pending/denied state. | Sentropic runtime maintainer, P1; required safety contract, no new owner choice. |
| DS program D7 / 2026-08-21 | Dated, non-increasing DS-deviation budget for **chat lots only**. P0 measures 75 widget `dark:` tokens and catalogs existing overrides; no new chat styling route. | UI/DS theming maintainers; P2b/P3; zero widget variants at joint exit. This is not SURFACES runtime D7. |
| Agents O4 / 2026-07-29 | Assistant chat has one home, `agents`; reserve `chats` for inter-user threads. | Agents integration lead; F1/F3/F4; not a P0 tab rename. |
| Agents O5 / 2026-07-29 | Preserve job kind icon/filter and cancel/retry/delete/history/purge in agents listing. | Agents integration lead; F1; projection cannot discard actions or duplicate chat-message jobs. |
| Agents O6 / 2026-07-29 | Plan Claude then Codex adapters; live tail running sessions, on-open snapshot inactive sessions. **No transcript export/egress authorized.** | Transcript lane; F5 ordering only; D21 remains architect + owner gate. |
| Agents O7 / 2026-07-29 | One delegated level expanded; deeper levels collapsed with counts; propagate pending input upward. | Agents/transcript view owners; F2/F5; no additional visibility grant. |
| L-A′ Chrome/VSCode ownership / 2026-07-29 | Existing plugin maintainers own edits and qualification; cowork-bridge integration uses an explicit lane hand-over naming scope and acceptance. | Plugin/cowork owners, F1. Existing breaking GO remains valid; do not request it again or silently take another lane. |
| Turnkey D1 / 2026-06-02 | Continue 38d adoption using shipped 38c primitives. | App/chat integration lead, P0–P2; no restart of completed extraction. |
| Turnkey D2 / 2026-06-02 | Current app/chat integration role works with package/runtime maintainer counterpart. | P1/P2; do not wait for historical `38etc`. |
| Turnkey D3 / 2026-06-02 | Preserve existing bubble/floating, docked and inline behavior; new placements are separately gated. | UI/host acceptance leads, P1/P5/U0; no inline-only parity shortcut. |
| Turnkey D4 / 2026-06-02 | Use shipped attachment tray/lightbox/upload where matching host capability exists; preserve current app attachment behavior. | Runtime/UI/host maintainers, P1/P2; no app duplicate or silent no-op. |
| Turnkey D5 / 2026-06-02 | Finish parity composition/adoption before transfer; siblings qualify the same artifacts and revised P0–U0 estimates. | UI/runtime release + consumer owners; P1 runtime-import break explicitly versioned, publication separately gated. |
| Turnkey D6 / 2026-06-02 | DS tokens with Sentropic small density (`sm` where supported); same components support other presets. | DS theme + app integration owners, P3; no parallel exact-only skin. |
| Runtime package (r2 note 1) | Name canonical Sentropic package **`@sentropic/chat-runtime`**. P1 removes old chat-ui runtime exports in a breaking release and migrates all consumers before U0. | Runtime/UI release owners; notify every inventoried host/sibling owner; new bootstrap/publication still requires npm grant. |

**O2 remains a proposal**, open since 2026-07-29: agent → newest-first sessions plus virtual continuous history retaining session boundaries/storage. Review at F2 entry; neither ratified nor dispatched here; no transfer dependency.

The 2026-06-02 immo/counteroffer hold is historical negotiation state. P0 inventories current sibling consumers and preserves the role handoff; it does not reopen extraction or infer a new sibling acceptance from an old request.

| Held decision | Authority and required evidence | Named gate / safe interim |
| --- | --- | --- |
| **UAT GO** | Owner personally tests migrated exact main revision + web/Chrome/VSCode artifacts; actual words and outcomes recorded verbatim through Track CLI. | U0 blocks M1/M1b/M2/M3; no agent/CI substitute. |
| **Transfer GO** | Owner separately authorizes visual custody under runtime-excluding contract; record a distinct actual answer. | U0; initial tentative direction and P0 authorization do not grant transfer. |
| npm publication/trusted publisher | npm organization administrator/authorized owner grants DS chat-ui handover and Sentropic runtime bootstrap/publication through CI; one publisher per package. | M2 and runtime publication wait; UAT/transfer GO does not grant registry rights. |
| Agents O3 / 2026-07-29 | Owner or authorization-domain owner decides other-principal perennial-agent visibility under C-07. | F2/F5 cross-principal expansion only; **own-principal everywhere** until explicit authority, including perennial agents. ACL existence is insufficient. |
| D21 transcript posture | **Architect + owner** approve precise redaction/egress/cache/logging contract; recommended metadata-first, own-principal, read-only, no server persistence/blind capture. | F5 egress, including own-principal foreign transcripts. O6 ordering is not consent. |
| DS D7-a transverse freeze / 2026-08-21 | Owner decides any extension beyond chat to `ui/src/**`/other lanes with cross-lane cost presented. | Until then only chat-local budget applies; conductor cannot impose a transverse freeze. |
| C-03 boundary disagreement | DS and Sentropic domain owners co-freeze; escalate a concrete unresolved disagreement to the owner before M1. | Runtime/tool machinery remains outside DS by default; no vote or implied permission to widen custody. |

G1/G2/G3/H1 and the earlier L-A′ breaking GO remain settled. Follow-on feature decisions block their named follow-ons only. Owner personal UAT/transfer and registry gates continue to block their corresponding transfer/release acts.
