import { expect, request, test } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8787';
const A1_EVIDENCE = process.env.CLUSTER_MESH_A1_EVIDENCE;
const A1_REGISTRATION = process.env.CLUSTER_MESH_A1_TARGET_REGISTRATION;
const A1_TICK_URL = process.env.CLUSTER_MESH_A1_TARGET_TICK_URL;
const A1_PARK_URL = process.env.CLUSTER_MESH_A1_PARK_TARGET_URL;
const A1_LOST_URL = process.env.CLUSTER_MESH_A1_LOST_STATUS_URL;
const MCP_QUALIFICATION_URL = process.env.CLUSTER_MESH_MCP_QUALIFICATION_URL;
const qualificationAvailable = [
  A1_EVIDENCE, A1_REGISTRATION, A1_TICK_URL, A1_PARK_URL, A1_LOST_URL,
].every(Boolean);

test.describe('Cluster Mesh central control plane A1 qualification', () => {
  test.skip(!qualificationAvailable, 'BR75-SG1: real h2a PTY adapter evidence is unavailable');

  test('session A drives B, relaunches a non-empty set, and reconciles parked B to LOST', async () => {
    const api = await request.newContext({ baseURL: API_BASE_URL });
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

      expect((await qualifier.post(A1_PARK_URL!)).ok()).toBeTruthy();
      const wake = await invoke('wake', 'a1-wake-parked-b');
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

test.describe('Cluster Mesh MCP singleton qualification', () => {
  test.skip(!MCP_QUALIFICATION_URL, 'real MCP singleton qualification endpoint is unavailable');

  test('N sessions share one generation server and missing registration fails before effects', async () => {
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
