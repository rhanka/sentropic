# Preserved qualification before reboot

Source: `57e246c70f09f412559d51e98945e736f09907df`, retained under `recovery/memory-l5-pre-reboot` locally.
Candidate: `965c93e326df9866584261061f4e49571cfd74dfe1dc258c0c6894eea121a4e9`.
Archive: `r5-pre-reboot-run.tgz`, SHA-256 `58d8831a8a681dbdd3aec32b8c8993117238bdf8d8b2751a4e300c8164a04e80`.

The archive preserves original paths and bytes for the candidate manifest, raw commands/logs/exits, raw Vitest reports, disabled-install traces, P01–P10 bundles, rejected checkpoint and verifier result. Extract into an isolated directory to inspect; do not overwrite a later attempt.

Verdict: **NOT QUALIFIED**. Reference/source/tooling and ordinary disabled installation passed. LOT=2/3 refused the absent exact durable envelope; exports refused the frozen broker's absent reference export; missing packed suites remained missing. The packed disabled test exceeded its timer because installation was inside the case; the correction is retained in #843. Owner/CI provenance was not fabricated.

This historical attempt remains distinct from the post-reboot source head and its next execution.
