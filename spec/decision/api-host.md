# Decision API host

The product API acquires the Decision host and JEV transport through the cluster-mesh module
registry and `compose/llm-mesh`. Its existing namespace author fence and session authentication
protect `GET` and `POST /api/v1/llm-mesh/decision`. The POST body is the closed Decision v1 request;
it cannot select financial ownership, credentials, execution profile or readiness evidence.
GET returns evaluator discovery and availability facts without contacting a provider.

`DECISION_EXECUTION_PROFILE` selects `production` (the default) or `qualification`. Other values
make the Decision endpoint unavailable. Production retains the shipped unqualified descriptors:
neither remote evaluator can execute. L6 identity and criterion calibration remain outstanding.
Qualification requires `admin_app` and workspace admin membership, returns experimental receipts
and verdicts, and accepts only the provisional exact wire IDs `jev-1.13.0` and `gpt-6-luna`.
It never advertises production readiness. Local native hosting remains deferred.

The operator provisions `OPENAI_API_KEY` (the existing OpenAI environment connection) and the new
`JEV_API_KEY` for TypeSafe, plus `DECISION_EXECUTION_PROFILE` when qualification is intended.
Compose forwards these names; `k8s-bundle-secret` reads them from the operator's env file and
the API template uses optional secret references. No values are provisioned by this change.
An absent key is unavailable; an unset profile defaults to production refusal, while an empty
or unknown profile makes the endpoint unavailable. Requests and logs never carry key material. This lot performs no live call,
entitlement probe, provider inventory request or paid assessment.

## Financial bound

Qualification caps the combined serialized input and single question at 1,024 UTF-8 bytes and
the complete wire body at 8,192 bytes. Native adapters add no prompt generation or retries.
The conservative input reservations remain 65,536 tokens for JEV and 2,048 for OpenAI Decisions;
neither protocol admits billable output. This host-only financial bound does not qualify served
identity, model stability, latency or semantic quality. A breached reserve disables the exact
evaluator revision durably before later admission or dispatch. Keep qualification inputs small;
larger input scopes require separate evidence and a reviewed bound.

The existing llm-metering admission reserves every applicable monthly tenant, workspace,
principal and model bucket. Missing strategy, tenant bucket, price or database refuses admission.
The Decision adapter holds the evaluator lock before the hold/budget locks; dispatch rechecks
authorization and disable state. Host database operations have bounded transaction/lock deadlines.
Settlement atomically writes the exact micro-USD ledger charge, metadata receipt, disable evidence
and outbox event. Unknown usage retains the full reserved liability as pending spend; it never
becomes a zero charge. Repeated settlement does not double-charge. Accounting reconciliation
does not replay the provider evaluation. No request content or verdict enters the financial ports.

## Published tariff sources

Verified 2026-10-28 from the providers' public documentation, without authenticated provider calls:

| Service | Source | Standard input USD/Mtok | Output | Immutable pricing row |
| --- | --- | ---: | --- | --- |
| JEV `jev-1.13.0` | [TypeSafe models](https://docs.typesafe.ai/models.md) | 0.042 ($42/Btok) | Free | `jev-1.13.0-standard-2026-10-28` |
| OpenAI Decisions `gpt-6-luna` | [Decisions pricing](https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability) | 0.10 | Free | `openai-decisions-standard-no-cache-2026-10-26` |

Migration `control/0012_decision_host.sql` inserts both `control.model_pricing` rows. Rates are
42,000 and 100,000 integer micro-USD per million input tokens, respectively. The migration uses
the existing pricing writer's provider/model advisory lock and closes only an open predecessor.
Windows and their unique key include `protocol`; historical rows default to `generation`.
The generation reader/writer keep that default, while Decision admission explicitly selects
`jev-native` or `openai-decisions`. A native Decisions price never replaces the chat tariff for
the same `gpt-6-luna` wire model, including when both rows share an effective timestamp.
Resolution requires the exact current row ID, provider, model, protocol and authority. Missing,
expired or superseded rows refuse execution. OpenAI's dedicated Decisions codec disables implicit
caching; other OpenAI endpoints and processing tiers do not inherit this price.
