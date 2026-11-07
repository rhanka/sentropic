# SPEC_EVOL — cluster-mesh GAS build target (N1)

Status: FROZEN r3 (2026-11-07). r2 revised after the GLM review; r3 closes OQ13/OQ14 after the ab-assistant co-review and aligns with N3 CONTRACT r3 (see « Review resolution »). Serves Airbus objectives O1 and O7 (slice S1), later S2/S3.
Code baseline read: sentropic `origin/main` 98bddc06d, `packages/cluster-mesh` 0.26.0-dev.14, `packages/artifacts` 0.2.18.
Inputs read: owner verbatim 2026-11-07 (U1/U2 + « que cluster-mesh sache gérer cette situation »), airbus-activities
`docs/objectives-2026-11-07.md`, `contracts/dossier-publish/CONTRACT.md` (N3 draft r2), S1 scaffold (repo
`~/src/airbus-appscript-sentropic`, GitHub private `rhanka/airbus-appscript-sentropic`, formerly `appscript-dossier/`).
N3 CONTRACT r3 §7 (A1–A8, OQ13). `h-cond/focus-live/N3-ANSWERS.md`: not read here; its content is taken from CONTRACT r3 §7.
Marker rule: anything not grounded is « not found » or « open question ».

## 0. Facts that shape the design (grounded)
- F1. `createDegenerateClusterMesh` (`src/mesh.ts`) is the only single-node runtime (`capabilities.mode: 'single-node'`).
  It requires `self`, `workstations`, `memberships: ValidatedMembershipPort`, `projections`, `devices` and one of
  `nhi`/`nhiRunner`. It is `@deprecated` (removal after Lots 4-32). A GAS entry must not depend on it.
- F2. Package root `src/index.ts` re-exports hono routers, storage modules, `node:` users (`node:url` in
  `modules/registry.ts`, node crypto in identity/storage). It cannot be bundled for V8. N1 needs a new narrow entry.
- F3. `src/boundaries.ts` `deriveWorkspaceReference` uses `crypto.subtle` + `TextEncoder`. Neither is a documented GAS
  global (`unverified`, spike G0). The digest must be an injected port, not a global.
- F4. Tenant is resolved only through `ValidatedMembershipPort.resolveApproved({workspaceId, userId})`; any miss
  throws `TenantBoundaryError` (`code: 'tenant_membership_required'`, `src/errors.ts`). Tenant never comes from input.
- F5. `src/identity-contracts/boundary-resolution.ts` already builds that port over `TenantRegistryStore`,
  `WorkspaceDirectoryStore`, `TenantMembershipStore` (workspace → active tenant → approved membership, no cache).
- F6. Artifacts: `@sentropic/artifacts` identities are server-allocated UUIDs (`isArtifactId`), releases are immutable,
  server ports are `KvPort {get, putIfAbsent}` + `UuidPort` + `KeyMutex.runSerialized` (`src/server/ports.ts`).
  **No "strictly increasing integer version per human id" exists**: the N3 `artifact.id` (`^[a-z0-9][a-z0-9-]{2,63}$`)
  and `version` integer are a new store contract (§5).
- F7. The cluster-mesh artifacts leaf `createArtifactsBuiltin` is an MCP leaf (needs `@sentropic/mcp-platform`), not the
  GAS store. N1 ships no MCP (O2 is later).
- F8. S1 scaffold: `appsscript.json` V8, `webapp.access=DOMAIN`, `executeAs=USER_ACCESSING`, scope `userinfo.email`;
  dossiers bundled at clasp-push time as `src/dossiers/*.html` + generated `Registry.js` (`tools/build.mjs`, entries
  `{file, title, createdAt, payloadSha256, llmRoute}`: **metadata only, no bytes**); URL `?a=<id>&v=<n>`; publish-time
  validation already runs in Node inside `tools/build.mjs`; vendored h2a focus-kit 0.98.8 (validator sha256
  `c5b3afce…ad2ea4`, renderer `6a6e62aa…77d305`).
