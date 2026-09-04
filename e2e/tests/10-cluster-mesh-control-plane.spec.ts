import { expect, request, test } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
const USER_A_STATE = './.auth/user-a.json';
const A1_EVIDENCE = process.env.CLUSTER_MESH_A1_EVIDENCE;
const A1_REGISTRATION = process.env.CLUSTER_MESH_A1_TARGET_REGISTRATION;
const A1_TICK_URL = process.env.CLUSTER_MESH_A1_TARGET_TICK_URL;
const A1_PARK_URL = process.env.CLUSTER_MESH_A1_PARK_TARGET_URL;
const A1_LOST_URL = process.env.CLUSTER_MESH_A1_LOST_STATUS_URL;
const MCP_QUALIFICATION_URL = process.env.CLUSTER_MESH_MCP_QUALIFICATION_URL;
const CLI_QUALIFICATION_URL = process.env.CLUSTER_MESH_CLI_QUALIFICATION_URL;
const CAPACITY_QUALIFICATION_URL = process.env.CLUSTER_MESH_CAPACITY_QUALIFICATION_URL;
const EXPECTED_NAMESPACES = [
  '/session', '/cli', '/mcp', '/oauth', '/gw', '/chat', '/focus', '/track', '/memory',
  '/health', '/apps', '/catalog', '/resources', '/admin', '/clients', '/transfers',
  '/documents', '/config', '/auth', '/llm-mesh', '/workflows', '/comments', '/connectors',
  '/agents', '/streams', '/locks', '/business', '/analytics', '/workspaces',
];
const qualificationAvailable = [
  A1_EVIDENCE, A1_REGISTRATION, A1_TICK_URL, A1_PARK_URL, A1_LOST_URL,
].every(Boolean);

test.describe.configure({ mode: 'serial' });

test.describe('Cluster Mesh central control plane A1 qualification', () => {
  test('executes real A1 or proves the production source-gap fence', async () => {
    const api = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    if (!qualificationAvailable) {
      try {
        const health = await api.get('/api/v1/health');
        expect(health.ok()).toBeTruthy();
        await expect(health.json()).resolves.toMatchObject({
          clusterMesh: { generation: { generationId: 'cluster-mesh-session-v1' } },
        });
        const refused = await api.post('/api/v1/auth/session/control/drive', {
          headers: { 'content-type': 'application/json' },
          data: {
            commandId: 'a1-source-gap',
            targetRegistrationId: 'unavailable-real-target',
            idempotencyKey: 'a1-source-gap',
          },
        });
        expect(refused.status()).toBe(401);
        await expect(refused.json()).resolves.toEqual({ error: 'unverified_invocation_context' });
        return;
      } finally {
        await api.dispose();
      }
    }
    const qualifier = await request.newContext();
    const invoke = async (action: 'drive' | 'wake' | 'relaunch', commandId: string) =>
      api.post(`/api/v1/auth/session/control/${action}`, {
        headers: {
          'content-type': 'application/json',
          'x-cluster-mesh-evidence': A1_EVIDENCE!,
          'x-correlation-id': `a1-${commandId}`,
        },
        data: {
          commandId,
          targetRegistrationId: A1_REGISTRATION,
          idempotencyKey: `a1-${commandId}`,
        },
      });

    try {
      const before = await qualifier.get(A1_TICK_URL!);
      expect(before.ok()).toBeTruthy();
      const beforeTick = Number((await before.json()).tick);

      const drive = await invoke('drive', 'a1-drive-b');
      expect(drive.ok()).toBeTruthy();
      await expect(drive.json()).resolves.toMatchObject({ status: 'acted' });
      await expect.poll(async () => {
        const response = await qualifier.get(A1_TICK_URL!);
        return Number((await response.json()).tick);
      }).toBeGreaterThan(beforeTick);

      const relaunch = await invoke('relaunch', 'a1-relaunch-b');
      expect(relaunch.ok()).toBeTruthy();
      const relaunchBody = await relaunch.json();
      expect(relaunchBody.effectRef).toBeTruthy();
      expect(relaunchBody.actedTargets).toContain(A1_REGISTRATION);

    } finally {
      await api.dispose();
      await qualifier.dispose();
    }
  });
});

test.describe('Cluster Mesh MCP singleton qualification', () => {
  test('qualifies one generation server or proves the external evidence gap', async () => {
    if (!MCP_QUALIFICATION_URL) {
      const api = await request.newContext({ baseURL: API_BASE_URL });
      try {
        const response = await api.get('/api/v1/health');
        expect(response.ok()).toBeTruthy();
        await expect(response.json()).resolves.toMatchObject({
          clusterMesh: { generation: { generationId: 'cluster-mesh-session-v1' } },
        });
        expect((await api.get('/api/v1/mcp')).status()).toBe(404);
        return;
      } finally {
        await api.dispose();
      }
    }
    const qualifier = await request.newContext();
    try {
      const response = await qualifier.get(MCP_QUALIFICATION_URL!);
      expect(response.ok()).toBeTruthy();
      const evidence = await response.json() as {
        sessionCount: number;
        logicalServers: number;
        perSessionServers: number;
        missingRegistration: { status: number; providerEffects: number };
      };
      expect(evidence.sessionCount).toBeGreaterThan(1);
      expect(evidence.logicalServers).toBe(1);
      expect(evidence.perSessionServers).toBe(0);
      expect(evidence.missingRegistration).toEqual({ status: 503, providerEffects: 0 });
    } finally {
      await qualifier.dispose();
    }
  });
});

