# RC1 session authority

This implements the sentropic RC1 boundary from plan v1.1 revision 2 and the frozen joint interface, SHA-256 `104e64761f957c12291ad86bc8553359d63bf15135660d7f53ddbdccded17032`. RC2 supplies the approved native mapping/capsule; K-app and K-native supply dispatch, claim, durable consumption and effects. No action routes or provider effects are enabled by RC1.

The standalone IdP owns `POST /api/v1/auth/session/remote-action-evidence`. The product root returns `403 authority_refused`. The issuer route requires TLS, an exact authenticated app workload, and the `remote.evidence.issue` S2S scope and pinned resource. Browser Origin/cookies are refused before body parsing. Input is streamed with an 8192-byte maximum, duplicate-key and invalid UTF-8 rejection, and a closed EvidenceRequest. Responses use `no-store`; failures contain only typed codes.

The issuer derives the owner and original authentication time from the current verified session credential. It independently resolves the native target's tenant/workspace membership. A global login may switch approved native targets without a new login or MFA ceremony. Every explicit action gets fresh EdDSA evidence with exact action/target/operation/payload/nonce bindings and a unique jti, bounded to 60 seconds and the original credential expiry. Issuance replay metadata is namespaced in the existing unique proof-fence table for at least 90 days. K-app dedup and native durable jti/nonce consumption remain independent obligations.

`authorizeRemoteAction` requires approved-owner equality, current exact-workspace membership, a permitted nonviewer role, enabled control epoch and current BindingControlConsent. Only that consent supplies `remote.input` and `remote.permission.respond`. Owner-wide on or an administrator role grants no scope. Input additionally requires interactive mode and no auto-approval policy. The attestation has the exact frozen fields, with no envelope/self-digest cycle.

`verifyRemoteCliProof` compares the complete source-signed proof against a trusted current-native-state port, including the closed Target, approved-registration revision, provider identity, mode/policy, capabilities, key and deadline. The default production target contribution is unavailable. Tests inject the native port; synthetic results do not close installed/native acceptance.

## Isolated authority

| Workload | Private authority | Public input / allowed purpose |
| --- | --- | --- |
| Standalone IdP | Its session-signing secret, issuer-private session volume and IdP evidence key | Current login verification; exact-action evidence only |
| App authorization | Its attestation key and app workload credential | Public IdP/source trust; current membership/consent attestation |
| App mesh instruction | Its mesh instruction key | Public trust; eventual action-envelope signing in K-app |
| Native B | Enrolled source/native keys and local state | Public IdP/app/mesh trust; independent verification and durable consumption |

The three proof-signing roles require distinct public fingerprints, kids, workloads and secret references. The loader requests only its own role's secret and compares its derived public key with pinned public trust. Public configuration rejects private key fields. Unknown/revoked or substituted keys fail validation; rotation installs acknowledged public trust before activation. No fixture private key is committed.

BRRC1-EX1 adds a dedicated `auth-idp-session-signing` Secret reference and `auth-idp-session-authority` PVC to the IdP manifest. The product receives neither. Session and refresh credentials cryptographically bind original MFA, authentication time and session version; refresh preserves them and rotates with a credential-hash CAS. Old credentials without signed lineage cannot authorize remote control; pre-upgrade UUID refresh credentials require a new login.

The issuer-private volume retains current credential hashes, immutable login metadata, expiry and revocation tombstones. It stores no bearer or proof bytes. Login/refresh/revoke update this authority; a restored or modified shared DB row cannot create, elevate or revive it. Writes use per-session filesystem fences, fsync and atomic replacement. An interrupted writer leaves authority closed for recovery. An ambiguous refresh fails closed and can require a new login. Tombstones are retained without automatic deletion. Session-store loss/corruption refuses authority. Restoring an older private authority volume requires a separately qualified revocation/epoch recovery and remains closed until that gate passes.

Bulk session revocation tombstones every deleted session ID, including a login whose private creation has not completed. A tombstone for an unknown ID prevents that creation from reviving deleted authority. Evidence preparation revalidates current login after asynchronous target/replay work; the final synchronous EdDSA signature shares the per-session private revocation fence and rechecks the original conservative deadline. Revocation and signing therefore have an explicit ordering boundary across issuer processes.

## Configuration and composition handoff

The standalone issuer requires its isolated `JWT_SECRET`, `REMOTE_ACTION_ROLE=auth-idp`, and `REMOTE_ACTION_SESSION_STATE_DIR` on the issuer-only durable mount. Provision the referenced Secret and storage before any approved rollout. No Secret value, deployment or live migration is created by this branch.

For the evidence backchannel, provision `REMOTE_ACTION_EVIDENCE_CLIENT_ID`, `REMOTE_ACTION_EVIDENCE_RESOURCE`, `OAUTH_ISSUER_URL`, `REMOTE_ACTION_WORKLOAD_ID` and `REMOTE_ACTION_TRUST_FILE`. Public trust has exactly the `idp`, `attestation` and `mesh` pin objects: issuer, kid, workload, secretRef, publicKeyPem and optional revoked. Private evidence keys must be separate mounted secrets; the product must never mount the IdP key. The caller's S2S client must be the attestation workload. TLS termination must supply an authenticated internal TLS route; untrusted forwarded headers do not authorize it.