- F9. esbuild is used in `Makefile` (cowork-desktop packaging, 0.25.10 pinned via `scripts/ci/locked-tools.mjs`).
  An SBOM generator for release bundles: **not found** (matches are scanner receipts only).
- F10. Layering of the N3 validation: focus-kit `validator.mjs` (single-file ESM, no imports, no `node:`, no
  `crypto`/`TextEncoder`) checks only the **document** (closed schema + presentation gate). The **envelope** layer
  (closed envelope, C1 no `http(s)://`, C3 ≤ 400 000 B, C4 snapshot, C5 secrets, JCS RFC 8785 integrity, sha pinning) lives
  in `contracts/dossier-publish/validate-dossier.mjs` (Node). Fixtures: `valid-v1.json` + five invalid.
- F11. Capabilities in `mesh.ts` are `single-node`, `interServerDirectory`, `tokenExchange`, `memoryReplication`; there is
  no fetch capability. `FetchPort`, `BlobStorePort`, `RegistryPort`, `LockPort`, `DigestPort`, `ViewPort`, `LogPort`,
  `ClockPort` exist nowhere in `packages/cluster-mesh` today: **all are new** (§2).

## 1. The bundle
- Name `@sentropic/cluster-mesh/gas`, new source entry `packages/cluster-mesh/src/gas/index.ts` (later lots). It imports
  only pure modules: `errors.ts`, `boundaries.ts` (after F3 fix), `membership.ts` types,
  `identity-contracts/boundary-resolution.ts` and a new `src/gas/*`. An import-graph test fails the build on any `node:*`,
  `hono`, `pg`, `better-sqlite3`, `@sentropic/mcp-platform` reachable from the entry (drivers are injected ports today, so
  this is a guard, not a known violation).
- Output: **one file** `dist-gas/cluster-mesh.gas.js`, format **IIFE**, target `es2019` (exact GAS V8 level `unverified`,
  G0), `platform=neutral`, no `import()`, no `require`, no top-level `await`, no `eval`/`new Function`,
  `legalComments=none`, no sourcemap inside the release file (separate release asset). One global,
  `var SentropicClusterMesh = (function(){…})();`, is the only symbol exposed to `Code.js`.
- The focus-kit validator is **not** part of the S1 bundle (F10, §5): S1 ships exactly this one file. A validator IIFE
  appears only in G6 (mode (a)) as a **second** pushed file with its own sha and its own budget; it never counts toward
  the bundle budget and never contradicts the « one file » statement for S1.
- Builder: esbuild pinned as in F9, Make-only (`make build-cluster-mesh-gas ENV=<slug>`, Docker-first; Makefile edit
  needs a scope exception BRxx-EXn).
- Size budget (proposed, not measured): bundle ≤ 150 KB minified, hard fail > 200 KB. Renderer HTML (≈326 KB) is an
  HtmlService file, not in the bundle. GAS per-file and project quotas for the Airbus tenant: **open question**.
- Deterministic build: pinned esbuild + lockfile, no timestamps, stable banner `/* cluster-mesh-gas <version> <git sha> */`,
  sorted inputs, LF endings, build twice in CI and compare sha256 (fail on diff). Build metadata lives in
  `cluster-mesh.gas.manifest.json`.
- Release (N4): GitHub release assets = `cluster-mesh.gas.js`, `.sha256` (`sha256sum` format),
  `cluster-mesh.gas.manifest.json` (version, git sha, esbuild version, import closure list), SBOM (CycloneDX JSON from a
  Node tool; generator **open question**, F9), sourcemap. Tag and `package.json` version follow the Post-Rebase Gate
  (`rules/workflow.md:118`); wagon lanes do not bump versions — the train integration lane assigns the version once.
- Transport integrity: the chain release → private GitHub → Airbus GitLab → Windows laptop → `clasp push` has no build step
  (R8). LF is guarded by a `.gitattributes` rule (`cluster-mesh.gas.js`, `Registry.js`: `-text eol=lf`) in the S1 repo
  (G5 scope, repo `airbus-appscript-sentropic`); AB2 detects any residual drift.

