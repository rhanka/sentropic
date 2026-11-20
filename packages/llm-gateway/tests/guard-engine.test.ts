import { describe, expect, it } from 'vitest';
import { GuardEngine } from '../src/guards/guard-engine.js';
import type { ExternalGuardPort, MaskedCapturePayload } from '../src/ports/guards.js';
import { redactForLog } from '../src/redaction.js';

const synthetic = {
  email: 'alice.tester@example.org',
  phone: '+1-514-555-0199',
  card: '4532 0151 1283 0366', // Luhn-valid synthetic PAN
  invalidCard: '4532 0151 1283 0367', // Luhn-invalid
  ssn: '123-45-6789',
  sin: '046 454 286', // Luhn-valid synthetic Canadian SIN
  gwToken: ['gw-v2-', 'abcdefghijklmnop1234'].join(''),
  anthropicOAuth: ['sk-ant-', 'oat01-', 'SyntheticTokenValue123456'].join(''),
  anthropicApi: ['sk-ant-', 'SyntheticApiKeyValue123456'].join(''),
  openaiKey: ['sk-', 'SyntheticOpenAiKeyValue123456'].join(''),
  awsKey: ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  googleOAuth: ['ya29.', 'SyntheticGoogleOAuthToken12345'].join(''),
  ghToken: ['ghp_', 'SyntheticGitHubPatValue123456'].join(''),
  dpopHeader: ['DPoP:', ' eyJhbGciOiJFZERTQSJ9.eyJqdGkiOiIxIn0.sigvalue1234'].join(''),
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ1c2VyMSJ9', 'SyntheticSignature1234'].join('.'),
  pem: ['-----BEGIN ', 'PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEF\n-----END ', 'PRIVATE KEY-----'].join(''),
  envLine: 'SERVICE_API_KEY=synth_secret_value_99',
};

