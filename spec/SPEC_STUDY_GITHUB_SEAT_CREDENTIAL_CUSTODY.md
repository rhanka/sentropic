# SPEC STUDY — GitHub-backed custody of LLM seat credentials (MEP retrieval, Sentropic-side refresh)

Status: **STUDY / RECONCILED 2026-10-18** — historical study dated 2026-09-20, reconciled with `origin/main` at `1472d961e098908e64ef60b83835af357888d031` and with PR #659 (merged 2026-10-10 as `dc95f7e4f88048e9671002827537cde4cb8149b7`). Derived from the FROZEN `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md`; this study does not re-open the broker. Current authority for custody consumption is `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` §7 (D7); this study selects no new design and authorizes no production delivery. Owner instruction 2026-10-18: keep PR #596 open (« La garder »).

Reading guide: **Historical (2026-09-20)** marks the original request and options as recorded at that date. **Current (on main)** marks a normative decision, implemented code, or inventory observed at the pinned main above. **Unverified** marks a claim with no live qualification evidence at that baseline. A historical observation is not a current fact.

Owner intent (2026-09-20, historical): *« Je veux que llm-mesh + gw offre une capacité de stocker les sièges sur GitHub, pour les récupérer à la MEP, quitte à ce que le rafraîchissement de device se fasse côté repo sentropic — pour réduire les coûts run. »* This dated request, tying GitHub storage to deployment retrieval and lower run cost, is retained as provenance. The cost model was unproven in the original study and remains unverified (§9).

## 0. Executive summary

Historical (2026-09-20): the mesh/gateway authenticated each provider with a metered API key injected at deploy, while the owner held already-paid seat subscriptions. The study proposed enrolling each seat once, storing the resulting device credential in a GitHub-backed custody store, refreshing it from the Sentropic repository side, and retrieving it at deployment (MEP) so the gateway would run on seat quotas.

Current (on main): the deployable-process contract already specifies that capability beyond the Claude-specific scope. D7 records the owner-selected GitHub Secrets approach, full provider/device payloads, and a dedicated Actions-secret API credential (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:13`, `:144-145`). It specifies a sole scheduled refresher, serialized triggers, GitHub-first durable commit, CAS delivery, failure recovery, and an independent freshness monitor (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:147-153`). PR #659 delivered ordinary Claude-seat enrollment, persistence, refresh, and an injected execution bridge; it did not deliver the general GitHub custody service (§2, §6). The custody job, the projection resolver, and live qualification remain implementation gaps already named on main (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:220`, `:263`, `:410`).

Remaining contribution of this study: the dated owner rationale, the explicit O1/O2/O3 comparison retained as decision history (§3), and unresolved operational questions (§7). It is not a separate accepted implementation design.

Central tension (historical framing, still applicable as history): the broker study bans raw-secret mirroring by default and requires an explicit owner gate, a KMS-to-KMS envelope, an audit trail, and a revocation SLA for any exception (`spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md:335`). How the selected design on main relates to that default is stated in §3; no stronger guarantee is claimed there.

## 1. Goal and non-goals

### 1.1 Goal
Historical goal: give the owner a mono-principal capability to run `llm-gateway` on their own paid seats, with credentials that survive redeploys and refresh unattended, without exposing raw seat secrets to agents. Current (on main): that objective is carried by the D7 custody lane (§3-§5); this study adds no second delivery mechanism.

### 1.2 Non-goals (v0)
- No cross-user / cross-agent seat pooling. Scope stays mono-principal, own seats only, personal passthrough with cross-user selection disabled (`spec/SPEC_EVOL_LLM_GATEWAY_LOT2.md:249`). No categorical provider-permission assurance is stated: the later Claude treatment distinguishes the recorded owner continuation decision from provider permission (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:63-75`, `:260`).
- No agent-visible refresh tokens, cookies, 2FA codes, or security-key material. Policy/index, custody, and human-challenge boundaries are already established on main (`spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md:267`, `:329-335`, `:366-380`; `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_ADMINISTRATION.md:16-44`).
- No new authorization plane: reuse the existing policy/index and account-administration contracts cited above.
- No unconditional metered fallback: fallback requires explicit configuration, matching owner/workspace authorization, and reserved budget (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:163`); no implicit fallback follows a seat failure (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:187`, `:258`). The CI-seats lane keeps its own seat-only cost constraint (`spec/SPEC_EVOL_CI_SEATS.md:5-6`); that lane rule is not a blanket rule for every gateway consumer.

## 2. Grounded map (what exists vs net-new)

Exists — Current (on main), observed at the pinned main:
- Enrollment contract and providers, including native Muse and existing Codex/Cloud-Code enrollment (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:16-18`). Muse provider code exists in `packages/llm-mesh/src/enrollment/muse-code.ts`; Muse identity is not a remaining discovery decision (§6).
- Ordinary Claude-seat enrollment, renewable import, refresh, durable publication, and an access-only injected execution bridge, delivered by PR #659. The contract distinguishes ordinary and custody-managed seats (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:120-135`). Enrollment delivered by PR #659 is not evidence that GitHub custody is operational.
- Storage contracts as specified on main: durable ordinary envelopes are distinct from custody projections (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:256-257`). The keyring classes named for OS keychains use memory maps at the cited baseline (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:26`); no durable OS-keychain behavior is promised, and no second custody token store is created (§5).
- Provider inventory: a five-CLI credential envelope for agy, codex, vibe, muse, and claude, with lifecycle qualification explicitly unverified (`spec/SPEC_EVOL_CI_SEATS.md:58-68`).
- Workflow inventory: only `ci.yml` and `idp-identity-sync.yml` are tracked under `.github/workflows/` at the pinned main. No custody refresh workflow is tracked.

