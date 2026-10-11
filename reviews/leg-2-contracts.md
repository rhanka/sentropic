# Leg 2 — contracts

```yaml
status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: unspecified (codex CLI is model-only; effort not attestable)
target-ref: spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md @ fix/llm-gateway-muse-vibe-wires (working tree)
target-diff-sha256: b92fa68c194b6477e41d6b75855aef062ae41f0011c84ed9050bdbbd4149882c
lens: contracts
launch: tmux CLI (h2a down; claude CLI weekly quota exhausted until Oct 15)
```

## Findings (from tmux session rev-spec15-contract)

- **ACCEPT — Provider contracts:** Both envelopes remain intact. Ordinary no-route retains 503, Anthropic `api_error`, OpenAI `server_error`/`no_route`, `x-should-retry: false`, and no `Retry-After`; enrollment-action keeps its documented exception ([errors.ts:198](/home/antoinefa/src/sentropic/tmp/llm-gateway-muse-vibe-wires/packages/llm-gateway/src/router/errors.ts:198)).
- **ACCEPT — LOT2/B3b deviation:** Operator distinction justifies three fixed subsystem messages; the implementation preserves status/type/code/headers and discards internal exception text. The wording-only deviation is explicitly recorded ([spec:1256](/home/antoinefa/src/sentropic/tmp/llm-gateway-muse-vibe-wires/spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md:1256), [errors.ts:155](/home/antoinefa/src/sentropic/tmp/llm-gateway-muse-vibe-wires/packages/llm-gateway/src/router/errors.ts:155)).
- **REJECT — Diagnostic sanitization:** Singular and joined diagnostic messages reach client bodies verbatim ([errors.ts:227](/home/antoinefa/src/sentropic/tmp/llm-gateway-muse-vibe-wires/packages/llm-gateway/src/router/errors.ts:227), [errors.ts:251](/home/antoinefa/src/sentropic/tmp/llm-gateway-muse-vibe-wires/packages/llm-gateway/src/router/errors.ts:251)). The production producer also interpolates unvalidated expiry strings for `reauth_required` accounts ([service:777](/home/antoinefa/src/sentropic/tmp/llm-gateway-muse-vibe-wires/packages/llm-mesh/src/service/local-account-transport-service.ts:777)). Require validated fields and safe templates.
- **REJECT — §15.6 exhaustion detail:** URLs are fixed public endpoints, but `networkErrorDetail` emits arbitrary cause codes **and raw exception messages**, even when a code exists—contrary to the specified “else the message” ([codex.ts:34](/home/antoinefa/src/sentropic/tmp/llm-gateway-muse-vibe-wires/packages/llm-mesh/src/enrollment/codex.ts:34), [spec:1276](/home/antoinefa/src/sentropic/tmp/llm-gateway-muse-vibe-wires/spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md:1276)). Allowlist codes and suppress unsanitized detail.
- **REJECT — Redaction coverage:** New diagnostic tests use clean messages; exhaustion tests use `fetch failed` ([errors.test.ts:258](/home/antoinefa/src/sentropic/tmp/llm-gateway-muse-vibe-wires/packages/llm-gateway/tests/errors.test.ts:258), [codex.test.ts:164](/home/antoinefa/src/sentropic/tmp/llm-gateway-muse-vibe-wires/packages/llm-mesh/tests/enrollment/codex.test.ts:164)). Add account/token/lease/pricing canaries across both diagnostic wire mappings and both retry-exhaustion sites.
**Verdict: REJECT**