## 2. Ports on GAS services (all **new**, F11)
The GAS runtime is an adapter set injected into the pure core; no GAS global is read outside `src/gas/adapters/`.

| Port (core) | GAS adapter | Notes |
|---|---|---|
| `DigestPort.sha256(input: string \| number[]) → hex` | `Utilities.computeDigest(SHA_256, input)` (string overload = UTF-8; `number[]` = signed bytes), hex via `& 0xff` | the core never encodes: no `TextEncoder`. Replaces `crypto.subtle` in `deriveWorkspaceReference` (F3); string inputs are the `ws:sha256:` workspaceId and the JCS text; byte inputs only for blobs |
| `RegistryPort.get(id, version)`, `latest(id)`, `list(tenant)` → metadata `{sha256, bytes, createdAt}` | mode (b): reads the build-generated `Registry.js` (in-memory, no bytes) | the only store backing in S1; no Properties, no Drive |
| `BlobStorePort.put/get(name, bytes)` | mode (a) only: `DriveApp` file per (id, version) in a configured folder | **no mode-(b) adapter exists or is needed** (§4/§5); folder id is a deployment property |
| `KvPort`-like index | mode (a) only: `PropertiesService.getScriptProperties()`, per-version keys (§5) | per-value limit `unverified` for Airbus |
| Cache | `CacheService` **not used in v1**; later only for the index, TTL ≤ 60 s, never for authorization | open question if needed |
| `ViewPort.render(html)` | `HtmlService`; default `XFrameOptionsMode`; no remote `<script src>` | renderer delivered as an HTML file, `<!--FOCUS_PAYLOAD-->` injection (CONTRACT §5) |
| `FetchPort` | **absent**: the adapter factory has no fetch member | zero external fetch is structural, not a flag. Not a `mesh.capabilities` entry (F11). Enabling needs a new bundle flavor (`cluster-mesh.gas.net.js`), out of scope |
| `LockPort` | `LockService.getScriptLock()` | mode (a) only; **proposal**; `unverified` in the Airbus tenant |
| `LogPort` | `console.log(JSON)` (Cloud Logging) | scope/permission in the linked GCP project: open question |
| `ClockPort` | `new Date()` injected | tests fake it |

Fail-closed seams: the existing gated pattern (`CapabilityGatedError`, `mesh.capabilities.* = 'gated'`) covers
`interServerDirectory`, `tokenExchange`, `memoryReplication`. Network fetch and MCP are not capabilities: they are absent
adapter-factory members. A missing adapter at construction throws `TypeError` (as `nhi` today, `mesh.ts:68`); no stub
fallback, no legacy path.

## 3. SSO identity port (owner requirement)
New port `ViewerIdentityPort` in `src/gas/identity.ts` (name proposed):
```
interface ViewerIdentity { issuer: string; subject: string }       // issuer = "google-workspace:<domain>"
interface ViewerIdentityPort { current(): ViewerIdentity | null }  // null = no identity
```
- GAS adapter: `Session.getActiveUser().getEmail()` under `executeAs=USER_ACCESSING` (F8, scope `userinfo.email`).
  `subject` = lower-cased email; `issuer` = `google-workspace:` + the domain part.
  **Domain pinning**: the deployment config holds the allowed domain list (`airbus.com` family: exact values **not found**);
  an email outside it yields `null`. An **empty** list refuses everyone (the deploy-time default until OQ1 resolves).
- Fail closed: empty/absent email, no `@`, multiple `@`, non-allowed domain, empty domain list, or any exception → `null` →
  fixed access-refused page and a `dossier.denied` log event, with no registry/store lookup.
- Tenant: `ValidatedMembershipPort.resolveApproved({workspaceId, userId})` (F4/F5). `workspaceId` is derived **in the
  adapter** from the pinned domain (e.g. `workspace:<domain>`), `userId` = identity subject. `e.parameter` is never an
  input to tenant resolution; a test asserts that `?tenant=` / `?t=` is ignored. For S1 the membership port is a **static,
  configuration-backed** implementation (`tenantId` fixed per deployment, approved = domain match); a Drive/Properties-backed
  membership store is S2 and an **open question** (domain membership vs per-dossier allow-list).
