/**
 * Slice 1 contract tests — the closed manifest/capability schemas compile and
 * the read-only closed exceptions are expressible exactly as the spec mandates.
 *
 * These are type-level + value-level assertions over an app-neutral fake
 * manifest: no domain (Wave/immo) shape is baked in.
 */
import { describe, expect, it } from 'vitest';
import {
  elicitationPolicyIsSecretSafe,
  type ElicitationPolicy,
} from '../src/experimental/manifest-elicitation.js';
import type {
  AppMcpProviderManifest,
  CapabilityPrompt,
  CapabilityResource,
  CapabilityTool,
} from '../src/manifest.js';

const readOnlyGates = {
  requiresElicitation: false,
  requiresHumanConfirmation: false,
  requiresPrincipalGate: false,
};

const resource: CapabilityResource = {
  kind: 'resource',
  name: 'list_widgets',
  uriTemplate: 'fake://widgets/{id}',
  description: 'List app-neutral fake widgets.',
  requiredScopes: ['widgets:read'],
  requiredClaims: [],
  outputSchema: { type: 'array' },
  redactionClass: 'low',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const prompt: CapabilityPrompt = {
  kind: 'prompt',
  name: 'summarize_widget',
  description: 'Summarize a widget.',
  requiredScopes: ['widgets:read'],
  requiredClaims: [],
  argumentSchema: { type: 'object' },
  outputSchema: { type: 'string' },
  redactionClass: 'none',
  mutability: 'read-only',
  mutatesExternalSystem: false,
  idempotency: { required: false },
  gates: readOnlyGates,
};

const writeTool: CapabilityTool = {
  kind: 'tool',
  name: 'create_widget',
  description: 'Create a widget (external mutation).',
  requiredScopes: ['widgets:write'],
  requiredClaims: [],
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  redactionClass: 'moderate',
  mutability: 'append',
  mutatesExternalSystem: true,
  idempotency: { required: true, scope: 'tenant' },
  freshness: { maxAgeSeconds: 300, stepUp: 'auth' },
  gates: {
    requiresElicitation: true,
    requiresHumanConfirmation: true,
    requiresPrincipalGate: false,
  },
};

const manifest: AppMcpProviderManifest = {
  appId: 'fake-app',
  providerId: 'fake-provider',
  version: '0.0.0',
  displayName: 'Fake app-neutral provider',
  resources: [resource],
  tools: [writeTool],
  prompts: [prompt],
  authz: {
    requiredClaims: [],
    scopes: ['widgets:read', 'widgets:write'],
    tenantResolution: 'connector-instance',
    freshness: { maxAgeSeconds: 3600, stepUp: 'either' },
  },
  audit: { eventKinds: ['invoke', 'consent'], piiClass: 'low' },
  durability: {},
  secrets: [
    {
      name: 'fakeAccessToken',
      scope: 'connector-instance',
      sensitive: true,
      rotation: 'manual',
    },
  ],
};

describe('manifest closed schemas (§4.2/§4.3)', () => {
  it('read-only capabilities declare the closed read-only exception explicitly', () => {
    for (const cap of [resource, prompt]) {
      // mutatesExternalSystem and idempotency.required are NEVER implicit for read-only.
      expect(cap.mutatesExternalSystem).toBe(false);
      expect(cap.idempotency.required).toBe(false);
      expect(cap.mutability).toBe('read-only');
    }
  });

  it('a write tool carries mutatesExternalSystem + idempotency + gates', () => {
    expect(writeTool.mutatesExternalSystem).toBe(true);
    expect(writeTool.idempotency.required).toBe(true);
    expect(writeTool.gates.requiresElicitation).toBe(true);
  });

  it('connector secrets are always sensitive and scoped', () => {
    for (const secret of manifest.secrets ?? []) {
      expect(secret.sensitive).toBe(true);
      expect(secret.scope).toBeTruthy();
    }
  });

  it('manifest stays app-neutral (no domain shape baked into the schema)', () => {
    expect(manifest.appId).toBe('fake-app');
    expect(manifest.tools.map((t) => t.name)).not.toContain('list_businesses');
  });

  it('F8: a form-mode elicitation policy MUST NOT carry secrets (§5.2 b, provisional)', () => {
    const formWithSecret: ElicitationPolicy = {
      capabilityRef: 'create_widget', mode: 'form', ttlSeconds: 120, required: true, carriesSecrets: true,
    };
    const formNoSecret: ElicitationPolicy = {
      capabilityRef: 'create_widget', mode: 'form', ttlSeconds: 120, required: true,
    };
    // Sensitive entry must use url/credential mode (does not transit the MCP client).
    const credential: ElicitationPolicy = {
      capabilityRef: 'enroll_secret', mode: 'credential', ttlSeconds: 120, required: true, carriesSecrets: true,
    };
    expect(elicitationPolicyIsSecretSafe(formWithSecret)).toBe(false);
    expect(elicitationPolicyIsSecretSafe(formNoSecret)).toBe(true);
    expect(elicitationPolicyIsSecretSafe(credential)).toBe(true);
  });
});
