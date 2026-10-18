# W0 release and authorization evidence register

W0 preparation, local evidence probes, commits, push and a draft PR are covered by the owner's 2026-10-18 launch packet `AGENT_SIG:7f3a9c2e1b`. The verbatim request and approved plan hash are preserved in [baseline.md](baseline.md). No merge, deployment, production migration, live restore, key enrollment or Environment reconfiguration is included. Unknown evidence is pending; no receipt is inferred from a green check or elapsed time.

## Pending dependencies and observable handoffs

Dates below are requested resolution deadlines from the plan, not accepted availability or granted authority. SC owns collection; unresolved dependencies keep the relevant dispatch/qualification gate closed and add their nonoverlapping critical-path delay to Δ.

| ID / responsible role | Bounded missing evidence / acceptance | Deadline / gate |
|---|---|---|
| B01 / tenant operator, personal name **pending SC assignment** | Read-only pod/deployment inventory in prod and preprod: namespace, role, pod UID/start time, requested image, actual `imageID`, deployment revision, config/resource hashes and observed timestamp. Include actual content-role presence/absence. Names of Secret refs only; no values or privileged kubeconfig | 19 Oct 09:00 Toronto, before W0 dispatch sign-off |
| B02 / tenant operator | Read-only applied migration journal IDs/checksums and frontier; current `(compositionRoot,namespace)` selected generation/active author/status, generation/server/lease validity and writer fence. Distinguish both migration streams and package journal | Same W0 dispatch gate; refresh before W5 |
| B03 / tenant operator + KO | Named backup/rotation/restore owners, last verified backup + private object checkpoint, isolated restore receipt preserving grants/revocations. No live restore attempt from W0 | Baseline receipt before dispatch; actual new-provider restore before W5 |
| B04 / tenant operator + W1 storage owner | Aggregate counts of `context_documents`, versions, generated `job_queue.result` objects/legacy base64 and chat references, grouped by tenant/workspace/source; object existence/checksum and ACL mapping summary. Record explicit leave-in-place vs import disposition for each source; no content, user IDs or object names in report | Before W1 import/migration scope is finalized; refresh qualification inventory in W5 |
| B05 / SC + rhanka | Name authorized acceptance signer, public-key export source, SPKI fingerprint, validity/revocation policy and durable role-authorization receipt; populate protected-main trust only through reviewed P | Before P acceptance can validate any real release; P remains required |
| B06 / SC + KO + tenant operator | Personal names for infrastructure, promotion, migration, backup and restore operators; explicit ownership acceptance, infra repo/PR receipt, exact DNS/TLS callbacks, private bucket/IAM/RBAC, six-slot availability and owner/operator staffed windows. Only role reservations exist now | Before dispatch; infra before W3/W5, promotion gate before TG exit |
| B07 / rhanka + tenant operator | Native app `production` Environment configuration, main-only/reviewer/no-admin-bypass receipt, tag rules, credential-route audit and preprod production-write denial; signed positive rehearsal and native `probe_only` barrier receipt | TG exit; actual distinct G-PROD and run approval before production |
| B08 / SC / independent R | Sol 6.1 xhigh + Astra max acceptance-scope review of the exact W0 head/records and reconciliation. Coding instance supplies evidence and does not issue its own independent GO | Before marking W0 accepted; draft PR alone is not acceptance |

Read-only access/receipts and operator names/windows were requested through the session's structured input while independent source/contract work continued. No reply had been supplied when this register was prepared. Do not switch to admin credentials to fill the blanks. If a collection cannot be provided by the dispatch window, SC names the resolver, records the delay and keeps dependent work gated.

## Action authorization register

Each merge record needs the owner/actor, UTC timestamp, durable source link, action scope, PR, exact reviewed head, required checks and both independent reviews. Each production record instead binds the canonical manifest hash, all four role digests, config/migration/frontier/backup/rollback scope, target tenant, signed acceptance, named operator/window and the native Environment run/approval receipt. A scheduled slot is not GO.

| Record | Action / state |
|---|---|
| W0-LAUNCH | **Granted**, owner 18 Oct task packet; baseline preparation + draft delivery only. W0 head/review/PR are supplied by this branch; this is not a merge receipt |
| M-T1 | **Pending**, W1 storage exact PR/head + tests/reviews; SC prepares, owner authorizes |
| M-T2 | **Pending**, W2 registry exact PR/head + parity/identity evidence; SC prepares, owner authorizes |
| M-T3 | **Pending**, W3 content/activation/packaging/I manifests + EX1 and KO handoff; SC prepares, owner authorizes |
| M-T4 | **Pending**, W4 context/callers/catalogue/UI + HTTP/chat auth proof; SC prepares, owner authorizes |
| M-TG | **Pending**, P exact PR/head + verifier/bypass/configuration evidence and EX2; SC/operator prepare, owner authorizes |
| M-T5 | **Pending**, integrated fixes/runbook/qualification candidate + final Sol/Astra findings/checks; SC prepares, owner authorizes; excludes production |
| G-PROD | **Pending**, qualified immutable tuple/manifest + signed acceptance, frontier/backup/migration scope and operator window; rhanka's distinct native approval is mandatory |
| G-ROLLBACK | **Pending**, explicit stop/fence/prior-tuple actions preserving committed data and deny state; may be included in G-PROD, but each workflow still passes its Environment gate. Destructive live restore excluded |
| Other/T0/TX candidates | No authority granted by this plan or W0; SC refreshes their heads and cites separately applicable receipts |

SC may reuse an existing explicit GO whose scope covers the concrete action; it records the receipt rather than requesting the same approval again. W0 creates no review, operator, signer or action approval by declaration. This draft remains a baseline preparation record until B01–B08 have the applicable evidence.
