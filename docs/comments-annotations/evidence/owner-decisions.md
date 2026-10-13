# Owner authority and decision references

English extract prepared from the confirmed SPEC and the source briefs below. Only the two authorized register statements and approved scope labels are reproduced from private provenance. Private paths, personal identities and other register content are omitted. This extract grants no new authority.

## Source references

| Alias | Original source SHA-256 | Reading / precedence |
|---|---|---|
| UPDATE | `3c11efcc10bab4b2fd3402906e67ce1f46e73296ff54a990968ce2f887234670` | Revision brief with later OWNER-D1–D4 update; superseded on AUTH-M and Immo backups by RESUME/TREAT2. |
| RESUME | `8777f21d0412b9f7a98e18bfd88cbe889652d970d9bef79c46a79ce02ffe0bd5` | Direct default owner instruction relayed to the conductor on 2026-10-11. |
| TREAT | `b8ca9c06dbf0343e6c100af4c14e9613341d5e4a3b099bcc6ad3790a74bc86d0` | Earlier treatment/provenance correction; its normalized quotations and backup prescriptions are superseded. |
| M2-DELTA | `9507232c6d1bc5718d80b167d892f82960b1b3f049058c148b888c6ba7b23300` | Owner answers collected by conductor AskUserQuestion on 2026-10-11, as recorded in the M2 cluster-mesh delta brief; supersedes storage/API ownership and pre-delivery restoration gates. |
| M2-TREAT | `1f74b3f734204392be788b57a6b78ea7720b6b921b2dd5b28b2f7da23aa6473a` | Historical context correction; its pre-freeze and universal-backend proposals are superseded by frozen v4.1. The current [alignment reference](storage-alignment.md) preserves owner closure and profile-specific gates. |
| TREAT2 | `7d209986b34d150c178fd6a074e0d311f7b99b4cf47e625b7e9531e4024dea96` | Direct owner answers collected through the conductor's AskUserQuestion on 2026-10-11, as recorded in that brief. |
| OWNER | `4c3e546c74f332850592bb8bb48a98b366357cb9fb90cedb796c0836ffc6af98` | Private convergence record; digest and generic effects inherited from the confirmed SPEC/UPDATE, not reread here. |
| OWNER-QUOTES | `4220358516eb87077568f33dcd6cfcc0e41dbd75a26fe5a82700de90e1e830fe` | Private owner register of 2026-10-10; source statements at lines 108 and 118, exactness checked by CONF3. Not reopened here. |

The local brief digests were recomputed during promotion preparation. Historical private-source digests remain attributed to the prior reviews; this extract does not claim new inspection of those files or independent verification of the AskUserQuestion exchange.

## AUTH-M

RESUME records the owner's instruction verbatim:

> j'autorise par défaut tout sauf question empêchant d'avancer

AUTH-M covers isolated lane M implementation: P1/M1, P2/M2, P4-M/M3, P5/M4 candidate qualification and separately scoped synthetic P4-S/M5-S. It takes effect with SPEC §1's recorded treated-version confirmation, reviewed aligned plans and durable evidence. U has its own scope under the same default instruction after contract freeze; scheduling does not create another authorization vote.

Merge, publication, deployment, real-data processing and each actual delivery remain submitted under OWNER-D2 and applicable operational authority. Neither conductor nor i-cond arbitrates. CONF3 passes the source revision; the promotion delta and Git recording remain due, as the [receipt](convergence.md) states.

## TREAT2 owner answers

1. Provenance and authorized quotation use:

> Valider, citations exactes

This validates exact reproduction, eradication limited to `prospect_notes` and Immo's old notes system, and attribution of “sans conservation / no conservation” to i-cond. It supersedes the earlier relay-only scope claim.

2. Immo backups:

> Le sujet de sauvegarde ne te conerne paa

Immo's backups and their lifecycle are its own domain and decision, outside the Sentropic SPEC. No Immo expiry schedule, new-copy prohibition, cutover-backup ban or backup anti-resurrection proof is imposed. Legacy rows not carried over are still counted in the conversion report. Sentropic's own cutover obligations remain in the later separate P4-S track; M2-DELTA removes backup/restore rehearsal from M2 and pre-Immo-delivery gates.

3. Documentary implementation base:

> Branche doc comme base

Commit the evidence chain on `spec/comments-annotations-port`; create `feat/comments-annotations-model` from the LAST commit of the reviewed promotion series, with its main ancestor pinned. No documentary merge to main precedes M1. The later code/evidence merge follows P4-S and the owner's merge gate; actual delivery retains OWNER-D2.

