import { describe, expect, it, vi } from 'vitest';
import { createQualificationCap, qualificationSelected, QUALIFICATION_SCOPE } from '../../src/services/llm-runtime/gw-native-qualification-cap';
import { qualificationCases } from '../../src/services/llm-runtime/gw-native-qualification-plan';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { reserveQualificationSend, closeQualificationRun, qualificationSdkOptions, readQualificationFixture, qualificationFetch } from '../../src/services/llm-runtime/gw-native-qualification-transport';
import { qualificationEnvironment, checkQualificationReadiness, probeQualificationListener, type QualificationDb } from '../ai/gw-native-qualification-readiness';
import { inputUsageReceipt, cleanNativeMeasured, serverToolQualifies } from '../ai/gw-native-qualification-receipts';
import { observeQualificationResponse, safeQualificationModel } from '../../src/services/llm-runtime/gw-native-qualification-observer';
import { readQualificationReply } from '../ai/gw-native-qualification-http';
import { qualificationLedgerEvidence } from '../ai/gw-native-qualification-ledger';
import { createFirstFailureGuard } from '../ai/gw-native-qualification-run';

describe('native qualification safety', () => {
  it('should preserve the configured fake UAT phase without permitting an origin switch or redirects', async () => {
    const send = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ input_tokens: 1 }));
    try {
      vi.stubEnv('LLM_GATEWAY_UAT_MODE', 'qualify-three'); vi.stubEnv('LLM_GATEWAY_UAT_SCOPE', 'test-llm-native-uat');
      vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('ANTHROPIC_BASE_URL', 'http://fake-provider:8787'); vi.stubGlobal('fetch', send);
      await qualificationFetch('http://fake-provider:8787/v1/messages', { method: 'POST' });
      expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0]?.[1]?.redirect).toBe('error');
      await expect(qualificationFetch('https://api.anthropic.com/v1/messages')).rejects.toThrow('origin refused');
      expect(send).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it('should retain safe served aliases for mismatch evidence and mask malformed model values', () => {
    expect(safeQualificationModel('claude-sonnet-5-served-alias')).toBe('claude-sonnet-5-served-alias');
    expect(safeQualificationModel('private body\n')).toBe('other'); expect(safeQualificationModel({ secret: 'private' })).toBe('other');
  });
  it('should accept the actual enabled switch and reject true before any live readiness work', () => {
    try {
      for (const [name, value] of Object.entries({ LLM_GATEWAY_UAT_MODE: 'qualify-three', LLM_GATEWAY_UAT_SCOPE: 'test-llm-native-uat',
        NODE_ENV: 'development', LLM_GATEWAY_NATIVE_MESSAGES: 'enabled', DISABLE_AUTH: '0', CHAT_TRACE_ENABLED: 'false',
        ANTHROPIC_API_KEY: 'fake-server', LLM_GATEWAY_UAT_SESSION_TOKEN: 'fake-caller',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com', DATABASE_URL: 'postgres://app:app@postgres:5432/app' })) vi.stubEnv(name, value);
      expect(typeof qualificationEnvironment().token === 'string').toBe(true);
      vi.stubEnv('LLM_GATEWAY_NATIVE_MESSAGES', 'true'); expect(() => qualificationEnvironment()).toThrow('prerequisite');
    } finally { vi.unstubAllEnvs(); }
  });
  it('should require matching local construction evidence and reject unsupported classification before transport', () => {
    const fixture = { body: { messages: [], safeguards: [{ type: 'dangerous_tool_use', classifier_context: 'fake-only-context' }] },
      betas: ['dangerous-tool-use-2026-09-03'], successfulSafeguardResults: [{ type: 'dangerous_tool_use', status: { type: 'fixture_success' } }],
      webSearchBody: { messages: [], tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }] },
      webSearchBetas: ['fixture-beta'], payloadSource: 'captured-fixture.json' };
    const source = { ...fixture, recognizedSuccessfulClassification: true };
    const read = (candidate = fixture, captured: object = source) => (path: string | URL) =>
      JSON.stringify(String(path).endsWith('captured-fixture.json') ? captured : candidate);
    expect(readQualificationFixture(read())).toEqual(fixture);
    expect(() => readQualificationFixture(read(fixture, { ...source, body: {} }))).toThrow('evidence mismatch');
    const unsupported = { ...fixture, successfulSafeguardResults: [{ type: 'dangerous_tool_use', status: { type: 'unsupported' } }] };
    expect(() => readQualificationFixture(read(unsupported, { ...unsupported, recognizedSuccessfulClassification: true }))).toThrow('safeguards construction');
  });
  it('should attempt all three post-run HTTP probes even when health fails', async () => {
    const probe = vi.fn(async () => Response.json({}, { status: 503 }));
    try {
      vi.stubGlobal('fetch', probe);
      await expect(probeQualificationListener('private-token')).rejects.toThrow('prerequisite');
      expect(probe).toHaveBeenCalledTimes(3);
    } finally { vi.unstubAllGlobals(); }
  });
  it('should abort after the first failed case without retrying or sending a later case', async () => {
    const close = vi.fn(); const send = vi.fn(async () => { throw new Error('private error'); });
    const guard = createFirstFailureGuard(close);
    await expect(guard.run(send)).rejects.toThrow('first failed case');
    await expect(guard.run(send)).rejects.toThrow('prerequisite');
    expect(send).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1); expect(guard.failed()).toBe(true);
  });
  it('should join one measured financial row and one physical native observation without persisting arbitrary metadata', () => {
    const planned = { model: 'claude-sonnet-5', name: 'sse', native: true, count: false, stream: true };
    const financial = { idempotency_key: 'request', hold_id: 'hold', cost_micro_usd: '7', input_tokens: 7, output_tokens: 4,
      attempts: [{ inputTokens: 7, outputTokens: 4, estimated: false }] };
    const observation = { idempotency_key: 'call', response_id: 'request', hold_id: null, cost_micro_usd: null,
      credential_source: 'environment', input_tokens: 7, output_tokens: 4, total_tokens: 11, usage_raw: { input_tokens: 2,
        cache_read_input_tokens: 3, cache_creation_input_tokens: 2, output_tokens: 4, input_usage_validated: true,
        input_usage_source: 'message_delta', native_pricing_policy: 'anthropic-cache-2026-10-02', estimated: false,
        final_output_observed: true, termination: 'completed', fallback_present: false, iterations_present: false,
        native_selected_model_id: planned.model, native_served_model_id: planned.model, secret: 'private data' } };
    const receipt = qualificationLedgerEvidence(planned, 'request', [financial, observation], [{ status: 'settled' }], 1);
    expect(receipt).toMatchObject({ financialRows: 1, observationRows: 1, inputTokens: 7, chargedOutputTokens: 4 });
    expect(JSON.stringify(receipt)).not.toContain('private'); expect(JSON.stringify(receipt)).not.toContain('"hold"');
    const saved = vi.fn();
    expect(() => qualificationLedgerEvidence({ ...planned, name: 'websearch' }, 'request', [financial,
      { ...observation, usage_raw: { ...observation.usage_raw, input_usage_validated: false, uncertainty_reason: 'invalid_input' } }],
    [{ status: 'settled' }], 1, saved)).toThrow('prerequisite');
    expect(saved.mock.calls[0]?.[0]).toMatchObject({ input_usage_validated: false, uncertainty_reason: 'invalid_input' });
    expect(() => qualificationLedgerEvidence(planned, 'request', [financial, observation, financial], [{ status: 'settled' }], 1)).toThrow('prerequisite');
    expect(() => qualificationLedgerEvidence({ ...planned, count: true }, 'request', [financial], [], 0)).toThrow('prerequisite');
    expect(qualificationLedgerEvidence({ ...planned, count: true }, 'request', [], [], 0)).toMatchObject({ financialRows: 0, observationRows: 0, outboxEvents: 0 });
  });
  it('should extract only numeric WebSearch growth and reject EOF without message_stop', async () => {
    const frame = (type: string, rest = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`;
    const body = frame('message_start', { message: { model: 'claude-sonnet-5', usage: { input_tokens: 2679 } } })
      + frame('content_block_start', { content_block: { type: 'server_tool_use', name: 'web_search', input: 'private query' } })
      + frame('content_block_start', { content_block: { type: 'web_search_tool_result', content: [{ type: 'web_search_result', title: 'private results' }] } })
      + frame('message_delta', { usage: { input_tokens: 10682, output_tokens: 16, server_tool_use: { web_search_requests: 1 } } });
    await expect(readQualificationReply(new Response(body), true, [])).rejects.toThrow('prerequisite');
    const receipt = await readQualificationReply(new Response(body + frame('message_stop')), true, []);
    expect(receipt).toMatchObject({ serverTool: true, resultObserved: true, webSearchRequests: 1, input: { numeric_input_growth: true } });
    expect(JSON.stringify(receipt)).not.toContain('private');
  });
  it('should observe JSON fidelity without persisting response contents or credentials', async () => {
    const evidence = vi.fn();
    const result = [{ type: 'fixture', status: 'fixture' }];
    const body = { model: 'claude-sonnet-5', safeguard_results: result, content: [{ text: 'private response' }] };
    const response = observeQualificationResponse(Response.json(body), false, result, evidence);
    expect(await response.json()).toEqual(body);
    expect(evidence.mock.calls[0]?.[0]).toMatchObject({ safeguardResultsPresent: true, safeguardResultsEqual: true });
    expect(JSON.stringify(evidence.mock.calls)).not.toContain('private response');
    expect(JSON.stringify(evidence.mock.calls)).not.toContain('fixture');
  });
  it('should preserve SSE bytes and deliver the first frame before stream completion', async () => {
    const evidence = vi.fn(); const encoder = new TextEncoder();
    const start = 'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-5"}}\n\n';
    const end = 'event: message_delta\ndata: {"type":"message_delta","delta":{"safeguard_results":[]}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; controller.enqueue(encoder.encode(start)); } });
    const response = observeQualificationResponse(new Response(body), true, [], evidence);
    const reader = response.body!.getReader(); const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe(start); expect(evidence).not.toHaveBeenCalled();
    upstream.enqueue(encoder.encode(end)); upstream.close();
    const last = await reader.read(); expect(new TextDecoder().decode(last.value)).toBe(end); await reader.read();
    expect(evidence.mock.calls[0]?.[0]).toMatchObject({ messageStop: true, safeguardResultsPresent: true, safeguardResultsEqual: true });
  });
  const websearch = () => ({ selectedModel: 'claude-sonnet-5', servedModel: 'claude-sonnet-5', native: true,
    requestId: 'server-request', toolName: 'web_search', serverTool: true, resultObserved: true, webSearchRequests: 1,
    input: inputUsageReceipt({ input_tokens: 2679, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      [{ input_tokens: 10682, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }]) });
  it('server_tool_receipt_rejects_canonical_or_non_QB_turn', () => {
    expect(serverToolQualifies(websearch())).toBe(true);
    expect(serverToolQualifies({ ...websearch(), native: false })).toBe(false);
    expect(serverToolQualifies({ ...websearch(), selectedModel: 'other', servedModel: 'other' })).toBe(false);
    expect(serverToolQualifies({ ...websearch(), servedModel: 'claude-opus-5' })).toBe(false);
  });
  it('server_tool_receipt_rejects_client_only_search', () => {
    expect(serverToolQualifies({ ...websearch(), serverTool: false })).toBe(false);
    expect(serverToolQualifies({ ...websearch(), resultObserved: false })).toBe(false);
    expect(serverToolQualifies({ ...websearch(), webSearchRequests: 0 })).toBe(false);
  });
  it('server_tool_growth_requires_repeated_numeric_categories', () => {
    for (const input of [inputUsageReceipt({ input_tokens: 2679 }, [{}]),
      inputUsageReceipt({ input_tokens: 2679 }, [{ input_tokens: null }]),
      inputUsageReceipt({ input_tokens: 2679 }, [{ input_tokens: 2679 }]),
      inputUsageReceipt({ input_tokens: 2679 }, [{ input_tokens: 10682 }, { input_tokens: 10681 }])]) {
      expect(serverToolQualifies({ ...websearch(), input })).toBe(false);
    }
  });
  it('growth_and_decrease_have_distinct_receipts', () => {
    const start = { input_tokens: 2, cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 } };
    expect(inputUsageReceipt(start, [{ cache_creation_input_tokens: 200 }])).toMatchObject({
      message_delta_repeats_input: true, message_delta_input_equals_start: true, message_delta_input_decreased: false });
    expect(inputUsageReceipt(start, [{ input_tokens: 3 }])).toMatchObject({ numeric_input_growth: true, message_delta_input_decreased: false });
    expect(inputUsageReceipt(start, [{ input_tokens: 0 }])).toMatchObject({ message_delta_input_decreased: true });
  });
  it('decrease_compares_with_latest_accepted_counts', () => {
    expect(inputUsageReceipt({ input_tokens: 2 }, [{ input_tokens: 9 }, { input_tokens: 8 }, { input_tokens: 10 }]))
      .toMatchObject({ message_delta_input_decreased: true, message_delta_input_equals_start: false });
    expect(inputUsageReceipt({ input_tokens: 2 }, [{ input_tokens: 9.5 }, { input_tokens: 3 }]).message_delta_input_decreased).toBe(false);
  });
  it('null_input_is_not_a_decrease', () => {
    expect(inputUsageReceipt({ input_tokens: 2 }, [{ input_tokens: null }, {}])).toMatchObject({
      message_delta_repeats_input: false, message_delta_input_equals_start: false, message_delta_input_decreased: false });
    expect(inputUsageReceipt({ input_tokens: 2 }, [{ input_tokens: 'private' }]).message_delta_input_equals_start).toBe(false);
  });
  it('clean_sse_rejects_revoked_proof_or_output_floor and inferred_split_can_remain_measured', () => {
    const observation = { input_tokens: 2, output_tokens: 4, usage_raw: { input_usage_validated: true,
      input_usage_source: 'message_delta', estimated: false, final_output_observed: true, termination: 'completed',
      fallback_present: false, iterations_present: false, native_selected_model_id: 'm', native_served_model_id: 'm',
      output_tokens: 4, cache_write_split_reason: 'cache_write_split_inferred' } };
    const financial = { input_tokens: 2, output_tokens: 4, attempts: [{ inputTokens: 2, outputTokens: 4, estimated: false }] };
    expect(cleanNativeMeasured('m', observation, financial)).toBe(true);
    expect(cleanNativeMeasured('m', { ...observation, usage_raw: { ...observation.usage_raw, input_usage_validated: false } }, financial)).toBe(false);
    expect(cleanNativeMeasured('m', observation, { ...financial, output_tokens: 16 })).toBe(false);
    expect(cleanNativeMeasured('m', { ...observation, usage_raw: { ...observation.usage_raw, uncertainty_reason: 'invalid_input' } }, financial)).toBe(false);
  });
  it('should refuse two sessions of one principal before HTTP or provider traffic', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'a', user_id: 'one' }, { id: 'b', user_id: 'one' }] }));
    const now = Date.now();
    await expect(checkQualificationReadiness({ query } as unknown as QualificationDb, 'private', {
      sessionIds: ['a', 'b'], generationId: 'g', featureSha: 'a'.repeat(40), uatSha: 'b'.repeat(40), edgeSha: 'c'.repeat(40),
      listenerStartedAtMs: now - 1000, reaperHeartbeatAtMs: now, reaperSuccessfulPasses: 1, reaperFailedPasses: 0,
      secondModelsProbeAtMs: now, sourceEquivalent: true, imageVerified: true, edgeLimitsVerified: true, authorizedHeadroomMicroUsd: 1,
    })).rejects.toThrow('prerequisite');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('should refuse live readiness in normal test environments before provider or DB work', () => {
    expect(() => qualificationEnvironment()).toThrow('prerequisite');
  });
  it('should enable the listener transport only under the isolated UAT guards with zero SDK retries', () => {
    try {
      vi.stubEnv('LLM_GATEWAY_UAT_MODE', ''); expect(qualificationSdkOptions()).toEqual({});
      vi.stubEnv('LLM_GATEWAY_UAT_MODE', 'qualify-three'); vi.stubEnv('LLM_GATEWAY_UAT_SCOPE', 'wrong');
      expect(() => qualificationSdkOptions()).toThrow('guard refused');
      vi.stubEnv('LLM_GATEWAY_UAT_SCOPE', 'test-llm-native-uat'); vi.stubEnv('NODE_ENV', 'production');
      expect(() => qualificationSdkOptions()).toThrow('guard refused');
      vi.stubEnv('NODE_ENV', 'development'); expect(qualificationSdkOptions().maxRetries).toBe(0);
      expect(typeof qualificationSdkOptions().fetch).toBe('function');
    } finally { vi.unstubAllEnvs(); }
  });
  it('should keep thirteen durable reservations across transport reconstruction', () => {
    const directory = mkdtempSync(`${tmpdir()}/qualification-cap-`);
    try {
      expect(() => reserveQualificationSend(directory)).toThrow('not armed');
      writeFileSync(`${directory}/armed.json`, '{}');
      for (let n = 1; n <= 13; n++) expect(reserveQualificationSend(directory)).toBe(n);
      expect(() => reserveQualificationSend(directory)).toThrow('call cap');
      closeQualificationRun(directory);
      expect(() => reserveQualificationSend(directory)).toThrow('not armed');
    } finally { rmSync(directory, { recursive: true }); }
  });
  it('should plan exactly nine generation, three count and one WebSearch turn', () => {
    const cases = qualificationCases({ body: { messages: [], safeguards: [] }, betas: [],
      successfulSafeguardResults: [], webSearchBody: {}, webSearchBetas: [], payloadSource: 'fixture' });
    expect(cases).toHaveLength(13); expect(cases.filter(c => c.count)).toHaveLength(3);
    expect(cases.filter(c => !c.count && c.name !== 'websearch')).toHaveLength(9);
    expect(cases.filter(c => c.name === 'websearch')).toHaveLength(1);
    for (const c of cases) {
      expect(c.count ? !('max_tokens' in c.body) && !('stream' in c.body) : c.body.max_tokens === 16).toBe(true);
      if (!c.native) expect('safeguards' in c.body || c.betas.length > 0).toBe(false);
    }
  });
  it('should refuse the fourteenth request before anything is sent', async () => {
    const sent = vi.fn(async () => new Response('{}'));
    const cap = createQualificationCap('https://api.anthropic.com', sent);
    for (let n = 0; n < 13; n++) await cap.fetch('https://api.anthropic.com/v1/messages');
    await expect(cap.fetch('https://api.anthropic.com/v1/messages')).rejects.toThrow('refused');
    expect(sent).toHaveBeenCalledTimes(13); expect(cap.calls()).toBe(13);
  });
  it('should refuse other origins and close after a failed send without retries', async () => {
    const sent = vi.fn(async () => { throw new Error('private upstream detail'); });
    const cap = createQualificationCap('https://api.anthropic.com', sent);
    await expect(cap.fetch('https://other.invalid')).rejects.toThrow('refused');
    expect(sent).not.toHaveBeenCalled();
    await expect(cap.fetch('https://api.anthropic.com')).rejects.toThrow('transport failed');
    await expect(cap.fetch('https://api.anthropic.com')).rejects.toThrow('refused');
    expect(sent).toHaveBeenCalledTimes(1);
  });
  it('should stay inert for normal, aggregate and space-separated scopes', () => {
    for (const scope of [undefined, '', 'tests/ai', `${QUALIFICATION_SCOPE} tests/unit/other.test.ts`]) {
      expect(qualificationSelected(scope)).toBe(false);
    }
    expect(qualificationSelected(` ${QUALIFICATION_SCOPE} `)).toBe(true);
  });
});
