# Decision qualification and calibration gates (V4-L5)

The host publishes `discoverDecisionEvaluator(descriptor, evidence, request)` facts independently:
contract conformance, served identity, billing bound, protocol-specific price, transport access and
criterion calibration. Without a request it lists qualified scopes and omits `productionReady`.
With a request it evaluates only that exact criterion and operating policy. No rubric qualifies
other instructions, another registered revision, language, domain, input bound or threshold.

`decisionExecutionDigest` covers the executable descriptor, including accepted IDs, compilation,
readout, scales, bounds and protocol/price identity. Evidence references, qualification statuses,
the publication bundle digest and the execution profile do not change assessed execution.
Changing execution invalidates matching evidence; changing evidence alone can qualify the same
candidate. The host and adapter still compare their complete published descriptors.

The default profile is `production`. `createDecisionService` requires host-owned `readiness`
evidence and a passing recorded assessment before resolving credentials or reserving budget.
An explicit descriptor `executionProfile: 'qualification'` permits provisional expected served
IDs with unqualified identity. It always advertises `experimental: true`, never production
readiness. Empty expected IDs or an unqualified financial bound permit fixture work only.
The profile is host composition, never a request-selected bypass. Qualification success uses
`kind: 'experimental-verdict'` and every selected qualification result/receipt has `experimental: true`.
Its served evaluator carries `provisional: true`; it never supplies production identity evidence.
The closed production v1 validator rejects these envelopes and receipts, including experimental errors.

## Recorded assessment contract

`assessDecisionCalibration(record, descriptor, scope)` is deterministic, bounded and offline.
It rebuilds status from the record; a supplied `passed` field is rejected. Its input includes:

- Exact execution/evaluator/criterion/policy binding, dataset and split revisions, dated source
  and rights references, access evidence and an approved run-packet reference.
- Unique sample/input digests, source-family split assignment, gold labels, rationale, independent
  annotator identifiers, adjudication and slice tags. Unresolved labels and split leakage block.
- A frozen policy selected using tuning data, distinct planned populations, immutable call IDs,
  receipt references, native evidence, outcome categories, 0/1 outer attempts, internal work and
  billable units, per-receipt rounded costs and pending-reconciliation markers.

P30 is verified from `controls`: an explicit criterion revision, criterion/policy/split digests,
using the registered revision or the content digest as the arbitrary rubric's revision,
the exact tuning call IDs, ordered candidate rules and a policy freeze timestamp. The assessor
replays minimum-error selection on tuning calls only (first candidate wins ties), compares the
winner with the operating policy and checks every call's policy digest and chronology. Tuning
must precede the freeze; held-out, challenge and repeat calls must follow it. Missing or corrupt
controls block calibration and report `evidence.p30: 'unverified'`; validated controls report
`verified`. The two former self-declared freeze/selection fields are rejected.

Records are trusted evidence supplied by the host, not consumer assertions. The recorder must
verify source permissions, human label authority, locked split/threshold timing and receipt
provenance before importing them. Replay and digest checks cannot authenticate external timestamps,
prove that an omitted candidate was never tried, or establish human authority independently.
Transport fixtures use `evidenceKind: 'fixture'` and cannot pass semantic calibration. Unit tests
also fabricate recorded-shaped inputs to test acceptance and independent corruption controls;
those objects are not provider qualification reports and do not activate shipped descriptors.

The base held-out population alone supplies quality/coverage denominators. A refusal/failure
on a gold-valid item counts as false-fail; a missing verdict on gold-invalid data affects coverage
without fabricating a correct negative. All populations still contribute to call/work/cost totals.
Paired challenges and repeats never dilute held-out errors. Exact one-sided 95% Clopper-Pearson
bounds retain nonzero risk after zero observed errors. Graded and choice gates remain native;
threshold choice is not probability correction. Reports distinguish blocked, incomplete, failed
and passed states. Cap exhaustion, pending accounting or missing planned rows prevent completion.

## L6 handoff

Production qualification is outstanding for JEV, OpenAI Decisions and the owner-selected HF
candidate. L4 supplies the local artifact/inventory/runtime tuple separately. L6 needs ratified
exact rubrics and operating policies, independent human gold labels with rights and split-family
integrity, approved provider/runtime access, defensible financial bounds, and an explicit run
packet naming attempt/compute caps and stop conditions. No inference budget is authorized here.

Produce separate dated reports per candidate, including immutable model/artifact and execution
identity, protocol conformance, source/licence and access evidence, price/bound evidence, every
receipt, call/work/billable totals, latency p50/p95 on the deployment, dataset/split/policy hashes,
all population and slice metrics, confidence intervals, accounting reconciliation and bounded
remaining actions. Report unmeasured latency and deployment prevalence as `unverified`.
The L5 report includes fixed-seed 512-resample percentile intervals for choice macro-F1 and
graded MAE/Spearman, exact decision-risk upper bounds and labelled confusion matrices.
L6 supplies measured records, reliability plots and domain-sensitive acceptance interpretation.
