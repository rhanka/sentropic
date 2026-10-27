# OpenAI Decisions candidate packet — V4-L3

- Date: 2026-10-26. Status: fixture conformance only; live qualification outstanding.
- Candidate: OpenAI `gpt-6-luna`, dedicated `openai-decisions` protocol. General chat/Responses catalogue membership grants no Decision eligibility.
- Transport: fixed HTTPS `POST https://api.openai.com/v1/decisions`; one named `verdict` question, one attempt, no SDK retry, repair call, CLI route or fallback.
- Contract evidence: [TypeScript API reference](https://developers.openai.com/api/reference/typescript/resources/decisions/methods/create), retrieved 2026-10-26. Binary maps to predicate probability; choice uses typed string values; score binds numeric indices and labels to the ordered rubric. Refusal is a non-evaluation.
- Current [guide](https://developers.openai.com/api/docs/guides/decisions), retrieved 2026-10-26, now describes GA and paid cache writes/discounted cache reads. This supersedes the spec's dated public-beta/cache-free observation without establishing account entitlement.
- Supported operating policy: text evidence serialized as data, explicit cache mode without breakpoints (cache disabled), standard short context, no region premium. The descriptor is unqualified; these assumptions require confirmation before financial admission.
- Published base tariff: $0.10/M uncached input, no output charge. Candidate price revision is service-specific and bound to `control.model_pricing`; it is not a Responses tariff and grants no spending authority.
- Protocol fixtures: `packages/llm-mesh/tests/decision-openai-v4l3.test.ts`; synthetic documented answers, not live recordings. Usage requires the dated schema's input/output/total and cache/reasoning details, validated independently.
- Identity: model string observable; accepted model set empty by default. Frozen selection, checkpoint stability, account access and liability bound remain unverified. OD-6 is not decided by choosing this candidate.
- Retention: conservative unknown receipt; vendor feature availability does not prove account-specific terms.
- Attempts/work/billable units: zero live attempts, zero model work, zero live spend. No measured latency, semantic calibration or universal readiness claim.
- Outstanding owner: provider qualification owner, V4-L5/L6. Obtain endpoint entitlement, exact selection guarantee, qualified input bound and tariff assumptions; run only an approved, capped packet against locked labelled criteria.
- Exit: per-candidate identity/billing/access report plus criterion-specific quality results; all production gates must pass independently. Blocked access leaves OD-2 qualification outstanding.
- HF selection/hosting and labelled assessment remain V4-L4/L6. Optional prompted Luna and Julia remain disabled.