- Result is a `TenantResidenceContext` (`tid`, `workspace`, `userId`, `homeNodeId`); `TenantBoundaryError` maps to the refusal page.
- Audit: exactly one `dossier.view` event per successful read: `{event, ts, issuer, subject, tid, artifactId, version,
  payloadSha256, outcome}` through `LogPort` → Cloud Logging. `payloadSha256` is the **registry-declared** value (mode (b))
  or the recomputed one (mode (a)). `dossier.denied` logs `subject` only if an email was read. No dossier content in logs.
  Delivery guarantee: **open question** (best-effort; if audit must block the read, the read fails closed when the log call
  throws — proposal, owner to confirm).
- Trust boundary: the identity is *asserted by the GAS platform*, not by a token cluster-mesh verifies. No parity claim
  with the OIDC/WebAuthn paths in `src/identity/`.

## 4. Execution modes: decision (a) vs (b)
Constraint: S1 manifest is `USER_ACCESSING` (F8), so any `DriveApp` call runs **as the viewer**.

| Criterion | (a) separate `USER_DEPLOYING` publish deployment | (b) clasp-time bundling (S1 today) |
|---|---|---|
| Viewer Drive rights | **the viewer needs read access on the store folder** (DriveApp runs as the viewer in the USER_ACCESSING viewer app); publisher project (USER_DEPLOYING) writes with the deployer's authority | none: dossiers are in the script project |
| Write path | a deployed publish endpoint (`doPost`) holds deployer Drive write authority: high-value target; caller authentication laptop → endpoint is **open question** (U1 forbids paste; Apps Script API route `unverified`) | no runtime write path; publish = `clasp push` + `clasp deploy` (U1) |
| Identity at read | viewer app stays USER_ACCESSING (native viewer email); a USER_DEPLOYING viewer would make `getActiveUser()` `unverified` — hence the publisher/viewer split | native: `USER_ACCESSING` gives the viewer email (U2) |
| Immutability / audit | Drive history, mutable by the deployer; read-time re-hash is the control | each version is a file in git (GitLab), validated and hashed at build; push is the only mutation |
| Dossier count / size | no project-size pressure | project size/file quota applies (**open question**; ≈326 KB renderer + ≈330 KB page per dossier) |
| Time to S1 | spike + new deployment + auth design | already scaffolded |

Recommendation: **(b) for S1 and S2**, store code written against `RegistryPort`/`BlobStorePort` so the backing is
swappable. Reasons: no runtime write authority exposed to a domain-wide audience, viewer identity is the documented
USER_ACCESSING case, the owner decided the clasp path (U1). Migrate to **(a)** only if a trigger fires: (T1) dossier
count/size hits GAS quotas; (T2) S3 needs publishing without redeploy; (T3) an authenticated Apps Script API / `doPost`
path is confirmed in the tenant.
Migration rule ((b) → (a)), single statement: the publisher is a **separate script project** (USER_DEPLOYING) that writes
to a domain-shared folder or shared drive; the viewer app **remains USER_ACCESSING** and reads that folder **as the
viewer**, so viewer read access is granted by Workspace group, not per user. Publish-time validation (both layers, §5) and
the read-time sha re-hash (§5) are both active in (a). Under (b) the "write" is the build step (`tools/build.mjs`), whose
output is replayed through the same store code in a test.

## 5. Artifact store
- Model: key `(id, version)`; `id` matches `^[a-z0-9][a-z0-9-]{2,63}$`, `version` integer ≥ 1 (N3 CONTRACT §2).
- **Version rule (one rule, both gates)**: versions per id are **contiguous 1..latest**; publish accepts `latest + 1` only
  (first publish 1; gaps, repeats, 0, negatives and non-integers refused with `version_conflict`). The same predicate runs at
  build time and when the runtime loads `Registry.js` (a registry with gaps, duplicates or disorder refuses to start). This is
  stricter than the former CONTRACT §2 « strictly increasing per id »; **accepted by N3 (OQ13 closed, CONTRACT r3 §7)**, which
  replaces that wording. Today `tools/build.mjs` admits gaps (`Math.max`) and rejects only duplicates: tightening it is a G5
  change in the S1 repo `airbus-appscript-sentropic`. Under
  (a) the check runs inside `LockPort`, since `putIfAbsent` alone gives no "latest+1" (F6); mapping onto
  `@sentropic/artifacts` `Release` is an **open question**.
