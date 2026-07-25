# SPEC_EVOL — ARCH-15 Data lifecycle: residency, retention, export, erasure (BR-56) — SCOPING v1

Status: **SCOPING v1** — produced under the repo's double adversarial review cadence
(**Opus 4.8 xhigh + Codex 5.6-terra xhigh**, independent, CONVERGED on every load-bearing point;
divergences named explicitly below). Owner decisions taken 2026-07-25 are marked **RATIFIED**.
Decision-oriented; every technical claim is grounded in live code with `path:line`, not inferred.
After this → detailed `BRANCH.md` from `plan/BRANCH_TEMPLATE.md` for the implementation lots.
Owner: `chore/arch15-data-lifecycle-study` (BR-56, `PLAN.md:635`).
Registry: `spec/SPEC_EVOL_ARCHITECTURE.md:720` (ARCH-15 — "Data residency, retention, export/deletion").
Assigned to ARCH-15 by ARCH-18: `spec/SPEC_EVOL_DATA_ARCHITECTURE.md:425-426`
(retention/GDPR/erasure-across-planes + PII classification).

## 0. Scope frame (what ARCH-15 IS and IS NOT)

BR-56 is the **retention / erasure / residency contract** across every data plane, and it is one of the
two registered gates on **BR-62** (`PLAN.md:646`, diag.sent-tech.ca anonymous-first proof;
`spec/SPEC_EVOL_ARCHITECTURE.md:775` — ARCH-15 "gates Diag's GDPR posture").

**IN scope**: guest lifecycle contract (status, expiry clock, disposition at expiry, survivorship of
content in a claimed scope); the cross-plane erasure contract and its enumerator; lawful basis +
retention window for quota identifiers; tenant export/hard-delete shape; residency posture; the PII
classification register; the future-plane admission rule.

