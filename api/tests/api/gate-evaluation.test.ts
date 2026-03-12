import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { workspaces, workspaceMemberships, initiatives, folders } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';
import { evaluateGate, getDefaultGateConfig, type GateConfig } from '../../src/services/gate-service';

async function importApp() {
  const mod = await import('../../src/app');
  return mod.app as any;
}

describe('Gate evaluation system', () => {
  let app: any;
  let editor: any;
  const createdWorkspaceIds: string[] = [];
  const createdFolderIds: string[] = [];
  const createdInitiativeIds: string[] = [];

  beforeEach(async () => {
    app = await importApp();
    editor = await createAuthenticatedUser('editor', `editor-gate-${Date.now()}@example.com`);
    if (editor.workspaceId) createdWorkspaceIds.push(editor.workspaceId);
  }, 30000);

  afterEach(async () => {
    // Clean up in reverse dependency order
    for (const id of createdInitiativeIds) {
      await db.delete(initiatives).where(eq(initiatives.id, id)).catch(() => {});
    }
    createdInitiativeIds.length = 0;

    for (const id of createdFolderIds) {
      await db.delete(folders).where(eq(folders.id, id)).catch(() => {});
    }
    createdFolderIds.length = 0;

    for (const id of createdWorkspaceIds) {
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, id)).catch(() => {});
      await db.delete(workspaces).where(eq(workspaces.id, id)).catch(() => {});
    }
    createdWorkspaceIds.length = 0;
    await cleanupAuthData();
  }, 30000);

  // --- Helper to create a workspace with specific type and gate config ---
  async function createWorkspaceWithType(type: string, gateConfig?: GateConfig) {
    const res = await authenticatedRequest(app, 'POST', '/api/v1/workspaces', editor.sessionToken, {
      name: `Gate Test WS ${type}`,
      type,
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    createdWorkspaceIds.push(id);

    // If custom gate config, override it
    if (gateConfig) {
      await db.update(workspaces).set({ gateConfig }).where(eq(workspaces.id, id));
    }

    return id;
  }

  // --- Helper to create a folder in a workspace ---
  async function createFolderInWorkspace(workspaceId: string) {
    const folderId = createId();
    await db.insert(folders).values({
      id: folderId,
      workspaceId,
      name: 'Gate Test Folder',
    });
    createdFolderIds.push(folderId);
    return folderId;
  }

  // --- Helper to create an initiative ---
  async function createInitiativeInFolder(workspaceId: string, folderId: string, data: Record<string, unknown> = {}) {
    const id = createId();
    await db.insert(initiatives).values({
      id,
      workspaceId,
      folderId,
      data: { name: 'Gate Test Initiative', ...data },
    });
    createdInitiativeIds.push(id);
    return id;
  }

  // --- Default gate config tests ---

  describe('getDefaultGateConfig', () => {
    it('returns null for neutral workspace type', () => {
      const config = getDefaultGateConfig('neutral');
      expect(config).toBeNull();
    });

    it('returns free mode for ai-ideas', () => {
      const config = getDefaultGateConfig('ai-ideas');
      expect(config).toBeDefined();
      expect(config!.mode).toBe('free');
      expect(config!.stages).toEqual(['G0', 'G2']);
    });

    it('returns soft mode for opportunity', () => {
      const config = getDefaultGateConfig('opportunity');
      expect(config).toBeDefined();
      expect(config!.mode).toBe('soft');
      expect(config!.stages).toEqual(['G0', 'G2', 'G5', 'G7']);
      expect(config!.criteria).toBeDefined();
    });

    it('returns free mode for code', () => {
      const config = getDefaultGateConfig('code');
      expect(config).toBeDefined();
      expect(config!.mode).toBe('free');
      expect(config!.stages).toEqual(['G0', 'G2', 'G5']);
    });
  });

  // --- Workspace creation seeds gate config ---

  describe('workspace creation seeds gate_config', () => {
    it('seeds gate_config on opportunity workspace creation', async () => {
      const wsId = await createWorkspaceWithType('opportunity');
      const [ws] = await db.select({ gateConfig: workspaces.gateConfig }).from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
      expect(ws.gateConfig).toBeDefined();
      const config = ws.gateConfig as unknown as GateConfig;
      expect(config.mode).toBe('soft');
    });

    it('seeds gate_config on ai-ideas workspace creation', async () => {
      const wsId = await createWorkspaceWithType('ai-ideas');
      const [ws] = await db.select({ gateConfig: workspaces.gateConfig }).from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
      expect(ws.gateConfig).toBeDefined();
      const config = ws.gateConfig as unknown as GateConfig;
      expect(config.mode).toBe('free');
    });
  });

  // --- Free mode gate evaluation ---

  describe('free mode gate evaluation', () => {
    it('always passes in free mode', async () => {
      const wsId = await createWorkspaceWithType('ai-ideas');
      const folderId = await createFolderInWorkspace(wsId);
      const initId = await createInitiativeInFolder(wsId, folderId);

      const result = await evaluateGate(wsId, initId, 'G2');
      expect(result.gate_passed).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.blockers).toEqual([]);
    });

    it('passes even with missing data in free mode', async () => {
      const wsId = await createWorkspaceWithType('ai-ideas');
      const folderId = await createFolderInWorkspace(wsId);
      const initId = await createInitiativeInFolder(wsId, folderId, {});

      const result = await evaluateGate(wsId, initId, 'G2');
      expect(result.gate_passed).toBe(true);
    });
  });

  // --- Soft mode gate evaluation ---

  describe('soft mode gate evaluation', () => {
    const softConfig: GateConfig = {
      mode: 'soft',
      stages: ['G0', 'G2', 'G5'],
      criteria: {
        G2: { required_fields: ['data.description', 'data.domain'], guardrail_categories: [] },
        G5: { required_fields: ['data.solution'], guardrail_categories: [] },
      },
    };

    it('passes with warnings when required fields are missing', async () => {
      const wsId = await createWorkspaceWithType('opportunity', softConfig);
      const folderId = await createFolderInWorkspace(wsId);
      const initId = await createInitiativeInFolder(wsId, folderId, { name: 'Test' });

      const result = await evaluateGate(wsId, initId, 'G2');
      expect(result.gate_passed).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.blockers).toEqual([]);
    });

    it('passes with no warnings when all fields are present', async () => {
      const wsId = await createWorkspaceWithType('opportunity', softConfig);
      const folderId = await createFolderInWorkspace(wsId);
      const initId = await createInitiativeInFolder(wsId, folderId, {
        name: 'Test',
        description: 'A valid description',
        domain: 'Engineering',
      });

      const result = await evaluateGate(wsId, initId, 'G2');
      expect(result.gate_passed).toBe(true);
      expect(result.warnings).toEqual([]);
    });
  });

  // --- Hard mode gate evaluation ---

  describe('hard mode gate evaluation', () => {
    const hardConfig: GateConfig = {
      mode: 'hard',
      stages: ['G0', 'G2', 'G5', 'G7'],
      criteria: {
        G2: { required_fields: ['data.description', 'data.domain'], guardrail_categories: [] },
        G5: { required_fields: ['data.solution'], guardrail_categories: [] },
      },
    };

    it('blocks when required fields are missing', async () => {
      const wsId = await createWorkspaceWithType('opportunity', hardConfig);
      const folderId = await createFolderInWorkspace(wsId);
      const initId = await createInitiativeInFolder(wsId, folderId, { name: 'Test' });

      const result = await evaluateGate(wsId, initId, 'G2');
      expect(result.gate_passed).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(0);
      expect(result.warnings).toEqual([]);
    });

    it('passes when all fields are present', async () => {
      const wsId = await createWorkspaceWithType('opportunity', hardConfig);
      const folderId = await createFolderInWorkspace(wsId);
      const initId = await createInitiativeInFolder(wsId, folderId, {
        name: 'Test',
        description: 'A valid description',
        domain: 'Engineering',
      });

      const result = await evaluateGate(wsId, initId, 'G2');
      expect(result.gate_passed).toBe(true);
      expect(result.blockers).toEqual([]);
    });

    it('blocks on invalid stage', async () => {
      const wsId = await createWorkspaceWithType('opportunity', hardConfig);
      const folderId = await createFolderInWorkspace(wsId);
      const initId = await createInitiativeInFolder(wsId, folderId, { name: 'Test' });

      const result = await evaluateGate(wsId, initId, 'G99');
      expect(result.gate_passed).toBe(false);
      expect(result.blockers[0]).toContain('not a valid stage');
    });

    it('passes when stage has no criteria defined', async () => {
      const wsId = await createWorkspaceWithType('opportunity', hardConfig);
      const folderId = await createFolderInWorkspace(wsId);
      const initId = await createInitiativeInFolder(wsId, folderId, { name: 'Test' });

      const result = await evaluateGate(wsId, initId, 'G0');
      expect(result.gate_passed).toBe(true);
    });
  });

  // --- PATCH initiative maturity_stage transition ---

  describe('PATCH /api/v1/initiatives/:id maturity_stage transition', () => {
    it('allows maturity_stage transition in free mode', async () => {
      const wsId = await createWorkspaceWithType('ai-ideas');
      const folderId = await createFolderInWorkspace(wsId);

      // Create initiative via API
      const createRes = await authenticatedRequest(app, 'POST', '/api/v1/initiatives', editor.sessionToken, {
        folderId,
        name: 'Gate Transition Test',
      });
      expect(createRes.status).toBe(201);
      const initiative = await createRes.json();
      createdInitiativeIds.push(initiative.id);

      // PATCH to change maturity stage
      const patchRes = await authenticatedRequest(app, 'PATCH', `/api/v1/initiatives/${initiative.id}`, editor.sessionToken, {
        maturity_stage: 'G0',
      });
      expect(patchRes.status).toBe(200);
      const patched = await patchRes.json();
      expect(patched.gate).toBeDefined();
      expect(patched.gate.gate_passed).toBe(true);
    });

    it('blocks maturity_stage transition in hard mode with missing fields', async () => {
      const hardConfig: GateConfig = {
        mode: 'hard',
        stages: ['G0', 'G2'],
        criteria: {
          G2: { required_fields: ['data.description'], guardrail_categories: [] },
        },
      };
      const wsId = await createWorkspaceWithType('ai-ideas', hardConfig);
      const folderId = await createFolderInWorkspace(wsId);

      const createRes = await authenticatedRequest(app, 'POST', '/api/v1/initiatives', editor.sessionToken, {
        folderId,
        name: 'Hard Gate Test',
      });
      expect(createRes.status).toBe(201);
      const initiative = await createRes.json();
      createdInitiativeIds.push(initiative.id);

      // First advance to G0 (no criteria, should pass)
      const patchG0 = await authenticatedRequest(app, 'PATCH', `/api/v1/initiatives/${initiative.id}`, editor.sessionToken, {
        maturity_stage: 'G0',
      });
      expect(patchG0.status).toBe(200);

      // Now try to advance to G2 (requires description, should block)
      const patchG2 = await authenticatedRequest(app, 'PATCH', `/api/v1/initiatives/${initiative.id}`, editor.sessionToken, {
        maturity_stage: 'G2',
      });
      expect(patchG2.status).toBe(422);
      const body = await patchG2.json();
      expect(body.code).toBe('GATE_BLOCKED');
      expect(body.gate.gate_passed).toBe(false);
      expect(body.gate.blockers.length).toBeGreaterThan(0);
    });
  });

  // --- Gate config management ---

  describe('PATCH /api/v1/workspaces/:id/gate-config', () => {
    it('updates gate config for a workspace', async () => {
      const wsId = await createWorkspaceWithType('opportunity');

      const newConfig = {
        mode: 'hard' as const,
        stages: ['G0', 'G2', 'G5'],
        criteria: {
          G2: { required_fields: ['data.description'], guardrail_categories: [] },
        },
      };

      const res = await authenticatedRequest(app, 'PATCH', `/api/v1/workspaces/${wsId}/gate-config`, editor.sessionToken, newConfig);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.gate_config.mode).toBe('hard');
    });

    it('rejects gate config for neutral workspace', async () => {
      // We need a neutral workspace; use the auto-created one or create one via DB
      const { ensureNeutralWorkspace } = await import('../../src/services/workspace-service');
      const neutralId = await ensureNeutralWorkspace(editor.id);
      createdWorkspaceIds.push(neutralId);

      const res = await authenticatedRequest(app, 'PATCH', `/api/v1/workspaces/${neutralId}/gate-config`, editor.sessionToken, {
        mode: 'soft',
        stages: ['G0'],
      });
      expect(res.status).toBe(400);
    });
  });
});
