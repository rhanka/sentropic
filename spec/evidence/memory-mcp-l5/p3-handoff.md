# P3 pre-candidate amendment

Base: `origin/main@22d8a9e68b1abae2665fedb528526d2a84c6bc4d`.
Approved correction: `b13bcd77f4a78e20c7f6ed36561b5f2e57eeb7442ad5623d8607991a952a6ee9`; Opus r2 approved its two substitutions and retained producer tuple.

P2 history remains `2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`, frozen by `a601c8a1b1dd829f5d9f5eba4cac9377a4c4b162`.
P3 derives from retained main manifest `f2b094ae034514727dfe2f4c9a89b3742e3d75beafc8f70e5074cd49d7f16642`, written by `b6e1313e81a72a6d57424dba93a3662cb68c2912`; its exact bytes and sidecar are retained in `tools/memory-mcp-l5/artifacts/history/`.

Exactly seven scalar deviations from historical P2 are inherited, without repacking:

| Field | Historical P2 | P3 inherited value |
| --- | --- | --- |
| `source.br3Commit` | `b67e2a49af789f8f51d91cc5695f89caa63db2ee` | `e6d17327898a0118af123ff36ae508eefda80ddf` |
| `source.l5Head` | `517d06f8df562faf5baef19fa464dac814557d65` | `23f455c6dd253f9be1bb6dfc8c24546f8e2c1c20` |
| `source.declaredLockSha256` | `9e360b55538ac454c12d272340c2ec5d9ea5ea73ca70c85a08ea5e5552b87377` | `3bdcfa350d278ce118ae64486bbb3bde197797f56cbad3ca06517c469419da12` |
| `source.declaredLockSnapshot.sha256` | `9e360b55538ac454c12d272340c2ec5d9ea5ea73ca70c85a08ea5e5552b87377` | `3bdcfa350d278ce118ae64486bbb3bde197797f56cbad3ca06517c469419da12` |
| `source.declaredLockSnapshot.path` | `tools/memory-mcp-l5/artifacts/lock-snapshots/9e360b55538ac454c12d272340c2ec5d9ea5ea73ca70c85a08ea5e5552b87377.package-lock.json` | `tools/memory-mcp-l5/artifacts/lock-snapshots/3bdcfa350d278ce118ae64486bbb3bde197797f56cbad3ca06517c469419da12.package-lock.json` |
| Platform artifact `sourceHead` | `517d06f8df562faf5baef19fa464dac814557d65` | `23f455c6dd253f9be1bb6dfc8c24546f8e2c1c20` |
| Broker artifact `sourceHead` | `517d06f8df562faf5baef19fa464dac814557d65` | `23f455c6dd253f9be1bb6dfc8c24546f8e2c1c20` |

P3 changes only two inventory hashes from the retained main bytes: catalog `c8b0f9c8a907eb3d6a42e7a81d7509e6f5149aaf0b9f557842bda928c74c84be` -> `9bf377b774dda54a3b37189eea57cb845acca7b27b8b55b399f23c20215a1211`; L0 freeze `f37b3b9e220ab1043614b14eec34cbd1539b0cb9358d5ecee37f1bf81ad43bc5` -> `0541b15ba4d5e49ba3b30d92da1c5e3c2fd668e40937e4f942103a678e849bfb`.
P3 manifest SHA-256: `1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730`.
The L0 also corrects its stale artifact-manifest schema pin to the unchanged live schema `c0f968512d7b7bea14b0502eed95fae207e3ea09aba6524d77518631e69a6d36`.
All remaining inventory bytes, versions, spec identity, fixtures, source heads, archives and toolchain/lock snapshots are preserved. The checkout lock is not substituted for the retained closure.

L0 reissue: owner authorization recorded (text); detached signature pending.

- `authorizedBy`: `owner:antoinefa`; `at`: `2026-10-26T16:59:54Z`.
- `verbatim`: « Je dirai pas ca ma vas y », in reply to the L0 freeze re-issue request (P09 rescoped, P2 to P3).
- `source`: `.tmp/owner-deliverables/OWNER-DELIVERABLES-2026-10-23.md`, conductor's log line at that timestamp.
- Covered digests: amended L0 `0541b15ba4d5e49ba3b30d92da1c5e3c2fd668e40937e4f942103a678e849bfb`; P3 `1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730`.
- `detachedSignature`: `null` (pending), as recorded in [p3-owner-authorization.json](p3-owner-authorization.json); text authorization is not a signature or signed disposition. Frozen bytes and fail-closed behavior are unchanged.

`owner:antoinefa` must still supply the detached signature for the exact amended freeze digest. One allowed actor per L4/platform/broker/transport role must provide detached signed dispositions covering it, with each role explicit, before handoff/qualification. One authorized owner may cover multiple roles.
Gr-conductor must acknowledge both the `f2b094ae…` change and exact P3 digest/freezing commit before handoff. No prior ACK is reused and no notification/ACK is claimed here.
Amendment/freezing commit: `c919b638686fb93c8c90a2634d3c004fd25348b3`. It is recorded separately in the root BINDING.md P3 section and the draft PR, preserving manifest producer heads.
After those approvals, downstream owners rebuild E4 from unchanged source against P3 and reissue candidate/E2/host/contract/proof/checkpoint receipts, including new `authoritySourceSha256`, actual CI and qualification. This draft supplies neither those receipts nor publication/registration acceptance.
