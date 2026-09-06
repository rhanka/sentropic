import { describe, expect, it, vi } from 'vitest';
import type {
  AppConnectorProviderAdapter,
  AppResourceRead,
  AppResourceResult,
  AppToolInvocation,
  AppToolResult,
  AppCapability,
  AppMcpProviderManifest,
  ConnectorTenantContext,
  ConnectorTenantResolutionInput,
  ConnectorSecretStatus,
} from '@sentropic/mcp-platform';
import {
  createFakeConnector,
  createStpConnectorContext,
  fakeManifest,
  InMemoryAuditSink,
  MockSecretStore,
  SecretAccessError,
  SecretRedactor,
} from '@sentropic/mcp-platform/testing';
import { mountConnectorHost } from '../src/mount.js';
import type {
  AccountResolution,
  ConnectorHostPorts,
  SecretPort,
  TenantWorkspaceResolution,
} from '../src/ports.js';

const principalSub = 'owner-1';
const tenantRef = 'tenant-1';
const workspaceRef = 'workspace-1';
const connectorInstanceId = 'connector-instance-1';
const enrollmentRef = 'enrollment-1';
const secretValue = 'token-value-that-must-not-leak';

const defaultResolution: TenantWorkspaceResolution = {
  principalSub,
  tenantRef,
  workspaceRef,
  exposure: { capabilityIds: ['read_token', 'read_token_resource'] },
};

const defaultAccount: AccountResolution = {
  connectorInstanceId,
  enrollmentRef,
  secretRefs: ['opaque-secret-ref'],
};

type EnvelopeError = Error & { reason: string; version: string };

function secretEnvelopeError(reason: string, version: string): EnvelopeError {
  return Object.assign(new Error('credential envelope unreadable'), {
    name: 'SecretEnvelopeError',
    reason,
    version,
  });
}

function localManifest(): AppMcpProviderManifest {
  const platformFake = createFakeConnector();
  const tool = {
    ...fakeManifest.tools[2],
    name: 'read_token',
    description: 'Read a fake token-bound tool.',
    requiredScopes: [],
    requiredClaims: [],
  } satisfies AppCapability;
  const resource = {
    ...fakeManifest.resources[0],
    name: 'read_token_resource',
    description: 'Read a fake token-bound resource.',
    requiredScopes: [],
    requiredClaims: [],
  } satisfies AppCapability;

  return {
    ...fakeManifest,
    appId: platformFake.appId,
    providerId: 'local-host-fake',
    tools: [tool],
    resources: [resource],
    prompts: [],
  };
}

function appResultForSecret(ctx: AppToolInvocation['ctx']): Promise<AppToolResult> {
  return ctx.getSecret('token').then(
    async () => {
      await ctx.audit.emit({
        kind: 'connector.invoke',
        auditId: ctx.auditId,
        at: new Date().toISOString(),
        detail: { capabilityRef: 'read_token' },
      });
      return {
        ok: true,
        output: { source: 'local-fake' },
        auditId: ctx.auditId,
        redactionClass: 'none',
      };
    },
    (error: unknown) => {
      const shaped = error as { name?: unknown; reason?: unknown; version?: unknown };
      if (shaped.name === 'SecretEnvelopeError') {
        return {
          ok: false,
          auditId: ctx.auditId,
          redactionClass: 'none',
          error: {
            code: 'connector_secret_unreadable',
            message: 'Connector secret is unreadable.',
            retriable: true,
            detail: { reason: shaped.reason, version: shaped.version },
          },
        } as AppToolResult;
      }
      if (shaped.name === 'SecretAccessError') {
        return {
          ok: false,
          auditId: ctx.auditId,
          redactionClass: 'none',
          error: {
            code: 'connector_secret_unavailable',
            message: 'Connector secret is unavailable.',
            retriable: false,
          },
        } as AppToolResult;
      }
      throw error;
    },
  );
}