test.describe('Cluster Mesh CLI session-delegation qualification', () => {
  test('qualifies registration/delegation or proves the CLI is disabled', async () => {
    if (!CLI_QUALIFICATION_URL) {
      const api = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
      try {
        const response = await api.post('/api/v1/cli/intents', {
          data: { runnerId: 'h2a', argv: ['status'] },
        });
        expect(response.status()).toBe(404);
        return;
      } finally {
        await api.dispose();
      }
    }
    const qualifier = await request.newContext();
    try {
      const response = await qualifier.get(CLI_QUALIFICATION_URL!);
      expect(response.ok()).toBeTruthy();
      const evidence = await response.json() as {
        missingRegistration: { status: number; parses: number; sessionDelegations: number };
        delegated: {
          status: number;
          action: 'drive' | 'wake' | 'relaunch';
          path: string;
          receiptRef?: string;
          sessionDelegations: number;
        };
        survivingLegacyHttpPaths: string[];
      };
      expect(evidence.missingRegistration).toEqual({
        status: 409, parses: 0, sessionDelegations: 0,
      });
      expect(evidence.delegated.status).toBe(200);
      expect(evidence.delegated.path).toBe(`/auth/session/control/${evidence.delegated.action}`);
      expect(evidence.delegated.receiptRef).toBeTruthy();
      expect(evidence.delegated.sessionDelegations).toBe(1);
      expect(evidence.survivingLegacyHttpPaths).toEqual([]);
    } finally {
      await qualifier.dispose();
    }
  });
});

test.describe('Cluster Mesh capacity qualification', () => {
  test('qualifies default 12/13 and non-default caps or exposes the durable-admission gap', async () => {
    if (!CAPACITY_QUALIFICATION_URL) {
      const api = await request.newContext({ baseURL: API_BASE_URL });
      try {
        const response = await api.get('/api/v1/health');
        expect(response.ok()).toBeTruthy();
        const body = await response.json() as {
          clusterMesh: { generation: { config: { capacity: unknown } } };
        };
        expect(body.clusterMesh.generation.config.capacity).toEqual({
          maxConcurrent: 12,
          poolSize: 4,
        });
        return;
      } finally {
        await api.dispose();
      }
    }

    const qualifier = await request.newContext();
    try {
      const response = await qualifier.get(CAPACITY_QUALIFICATION_URL);
      expect(response.ok()).toBeTruthy();
      const evidence = await response.json() as {
        defaultCap: { accepted: number; refusalStatus: number; spawnCount: number };
        nonDefaultCap: { cap: number; accepted: number; refusalStatus: number; spawnCount: number };
      };
      expect(evidence.defaultCap).toEqual({ accepted: 12, refusalStatus: 429, spawnCount: 12 });
      expect(evidence.nonDefaultCap.accepted).toBe(evidence.nonDefaultCap.cap);
      expect(evidence.nonDefaultCap.spawnCount).toBe(evidence.nonDefaultCap.cap);
      expect(evidence.nonDefaultCap.refusalStatus).toBe(429);
    } finally {
      await qualifier.dispose();
    }
  });
});

test.describe('Cluster Mesh module and cutover qualification', () => {
  test('reports 29 modules, disables CLI, and serves canonical catalog/streams paths', async () => {
    const api = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    try {
      const health = await api.get('/api/v1/health');
      expect(health.ok()).toBeTruthy();
      const body = await health.json() as {
        clusterMesh: { modules: Array<{ namespace: string; enabled: boolean }> };
      };
      expect(body.clusterMesh.modules.map(({ namespace }) => namespace)).toEqual(EXPECTED_NAMESPACES);
      expect(body.clusterMesh.modules.find(({ namespace }) => namespace === '/cli')).toEqual({
        namespace: '/cli', enabled: qualificationAvailable,
      });

      expect((await api.get('/api/v1/catalog/entries')).status()).toBe(200);
      const workspaces = await api.get('/api/v1/workspaces');
      expect(workspaces.ok()).toBeTruthy();
      const workspaceId = String(((await workspaces.json()).items ?? [])[0]?.id ?? '');
      expect(workspaceId).toBeTruthy();
      expect((await api.get(`/api/v1/streams/active?workspace_id=${workspaceId}`)).status()).toBe(200);
      expect((await api.get(`/api/v1/streams/streams/active?workspace_id=${workspaceId}`)).status()).toBe(404);
    } finally {
      await api.dispose();
    }
  });
});

test.describe('Cluster Mesh final LOST qualification', () => {
  test('kills the dedicated target last and marks its registration lost', async () => {
    test.skip(!qualificationAvailable, 'live target qualification is not configured');
    const api = await request.newContext({ baseURL: API_BASE_URL, storageState: USER_A_STATE });
    const qualifier = await request.newContext();
    try {
      expect((await qualifier.post(A1_PARK_URL!)).ok()).toBeTruthy();
      const wake = await api.post('/api/v1/auth/session/control/wake', {
        headers: {
          'content-type': 'application/json',
          'x-cluster-mesh-evidence': A1_EVIDENCE!,
          'x-correlation-id': 'a4-lost',
        },
        data: {
          commandId: 'a4-wake-dead-target',
          targetRegistrationId: A1_REGISTRATION,
          idempotencyKey: 'a4-wake-dead-target',
        },
      });
      expect(wake.status()).toBe(409);
      await expect.poll(async () => {
        const response = await qualifier.get(A1_LOST_URL!);
        return (await response.json()).status;
      }).toBe('lost');
    } finally {
      await api.dispose();
      await qualifier.dispose();
    }
  });
});