## M2-DELTA owner answers

The brief records these verbatim choices from the conductor's AskUserQuestion on 2026-10-11. Its digest is recomputed here; the exchange itself is not independently reverified.

| Question | Owner's verbatim answer | Effective amendment |
|---|---|---|
| Cible M2 | « Oui, module cluster-mesh » | Move storage and API implementation into the comments module in packages/cluster-mesh: comments-domain adapter on the shared storage port/backends, modules/ registration and Hono API. Immo connects directly. Sentropic application storage/integration is a later separate M5-S track. |
| Restauration | « Oui, la retirer » | Remove backup/restore rehearsal from M2 and every gate on the path before delivery to Immo. OWNER-D2's durable software copy and identical locked install/rebuild/restore evidence remain unchanged. |

The owner also said:

> faut aller plus vite

> il ne faut pas mélanger trop pour le sujet de stockage

**Explicit G2 amendment:** G2 a+c previously assigned the proposed comments/pg storage and canonical comments API to comments. The owner moves those implementations to the cluster-mesh comments module. packages/comments remains the domain authority and keeps M1 types, hashing, validation and conformance; packages/contracts remains unchanged; chat-ui keeps UI ownership; no annotations package. Corrected M2-TREAT requires the module to build on the already-decided cluster-mesh storage abstraction, not to create another persistence system. D4=C and the engram decision below supersede the earlier treatment's comments-only README exception and catalog-owner transfer. The storage track owns the README correction; Lot 2 adds local delivered-module resolution alongside external providers, keeping GATED_OWNERS.comments.owner as comments, 'comments' in CLUSTER_MESH_GATED_MODULE_IDS and ClusterMeshGatedModuleId unchanged. Module/h2a N/N-1 conformance remains required.

M1 is now owner-closed at `2dabe25ce`; [contract-v1.json](../contract/contract-v1.json) and its [receipt](../contract/freeze-receipt.md) preserve four reserves and explicitly unprovided manifest confirmation/host acknowledgement. The manifest pins neutral adapter/HTTP declarations and the internal corpus, leaving cluster-mesh registration/export placement undeclared. C0 separately declares compatibility and unverified oracle packaging. Continue M2, C4/M3, M4-I, then separately authorized delivery; do not reopen Lot 1.

**Technical treatment, qualified by v4.1:** Immo uses its own full runtime/plugin and injected independent storage/authority. §17.4 controls comments-domain, loader, registry and composition paths. The optional comments peer is selected through its leaf; roots/disabled imports remain isolated. Installed M4-I requires a separately packaged digest-pinned oracle with no checkout imports. Its distribution/export remains unverified; no comments-package conformance export is claimed.

## Shared storage context correction

The current M2-TREAT explicitly supersedes MAJ-1's premise. Its sources and their bounded implications are:

| Source | Recorded decision / inspected SHA-256 |
|---|---|
| Cluster-mesh shared-core dossier r7, D4, lines 59–75 | D4=C was already decided from owner feedback r6: hybrid persistence by semantic authority, provider-owned authoritative files, SQLite/SQL for transactions and bindings, separate keyring/secret provider. The core chooses and coordinates adapters without becoming the Track codec, memory domain store or secret vault. Dossier `cluster-mesh-shared-core-dossier-r7.md`: `ea949a315f22bb922bc3aeabd8814843bcf90a27112c41a01e810f51d98f7062`. |
| Shared-core synthesis r7, §11 | Persistence matrix distinguishes semantic/codec authority from shared transactional infrastructure and host operation. `cluster-mesh-shared-core-synthesis-r7.md`: `1c53da1d5de03ebfb16a15192efb7aa4f918ebd089f23dde4bbdda7c85ef4d84`. |
| Engram live Git indexing, gr-conductor, owner decision 2026-10-11 | The corrected brief quotes « cluster-mesh porte l'abstraction de stockage » and cites the [owner dossier](https://claude.ai/artifact/CFpa9zknteXUD4qySGygcN). Engram emits neutral fact batches through its adapter; cluster-mesh owns the shared storage port and generation contract. Read `spec/SPEC_LIVE_GIT_INDEXING.md` §§1/2/9, SHA-256 `aeecb7e9895c7dbb8e99dca98c2b7db7687347f6339366efdda6ab4a011c2611`, and `plan/09-BRANCH_LIVE_GIT_INDEXING.md` L3a/L3b-S/L3b-P/L6a, SHA-256 `5fecf4f50a86e9cb43f44930e5a2f28b5bd032b2bed43b6bd37883b2cf262f14`. The external artifact itself is cited by the brief, not independently fetched. |

