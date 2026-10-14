import { describe, expect, it, vi } from 'vitest';
import { createQualificationCap, qualificationSelected, QUALIFICATION_SCOPE } from '../../src/services/llm-runtime/gw-native-qualification-cap';
import { qualificationCases } from '../../src/services/llm-runtime/gw-native-qualification-plan';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { reserveQualificationSend, closeQualificationRun, qualificationSdkOptions } from '../../src/services/llm-runtime/gw-native-qualification-transport';
import { qualificationEnvironment, checkQualificationReadiness, type QualificationDb } from '../ai/gw-native-qualification-readiness';
import { inputUsageReceipt, cleanNativeMeasured, serverToolQualifies } from '../ai/gw-native-qualification-receipts';
import { observeQualificationResponse } from '../../src/services/llm-runtime/gw-native-qualification-observer';

describe('native qualification safety', () => {
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
