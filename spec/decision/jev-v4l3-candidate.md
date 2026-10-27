# JEV candidate packet — V4-L3

- Date: 2026-10-26. Status: fixture conformance only; live qualification outstanding.
- Candidate: TypeSafe `jev-1.13.0`; mesh revision `jev-1.13.0-mesh-v1-unqualified`.
- Transport: fixed HTTPS `POST https://api.typesafe.ai/v1/systemone`.
- Contract evidence: [System One reference](https://docs.typesafe.ai/api), retrieved 2026-10-26; the answer discriminator matches its question (`noul`, `choice`, `score`).
- Tariff source: [TypeSafe models](https://docs.typesafe.ai/models); specification v4 records $0.042/M input, free output. Host price authority remains `control.model_pricing`.
- Protocol fixtures: `packages/llm-mesh/tests/decision-jev-v4l3.test.ts`. Synthetic, version-pinned values; no recorded live response or paid request.
- The provider response requires `type` and it must match the resolved criterion; missing, contradictory or extended answers are rejected. Primitive projections without `type` exist only inside typed-verdict reconstruction, never as a provider-wire fallback.
- Identity: accepted served-model set stays empty; served identity and billing bound stay unqualified. Matching a documented version is insufficient evidence of physical checkpoint stability.
- Input liability bound: candidate only; byte limits are not tokenizer qualification. No automatic upgrade to JEV 1.14 or mutable aliases.
- Retention: conservative unknown receipt; account-specific policy unverified.
- Attempts/work/billable units: zero live attempts, zero model work, zero live spend. Fixture tests do not establish measured latency, access or semantic quality.
- Outstanding owner: provider qualification owner, V4-L5/L6. Supply exact accepted identity evidence, qualified token liability and price revision, account access, approved run packet and criterion-specific labelled assessment.
- Exit: independently evidenced identity/billing plus locked criterion/dataset/policy results; readiness remains false until all production gates pass.
- OD-5 remains open. No durable product host, deployment or production qualification is delivered by this lot.