Frozen v4.1 §17.5 makes M2 entry depend on the reviewed independent shared contract and selected qualified Postgres profiles, with K4/P2u visibility roots active from C1a. C3, live generations/Q and restore witness are separate. Reusable PG lives under packages/cluster-mesh/src/storage/postgres/, with tests/storage/postgres-*.spec.ts and shared assets/storage/postgres/. Engram plan amendments and actual qualification remain due; preserve L6a registration without creating a live dependency.

Cluster-mesh owns K/P reusable infrastructure, co-reviewed by engram and comments for consumed profiles (§17.1); comments owns C1/C2/C4 and M2-W/M3-S. Kernel supplies the default package journal; the Sentropic outbox is an optional qualified application binding. C1b projection assets and P2b-M/P3 host-history attachment share one migration authority. Staffing remains unverified.

## Question owner

**Historical assignment question, superseded by frozen v4.1 §17.** Cluster-mesh is accountable for reusable PG; engram co-reviews, and comments reviews consumed capabilities. This is one backend at `packages/cluster-mesh/src/storage/postgres/*.ts`, exported through the proposed storage/postgres leaf. Hosts inject drivers and sole migration scheduling; they are not assigned backend implementation.

**Facts and scope.** Earlier engram plan placement needs the §18.1 Core/application amendment. No actual staffing, amended plan or qualification is inferred from the allocation. These execution receipts remain due; accountable ownership is no longer an open owner vote.

**Historical alternatives considered before the frozen allocation:**

| Option | Work and benefit | Cost / consequence |
|---|---|---|
| A — Storage team leads; comments supplies consumed-profile review | Consistent with §17's accountable cluster-mesh ownership. | Actual staffing and qualification receipts remain due. |
| B — Comments supplies a separately scoped contribution | Contributions may be coordinated under the same cluster-mesh ownership. | No second backend, migration authority or transfer of accountability. |

The frozen allocation replaces the earlier A/B question; do not request another ownership choice. Actual staffing and coordinated upstream amendments remain unverified. One backend, one asset inventory and consumed-profile/installed-host evidence prevent duplication. This extract records no new owner answer.

## Authorized register statements

The following are the two complete statements, with spelling and punctuation preserved. Their common source digest is OWNER-QUOTES above.

> au passage prospect_notes doit être éradiqué merci, ton modele oublie de le proposer. faut éradiquer le modele légacy

> prospect_note doit être éradiqué, et on devrait supprimer ce qui a été implémenté a date côté UI, ta proposition doit se faire sur la cible en supprimant ce qui a été fait n'importe comment a date assure moi l'invetaire d'éradication stp et planifie le

## Generic decision consequences

| Reference | Effective requirement |
|---|---|
| M2-DELTA / corrected M2-TREAT / G2 amendment | Cluster-mesh owns the shared storage abstraction and module/API implementation; comments retains domain authority and adapts to the same L3a/L3b infrastructure. No M2/pre-Immo-delivery backup/restore rehearsal or Sentropic app integration dependency. |
| OWNER-D1 / R-HOTE | Host synthetic preparation may begin after the reviewed, supplied and acknowledged P1 contract-freeze receipt. It replaces the former F6 prohibition on parallel host work. |
| OWNER-D2 / R-CANAL | Produce an independently verified frozen package; the receiver retains identical durable bytes and proves locked installation/rebuild/restore. Each actual delivery is owner-submitted. |
| OWNER-D3 / HOST-D3 | The host's domain decision is recorded as decided; neither its private choices nor an implementation certification is reproduced. |
| OWNER-D4 / R-SAUVEGARDES | Count legacy rows not carried over; excluded rows have no per-row canonical content/receipt. TREAT2 removes earlier Immo backup prescriptions. |
| HOST-D10 | Evaluation/learning remains deferred; ordinary annotation adoption has no gate from it without an evidenced bounded dependency. |
| ARCH-D11 / ARCH-12 | Separate Sentropic architecture authority; do not confuse it with OWNER-D1–D4 or host decisions. |

E2/TR2 attribution erratum: “no conservation” was i-cond's reformulation, not an owner quotation or a general policy. E2/TR2 backup erratum: their Immo backup prescriptions are superseded by TREAT2. Count-only conversion evidence remains; Sentropic's own recovery obligations belong only to its later separate P4-S track. M2-DELTA supersedes any historical M2/pre-Immo-delivery backup/restore rehearsal gate. The interface maintainer must supply and obtain acknowledgement of this erratum with the P1 freeze receipt before preparation relies on E2.