- **Index layout (mode (a))**: Properties holds small per-version keys, never one aggregated value: `a:<id>:latest` →
  integer, `a:<id>:v<n>` → `{fileId, sha256, bytes, createdAt}` (≈150 B each, far under the ≈9 KB per-value cap). G0 confirms
  total key-count and total-store quotas rather than reopening the layout. Under (b) no Properties are used.
- **Validation is two layers (F10), with explicit owners per mode**:
  - Mode (b), S1: both layers run **in Node at build** (`validate-dossier.mjs`, which imports the focus-kit `validator.mjs`),
    pinned by validator source sha (`c5b3afce…ad2ea4`, h2a 0.98.8) checked in CI. **No validator code ships in the GAS
    runtime**; the runtime enforces only the version rule and the registry metadata check (id/version/sha shape).
  - N3 r3 alignment (CONTRACT §7): `payload.render.root.document` is the **built** document (each `diagram` carries its
    generic@1 `scene`); a closed `payload.build` (A2: renderer/validator version and sha256, `documentDigest`,
    `catalogSha256` null, `capabilities`, `formats`, `increment`, `envelopeSha256`) is covered by `integrity`. The store
    re-validates and checks `payload.build` against its own pins and never rebuilds. Profile `airbus@1`: diagrams optional,
    any `ecosystem:*` source refused (`focus-ecosystem-forbidden`), no ecosystem scene or catalog. Store is **v1-only**
    (`schemaId` `:2.0.0` refused) until focus-kit validator 0.6.0. `tools/build.mjs` emits `payload.build` (G5).
  - Mode (a), G6: document layer = focus-kit `validator.mjs` rebuilt as an IIFE (`FocusValidator`, esbuild, no code change,
    second pushed file, IIFE sha is a release asset). Envelope layer (C1/C3/C4/C5, JCS integrity via `DigestPort`) = **new**
    port code `src/gas/envelope.ts` — new code, not a re-implementation claim; owner lot G6. `buildFocusDossier`
    portability is CONTRACT R5, pending h-cond. GAS-cleanliness of `validator.mjs` is `unverified` until the import-graph
    test passes.
  - Parity is defined **per layer** (A5): see §6.
- **Read path** `doGet(e)`: identity (§3) → tenant (§3) → parse `e.parameter.a` (id regex) and `e.parameter.v`
  (`^[1-9][0-9]{0,8}$`; absent = latest) → registry/index lookup →
  - mode (b): metadata check only; **no payload re-hash at runtime** (bytes are not readable by the app). Integrity rests on
    build-time validation + GitLab immutability + AB2 (deployed bundle sha = release sha) + registry monotonicity. The
    page file is served through `ViewPort`; `payloadSha256` is logged as declared (§3);
  - mode (a): `BlobStorePort.get` → recompute sha256 via `DigestPort` → compare to the index entry (mismatch = fail closed,
    `dossier.integrity` log);
  - then one `dossier.view` → `ViewPort` output.
  Unknown id/version → a **not-found page, distinct from the access-refused page**, that reveals nothing about ids outside
  the viewer's tenant.
- URL scheme `?a=<id>&v=<n>` unchanged (F8); the index page lists only what the viewer's tenant may read.

## 6. Acceptance
Node tests against GAS service mocks (`tests/gas/`, `make test-cluster-mesh-gas ENV=<slug>`, Docker-first; mocks:
`Session`, `PropertiesService`, `DriveApp`, `HtmlService`, `Utilities`, `LockService`, `console`; **no `UrlFetchApp` mock**,
so any call is a `ReferenceError`):
- A1 bundle loads in a `node:vm` context with only the mocked globals; a deliberate `fetch`/`UrlFetchApp` call fails.
  **A1 is the authority** for bundle purity.