function createLocalFakeAdapter(options: { broadenTenant?: boolean } = {}): AppConnectorProviderAdapter {
  const manifest = localManifest();
  return {
    appId: manifest.appId,
    connectorId: 'fake',
    manifest,
    async resolveTenant(input: ConnectorTenantResolutionInput): Promise<ConnectorTenantContext> {
      return {
        principalRef: input.principalSub,
        tenantRef: options.broadenTenant ? 'other-tenant' : input.tenantRef,
        workspaceRef: input.workspaceRef,
        connectorInstanceId: input.connectorInstanceId,
      };
    },
    async listCapabilities(): Promise<AppCapability[]> {
      return [...manifest.tools, ...manifest.resources];
    },
    async invokeTool(req: AppToolInvocation): Promise<AppToolResult> {
      return appResultForSecret(req.ctx);
    },
    async readResource(req: AppResourceRead): Promise<AppResourceResult> {
      const result = await appResultForSecret(req.ctx);
      if (!result.ok) return result;
      return {
        ...result,
        output: { uri: req.input.uri, source: 'local-fake' },
      };
    },
    async validateSecrets(): Promise<ConnectorSecretStatus> {
      return [{ name: 'token', scope: 'connector-instance', state: 'active' }];
    },
  };
}

function createPlatformStoreSecretPort(redactor: SecretRedactor, audit: InMemoryAuditSink): SecretPort {
  const store = new MockSecretStore(redactor);
  store.put(
    { principalSub, tenantRef, workspaceRef, connectorInstanceId, name: 'token' },
    secretValue,
  );
  const context = createStpConnectorContext({
    requestId: 'platform-test-request',
    correlationId: 'platform-test-correlation',
    auditId: 'platform-test-audit',
    principal: {
      sub: principalSub,
      claims: {},
      scopes: [],
      tenantRef,
      workspaceRef,
      authTime: new Date(0).toISOString(),
    },
    surface: 'backend',
    mcpSessionId: 'platform-test-session',
    connectorInstanceId,
    consentRefs: [],
    grantRefs: [],
    secretStore: store,
    audit,
  });
  return { resolve: async ({ secretName }) => context.getSecret(secretName) };
}

function createHost(options: {
  secret?: SecretPort;
  tenantResolution?: TenantWorkspaceResolution | { deny: true; reason: string };
  accountResolution?: AccountResolution | { deny: true; reason: string };
  adapter?: AppConnectorProviderAdapter;
} = {}) {
  const redactor = new SecretRedactor();
  redactor.register(secretValue);
  const audit = new InMemoryAuditSink(redactor);
  const tenantResolve = vi.fn(async () => options.tenantResolution ?? defaultResolution);
  const accountResolve = vi.fn(async () => options.accountResolution ?? defaultAccount);
  const ports: ConnectorHostPorts = {
    secret: options.secret ?? createPlatformStoreSecretPort(redactor, audit),
    tenantWorkspace: { resolve: tenantResolve },
    account: { resolve: accountResolve },
    audit,
  };
  return {
    driver: mountConnectorHost({ adapters: { fake: options.adapter ?? createLocalFakeAdapter() }, ports }),
    audit,
    tenantResolve,
    accountResolve,
  };
}

function invokeRequest(overrides: Partial<Parameters<ReturnType<typeof createHost>['driver']['invoke']>[0]> = {}) {
  return {
    sessionPrincipalSub: principalSub,
    requestedWorkspaceRef: workspaceRef,
    connectorId: 'fake',
    capabilityRef: 'read_token',
    input: {},
    ...overrides,
  };
}

function resultOf(result: AppToolResult | string): AppToolResult {
  if (typeof result === 'string') throw new Error('expected an inline app result');
  return result;
}

function expectMissing(result: AppToolResult | string): void {
  expect(resultOf(result)).toMatchObject({
    ok: false,
    error: { code: 'connector_not_found', retriable: false },
  });
}