**OUT of scope (cite and respect the boundary)**: quota enforcement design — ARCH-13
(`spec/SPEC_EVOL_QUOTA_LEDGER.md`, BR-47 DONE, which explicitly "Unblocks ARCH-02 (anonymous quotas)"
at `:53`); guest principal shape / claim / merge mechanism — ARCH-02 (BR-53); storage architecture —
ARCH-18 (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md`); canvas runtime — ARCH-16. ARCH-15 sets POLICY and the
erasure CONTRACT; it does not redesign those subsystems.

## 1. Owner decisions (RATIFIED 2026-07-25)

| id | Decision | Value | Consequence |
|---|---|---|---|
| **O-EXPO** | Diag phase 1 exposure | **Invite-gated / closed**, NOT open internet | The privacy notice + sub-processor statement drop from BLOCKING to fast-follow. Minimum gate set collapses to guest lifecycle + quota-identifier legal posture + one working erasure primitive. Re-opens as blocking the day phase 1 goes open. |
| **O-TTL** | Unclaimed guest retention | **30 days sliding** from last activity | Aligns with the quota-identifier window; a casual visitor loses unclaimed work faster, accepted as the minimisation-first posture. |
| **O-CTRL** | Data controller | **Sent-Tech as an entity** | The LIA and the privacy notice must name Sent-Tech. Both are signed by the controller, never by an agent. |
| **O-TENANT** | Diag tenant identity | **Pooled into `'sentropic'`** (the `workspaces.tenant_id` default, `api/src/db/schema.ts:22`) | Owner ACCEPTED the hazard, stated explicitly: anonymous visitors' **cost** (`control.budgets` is keyed `(scope_kind, scope_key)` incl. `tenant`, `spec/SPEC_EVOL_QUOTA_LEDGER.md:21`) and **authz** blast radius mix into the production tenant. Recorded as an accepted risk, not an oversight. Revisit if diag opens to the internet. |

## 2. Decisions (evaluator-converged unless noted)

**DL-1 — Guest principal carries an explicit lifecycle status and an expiry column.**
The clock lives on the guest row. ARCH-15 owns the DURATION and the semantics; ARCH-02/BR-53 owns the
column and the merge policy. **Critical collision (Opus, verified):** `users.role` DEFAULTS to
`'guest'` (`api/src/db/schema.ts:150`) and `'guest'` ALREADY denotes a *downgraded registered human* —
`approval_expired_readonly` and expired `pending_admin_approval` both coerce `role='guest'`
(`api/src/routes/auth/login.ts:83-84`, `api/src/services/session-manager.ts:219-223`,
`api/src/routes/auth/oauth.ts:137-139`). A guest principal MUST NOT be encoded on `role`; use the
lifecycle axis (`account_status`) plus a dedicated expiry column. Encoding it on `role` would make an
anonymous visitor indistinguishable from a suspended real account and silently grant it `guest` RBAC
(`api/src/middleware/rbac.ts:18`).

**DL-2 — At expiry, an unclaimed guest scope is DELETED, not anonymised.**
Anonymising leaves free-text chat/document content — which routinely carries third-party personal data —
alive with no remaining purpose and no controller basis. That is the WORSE posture, not the safer one.
`spec/SPEC_EVOL_ARCHITECTURE.md:288-289` already names `ON DELETE CASCADE` on the guest user row as the
baseline. Duration = **O-TTL (30d sliding)**.

**DL-3 — One clock, not two.** A guest scope is claimable for its whole life; expiry is the single
clock. A separate, shorter "claim window" guarantees a state where a workspace is alive but
unclaimable — user-hostile and untestable. The claim MECHANISM is ARCH-02
(`spec/SPEC_EVOL_ARCHITECTURE.md:275-280`).

**DL-4 — Content inside a CLAIMED scope outlives its guest author.**
Authorship transfers to a sentinel principal (or to the claiming account) BEFORE the guest row is
deleted. **This is broken in schema today:** `comments.created_by` is `ON DELETE CASCADE` to `users.id`
(`api/src/db/schema.ts:938-940`), so guest cleanup silently destroys comments inside workspaces someone
else claimed — precisely the hazard `spec/SPEC_EVOL_ARCHITECTURE.md:285-287` warns about. ARCH-15 owns
the RULE; ARCH-02 owns the FK re-key mechanism.

**DL-5 — Lawful basis for quota identifiers = Art. 6(1)(f) legitimate interest, with a WRITTEN LIA.**
Purpose: abuse/fraud prevention and service security (Recitals 47/49). Consent is the wrong basis — a
defeatable anti-abuse control is not an anti-abuse control. ARCH-13 already assumed this and deferred
confirmation to ARCH-15 (`spec/SPEC_EVOL_QUOTA_LEDGER.md:45`, and `:57` states no ARCH-15 retention
design exists). **OWNER-ONLY**: the LIA is signed by the controller (**O-CTRL** = Sent-Tech).

**DL-6 — Hashed/salted/HMAC'd quota identifiers REMAIN PERSONAL DATA. The spec says so in those words.**
No "anonymisation" claim may appear anywhere. Reasoning: (a) a salted IPv4 hash is brute-forceable over
a 2^32 space — ARCH-13 already concedes this and moved to keyed HMAC + rotatable pepper
(`spec/SPEC_EVOL_QUOTA_LEDGER.md:45`); (b) keyed HMAC is *pseudonymisation*, not anonymisation — Art. 4(5)
+ Recitals 26/28 keep pseudonymised data fully in scope while the controller retains the means of
re-identification, and here the controller holds the pepper by construction; (c) the identifier is
designed to single out a returning device across records the controller also holds. **The real control
is pepper ROTATION**, which caps cross-period linkability better than any retention rule alone.
Windows: quota-identifier rows deleted at **30 days**; pepper rotated at **90 days**;
`cost_ledger.principal_key` anonymised at 30 days while the monetary aggregate is retained (ARCH-13's
own erasure hook, `spec/SPEC_EVOL_QUOTA_LEDGER.md:45`).

**DL-7 — The browser anonymous id is a first-party cookie value, NEVER a device fingerprint.**
ePrivacy Art. 5(3) is a separate gate from Art. 6 and applies to any storage/access on terminal
equipment. A strictly-necessary first-party value is defensibly exemptible; a canvas/UA-entropy
fingerprint used for quota enforcement is not comfortably exemptible and would drag consent — and a
banner — onto an anonymous-first app. ARCH-15 ASSERTS this as a constraint on ARCH-13's `browserIdHash`
(`spec/SPEC_EVOL_ARCHITECTURE.md:262-266`); it does not redesign the quota key.

**DL-8 — ONE scope enumerator, TWO consumers.** Define a single
`ScopeEnumerator(scope: tenant | workspace | principal)` that lists every table/object family in scope
using the DD9 soft `tenant_id`/`workspace_id` columns. **EXPORT and HARD-DELETE are two consumers of the
same enumeration**, with a conformance test asserting they cover an identical set. Without this they
drift, and the drift is invisible — the classic failure. This is the highest-value architectural
decision in ARCH-15. It also answers `spec/SPEC_EVOL_DATA_ARCHITECTURE.md:394-395` (polymorphic
`(contextType, contextId)` refs have no cascade, so every lifecycle deletion must sweep references).

**DL-9 — A relational cascade is NOT proof of erasure.** The erasure primitive must explicitly enumerate
rows AND external object keys, record retries, and never declare completion from a cascade alone.
Grounding: `context_documents` carries `storage_key` for S3 objects (`api/src/db/schema.ts:762-814`) —
deleting the row does not delete the bytes.

**DL-10 — Erasure capability per plane is declared, and tombstoning is constrained.**
Real delete for PG operational families and S3 objects; tombstone-with-link-severance for append-only
families (ledger, audit, outbox history) per `spec/SPEC_EVOL_DATA_ARCHITECTURE.md:178-179` and
`spec/SPEC_EVOL_EVENT_SPINE.md:52`; crypto-shredding for immutable columnar exports when they exist
(`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:396-398`). **Rule to write down: an append-only family may only be
tombstoned if it carries NO free-text payload** — otherwise the tombstone is a fiction. This forces
payload minimisation on `control.event_audit` at design time rather than as a later rewrite.

**DL-11 — Future-plane admission rule.** No outbox/audit payload, analytics export, knowledge snapshot,
vector index, external mounted-resource cache, or backup format may carry personal content without
(a) a subject/tenant deletion locator and (b) a declared DL-10 capability. This constrains CONSUMERS;
it does not redesign ARCH-14, ARCH-18, or storage. Sufficient now precisely because analytics
(`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:120-129`) and runtime knowledge/vector infrastructure do not exist.

**DL-12 — Erasure UX for a subject with no account.** The guest cookie IS the credential: ship an
in-session "delete everything I created here" action that hard-deletes the guest scope synchronously,
and state in the notice that clearing cookies makes the data unreachable to the subject but that it is
deleted at expiry regardless. An email-based DSAR flow for a principal with no email is theatre.

**DL-13 — Tenant export/hard-delete are DL-8 consumers.** Export = one signed archive (JSONL per
tenant/workspace-scoped control-plane table, a documents manifest plus the S3 objects, comments, and —
when ARCH-19 storage lands — UBO envelopes, with per-family schema/`payloadSchemaVersion` in the
manifest). Hard-delete = the SAME enumeration executed as delete + S3 sweep + ledger principal
anonymisation + a deletion-certificate record. **Not a Diag gate** (phase 1 has no tenants,
`spec/SPEC_EVOL_ARCHITECTURE.md:483-486`).

**DL-14 — Residency is PINNED, not merely defaulted.** Storage residency is already EU by default —
`DOC_STORAGE_REGION` defaults to `fr-par-1` (`api/src/services/storage-s3.ts:25`) — and ARCH-15 pins it
as policy. The unresolved leg is EGRESS: anonymous free-text prompts are sent to third-country LLM
providers, a processor/transfer question with **no technical erasure recourse** (see the matrix). A
sub-processor list + transfer basis is required before OPEN exposure; under **O-EXPO** (invite-gated)
it is fast-follow, but it must exist before phase 1 opens.

**DL-15 — Transparency artefacts.** Art. 13 obligations attach on COLLECTION, not on complaint. There is
currently NO privacy/legal document anywhere in the repo. ARCH-15 owns the required content INVENTORY
(categories, purposes, bases, durations, recipients, rights); the owner owns the TEXT and its
publication. Under **O-EXPO** this is fast-follow for phase 1 and BLOCKING before open exposure.

**DL-16 — PII classification register + declarative policy.** Per-family classification
(`none` | `pseudonymous-identifier` | `direct-identifier` | `free-text-may-contain-PII`), and every
retention duration is a DECLARATIVE config value read by the sweeps (one `data_policy` document:
per-family retention days, residency region, anonymous mode on/off) so a self-hoster can restate policy
without a fork — consistent with the BR-51 portability annex (`PLAN.md:625`) and with ARCH-18's
assignment of PII classification to ARCH-15 (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:425-426`).