- A2 static gate, token-bounded (identifier-boundary regex on the unminified-equivalent AST or a pre-minify check; never raw
  substring on the minified file): no `node:` specifier, `require(`, dynamic `import(`, ESM `import`/`export` statements,
  `eval`, `new Function`. The banner is excluded.
- A3 identity: empty email, bad domain, two-`@` email, **`Session.getActiveUser` throwing**, and **empty allowed-domain list**
  → refused with no store access (spy). Valid email → one `dossier.view` with issuer/subject. `?tenant=other` ignored.
  `TenantBoundaryError` → refusal page. **Index page lists only tenant-readable dossiers** (two-tenant fixture).
- A4 version rule: 1,2,3 accepted; 1 again, 5 after 3, 4 after 2 (gap), 0, `-1`, `"2"` refused; a gapped `Registry.js` refuses
  to start (mode (b)); concurrent publish serialized by the lock mock (mode (a)).
- A5 validator parity, **per layer**. Document layer: `payload.render.root.document` of every fixture gives identical
  verdicts in Node `validator.mjs` and the IIFE (G6). Envelope layer: `invalid-integrity`, `invalid-residency`,
  `invalid-secret`, `invalid-external-url` verdicts of Node `validate-dossier.mjs` equal those of `src/gas/envelope.ts`
  (G6). S1 (mode (b)): the fixtures run through Node `validate-dossier.mjs` as the build gate; no GAS-side verdict exists.
- A6 sha: (i) `DigestPort` over `Utilities.computeDigest` mock vs `node:crypto` on random vectors **including non-ASCII
  and multi-byte text** and `number[]` inputs (encoding drift must fail); (ii) mode (a) only: integrity-mismatch read fails
  closed with a Drive-style blob mock. S1 does not exercise (ii).
- A7 determinism: two clean builds give identical sha256.
- A8 Quota/size gate: bundle ≤ budget, fail otherwise.

Airbus acceptance (airbus-laptop, owner-run protocol, serialized through the h2a laptop instance; results recorded in
airbus-activities, not here):
- AB1 **zero external fetch**: with the web app open in the Airbus Chrome, the browser network log lists no request outside
  `script.google.com` / `*.googleusercontent.com` — exact allowed host list **open question**; manifest `urlFetchWhitelist`
  empty, no `script.external_request` scope.
- AB2 **bundle sha256 = release sha256**: sha256 of the bundle file pushed by clasp (read back from the project source)
  equals the sha256 in the GitHub release (N4).
- AB3 a second Airbus user sees their own identity in a `dossier.view` log line. A non-Airbus account is normally stopped by
  the DOMAIN wall of GAS **before app code runs**: the protocol observes that platform refusal (no app log line expected);
  the app-level refusal is observed through a dedicated **negative test deployment** `ab3-negative`: build-time pinned
  domain list that excludes the owner domain (`["example.invalid"]`), opened by the owner. Expected: a refusal page plus one
  `dossier.denied` log line carrying the owner identity. The production deployment is never touched; `ab3-negative` is
  undeployed after the run. The domain list stays a build-time constant (no runtime override). Also covered by A3 in Node.