describe('connector host mount', () => {
  it('returns adapter results for invoke and readResource without secret leakage', async () => {
    const { driver, audit, tenantResolve, accountResolve } = createHost();

    const invokeResult = resultOf(await driver.invoke(invokeRequest()));
    const resourceResult = await driver.readResource(invokeRequest({
      capabilityRef: 'read_token_resource',
      input: { uri: 'fake://workspace-1/token' },
    }));

    expect(invokeResult).toMatchObject({ ok: true, output: { source: 'local-fake' } });
    expect(resourceResult).toMatchObject({ ok: true, output: { source: 'local-fake' } });
    expect(JSON.stringify({ invokeResult, resourceResult })).not.toContain(secretValue);
    expect(audit.dump()).not.toContain(secretValue);
    expect(audit.dump()).toContain('"name":"token"');
    expect(tenantResolve).toHaveBeenCalledTimes(2);
    expect(accountResolve).toHaveBeenCalledTimes(2);
  });

  it('surfaces a SecretEnvelopeError-shaped port failure as connector_secret_unreadable', async () => {
    const { driver, audit } = createHost({
      secret: { resolve: async () => { throw secretEnvelopeError('unknown_version', 'v9'); } },
    });

    const result = resultOf(await driver.invoke(invokeRequest()));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'connector_secret_unreadable',
        retriable: true,
        detail: { reason: 'unknown_version', version: 'v9' },
      },
    });
    expect(JSON.stringify(result)).not.toContain(secretValue);
    expect(audit.dump()).not.toContain(secretValue);
  });

  it('surfaces a SecretAccessError missing failure as connector_secret_unavailable', async () => {
    const { driver } = createHost({
      secret: { resolve: async () => { throw new SecretAccessError('token', 'missing'); } },
    });

    const result = resultOf(await driver.invoke(invokeRequest()));

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'connector_secret_unavailable', retriable: false },
    });
  });

  it('rethrows an unknown secret-port failure instead of converting it to a connector code', async () => {
    const { driver } = createHost({
      secret: { resolve: async () => { throw new TypeError('secret port programming failure'); } },
    });

    await expect(driver.invoke(invokeRequest())).rejects.toThrow('secret port programming failure');
  });

  it.each([
    {
      label: 'the tenant/workspace resolver denies',
      options: { tenantResolution: { deny: true as const, reason: 'not exposed' } },
      calls: { tenant: 1, account: 0 },
    },
    {
      label: 'the account resolver denies',
      options: { accountResolution: { deny: true as const, reason: 'ambiguous account' } },
      calls: { tenant: 1, account: 1 },
    },
    {
      label: 'the finite exposure allowlist omits the capability',
      options: {
        tenantResolution: { ...defaultResolution, exposure: { capabilityIds: ['another_capability'] } },
      },
      calls: { tenant: 1, account: 0 },
    },
  ])('denies as missing when $label', async ({ options, calls }) => {
    const { driver, tenantResolve, accountResolve } = createHost(options);

    expectMissing(await driver.invoke(invokeRequest()));
    expect(tenantResolve).toHaveBeenCalledTimes(calls.tenant);
    expect(accountResolve).toHaveBeenCalledTimes(calls.account);
  });

  it('denies principal-bearing request hints before a resolver can treat them as authority', async () => {
    const { driver, tenantResolve } = createHost();

    expectMissing(await driver.invoke(invokeRequest({ hints: { principalSub: 'another-user' } })));
    expect(tenantResolve).not.toHaveBeenCalled();
  });

  it('honors a capability hint only as a narrowing constraint', async () => {
    const { driver, accountResolve } = createHost();

    expectMissing(await driver.invoke(invokeRequest({ hints: { capabilityIds: ['another_capability'] } })));
    expect(accountResolve).not.toHaveBeenCalled();
  });

  it('never resolves a provider secret for unknown connector or capability requests', async () => {
    const resolveSecret = vi.fn(async () => secretValue);
    const { driver } = createHost({ secret: { resolve: resolveSecret } });

    expectMissing(await driver.invoke(invokeRequest({ connectorId: 'unknown' })));
    expectMissing(await driver.invoke(invokeRequest({ capabilityRef: 'unknown' })));
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  it('refuses a resolver principal mismatch through the explicit P1 structural guard', async () => {
    const { driver } = createHost({
      tenantResolution: { ...defaultResolution, principalSub: 'another-user' },
    });

    // This is load-bearing: deleting mount.ts's explicit principal mismatch branch
    // makes this call resolve through the local adapter, so this rejection fails.
    await expect(driver.invoke(invokeRequest())).rejects.toThrow('session principal mismatch');
  });

  it('rejects an adapter resolveTenant result that broadens the server resolution', async () => {
    const { driver } = createHost({ adapter: createLocalFakeAdapter({ broadenTenant: true }) });

    await expect(driver.invoke(invokeRequest())).rejects.toThrow('broadened tenant context');
  });
});