RC2's named composition writer supplies `RemoteEvidenceIssuerPorts.approvedTarget(targetDigest, credentialDerivedLogin)` from the approved current-native registration/proof state. It returns only the pinned native audience and exact tenant/workspace or null. The issuer then checks its own current membership. A cannot submit subject, tenant, workspace, audience, callback or socket fields in EvidenceRequest. Missing native contribution refuses issuance; there is no production fake.

The conductor relay request is `.tmp/remote-ctl/RC1-requests-to-native.md`: D2-JWS, CLI-PROOF, owner/scope, key rotation, bounded revocation and content-v3 policy-purpose vectors. R15 remains open: frozen draft.5 line 140 references S2 share/amend mapping/vector bytes absent from both pinned and current S2. The exact normative change request is `.tmp/remote-ctl/RC1-share-amend-proof.md` (RC1-S2-POLICY-01). Remote-action evidence is not a sharing proof. Source/read credentials cannot authorize human operations.

Native reply IDs below are tracking references only. They preserve the seven original request groups and all frozen wire identifiers. The reply at `/home/antoinefa/src/h2a/tmp/h-cond/rc1-reply.md` has SHA-256 `dc17a5ea3bb8bcf2d080338ac08a4dfd42f06d9259832ae36ed386b31f0b579d`; its analysis has SHA-256 `23669df87d63ee651865bc73d70d3ba350dcfa458911df6849b3f6a7bf5f4ac9`. Local witnesses do not close any native delivery row.

| Native tracking ID | Existing app-side test reference / outstanding native evidence |
| --- | --- |
| R01 — AUTH-01 | `api/tests/unit/auth/remote-evidence.test.ts`: repeated actions/source switch. Real login/installed verifier receipt pending. |
| R02 — D2 lineage | Same suite: signed issuer/subject/sid/sessionVersion substitutions. Native vector/verification pending. |
| R03 — D2 audience/MFA | Same suite: audience/amr/auth_time substitutions. Qualified native MFA policy pin pending. |
| R04 — D2 exact bindings | Same suite and `remote-authority.test.ts`/`remote-contract.test.ts`: action/JCS/attestation bindings. Shared byte fixtures and native equality checks pending. |
| R05 — D2 keys | `remote-evidence.test.ts`: unknown/revoked/wrong IdP key. Native purpose-scoped ring vectors pending. |
| R06 — D2 algorithm | Same suite: positive pinned EdDSA signing. Shared negative JWS algorithm-substitution fixtures/native verification pending. |
| R07 — D2 expiry | Same suite: signed time mutations; `remote-native-proof.test.ts`: CLI proof cutoff. Native original-deadline vectors pending. |
| R08 — D2 replay | `remote-evidence.test.ts`: explicitly injected native fake. Durable native replay/restart/race receipt pending. |
| R09 — CLI-PROOF | `remote-native-proof.test.ts`: exact signed proof/target comparisons. Actual-host proof producer and capsule lock pending. |
| R10 — OWNER-ONLY | `remote-authority.test.ts`: owner/membership/role refusals. Paired native refusal witnesses pending. |
| R11 — consent/scope | Same suite: scope/revision/epoch equality. Native consent-fence/race witnesses pending. |
| R12 — trust isolation | `remote-contract.test.ts` and `remote-evidence.test.ts`: key/workload/secret separation and rotation. Acknowledged shared trust and actual workload receipts pending. |
| R13 — revoke/logout | `remote-evidence.test.ts`; `api/tests/api/auth/remote-session.test.ts`: current issuer denial/restore. Observed native denial/real-session receipt pending. |
| R14 — offline bound | Unit evidence clock refusal and CLI proof minus-5000-ms cutoff. Native immutable claim cutoff and installed <=35 s measurement pending. |
| R15 — sharing policy-purpose | No successor schema/vector test asserted. Blocked by RC1-S2-POLICY-01; shared policy fixtures and native PolicySessionVerifier remain pending. |

## Validation and acceptance

Tests cover repeated explicit action evidence and distinct native audiences under the same login; refresh; logout, revocation, expiry/version; wrong identity/audience/MFA/key; revoked/rotated trust; exact Target/consent; native replay fake; bounded body/TLS/workload/product/browser refusals; and private authority restart/restore/CAS. RED receipts precede implementation. Commands use ENV=test-rc1 last, API_PORT=8799, UI_PORT=5199 and MAILDEV_UI_PORT=1099, under both shared Docker locks, followed by `make down`.

Post-integration local validation at `c36c75759a0fbe43c2e32ca14f08d67a55b03e68` passes 177 cases: 123 RC1 unit, 20 RC1 API, 11 session-manager, 2 passkey-MFA session, 10 federation-route cookies and 11 API session cases. API typecheck/lint and standalone IdP typecheck pass. The receipt is `.tmp/remote-ctl/RC1-final-green.log`; its final result records zero for all seven checks. This is local app-side evidence; native and real-session gates below remain open.

The D2 trust limits remain unchanged. A compromised API holding a still-valid login credential can act within that login's existing bounds. Compromise of API plus issuer/signing authority can drive connected approved sessions within native limits. Key isolation does not prove a fresh human click or protect a compromised permission-card UI. There is no trusted-display or instantaneous offline-revocation claim. Fixed conservative deadlines and native local denial still apply.

RC-SESSION still requires the real enrolled-2FA login and installed native verifier/capsule/key/workload/storage receipts. Real receiver/provider/two-machine effects, phone alerts, RCP, protected release and owner production GO belong to their named later gates. BRRC0-EX1 retains mechanism-only dependencies and writer leases; unrelated artifact/product completion is not a remote predecessor.