## 7. Lots (wagons, branch names; wagons push branches only, no PR; train lane merges and versions)
| Lot | Branch | Target repo | Content | Depends |
|---|---|---|---|---|
| G0 | `spike/cluster-mesh-gas-g0` | sentropic | GAS V8 feasibility on Airbus tenant: `Utilities.computeDigest` (string and byte overloads), Promise/async, globals (`TextEncoder`, `crypto`), `Properties` value and key-count limits, `LockService`, project quota; report only | U1/U2 access |
| G1 | `feat/cluster-mesh-gas-bundle` | sentropic | `src/gas/` entry, `DigestPort` (string \| number[]) + `boundaries.ts` F3 fix, import-graph gate, esbuild IIFE target, determinism, size gate | G0 |
| G2 | `feat/cluster-mesh-gas-identity` | sentropic | `ViewerIdentityPort`, static membership port, audit event, refusal paths, A3 | G1 |
| G3 | `feat/cluster-mesh-gas-store` | sentropic | `RegistryPort` over `Registry.js`, version rule (shared predicate), A4, A6(i); build-time fixture replay (A5 S1 form) | G1, N3 freeze |
| G4 | `feat/cluster-mesh-gas-release` | sentropic | N4: release assets (bundle, sha, manifest, SBOM, sourcemap), tag flow | G1-G3, SBOM tool choice |
| G5 | `feat/cluster-mesh-gas-airbus-s1` | sentropic + airbus-appscript-sentropic + airbus-activities | S1 integration (example `Code.js`, AB protocol doc, `ab3-negative` deployment recipe), A1-A8 green; **changes in `airbus-appscript-sentropic`** (not sentropic): `tools/build.mjs` contiguous-version rule and `payload.build` emission, `.gitattributes` LF rule; **airbus-activities**: realign `objectives-2026-11-07.md:38` (« single-node mode, publish/read artifact port ») to the delivered surface (identity/boundary/registry assembly, build-time publish, no deprecated single-node runtime) | G2-G4 |
| G6 | `feat/cluster-mesh-gas-drive-store` | sentropic | later, mode (a): Drive `BlobStorePort`, Properties index, `LockPort`, `FocusValidator` IIFE (second file) + `envelope.ts`, A5 full, A6(ii), separate publisher project, triggers T1-T3 | S1 done |

Each lot: scoped local tests only, `BRANCH.md` with Allowed/Forbidden/Conditional paths (Makefile edit = exception), no
version bump in wagons, two-AI design review at max effort before build (this spec: author + one reviewer, done once).

## 8. Risks
- R1 GAS lacks `TextEncoder`/`crypto.subtle` and perhaps other globals pure modules touch (F3). Mitigation: G0, injected ports.
- R2 `validator.mjs`/`buildFocusDossier` not GAS-clean (CONTRACT R2/R5) would force a fork — forbidden by the pin; ask h-cond.
  Only G6 is exposed to this; S1 is not.
- R3 `getActiveUser()` returns empty in some configurations (consumer accounts, missing scope, cross-domain); fail-closed
  makes it an availability issue. Mitigation: the refusal page states the cause.
- R4 Size: renderer ≈326 KB + payloads vs GAS project quotas (`unverified`).
- R5 Deprecated `createDegenerateClusterMesh` (F1): wrapping it inherits removal. Mitigation: boundary/membership pieces used directly.
- R6 Audit is best-effort; strength = Cloud Logging retention and project IAM.
- R7 IP/IT-security position on sentropic code in Airbus Workspace (U3) unresolved; signed sha + SBOM supports, not replaces.
- R8 No npm Artifactory on the laptop (E401); the bundle is consumed as a release file, never built on the laptop; transport
  is the only mutation path (mitigated by `.gitattributes` + AB2).
- R9 Mode (b) has no runtime payload re-hash: tampering between GitLab and the deployed project is detected only by AB2,
  not by each read. Accepted for S1; mode (a) closes it.

## 9. Open questions
1. Allowed Workspace domains list for the issuer pin (exact values not found).
2. Is `LockService` available and sufficient in the Airbus tenant (mode (a) only)?
3. GAS project/file/Properties quotas (value, key count, total) for the Airbus tenant.
4. Membership: domain-wide approval vs per-dossier allow-list; Drive-backed membership store in S2?
5. Audit: block-on-log-failure, retention, who reads Cloud Logging (needs GCP project `prj-c700-ahna-dcr-dev-fd68` access).
6. SBOM generator (F9) and where it runs (CI Docker, under the build rules).
7. Map the `(id, version)` store onto `@sentropic/artifacts` releases, or keep it separate?
8. N3 r3 (A1–A8) settles R6 (profile `airbus@1`); R5 (pure `buildFocusDossier` portability) stays open and blocks G6 envelope/validator work only.
9. Authenticated publish path for mode (a) (Apps Script API vs `doPost`), U1 forbids paste.
10. Ship from the `cluster-mesh` package or a new package `@sentropic/cluster-mesh-gas`?
11. Allowed host list for AB1 (Apps Script sandbox domains in the Airbus network).
12. Release naming and train slot for N1/N4 (ETA in the objectives file: 10/11).
13. CLOSED (accepted, N3 CONTRACT r3 §7): contiguous `1..latest`, publish `latest + 1` only, any refusal = `version_conflict`.
14. CLOSED (answered): app-level refusal observed via the `ab3-negative` test deployment (§6 AB3).