describe('L1.3a GuardEngine (decoded JSON PII + technical secrets) & redactForLog', () => {
  it('keeps in-flight payloads intact under audit_mask_copy while masking all PII and technical secrets in MaskedCapturePayload', () => {
    const engine = new GuardEngine();
    const rawJson = JSON.stringify({
      system: [{ type: 'text', text: `Contact ${synthetic.email} or ${synthetic.phone}; short id sk-foo stays intact` }],
      messages: [
        { role: 'user', content: `Card ${synthetic.card} (bad ${synthetic.invalidCard}) SSN ${synthetic.ssn} SIN ${synthetic.sin}` },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'bash', input: { cmd: `${synthetic.envLine} ${synthetic.gwToken} ${synthetic.anthropicOAuth} ${synthetic.anthropicApi}` } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: `${synthetic.openaiKey} ${synthetic.awsKey} ${synthetic.googleOAuth} ${synthetic.ghToken} ${synthetic.dpopHeader} ${synthetic.jwt}\n${synthetic.pem}` }] },
      ],
    });
    const decoded = JSON.parse(rawJson) as Record<string, unknown>;
    const result = engine.inspectRequest(decoded);

    expect(result.verdict).toBe('masked');
    // Request remains 100% intact in flight (D6d = A, AC6)
    expect(JSON.stringify(result.inFlightPayload)).toBe(rawJson);
    // MaskedCapturePayload scrubs every PII and technical secret without leaking raw values
    const maskedText = JSON.stringify(result.maskedCapture.payload);
    for (const secret of [
      synthetic.email, synthetic.phone, synthetic.card, synthetic.ssn, synthetic.sin,
      synthetic.gwToken, synthetic.anthropicOAuth, synthetic.anthropicApi, synthetic.openaiKey,
      synthetic.awsKey, synthetic.googleOAuth, synthetic.ghToken, synthetic.jwt, synthetic.pem,
      'synth_secret_value_99',
    ]) {
      expect(maskedText).not.toContain(secret);
    }
    // No false positive on short identifier `sk-foo` or Luhn-invalid card
    expect(maskedText).toContain('sk-foo');
    expect(maskedText).toContain(synthetic.invalidCard);
    expect(maskedText).toContain('[REDACTED:EMAIL]');
    expect(maskedText).toContain('[REDACTED:TECH_SECRET]');
    // Findings carry detector IDs and counts only, zero raw values
    const findingsJson = JSON.stringify(result.findings);
    expect(findingsJson).not.toContain(synthetic.email);
    expect(findingsJson).not.toContain(synthetic.awsKey);
    expect(result.findings.some((f) => f.detectorId === 'pii.email')).toBe(true);
    expect(result.findings.some((f) => f.detectorId === 'secret.pem_private_key')).toBe(true);
    expect(result.maskedCapture.__maskedCapturePayload).toBe(true);
  });

  it('enforces MaskedCapturePayload-only contract on ExternalGuardPort and supports block posture', async () => {
    const engine = new GuardEngine({ detectorActions: { 'secret.aws_access_key': 'block' } });
    const blocked = engine.inspectRequest({ messages: [{ role: 'user', content: synthetic.awsKey }] });
    expect(blocked.verdict).toBe('blocked');
    const seen: MaskedCapturePayload[] = [];
    const ext: ExternalGuardPort = {
      async evaluate(req) {
        seen.push(req.payload);
        return { action: 'pass', findings: [] };
      },
    };
    const res = await ext.evaluate({
      version: '1', stageId: 'relay:1', requestId: 'req-1', phase: 'request',
      payload: blocked.maskedCapture, deadlineMs: 500,
    });
    expect(res.action).toBe('pass');
    expect(seen[0]?.__maskedCapturePayload).toBe(true);
  });

  it('extends redactForLog SECRET_KEYS to scrub DPoP, bootstrap proof, hop envelope, cookies and affinity salt', () => {
    const scrubbed = redactForLog({
      dpop: 'dpop-1', DPoP: 'dpop-2',
      'x-sentropic-bootstrap-proof': 'proof-1', 'X-Sentropic-Bootstrap-Proof': 'proof-2',
      'x-sentropic-hop-envelope': 'env-1', cookie: 'sid=1', 'set-cookie': 'sid=2',
      workstationAffinitySalt: 'salt-secret', model: 'claude-sonnet-5',
    }) as Record<string, unknown>;
    for (const key of [
      'dpop', 'DPoP', 'x-sentropic-bootstrap-proof', 'X-Sentropic-Bootstrap-Proof',
      'x-sentropic-hop-envelope', 'cookie', 'set-cookie', 'workstationAffinitySalt',
    ]) {
      expect(scrubbed[key]).toBe('[redacted]');
    }
    expect(scrubbed.model).toBe('claude-sonnet-5');
  });

  it('catches quoted .env values, multi-cookie headers, ghs_/gho_/ghu_/ghr_, x-api-key, credentialed URIs, and array/case-insensitive redactForLog', () => {
    const engine = new GuardEngine();
    const ghs = ['ghs_', 'SyntheticActionsToken12345'].join('');
    const gho = ['gho_', 'SyntheticOAuthToken123456'].join('');
    const ghu = ['ghu_', 'SyntheticUserToken1234567'].join('');
    const ghr = ['ghr_', 'SyntheticRefreshTok123456'].join('');
    const xoxa = ['xoxa-', '1234567890-abcdef123456'].join('');
    const uri = ['postgres://svc:', 'synth_db_pass_99', '@db.local:5432/app'].join('');
    const sample = [
      'DATABASE_PASSWORD="synth_dq_pass_1"',
      "APP_SECRET='synth_sq_secret_2'",
      'API_TOKEN=`synth_bt_tok_3`',
      'DB_PASSWD="synth_pw_4"',
      'Cookie: lang=fr; sid=synth_cookie_val_2; csrf=synth_cookie_val_3',
      'Set-Cookie: sid=synth_set_cookie_4; HttpOnly',
      'Authorization: Basic c3ludGg6cGFzc3dvcmQ=',
      'Proxy-Authorization: Bearer synth_proxy_tok_5',
      'X-Api-Key: synth_header_apikey_6',
      ghs, gho, ghu, ghr, xoxa, uri,
    ].join('\n');
    const res = engine.inspectRequest({ messages: [{ role: 'user', content: sample }] });
    const masked = JSON.stringify(res.maskedCapture.payload);
    for (const leaked of [
      'synth_dq_pass_1', 'synth_sq_secret_2', 'synth_bt_tok_3', 'synth_pw_4',
      'synth_cookie_val_2', 'synth_cookie_val_3', 'synth_set_cookie_4',
      'c3ludGg6cGFzc3dvcmQ=', 'synth_proxy_tok_5', 'synth_header_apikey_6',
      ghs, gho, ghu, ghr, xoxa, 'synth_db_pass_99',
    ]) {
      expect(masked).not.toContain(leaked);
    }

    const scrubbed = redactForLog({
      'set-cookie': ['sid=synth_arr_1', 'sid=synth_arr_2'],
      Cookie: 'sid=synth_title_1',
      'Set-Cookie': ['sid=synth_title_2'],
      'X-Sentropic-Hop-Envelope': 'env-title-1',
      'X-Api-Key': 'key-title-1',
      'Proxy-Authorization': 'Bearer proxy-1',
      bootstrapSecret: 'boot-sec-1',
      controlToken: 'ctrl-tok-1',
      keyMaterial: 'key-mat-1',
      safeField: 'keep-me',
    }) as Record<string, unknown>;
    expect(scrubbed['set-cookie']).toEqual(['[redacted]', '[redacted]']);
    expect(scrubbed['Set-Cookie']).toEqual(['[redacted]']);
    for (const k of ['Cookie', 'X-Sentropic-Hop-Envelope', 'X-Api-Key', 'Proxy-Authorization', 'bootstrapSecret', 'controlToken', 'keyMaterial']) {
      expect(scrubbed[k]).toBe('[redacted]');
    }
    expect(scrubbed.safeField).toBe('keep-me');
  });

  it('never mutates system, instructions, or system/developer roles in flight under default config or mask_in_flight', () => {
    const payload = {
      model: 'claude-sonnet-5',
      system: [{ type: 'text', text: `System identity ${synthetic.email}` }],
      instructions: `Responses instructions ${synthetic.email}`,
      metadata: { user_id: synthetic.email },
      tools: [{ name: 't', description: `tool ${synthetic.email}` }],
      messages: [
        { role: 'system', content: `Sys msg ${synthetic.email}` },
        { role: 'developer', content: `Dev msg ${synthetic.email}` },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: `id-${synthetic.email}`, call_id: `call-${synthetic.email}`, content: `User msg ${synthetic.email}` }] },
      ],
    };
    const defaultRes = new GuardEngine().inspectRequest(payload);
    expect(defaultRes.inFlightPayload).toBe(payload);
    expect(JSON.stringify(defaultRes.inFlightPayload)).toBe(JSON.stringify(payload));

    const inFlightEngine = new GuardEngine({ detectorActions: { 'pii.email': 'mask_in_flight' } });
    const maskedRes = inFlightEngine.inspectRequest(payload);
    const inFlight = maskedRes.inFlightPayload as typeof payload;
    expect(inFlight.system).toEqual(payload.system);
    expect(inFlight.instructions).toBe(payload.instructions);
    expect(inFlight.metadata).toEqual(payload.metadata);
    expect(inFlight.tools).toEqual(payload.tools);
    expect(inFlight.messages[0]).toEqual(payload.messages[0]);
    expect(inFlight.messages[1]).toEqual(payload.messages[1]);
    const userBlock = (inFlight.messages[2]!.content as { tool_use_id: string; call_id: string; content: string }[])[0]!;
    expect(userBlock.tool_use_id).toBe(`id-${synthetic.email}`);
    expect(userBlock.call_id).toBe(`call-${synthetic.email}`);
    expect(userBlock.content).toBe('User msg [REDACTED:EMAIL]');
    expect(JSON.stringify(maskedRes.maskedCapture.payload)).not.toContain(synthetic.email);
  });
});
