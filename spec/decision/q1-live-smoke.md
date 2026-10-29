# Decision Q1 live smoke — 2026-10-29

Q1 follows merged H1/H2 (#822, base `213638676`). This is protocol/access and returned-identity
evidence on one synthetic English binary fixture. It supplies no criterion calibration,
immutable checkpoint guarantee or production readiness (OD-4). Both production descriptors
remain unqualified for identity and billing and production execution continues to refuse.

The operator used `DECISION_EXECUTION_PROFILE=qualification`, the real `createDecisionHost`
and durable PostgreSQL metering with `control.model_pricing`, in local Compose project
`test-decision-q1`. Its trusted synthetic operator/tenant bypassed HTTP authentication;
these calls establish host/transport behavior, not a live HTTP authorization acceptance.
API/UI/Maildev ports were reserved at 8802/5202/1102; only isolated PostgreSQL and one-shot
API containers were needed. All Docker operations used the shared Docker flock.
The container rebuilt exact base API and llm-mesh sources on the cached local Node image.

Credentials entered solely through Compose interpolation of the existing `.env` (a symlink
to the operator file). Only names and presence/format booleans were inspected. No credential
value or raw response body is retained. The evidence directory contains the fixed fixture,
per-call result/receipt and allowlisted response metadata, preflight tariffs/bounds, the
fsynced dispatch journal and ledger snapshots. Secrets and their trimmed forms were scrubbed
in memory before writing; only the fixture input was disclosed to the providers.

The fixture asks whether `The sky is blue.` contains the exact word `blue`, using a score
threshold `gte 0.5`. See [fixture.json](q1-2026-10-29/fixture.json). The host enforces exact
served-ID matching against its provisional descriptor set; no alias expansion was used.
Every observed identity matched. A mismatch would be refused and priced conservatively by
the existing host, with no automatic replay. The experiment allocated at most three host
attempts per candidate, including preflight refusal; five actual provider dispatches occurred.
No further smoke attempts remain in this run.

## JEV

| Attempt | Served ID | Input/output/total tokens | Latency ms (wall) | Result | Priced micro-USD |
| --- | --- | --- | ---: | --- | ---: |
| 1 | none; not dispatched | unknown/unknown/unknown | 7 | `CREDENTIAL_MISSING`, preflight | 0 |
| 2 | `jev-1.13.0` | 287/21/308 (total derived) | 226 | experimental binary, score 0.99, threshold pass | 13 |
| 3 | `jev-1.13.0` | 287/21/308 (total derived) | 162 | experimental binary, score 0.99, threshold pass | 13 |

Attempt 1 exposed surrounding whitespace in `JEV_API_KEY` (`trimChanged=true`, no line break).
For attempts 2 and 3 only, the runner normalized it transiently in memory after Compose
injection; it did not edit `.env` or change host authentication. The ordinary host will still
reject that source configuration until the operator removes the surrounding whitespace.
The failed preflight consumes one experiment slot even though the receipt proves zero dispatch.
Both live responses were HTTP 200 with no provider refusal. The adapter accepted the native
answer and reported usage; no raw native answer was retained. These two returned-ID observations
support adding only `jev-1.13.0` to the accepted set, with qualification still unqualified.

Tariff: `jev-1.13.0-standard-2026-10-28`, protocol `jev-native`, input $0.042/Mtok,
output free. Bound: 65,536 input tokens, zero billable output, 1,024 state/question bytes,
8,192 wire bytes; 2,753 micro-USD reserved per live call. Both calls settled, no overrun.
See [preflight](q1-2026-10-29/typesafe-preflight.json) and receipts `typesafe-{1,2,3}.json`.

## OpenAI Decisions

| Attempt | Served ID | Input/output/total tokens | Latency ms (wall) | Result | Priced micro-USD |
| --- | --- | --- | ---: | --- | ---: |
| 1 | `gpt-6-luna` | 167/0/167 | 1805 | experimental binary, score 1, threshold pass | 17 |
| 2 | `gpt-6-luna` | 167/0/167 | 1548 | experimental binary, score 1, threshold pass | 17 |
| 3 | `gpt-6-luna` | 167/0/167 | 160 | experimental binary, score 1, threshold pass | 17 |

The [official guide](https://developers.openai.com/api/docs/guides/decisions), consulted on
2026-10-29, did not establish a zero-cost endpoint entitlement probe. Organization usage reads
require an admin key and do not prove Decisions access. Attempt 1 therefore doubled as the
counted access check: `POST /v1/decisions` returned 200 for the descriptor's exact `gpt-6-luna`.
All responses carried one `predicate` answer with `type`, `name`, `probability`; none refused.
Cache reads/writes and reasoning were reported as zero, with explicit no-breakpoint caching.
Repeated matching strings establish observed served identity, not immutable model weights.

Tariff: `openai-decisions-standard-no-cache-2026-10-26`, protocol `openai-decisions`, input
$0.10/Mtok, output free. Bound: 2,048 input tokens, zero billable output, 1,024 state/question
bytes and 8,192 wire bytes; 205 micro-USD reserved per call. All settled, no overrun.
See [preflight](q1-2026-10-29/openai-preflight.json) and receipts `openai-{1,2,3}.json`.

## Accounting and limits

[Final ledger](q1-2026-10-29/ledger-final.json): JEV 26 + Decisions 51 = **77 micro-USD
($0.000077)**, each receipt rounded up to an integer micro-USD. The unrounded rate calculation
is $0.000074208. These are estimated token-priced charges, not provider invoice confirmation.
No pending reconciliation, held liability, overrun, provider refusal or identity mismatch remained.
The tenant budget was 10,000 micro-USD ($0.01). Local container compute is not provider billing.

Execution implementation: H1/H2 base sources at `213638676`; runner SHA-256 before normalization
`e65e3e1e31ceacd840cecb6e36f265c2441331d76e9d4dea2c1b384d2a892e73`, after normalization
`72043342a8ca5674f3e569e1fa5fb6668c5130a9910dc419082961d46e980d64`.
The descriptor edits append observed IDs and references; the parser now permits observed inventory
alongside unqualified status, with production admission still independently refusing. Runtime limits, evaluator
revisions, compilation and qualification status stay as assessed. OD-4 calibration remains
with the qualification owner: run a separately authorized locked criterion assessment and
retain identity/billing prerequisites before any production activation.

Deterministic validation: llm-mesh typecheck/lint, all 88 mesh test files (1,566 tests), and
16 API host/route tests pass. Existing admission tests retain observed inventory while
denying unqualified production before credentials, budget admission or transport dispatch.
The evidence audit verifies secret absence, caps, identities and zero reserved/pending spend.
`make down ENV=test-decision-q1` stopped the isolated stack after the run. Final remote
CI is attached to the draft PR's exact head; local validation is not a CI claim.