## Review resolution (GLM review `.h2a/reviews/spec-n1-gas-glm.md`, REQUEST_CHANGES)
| # | Finding | Fix in r2 |
|---|---|---|
| 1 | Read-time integrity has no bytes source in mode (b) | Option (i) chosen: §5 read path splits by mode; (b) = no runtime re-hash (bytes unreadable), integrity = build validation + GitLab + AB2 + registry rule; new `RegistryPort` (metadata only) replaces « BlobStorePort for bundled mode » (§2, G3); A6(ii) and `dossier.integrity` moved to mode (a); R9 records the residual |
| 2 | Validator scope contradiction, A5 unsatisfiable, one-file vs separate budget | F10 states the two layers; S1 ships no validator (both layers in Node at build); G6 owns IIFE (second file) + new `envelope.ts`; §1 one-file claim reconciled; A5 defined per layer |
| 3 | Mode (a) table cell contradicts USER_ACCESSING | §4 cell rewritten: viewer needs read access; single migration statement, viewer app stays USER_ACCESSING |
| 4 | `DigestPort` bytes-typed needs an encoder | `sha256(string \| number[])`, string overload = UTF-8, core never encodes (§2); A6(i) adds non-ASCII vectors; G1 scope updated |
| 5 | Version gates disagree; scaffold change unnamed | one contiguous 1..latest predicate for both gates (§5), flagged vs CONTRACT §2 (OQ13); `tools/build.mjs` change named in G5 |
| 6 | Properties index collides with per-value cap | per-version keys `a:<id>:latest`, `a:<id>:v<n>` (§5); no Properties under (b); G0 checks key-count quota |
| 7 | Test gaps (A3, A2, AB3) | A3: throwing `getActiveUser`, empty domain list, index-page tenant filter; A2 token-bounded with A1 as authority; AB3 states the DOMAIN wall layer (OQ14) |
| 8 | Transport determinism (CRLF) | `.gitattributes` LF rule in §1 and G5; R8 updated |
| 9 | Ports table precision | F11 + « all new » in §2; FetchPort/MCP reworded as absent adapter members, not capabilities |
| 10 | airbus-activities S1 expectation stale | G5 includes realigning `objectives-2026-11-07.md:38` |
| 11 | Garbled not-found wording | §5 read path: not-found page distinct from access-refused page, no cross-tenant id leak |

## r3 resolution (ab-assistant co-review, 2026-11-07)
| # | Item | Fix in r3 |
|---|---|---|
| 1 | OQ13 accepted | §5 and OQ13 closed; N3 CONTRACT r3 §7 states the same rule; same predicate at build and registry load |
| 2 | N3 r3 A1–A8 | §5 alignment bullet: built form, closed `payload.build` under `integrity`, profile `airbus@1` without ecosystem scene, v1-only store until validator 0.6.0 |
| 3 | OQ14 answered | §6 AB3: `ab3-negative` negative deployment, pinned list `["example.invalid"]`, undeployed after the run; OQ14 closed |
| 4 | G5 repo correction | S1 scaffold repo is `airbus-appscript-sentropic`; G5 changes (contiguous rule, `payload.build`, `.gitattributes` LF) target it |

sha256 (file without this line): 078f057b9c8e330a7c865d086bfc5818f3f7dd31481611153cf7f64082ae7d33
