import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createQualificationCap, QUALIFICATION_CALL_CAP } from './gw-native-qualification-cap';
import { qualificationCases, type QualificationFixture } from './gw-native-qualification-plan';

export const qualificationRoot = fileURLToPath(new URL('../../../../.h2a/native-qualification/', import.meta.url));
export const qualificationFixturePath = fileURLToPath(new URL('../../../../.h2a/inputs/gw-native-qualification.json', import.meta.url));
export const qualificationUatMode = (): boolean => {
  if (process.env.LLM_GATEWAY_UAT_MODE !== 'qualify-three') return false;
  if (process.env.LLM_GATEWAY_UAT_SCOPE !== 'test-llm-native-uat' || process.env.NODE_ENV !== 'development') {
    throw new Error('Qualification UAT guard refused');
  }
  return true;
};
export const readQualificationFixture = (): QualificationFixture => {
  const fixture = JSON.parse(readFileSync(qualificationFixturePath, 'utf8')) as QualificationFixture;
  const names = ['dangerous-tool-use-2026-09-03', 'auto-mode-classifier-2026-07-16'];
  if (!fixture.body?.safeguards || !Array.isArray(fixture.body.messages) || !fixture.betas?.length
    || fixture.betas.some(name => !names.includes(name)) || !Array.isArray(fixture.successfulSafeguardResults)
    || !fixture.successfulSafeguardResults.length || !Array.isArray(fixture.webSearchBody?.messages)
    || !Array.isArray(fixture.webSearchBetas) || !/^[A-Za-z0-9._-]+\.json$/.test(fixture.payloadSource)) {
    throw new Error('Qualification construction evidence missing');
  }
  // The operator supplies local construction evidence; the harness never invents classifier_context.
  const source = JSON.parse(readFileSync(new URL(`../../../../.h2a/inputs/${fixture.payloadSource}`, import.meta.url), 'utf8'));
  if (!isDeepStrictEqual(source.body, fixture.body) || !isDeepStrictEqual(source.successfulSafeguardResults, fixture.successfulSafeguardResults)
    || !isDeepStrictEqual(source.webSearchBody, fixture.webSearchBody)) throw new Error('Qualification construction evidence mismatch');
  return fixture;
};

/** Exclusive, durable reservations survive listener restarts and race between transport instances. */
export const reserveQualificationSend = (directory: string): number => {
  if (!existsSync(`${directory}/armed.json`) || existsSync(`${directory}/closed.json`)) throw new Error('Qualification run is not armed');
  let ordinal = 1;
  while (existsSync(`${directory}/${ordinal}.sent.json`)) ordinal++;
  if (ordinal > QUALIFICATION_CALL_CAP) throw new Error('Qualification call cap reached');
  writeFileSync(`${directory}/${ordinal}.sent.json`, JSON.stringify({ calls: ordinal }), { flag: 'wx', mode: 0o600 });
  return ordinal;
};
export const closeQualificationRun = (directory = qualificationRoot): void => {
  writeFileSync(`${directory}/closed.json`, JSON.stringify({ closed: true }), { mode: 0o600 });
};
let capped: ReturnType<typeof createQualificationCap> | undefined;
export const qualificationFetch: typeof fetch = async (input, init) => {
  if (!qualificationUatMode()) return globalThis.fetch(input, init);
  const origin = new URL(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').origin;
  if (origin !== 'https://api.anthropic.com') throw new Error('Qualification provider origin refused');
  let ordinal = 0;
  capped ??= createQualificationCap(origin, async (url, options) => {
    const request = new Request(url, options);
    const body = await request.json() as Record<string, unknown>;
    const planned = qualificationCases(readQualificationFixture())[ordinal - 1];
    const headers = request.headers;
    const credential = process.env.ANTHROPIC_API_KEY;
    const beta = headers.get('anthropic-beta')?.split(',').map(name => name.trim()) ?? [];
    const path = new URL(request.url).pathname;
    const count = path === '/v1/messages/count_tokens';
    if (!planned || !['/v1/messages', '/v1/messages/count_tokens'].includes(path)
      || request.method !== 'POST' || count !== planned.count || body.model !== planned.model
      || (!count && (body.max_tokens !== 16 || body.stream !== planned.stream))
      || !credential || headers.get('x-api-key') !== credential || headers.has('authorization')
      || !isDeepStrictEqual(beta, planned.betas)
      || (planned.native && !isDeepStrictEqual(body, planned.body))) throw new Error('Qualification outbound equality refused');
    return globalThis.fetch(request.url, { ...options, body: JSON.stringify(body), redirect: 'error' });
  }, () => { ordinal = reserveQualificationSend(qualificationRoot); });
  try { return await capped.fetch(input, init); }
  catch { closeQualificationRun(); throw new Error('Qualification transport refused'); }
};
export const qualificationSdkOptions = () => qualificationUatMode()
  ? { fetch: qualificationFetch, maxRetries: 0, baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com' } : {};
