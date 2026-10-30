# Qualification safety controls

Observed 2026-10-30. Daily service, auto-merge and all scanner admission flags remain off.

The [live receipt](sec5a-config-control.json) closes #840 open item 7: a real malicious-config trial. The digest-pinned Trivy 0.76.1 scans the same hash-pinned, never-executed Log4j 2.14.1 archive twice with frozen fresh DB snapshots. Repository-controlled `trivy.yaml` skips the payload; an ignorefile is present too, but its independent effect is not claimed. The default control reports zero findings; the hardened control reports eight CVEs, including CRITICAL CVE-2021-44228. Both produce valid filesystem reports; malformed or absent reports fail the trial.

`make security-qualify-acquire security-qualify-config ENV=test-sec5a-safety` reproduces the experiment under the shared Docker flock. The receipt retains DB manifest/layer/file hashes, metadata timestamps, fixture/config/report hashes, all observed finding identities and isolation settings. The native scanner runs without network, credentials or daemon socket, with read-only root/target/DB, dropped capabilities and a non-root UID. Only acquisition has network access. Cache bytes are verified for integrity and freshness before and after the trial. Raw reports and diagnostics remain in `tmp/security-qualify/hostile-config/`; this receipt does not grant admission.

The production cache adapter now classifies missing cache directories or files as `coverage-blocked: required cache files unavailable`. Regressions prove it refuses without acquiring replacement bytes. The live failure runner expects the same classification.

Operator registry fields are parsed as data rather than evaluated shell. Hostile substitutions remain literal bytes; duplicate, incomplete and malformed fields and registry option injection fail before authentication. Detached scanner trials retain Docker-assigned IDs and remove their own container on intermediate failure; regressions exercise failed creation and failed inspection without Docker access.

The inherited SECQUAL-EX1 scope exception permits only the existing opt-in Make include. Removal trigger: qualification completes or is abandoned; expiry: 2026-11-12, after which the shared Make prerequisite refuses trials pending renewal. UTC boundary regressions exercise the last valid date and the first expired date. No vulnerability exception or suppression is added.

Remaining admissions are unchanged: patched scanner and independent verifier/content admission, SAST/IaC coverage, canonical remote provenance and remote isolation, independent expected inventories, isolated builder/rebuild, performance target and qualified-runtime rollback. S3 custody remains a separate prerequisite. Explicit daily-suite CI wiring is handled separately in PR #848; the previous main already imported these tests indirectly.
