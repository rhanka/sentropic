import { describe, expect, it } from 'vitest';

import {
  createGatewayRouter,
  notImplemented,
  stubGatewayConfig,
  type AuthzMode,
  type GatewayConfig,
} from '../src/index.js';

const buildApp = () => createGatewayRouter({ config: stubGatewayConfig });

describe('@sentropic/llm-gateway router (v0 scaffold)', () => {
  it('mounts and serves a real /healthz', async () => {
    const app = buildApp();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; mode: string };
    expect(body.status).toBe('ok');
    expect(body.mode).toBe('personal-passthrough');
  });

  it('serves /readyz (ready by default in the scaffold)', async () => {
    const app = buildApp();
    const res = await app.request('/readyz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ready');
  });

  it('exposes the frozen v1 surface with provider-shaped 501 stubs', async () => {
    const app = buildApp();

    const anthropic = await app.request('/v1/messages', { method: 'POST' });
    expect(anthropic.status).toBe(501);
    const aBody = (await anthropic.json()) as { type: string; error: { type: string } };
    expect(aBody.type).toBe('error');
    expect(aBody.error.type).toBe('api_error');

    const openai = await app.request('/v1/chat/completions', { method: 'POST' });
    expect(openai.status).toBe(501);
    const oBody = (await openai.json()) as { error: { code?: string } };
    expect(oBody.error.code).toBe('not_implemented');

    const models = await app.request('/v1/models');
    expect(models.status).toBe(200);
    const mBody = (await models.json()) as { object: string; data: unknown[] };
    expect(mBody.object).toBe('list');
    expect(mBody.data).toEqual([]);
  });

  it('defaults the cross-user kill switch OFF (personal-passthrough only)', () => {
    const config: GatewayConfig = stubGatewayConfig;
    expect(config.crossUserPoolEnabled).toBe(false);
    expect(config.mode).toBe('personal-passthrough');
  });

  it('carries the 3-mode authz type surface (gated, types-only in v0)', () => {
    const modes: AuthzMode[] = ['direct', 'explicit-validation', 'assisted'];
    expect(modes).toHaveLength(3);
  });

  it('produces a provider-shaped error mapper', () => {
    const err = notImplemented('openai-chat-completions');
    expect(err.status).toBe(501);
  });
});
