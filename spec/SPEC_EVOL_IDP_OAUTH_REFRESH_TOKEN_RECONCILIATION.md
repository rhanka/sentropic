# Amendment — refresh specification evidence reconciliation

Date: 2026-10-18. Applies to [the refresh specification](SPEC_EVOL_IDP_OAUTH_REFRESH_TOKEN.md) and PR #699 round-1 findings. This records specification treatment, not runtime validation or owner acceptance.

Source: `/home/antoinefa/src/sentropic/.tmp/idp-refresh-token/analysis-astra.md`, observed **353 lines**, SHA-256 **`abd18e92d6c8725554dbed2546968859636e1c13fb4e4564485291e2c5918b70`**. All analysis line numbers below refer to these bytes. The previous reconciliation's 340-line / `bbc5ad63aef52cd6c940a15c8f0e6903cfe034a660645ce0c7ca9f635a191c9b` identification is superseded; that alleged source version was not verified. The analysis remains unchanged.

Evidence revisions: Sentropic baseline `9ed96eb83cd77da710f1adeb83a19e425d6c4910`; open MFA spec #695 `ef956c306be72b066f2a316d79fd6b0f8b1c4d68`; open registry spec #692 `4ed7cb37d4de12ee86eda3faeff5f1bc0de07ec2`; external Radar repository `89da3c814d3bfa4e5a6929c14838b04ab74d8291`. Merged exchange implementation #679 and open registry documentation #692 have distinct status. Radar's supplied investigation is 37 lines; package/session evidence is at lines 8–9, with its inspected revisions explained at line 3.

This table replaces the prior blanket TAKEN mappings in `.tmp/idp-refresh-token/reconciliation.md`, including nonexistent analysis sections and the claim that the source explicitly accepted a single-table model. Section references in the last column target the refresh specification.

| # | Actual analysis lines and point | Disposition and landing |
|---|---|---|
| 1 | 10–27: baseline versus open specs and external evidence | Taken; sections 0, 2 and 7 pin each revision and status. |
| 2 | 29–35: standards and offline-consent profile | Taken; sections 3, 5 and 6 cite OAuth 2.1 as draft-ietf-oauth-v2-1-16, RFC 6749/9700/7009/8707 and OIDC Core. |
| 3 | 50–54: immutable deadline, capped final bearer, human ceremony distinction | Taken; sections 4.3, 6.2 and 12; D-R1 remains unratified. |
| 4 | 68: retain spent digests through live-family boundary | Taken; sections 4.2 and 9 retain the anchor/lineage until family and access metadata expire. |
| 5 | 62–76, 242: generations, atomic transaction, one active leaf | Taken; sections 4.2, 6 and 9 specify constraints, transactions and PostgreSQL races. |
| 6 | 58–64: separate family and generation tables | Changed: retain one refresh table with generation-0 durable anchor plus client/user/anchor serialization; sections 4.2 and 9 require equivalent durable revocation. The source does not endorse this schema choice. |
| 7 | 72–75: authenticate/bind before destructive replay handling | Taken; section 6.2 and wrong-client/secret/DPoP tests. |
| 8 | 97: access downscoping preserves original refresh grant | Taken; sections 5.1 and 6.2 also invalidate removed live authority permanently. |
| 9 | 115: live tenant and authorization checks | Taken; sections 5.1, 6.2 and multitenant amendment; no null-tenant downgrade or restoration revival. |
| 10 | 111: standard top-level OAuth wire errors | Taken; section 6.3 and protocol/host suites. |
| 11 | 79: strict rotation and response-loss cost | Taken; sections 4.2, 5.2 and 6.3; no grace/cache workaround, compatibility gate if native qualification fails. |
| 12 | 125–139: opt-in/provisioning/secret-rotation preservation | Taken; section 5 and registration tests; live client authority is rechecked. |
| 13 | 187–200: published support versus native unknowns | Taken; sections 5.2, 9.3 and Lot 0; indexed article is secondary evidence with failed direct retrieval, not a production receipt. |
| 14 | 141–152: fifth MFA leg, original evidence, security lifecycle | Taken with bound; section 7.1 targets #695's evaluator at 413–419, keeps every non-null required-ACR client disabled and never revokes on unauthenticated recovery request alone. |
| 15 | 185, 202–211: 403/401, session 404/current bearer and PRM | Taken; sections 7.2 and 9.3 name existing mcp-auth/mesh/host/Radar suites and idle/restart/two-rotation acceptance. |
| 16 | 121, 175–183: mesh subject persistence, no refresh downstream, cache versus validity | Taken; section 7.3 separately states immediate issuer cutoff, 60 s residency, up-to-300 s delegated validity capped by subject expiry, and up-to-1 h human validity. Cache eviction cannot revoke delivered JWTs. |
| 17 | 254–263: tier sync, restore and rollout | Taken; section 7.4 and sync amendment keep offline authority local and invalidate restored/rekeyed families. Baseline import 101–106 deletes, 123–124 classifies with fallback 'durable'; the existing table is authorization_codes. |
| 18 | 267–278: actual residual product questions | Taken as proposals; section 12 and BRANCH.md leave owner document-UAT pending. D-R1/D-R2 need ratification before affected acceptance; D-R3 is conditional, no KVM reopening. |
| 19 | 125–127, 260: resource-specific consent and imported scopes | Taken explicitly; sections 4.2/5.2 add local issuer/epoch/offline scopes/resource/default-audience evidence, UI/port/schema/sync ownership and withdrawal/reapproval tests. A copied scope string proves no offline grant. |
| 20 | 66: domain-separated digest recommendation | Changed: SHA-256 of the complete UTF-8 srt_ token via hashSecret at every endpoint; no extra separator. The 256-bit random secret supports this contract; section 4.1 and end-to-end lookup tests prevent issuance/lookup divergence. |
| 21 | 213–252: seat comparison, delivery roles and acceptance | Taken; sections 2.3, 9 and 10 keep custody separate, assign BUILD owners and concrete suites, and test T−1/T/T+1 without waiting or increasing timeouts. |

Round-1 citation correction: the appended `/mcp/.well-known/oauth-protected-resource` redirects 308; the bare `/.well-known/oauth-protected-resource` serves compatibility metadata (Sentropic `prm.ts:60–65`, `hono.ts:48–52`). Native behavior, live TTLs/images and owner ratification remain unverified. No additional peer-consensus verdict is claimed by this treatment.
