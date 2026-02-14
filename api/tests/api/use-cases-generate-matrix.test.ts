import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { defaultMatrixConfig } from '../../src/config/default-matrix';
import { folders, jobQueue, organizations, useCases } from '../../src/db/schema';
import { queueManager } from '../../src/services/queue-manager';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';

describe('Use Cases Generate - Matrix Mode', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue();
  });

  afterEach(async () => {
    processJobsSpy.mockRestore();
    await db.delete(jobQueue).where(eq(jobQueue.workspaceId, user.workspaceId));
    await db.delete(useCases).where(eq(useCases.workspaceId, user.workspaceId));
    await db.delete(folders).where(eq(folders.workspaceId, user.workspaceId));
    await db.delete(organizations).where(eq(organizations.workspaceId, user.workspaceId));
    await cleanupAuthData();
  });

  async function createOrganization() {
    const response = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, {
      name: `Org ${createTestId()}`,
      industry: 'Tech',
    });
    expect(response.status).toBe(201);
    const org = await response.json();
    return org.id as string;
  }

  it('defaults to matrix_mode=default when no organization is provided', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/use-cases/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        use_case_count: 1,
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('default');
    expect(data.matrixJobId).toBeUndefined();
    expect(data.jobId).toBeDefined();
    expect(data.folder_id).toBeDefined();

    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, data.folder_id), eq(folders.workspaceId, user.workspaceId)))
      .limit(1);
    expect(folder).toBeDefined();
    expect(folder?.matrixConfig).toBeTruthy();
    expect(JSON.parse(folder!.matrixConfig!)).toEqual(defaultMatrixConfig);
  });

  it('defaults to matrix_mode=organization when org template exists', async () => {
    const organizationId = await createOrganization();
    const organizationTemplate = {
      ...defaultMatrixConfig,
      valueAxes: defaultMatrixConfig.valueAxes.map((axis) => ({
        ...axis,
        description: `${axis.description} (org template)`,
      })),
    };

    await db
      .update(organizations)
      .set({
        data: {
          industry: 'Tech',
          references: [],
          matrixTemplate: organizationTemplate,
        },
      })
      .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, user.workspaceId)));

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/use-cases/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        organization_id: organizationId,
        use_case_count: 1,
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('organization');
    expect(data.matrixJobId).toBeUndefined();

    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, data.folder_id), eq(folders.workspaceId, user.workspaceId)))
      .limit(1);
    expect(folder).toBeDefined();
    expect(JSON.parse(folder!.matrixConfig!)).toEqual(organizationTemplate);
  });

  it('defaults to matrix_mode=generate when org template is missing and enqueues matrix job', async () => {
    const organizationId = await createOrganization();

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/use-cases/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        organization_id: organizationId,
        use_case_count: 1,
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('generate');
    expect(data.matrixJobId).toBeDefined();
    expect(data.jobId).toBeDefined();

    const jobs = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.workspaceId, user.workspaceId));

    const useCaseListJob = jobs.find((job) => job.id === data.jobId);
    const matrixJob = jobs.find((job) => job.id === data.matrixJobId);
    expect(useCaseListJob?.type).toBe('usecase_list');
    expect(matrixJob?.type).toBe('matrix_generate');
  });

  it('rejects explicit matrix_mode=organization when organization has no template', async () => {
    const organizationId = await createOrganization();

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/use-cases/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        organization_id: organizationId,
        matrix_mode: 'organization',
      }
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe('Organization matrix template not found');
  });

  it('accepts explicit matrix_mode=default even when an org template exists', async () => {
    const organizationId = await createOrganization();
    const organizationTemplate = {
      ...defaultMatrixConfig,
      valueAxes: defaultMatrixConfig.valueAxes.map((axis) => ({
        ...axis,
        description: `${axis.description} (org template)`,
      })),
    };

    await db
      .update(organizations)
      .set({
        data: {
          industry: 'Tech',
          references: [],
          matrixTemplate: organizationTemplate,
        },
      })
      .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, user.workspaceId)));

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/use-cases/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        organization_id: organizationId,
        matrix_mode: 'default',
        use_case_count: 1,
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('default');
    expect(data.matrixJobId).toBeUndefined();

    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, data.folder_id), eq(folders.workspaceId, user.workspaceId)))
      .limit(1);
    expect(folder).toBeDefined();
    expect(JSON.parse(folder!.matrixConfig!)).toEqual(defaultMatrixConfig);
  });

  it('accepts explicit matrix_mode=generate when org template exists and enqueues matrix job', async () => {
    const organizationId = await createOrganization();
    await db
      .update(organizations)
      .set({
        data: {
          industry: 'Tech',
          references: [],
          matrixTemplate: defaultMatrixConfig,
        },
      })
      .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, user.workspaceId)));

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/use-cases/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        organization_id: organizationId,
        matrix_mode: 'generate',
        use_case_count: 1,
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('generate');
    expect(data.matrixJobId).toBeDefined();

    const jobs = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.workspaceId, user.workspaceId));
    const matrixJob = jobs.find((job) => job.id === data.matrixJobId);
    expect(matrixJob?.type).toBe('matrix_generate');
  });

  it('falls back to matrix_mode=default when explicit generate is sent without organization', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/use-cases/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        matrix_mode: 'generate',
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('default');
    expect(data.matrixJobId).toBeUndefined();
  });

  it('blocks usecase detail when matrix_generate failed for the folder (strict policy)', async () => {
    const organizationId = await createOrganization();
    const folderId = createTestId();
    const useCaseId = createTestId();

    await db.insert(folders).values({
      id: folderId,
      workspaceId: user.workspaceId!,
      name: `Matrix strict ${createTestId()}`,
      description: 'Folder waiting for generated matrix',
      organizationId,
      matrixConfig: null,
      status: 'generating',
      createdAt: new Date(),
    });

    await db.insert(useCases).values({
      id: useCaseId,
      workspaceId: user.workspaceId!,
      folderId,
      organizationId,
      status: 'generating',
      data: {
        name: 'Use case waiting matrix',
        description: 'Should fail before detail generation',
      },
      createdAt: new Date(),
    });

    await db.insert(jobQueue).values({
      id: createTestId(),
      type: 'matrix_generate',
      status: 'failed',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({ folderId, organizationId }),
      error: 'Matrix generation failed for strict-policy test',
      createdAt: new Date(),
    });

    await expect(
      (queueManager as unknown as {
        processUseCaseDetail: (data: Record<string, unknown>) => Promise<void>;
      }).processUseCaseDetail({
        useCaseId,
        useCaseName: 'Use case waiting matrix',
        folderId,
        matrixMode: 'generate',
        model: 'gpt-4.1-nano',
      })
    ).rejects.toThrow('Matrix generation failed for strict-policy test');
  });
});
