import { it } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import * as gateway from '@sentropic/llm-gateway';
import { startGatewayHost, resolveGatewayStateDir, GatewaySessionService } from '@sentropic/llm-gateway/node';
import { createGatewayControlClient } from '@sentropic/llm-gateway/node/control-client';
it('loads portable contracts and the published Node host/control subpaths from tarballs', async () => {
  assert.equal(typeof gateway.createGatewayRouter, 'function');
  assert.equal(typeof startGatewayHost, 'function'); assert.equal(typeof createGatewayControlClient, 'function');
  assert.equal(typeof resolveGatewayStateDir, 'function'); assert.equal(typeof GatewaySessionService, 'function');
  assert.equal('FileGatewayStateStore' in gateway, false);
  for (const subpath of ['@sentropic/llm-gateway', '@sentropic/llm-gateway/node', '@sentropic/llm-gateway/node/control-client']) {
    await access(new URL(import.meta.resolve(subpath).replace(/\.js$/, '.d.ts')));
  }
});
