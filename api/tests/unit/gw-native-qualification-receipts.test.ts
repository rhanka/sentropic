import { describe, expect, it, vi } from 'vitest';
import { createQualificationCap, qualificationSelected, QUALIFICATION_SCOPE } from '../../src/services/llm-runtime/gw-native-qualification-cap';
import { qualificationCases } from '../../src/services/llm-runtime/gw-native-qualification-plan';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { reserveQualificationSend, closeQualificationRun, qualificationSdkOptions } from '../../src/services/llm-runtime/gw-native-qualification-transport';

describe('native qualification safety', () => {
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
