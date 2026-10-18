# SPEC_STUDY — Ten-minute CI/CD, including E2E and delivery

Status: retained study and implementation plan; documentation only, 2026-10-18.
Evidence baseline: `441453966a4dfac12c220f154508d7ab1ee3c237`; documentation base: `9ed96eb83cd77da710f1adeb83a19e425d6c4910`.
Charter: qualify the complete selected CI/CD path within ten minutes, preserving tests, security, artifact identity, and visible delivery outcomes.

## 1. Decision and owner constraints

Retain the fresh nine-step plan: remove repeated preparation, reuse immutable artifacts, execute independent work concurrently, make PR/merge provider journeys deterministic, and qualify real providers daily. The previous acceleration experiment is superseded and supplies no implementation dependency. This PR changes documentation only; none of the proposed timing improvements has been measured as an implemented result.

The owner authorized committing, planning, and merging the documentation once green and reviewed. The author hands off an opened PR and does not merge it. Selected owner quotations remain verbatim:

> « écoute je suis en phase avec le plan proposé pour le CI/CD, je le veux commité / fusionné et planifié en branches stp »

> [Image #14] pour les tests e2e je crois qu'il va falloir commencer a mocker les llm et de mettre les tests vrais llm en mode genre daily au maximum

> le lot 1 d'accélération n'a pas été validé donc tu peux l'éradiquer. je veux un plan frais basé sur mes remaques. et je veux dans le diagramme a chaque étape du plan bien matérialiser les bénéfices de temps et toujours pouvoir cliquer les différents cas concernés.

> « aucun sens du design. les boutons sont à 2 km, t'as pas utilisé notre générateur de diagramme. Mets le bouton (DANS le diagramme) : avant/après, cas, événement, options de groupes »

## 2. Evidence and its limits

The validated source study inspected eight recent runs, with 666 first-attempt job records (460 successful, 202 skipped, four other conclusions), plus historical publisher records. Its 767 fetched records include carried-forward rerun copies; those are not independent executions. The inventory covers 66 job definitions and 84 expanded execution rows. These counts describe that pinned study, not a fresh audit of the documentation base.

| Quantity | Meaning |
| --- | --- |
| Measured job/step | Completion minus start in one identified run, attempt, and job; retain timestamp gaps and combined preparation spans. |
| Observed endpoint | Workflow creation to actual qualification, publication, or readiness; no earlier push timestamp was available. |
| Computed path | Dependency replay from identified examples, without queue time; mixed-source paths are not observed runs. |
| Budget to measure | Proposed future ceiling including setup and transfer; missing durations remain **to measure**, never zero. |

Selected anchors below are seconds. Main denotes [run 39113919235](https://github.com/rhanka/sentropic/actions/runs/39113919235), attempt 1; PR denotes [run 39124873217](https://github.com/rhanka/sentropic/actions/runs/39124873217), attempt 1. Every row preserves its own scope.

| Element | Measured example and job | Budget to measure | Main cause to address |
| --- | --- | --- | --- |
| API static | Main, [117635700362](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117635700362): 425 | 120 | Repeated workspace/image preparation; final compiler/linter spans below 8/7 seconds including transition. |
| UI static | PR, [117667798085](https://github.com/rhanka/sentropic/actions/runs/39124873217/job/117667798085): 144 | 90 | Development-container preparation; final Svelte check span about 17 seconds. |
| Cluster qualification | Main, [117635700549](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117635700549): 664 | 210 | Storage bundle 197, packed lazy qualification 159, repeated sibling builds. |
| Manifest qualification | Main, [117635700403](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117635700403): 125 | 75 plus explicit candidate branch | Packing and guard fixtures; this job does not publish packages. |
| API image | Main, [117635700627](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117635700627): 224 | 180 warm / 210 cold | Build 176 plus export and transport. |
| Full UI build | PR, [117667798508](https://github.com/rhanka/sentropic/actions/runs/39124873217/job/117667798508): 495 | 180 warm / 210 cold | Extensions, desktop, UI tests, image, and static profile serialized. |
| UI job in API case | Main, [117635700635](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117635700635): 138 | 120 warm / 150 cold | Different scope from the 495-second PR job; image action 107 seconds. |
| IdP screen smoke | Main, [117637085537](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117637085537): 222 | 150 | Browser action 6; image/tool transfer, loading, startup, and teardown dominate. |
| API image publication | Main, [117640722484](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117640722484): 203 | 40 after candidate upload | Download/load 82; fresh layers 93; alias push 22. |
| Preproduction | Main, [117641371250](https://github.com/rhanka/sentropic/actions/runs/39113919235/job/117641371250): 116 | 75 | Real API readiness dominates the 101-second deploy action. |

The main example reached CI qualification at 26:13 and preproduction at 31:33, while `publish-artifacts` failed. Whole-workflow success came only after a manual rerun, at 155:31. Its product replay is 1,007 seconds execution plus 886 seconds dispatch/waiting, including an 877-second ready-to-start E2E wait. A green CI gate alone did not prove complete delivery.

Fresh npm publication with registry qualification measured 157 seconds for cluster-mesh ([39111568697, attempt 1, job 117631762729](https://github.com/rhanka/sentropic/actions/runs/39111568697/job/117631762729)) and 160 for MCP Auth ([38867522929, attempt 1, job 116870759442](https://github.com/rhanka/sentropic/actions/runs/38867522929/job/116870759442)). Version-already-present paths cannot stand in for these fresh-publication measurements.

## 3. Retained architecture

1. **Measure and reserve capacity.** Record the expected result set before dispatch and all four delivery endpoints. Cancel superseded PR attempts, preserve current main releases, and prove aggregate critical-path scheduling of at most 60 seconds under concurrent traffic. Approximately 24 workers was a study hypothesis; actual account capacity and cost remain to be checked.
2. **Prepare once, native checks behind Make.** Pin Node/npm and tools, prepare each dependency closure once, then run complete compiler/linter programs independently. API/UI/IdP static budgets are 120/90/90 seconds including cold preparation. Native CI targets are a declared exception to current Docker-first recipes, not permission to run arbitrary host commands or replace production-image checks.
3. **Build and transfer less.** Use persistent BuildKit caches scoped by runtime/tool/profile; remove UI forced cache bypass. Separate stable tooling from source-dependent payloads without removing source from correctness keys. Include candidate upload, export, and transport in the complete image-readiness budget. Verify source, lock, architecture, toolchain, build arguments, and embedded assets before reuse.
4. **Execute independent work together.** Browser, VSCode, IdP, restore, and scans start when their artifacts are ready; static/security results still join the required verdict before promotion. Split independent UI build/test/profile work; the image still waits for extensions/desktop files embedded in `ui/static`. Different Vite build inputs require distinct outputs.
5. **One candidate, independent qualification.** Build sibling closures and candidate tarballs once; share immutable bytes and receipts, never mutable workspaces/databases. Fan out source, PostgreSQL/comments, and installed-consumer checks. Preserve seed → crash → verify ordering, upgrades, lazy peers, public exports, and clean installs. The 210-second cluster budget is `60 + max(60, 90, 90, 30 + 120)`; the common manifest guard is 75 seconds, with candidate work visible on its own branch.
6. **Deterministic journeys, real providers daily.** Put HTTP/SSE fixtures at the external provider boundary while preserving browser/API/auth/database/queue/streaming/tool behavior. Assert requests and outputs; forbid unexpected provider egress and omit real credentials from PR/merge lanes. Deterministic AI failures block. Run one Playwright process and seed/auth setup per balanced shard; retain real login coverage and exact test membership. Replace arbitrary sleeps with observable conditions. Budget each browser/API shard at 180 seconds, VSCode/IdP at 150, including startup and teardown. Daily live qualification preserves provider assertions against an exact tuple, with schedule health, failures, calls, and cost separately visible.
7. **Deliver the tested bytes.** Every proposed publisher waits for the complete required verdict. Promote the exact tested/scanned image digest; candidate layer upload happens earlier inside the image budget. Publish qualified tarballs without repacking; retain registry visibility, provenance, integrity, collisions, and post-publication clean installs. Keep actual new-version mesh → gateway → cluster dependencies, budgeting 195 seconds for that internal train. Deploy changed UI with unchanged API digest when appropriate; keep preproduction readiness and all selected package receipts distinct.
8. **Remove consumer work only with proof.** Start with comments → API, then cluster-mesh → API/IdP/gateway. Qualify candidate bytes before consumer-owned contracts; prove unchanged installed application tuples and Docker input digests before skipping integration/deployment. A semver range or unchanged manifest is insufficient because workspaces and `file:` dependencies resolve source. Breaking, unknown, adopted upgrades, lock/runtime/security changes, or absent evidence select full deterministic integration. Fill validation gaps before allowing affected boundaries onto a fast path; 95% avoidance is an adoption target, not an observed rate.
9. **Prove the maximum and present.** Run the acceptance campaign below, retain every breach, and publish the measured distribution. Maintain one generated interactive graph with controls inside it; a plan click highlights changed nodes and keeps case/event choices usable.

The inspected consumer graph contains 39 library roots plus API, UI, IdP, and gateway hosts: 43 components and 73 deduplicated directed edges. Edges distinguish build/type dependencies, runtime peers, application source coupling, protocols, and embedded assets. Lexical imports do not prove every dynamic edge. Eighteen libraries lacked dedicated validation jobs, the gateway host lacked its own lane, `validate-chat-core` omitted its runtime script, and `ubo-contracts` delegated tests to API integration. Re-inventory at implementation time and count added qualification work.

## 4. Complete path budgets, not measured outcomes

For the selected API-change merge case, the retained **budget to measure** is:

```text
classification 15
  -> parallel: static 120; cluster 210; common guard 75;
               image readiness 180 warm / 210 cold, then tests at most 180
  -> complete verdict 5 -> image promotions 40 -> preproduction readiness 75
  + cumulative critical-path scheduling allowance 60
  = 555 seconds warm / 585 seconds cold
```

The endpoints are PR qualification, selected images published, preproduction ready, and selected package publications qualified. Complete merge elapsed is their maximum, including actual queue/dispatch delays. Daily provider work has its own endpoint and is never counted as zero work or hidden inside merge timing. Package-only paths have no artificial image cold penalty.

The 555/585-second figures apply to the selected API/CD path, not every combination of changed packages. Calculate each selection from the same dependency model used for rendering. A selected fresh package train must wait for the full verdict; it cannot start early merely to fit the headline. Mixed application/package selections need their own maximum and breach accounting. If rollout remains at 116 seconds, the API cold budget becomes 626 seconds and fails the ten-minute target.

The UI merge case includes UI image publication and preproduction while preserving the API digest. The shared `AuthProviderGlyph` case selects auth-ui qualification/publication, UI and embedded IdP consumer checks, both images, and preproduction. Skipping deployment for compatible library-only changes is a future conditional policy, not a description of current main.

Isolated transformation gains are not additive: several steps share preparation savings. Distinguish isolated proposed effect, dependency-wait removal, queue allowance, and the complete nine-step budget. Missing, failed, cancelled, or unexpectedly skipped required results block promotion.