Net-new — still missing on main (existing gaps, not supplied by this study or by PR #659):
- The scheduled custody job that refreshes custody-managed seats and commits full payloads to GitHub Secrets (D7/G4 prerequisite, `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:263`).
- The projection resolver (`apps/llm-gateway/src/seat-resolver.ts` is absent at the pinned main; delivery is assigned to B4, `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:220`).
- The independent freshness monitor and live provider lifecycle qualification (`spec/SPEC_EVOL_CI_SEATS.md:58-68`).

Historical note: the `transpose-cv` PR #37 keyring precedent and the 2026-09-20 inventory (including the former zero-references statement for Muse) are historical observations. They do not describe the current provider inventory and do not justify a second custody path.

## 3. Central design problem — how GitHub holds the material (historical comparison)

Historical (2026-09-20): three custody shapes were compared, in increasing alignment with the broker handle-first default. The comparison and its original tradeoffs are retained as decision history only. Main records the selected GitHub Secrets design and rejects the older ciphertext/materializer model, but does not reproduce this three-way comparison (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:13`, `:144`).

### O1 — GitHub-encrypted secrets (repo/environment secrets via API) — historical option
GitHub stores the seat tokens as GitHub Actions secrets (encrypted at rest by GitHub, sealed-box on write); the refresh job rewrites them and the deployment consumes the delivered projection.
- Historical pro: simplest path; reuses the existing secret-delivery pattern; no extra KMS.
- Historical con: GitHub can decrypt at use time, so custody is delegated to GitHub and the material is a recoverable secret in a second store — the mirroring the broker bans by default (`spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md:335`).

### O2 — Envelope-encrypted blobs in a private repo (key in Sentropic KMS) — historical option, formerly recommended
GitHub stores only ciphertext encrypted to a key held by Sentropic KMS; the refresh job and deployment decrypt with that key.
- Historical pro: GitHub holds no decryptable secret; audit and revocation stay Sentropic-owned.
- Historical con: the KMS key must be reachable by the refresh job and the deployment, which leaves a key-distribution and bootstrap problem.

### O3 — Handle-only on GitHub, secret in Sentropic KMS — historical option
GitHub stores only a reference/handle; the raw seat token lives solely in Sentropic KMS and the GitHub side triggers a Sentropic endpoint for refresh.
- Historical pro: fullest alignment with the broker handle-first default; smallest blast radius.
- Historical con: GitHub stores a handle rather than the seats, and a reachable Sentropic KMS/endpoint is still required at deployment.

Decision recorded on main (current): the later owner decisions supersede the ciphertext/materializer model with GitHub Secrets updated by API, one scheduled Actions refresher that also delivers to preprod, and provider revocation per device (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:13`). Full provider/device payloads and the dedicated Actions-secret API credential are specified at `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:144-145`. Preprod delivery is ratified and production delivery is deferred (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:155`, `:263`). The O2 recommendation is therefore superseded and is not the current recommendation; the bounded decision and its provisioning prerequisites are carried forward without reopening them and without treating them as production authorization.

Security boundary (current, corrected): encryption at rest and a runner ability to decrypt are different boundaries. The selected Secrets design entrusts full credentials to the GitHub secret/job boundary (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:144-147`). The former statement that GitHub never holds a decryptable secret under O2 does not hold as a current guarantee for the selected design, in particular where a GitHub-hosted refresh step obtains the unwrap material. The broker stricter default remains at `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md:335`; the selected Secrets design is not claimed to automatically demonstrate that KMS-to-KMS condition.

## 4. Refresh loop (Sentropic-repo side)

Current (on main): the scheduled GitHub Actions job is the sole refresher of custody-managed seats. All scheduled and manual refresh and redelivery triggers are serialized, the GitHub Secret update is the durable commit point, delivery uses Kubernetes CAS, post-commit failure retries the same generation without a second rotation, and an independent freshness monitor is required (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:147-153`). Refresh-family identity, authority, epoch, and generation lineage are frozen by the CI-seats contract (`spec/SPEC_EVOL_CI_SEATS.md:18-40`). Failure before a confirmed GitHub commit sets `reauth_required` and alerts the custody operator; operator alerts, freshness refusal, and per-device provider revocation are specified at `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:151-165`.

The simpler 2026-09-20 loop (iterate seats, refresh, re-encrypt, rewrite with a generic version check) is historical and is not retained as an alternative normative workflow. Schema reconciliation within these established contracts remains the custody lane responsibility (§8).

## 5. MEP retrieval → gateway

Current (on main): delivery is job-only. The custody job creates or updates the Kubernetes seat Secret and delivers an access-only projection; a resolver reads that projection in custody-managed mode and supplies access material only inside the mesh credential boundary. Runtime never refreshes custody-managed seats, no persistent custody token copy is stored, and removed or revoked seats lose local eligibility (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:143`, `:149-163`). Custody projections must not be imported into the ordinary local account service (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:135`).

The 2026-09-20 description (deploy pulls full credentials into a keyring/pool and seeds active accounts) is superseded and is not retained. Ordinary local seats and custody-managed seats stay distinct; the pool-versus-keyring retrieval choice is decided by the projection resolver above and is no longer open (§7, question 6).

## 6. Provider coverage — current inventory and qualification status

Current (on main): the five-CLI envelope below is the provider inventory. Envelope support is contract coverage, not proof that every provider is deployable; lifecycle qualification stays unverified for each CLI (`spec/SPEC_EVOL_CI_SEATS.md:58-68`).

| CLI | Enrollment / contract status (current) | Custody lifecycle |
|---|---|---|
| agy | Envelope supported; agy enrolls as `cloud-code` and its application tuple must not substitute Gemini (`spec/SPEC_EVOL_CI_SEATS.md:49-64`) | Unverified (`spec/SPEC_EVOL_CI_SEATS.md:58-68`) |
| codex | Envelope supported; existing device-flow enrollment on main (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:16-18`) | Unverified (`spec/SPEC_EVOL_CI_SEATS.md:58-68`) |
| vibe | Envelope supported | Unverified (`spec/SPEC_EVOL_CI_SEATS.md:58-68`) |
| muse | Envelope supported; native Muse enrollment code exists (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:16-18`) | Unverified (`spec/SPEC_EVOL_CI_SEATS.md:58-68`) |
| claude | Ordinary enrollment, import, and refresh delivered by PR #659 (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:120-135`) | Custody readiness not advertised; resolver not implemented at the cited baseline (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:125`, `:135`) |

Delivered enrollment is distinct from execution qualification. Claude enrollment is separated from official-runner qualification (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:139`, `:165-169`, `:248`, `:308`); the execution bridge is an injected seam with no runner installed by default (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:169`), and runner/wiring plus live qualification are assigned to h2a (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:248-250`). The standalone deployable host excludes provider CLI subprocesses (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:117`), so the PR #659 h2a runner seam does not make the standalone custody gateway capable of serving Claude. That cross-host integration is not designed in this study.

Direct Gemini/AI-Studio seat (deferred/unverified): the 2026-09-20 study named a direct Gemini seat as a separate candidate. Main describes AI Studio as API-key access and Vertex as ADC/OAuth (`spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md:40`; `spec/SPEC_EVOL_LLM_MESH_GCP.md:17`), and the five-CLI contract forbids substituting Gemini for the agy tuple (`spec/SPEC_EVOL_CI_SEATS.md:49-64`). No direct Gemini subscription-seat path is established; the candidate is retained only as deferred/unverified, and adding such a provider is outside this reconciliation.

Initial subset and reauthentication surface (still unverified): the original request to choose the first custody proof subset and the concrete human reauthentication surface (Focus, h2a, or Sentropic UI) is retained without an invented answer. Main specifies a provider inventory, operator alerts, and trusted human surfaces, but does not select the exact initial custody rollout subset or a custody-specific UI (`spec/SPEC_EVOL_CI_SEATS.md:58-68`; `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:151-155`; `spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md:368-379`).

## 7. Disposition of the seven original questions

The 2026-09-20 study framed seven questions for a future EVOL gate. Each is reclassified below from evidence on main; no competing design is created and no qualification is marked complete.

| # | Original question | Disposition | Evidence |
|---|---|---|---|
| 1 | Custody choice (O1/O2/O3) | Decided on main: GitHub Secrets with preprod delivery; bounded authority retained, production deferred. Historical comparison in §3. | `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:13`, `:144`, `:155`, `:263` |
| 2 | Unwrap/KMS residence (O2/O3) | Historical dependency of the superseded options. The selected lane instead requires the specified GitHub API credential, custody environment, and rotation. | `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:145` |
| 3 | Muse identity/auth | Obsolete as a discovery question: provider code exists on main. Lifecycle/provider qualification remains separate and unverified. | `spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:16-18`; `spec/SPEC_EVOL_CI_SEATS.md:58-68` |
| 4 | First-wave seats | Current five-CLI inventory exists; an exact custody activation subset is not established by the qualification table. Still unverified (§6). | `spec/SPEC_EVOL_CI_SEATS.md:58-68` |
| 5 | Refresh cadence + escalation | Cadence/freshness defaults and operator alerts are specified; provider validation and the concrete operational handoff remain open. | `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:151-153`, `:161` |
| 6 | Pool versus keyring retrieval | Decided: projection resolver in custody-managed mode; no ordinary-envelope hydration. | `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:159-163`; `spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:135` |
| 7 | Mono-principal scope / terms | Personal scope kept; categorical provider-permission assurance removed (§1.2). | `spec/SPEC_EVOL_LLM_GATEWAY_LOT2.md:249`; `spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:63-75` |

## 8. Dependencies, method, and next steps

Dependencies (precise statement): the custody maintainer/conductor owns reconciliation with G4; the h2a owner owns Claude execution qualification; the platform/custody operator owns the already-required preprod delivery and per-device revocation evidence. Actual people are assigned by that lane. Missing custody job, resolver, and lifecycle proofs are recorded here as existing dependencies: they are not delivered by PR #659, are not newly solved by this study, and are not prerequisites to merging this accurately scoped historical study. Production remains deferred under O-D3 (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:155`, `:263`).

Method: this reconciliation is documentation-only and selects no new custody design. The successor filenames formerly cited — `spec/SPEC_EVOL_GITHUB_SEAT_CREDENTIAL_CUSTODY.md` in this study and the sibling-worktree `SPEC_EVOL_LLM_SEAT_CUSTODY.md` referenced from D7 — are not tracked spec files in the pinned main and are not cited as merged authority; D7 is the merged controlling consumption contract. The original gate of at least two independent adversarial reviews before a committed-decision EVOL remains a future gate: this reconciliation does not pass that gate and introduces no new decision. After this branch, the conductor obtains the two independent review lenses (mesh/Claude/runtime and custody/deployment/security) before any merge decision.

No implementation is authorized by this study. Custody build prerequisites on main include owner provisioning and rotation of the repo-scoped Actions-secret API credential, the reconciled projection schema, the serialized refresher job, the independent freshness monitor, and per-device revocation evidence (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:220`, `:263`, `:410`).

## 9. Risks

- **Custody blast radius (current)**: the selected Secrets design widens exposure to the GitHub secret/job boundary, which holds full provider/device payloads (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:144-147`). The dedicated API credential is a high-privilege provisioning and rotation prerequisite (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:145`).
- **Provider terms (unverified per provider)**: programmatic seat use requires provider-specific qualification. The recorded owner continuation decision is not provider permission (`spec/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.md:63-75`, `:260`).
- **Reauthentication cliffs**: device/OAuth seats force periodic human reauthentication. Freshness monitoring and operator alerts are specified (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:151-153`, `:161`); the concrete custody handoff surface remains unselected (§6).
- **Refresh-job target surface**: the sole refresher holds refresh material and is a high-value target. Serialization, GitHub-first commit, and redacted alerts are the specified mitigations (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:147-153`); revocation is per device at the provider (`spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md:165`).
- **Cost model unproven (unverified)**: retained from the 2026-09-20 study. Provider terms may forbid the exact usage and nullify the saving; validation precedes any build.

## 10. Reconciliation record (2026-10-18)

- Baseline: `origin/main` at `1472d961e098908e64ef60b83835af357888d031`; PR #659 merged 2026-10-10 as `dc95f7e4f88048e9671002827537cde4cb8149b7`. The Claude-seat spec is unchanged between the PR #659 merge and the pinned main, so its line references apply to both.
- Changes made: status and dates reconciled (§header, §0); option status corrected to historical with the recorded decision carried forward (§3); security boundary corrected (§3); refresh and delivery replaced by D7 references (§4-§5); factual inventory updated (§2, §6); fallback and terms wording corrected (§1.2, §9); seven questions reclassified (§7); dependency owners stated (§8).
- Residual contributions retained: the O1/O2/O3 comparison as decision history (§3); the dated 2026-09-20 owner request as provenance (§header, §0); the direct Gemini/AI-Studio candidate as deferred/unverified (§6); the initial-subset and reauthentication-surface questions as still unverified (§6).
- Historical material on main is preserved as historical: a dated observation in a controlling spec does not override its current normative decision, implemented code, or qualification status (§2, §6).