**DL-17 — Backups: document, do not automate.** Backups are out of scope for immediate erasure, are
retention-bounded (recommend 35 days), and completed deletions are re-applied at restore time via a
replayable deletion log, so a restore cannot resurrect erased data
(`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:399-400`). Non-blocking for Diag; must be written before the first
real DSAR.

**DL-18 — Pre-existing raw-IP exposure (orthogonal to Diag, must not be silently inherited).**
`user_sessions.ip_address` stores the RAW client IP (`api/src/db/schema.ts:193`; confirmed by
`spec/SPEC_EVOL_QUOTA_LEDGER.md:11` — "raw, no `ipHash`") and there is NO time-based purge: expired
sessions are deleted only on explicit logout/admin action (`api/src/routes/api/me.ts:199`,
`api/src/routes/api/admin.ts:207,332`, `api/src/services/admin-approval-sweep.ts:32`). Raw IPs are
therefore retained indefinitely today. Set an expired-session sweep (recommend 30 days), mirroring the
existing sweep pattern (`api/src/services/chat/stream-purge.ts:23`,
`api/src/services/chat-trace-sweep.ts:6`). **Pre-existing production exposure; deserves its own small
branch, NOT a Diag gate.**

## 3. Cross-plane erasure matrix (verified against live code)

| # | Plane | Capability today | Gap |
|---|---|---|---|
| 1 | PG core rows via FK cascade (`users`→sessions/comments/chat) | real delete | **No entrypoint exists**: no account-deletion route and no `deleteWorkspace` anywhere in `api/src`. Cascade also OVER-deletes (DL-4, `schema.ts:938-940`). |
| 2 | `context_documents` under a workspace | **none** | `workspace_id` references `workspaces.id` with **NO `onDelete`** (`schema.ts:766-769`) → default NO ACTION → a workspace delete is **FK-BLOCKED today**. Must be fixed before any erasure primitive can run. |
| 3 | Polymorphic refs (`comments.context_type/context_id` `:935-936`; `context_documents` `:770-771`) | none (no FK) | Orphan sweep required (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:394-395`). |
| 4 | S3 documents/artifacts | real delete (`api/src/services/storage-s3.ts:229`, `artifact-store/s3-artifact-store.ts:71`) | Reachable only per-document (`api/src/routes/api/documents.ts:376`). No scope-level sweep, no orphan reconciliation, no delete on teardown. |
| 5 | `chat_stream_events`, `chat_generation_traces` | real delete, TIME-based only (`stream-purge.ts:23` 7d; `chat-trace-sweep.ts:6` 7d) | No subject-scoped erasure. Acceptable given the short TTL, but that must be stated as the basis. |
| 6 | `user_sessions.ip_address` (raw IP, `schema.ts:193`) | real delete on explicit action only | No time-based purge → indefinite raw-IP retention (DL-18). |
| 7 | `control.event_outbox` (`control-schema.ts:33`, `envelope jsonb` `:46`) | none in practice | `spec/SPEC_EVOL_EVENT_SPINE.md:7,52` assert dispatched rows are pruned; **no prune/DELETE exists** in `api/src/services/outbox/*`. Envelope payload may carry personal data with no retention. |
| 8 | `control.event_audit` | does not exist | Append-only by design → tombstone-only, honest ONLY if payload minimisation is designed in now (DL-10). |
| 9 | `control.cost_ledger` | not built; design = anonymise `principal_key`, keep aggregate | Tombstone. Already specified (`spec/SPEC_EVOL_QUOTA_LEDGER.md:45`). |
| 10 | Analytics / Parquet export | does not exist (DD4-gated, BR-65) | When built: rewrite or crypto-shred (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:396-398`). Not a Diag gate. |
| 11 | Knowledge / vector index | does not exist (ARCH-06 / BR-57) | Embeddings derived from erased text are DERIVED personal data; the rebuild-on-erasure rule must be set before ARCH-06 builds. Not a Diag gate. |
| 12 | **LLM provider egress** (Anthropic/Google/OpenAI) | **none** | **No technical erasure recourse whatsoever**; contractual/retention terms only. Must be disclosed (DL-14/DL-15). The honest weak point of an anonymous-first public app. |
| 13 | Backups (PG dumps + S3) | none / tombstone | No documented restore-time re-application procedure (DL-17). |
| 14 | External mounted resources (Resource Plane) | does not exist | `spec/SPEC_EVOL_RESOURCE_FS.md:416` assigns residency/retention to ARCH-15. Not a Diag gate. |

## 4. Minimum gate-clearing set for BR-62 (under O-EXPO = invite-gated)

- **G1 — Guest lifecycle contract**: DL-1 (status + expiry, NOT on `role`) + DL-2 (delete at 30d) +
  DL-3 (single clock) + DL-4 (claimed-scope content survives its guest author).
- **G2 — Quota-identifier legal posture**: DL-5 (LIA, signed by Sent-Tech) + DL-6 (still personal data;
  30d window, 90d pepper rotation) + DL-7 (cookie, not fingerprint).
- **G3 — ONE working erasure primitive** reaching PG **and** S3 for the guest scope, per DL-8/DL-9.
  **The only item with real build content.** Prerequisite inside it: fix matrix row 2
  (`context_documents.workspace_id` has no `onDelete`, so workspace delete is FK-blocked today) and
  matrix row 1 (DL-4 over-cascade). BR-56 ships the CONTRACT and the enumerated scope; the
  implementation lot may live in BR-62.
- **G4 — Diag-scoped PII register** (DL-16, restricted to the surfaces Diag actually writes: guest
  `users`, chat session/message/stream rows, `context_documents` + their S3 objects, `comments`,
  quota/ledger identifiers, `user_sessions.ip_address`).

**Fast-follow under O-EXPO, BLOCKING the day phase 1 opens to the internet**: DL-15 privacy notice and
DL-14 sub-processor/transfer statement — neither can be produced by an agent; both require the
controller (O-CTRL = Sent-Tech).

**Explicitly NOT gates** (justified by non-existence, not by leniency): tenant export/hard-delete
(DL-13, no tenants in phase 1); analytics erasure (BR-65 unbuilt); outbox/audit erasure
(`control.event_audit` does not exist — `api/src/db/run-migrations.ts:45` calls it "future");
knowledge/vector erasure (BR-57 unbuilt); external mounted-resource residency
(`spec/SPEC_EVOL_RESOURCE_FS.md:416`, unbuilt); backup replay (DL-17); the `user_sessions` raw-IP sweep
(DL-18 — a real liability, but pre-existing and orthogonal; its own branch).

## 5. Evaluator divergences (recorded, not hidden)

- **Guest TTL duration**: Opus recommended 90d sliding, Codex 30d. Both classified it OWNER-ONLY.
  **Resolved by O-TTL = 30d.**
- **Blocking status of the notice/sub-processor statement**: Opus treated them as blocking for
  open-internet exposure; Codex folded the notice into its legal item. **Resolved by O-EXPO
  (invite-gated) → fast-follow now, blocking on opening.**
- Everything else converged, including the two findings that carry the most build consequence
  (DL-4 comment cascade, and matrix row 2's FK-blocked workspace delete).

## 6. Open questions (owner or counsel — cannot be settled by an agent)

1. **Counsel-grade validation** of the DL-5 LIA, the DL-7 ePrivacy exemption claim, and the DL-14
   transfer basis. My positions are the standard defensible posture, not counsel-grade; a supervisory
   authority reads an abuse-prevention exemption narrowly.
2. **Named sub-processors and transfer mechanism** for LLM egress (which providers, under which basis).
   Genuinely needs counsel if EU-resident personal data is expected in prompts — which, for a free-text
   anonymous app, it will be.
3. **Deletion-certificate record** (DL-13): useful for DSAR defence, but it is itself a retained record
   about a data subject. Small tension worth an explicit owner call.
4. **Backup retention number** (DL-17, recommended 35d) and the expired-session purge window
   (DL-18, recommended 30d).
