import { db, pool } from '../db/client';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { createId } from '../utils/id';
import { enrichOrganization, type OrganizationData } from './context-organization';
import {
  generateInitiativeList,
  generateInitiativeDetail,
  type InitiativeDetail,
  type InitiativeListItem,
} from './context-initiative';
import { generateOrganizationMatrixTemplate, mergeOrganizationMatrixTemplate } from './context-matrix';
import { parseMatrixConfig } from '../utils/matrix';
import { defaultMatrixConfig } from '../config/default-matrix';
import { opportunityMatrixConfig } from '../config/default-matrix-opportunity';
import type { MatrixConfig } from '../types/matrix';
import type { InitiativeData, InitiativeDataJson } from '../types/initiative';
import { validateScores, fixScores } from '../utils/score-validation';
import {
  comments,
  folders,
  organizations,
  initiatives,
  agentDefinitions,
  jobQueue,
  ADMIN_WORKSPACE_ID,
  type JobQueueRow,
  contextDocuments,
  contextModificationHistory,
  executionRuns,
  users,
  workflowDefinitionTasks,
  workflowRunState,
  workflowTaskTransitions,
  workflowTaskResults,
  workspaceMemberships,
} from '../db/schema';
import { settingsService } from './settings';
import { generateExecutiveSummary } from './executive-summary';
import { chatService } from './chat-service';
import type { VsCodeCodeAgentRuntimePayload } from './chat-service';
import type { StreamEventType } from './llm-runtime';
import {
  deleteObject,
  getDocumentsBucketName,
  getObjectBytes,
  headObject,
  putObject,
} from './storage-s3';
import { extractDocumentInfoFromDocument } from './document-text';
import { generateDocumentDetailedSummary, generateDocumentSummary, getDocumentDetailedSummaryPolicy } from './context-document';
import { getNextSequence, writeStreamEvent } from './stream-service';
import type { DocxEntityType, DocxTemplateId } from './docx-service';
import { runDocxGenerationInWorker } from './docx-render-worker';
import { generateFreeformDocx } from './docx-generation';
import type { CommentContextType } from './context-comments';
import { type AppLocale, normalizeLocale } from '../utils/locale';
import type { ProviderId } from './provider-runtime';

function parseOrgData(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonField<T = unknown>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

type WorkflowOrganizationTarget = {
  organizationId: string;
  organizationName: string;
  skipIfCompleted?: boolean;
  wasCreated?: boolean;
};

function readOrganizationTargets(value: unknown): WorkflowOrganizationTarget[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const organizationId =
        typeof item.organizationId === 'string' && item.organizationId.trim()
          ? item.organizationId.trim()
          : '';
      const organizationName =
        typeof item.organizationName === 'string' && item.organizationName.trim()
          ? item.organizationName.trim()
          : '';
      if (!organizationId || !organizationName) return null;
      return {
        organizationId,
        organizationName,
        skipIfCompleted: item.skipIfCompleted === true,
        wasCreated: item.wasCreated === true,
      } as WorkflowOrganizationTarget;
    })
    .filter((item): item is WorkflowOrganizationTarget => item !== null);
}

type WorkflowGeneratedInitiative = {
  id: string;
  name: string;
  description?: string;
  organizationIds?: string[];
  organizationName?: string;
};

function normalizeOrganizationName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readGeneratedInitiatives(value: unknown): WorkflowGeneratedInitiative[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!id || !name) return null;
      const organizationIds = readStringArray(item.organizationIds);
      const organizationName = normalizeOrganizationName(item.organizationName);
      const description = typeof item.description === 'string' && item.description.trim()
        ? item.description.trim()
        : undefined;
      return {
        id,
        name,
        description,
        organizationIds,
        organizationName: organizationName || undefined,
      } as WorkflowGeneratedInitiative;
    })
    .filter((item): item is WorkflowGeneratedInitiative => item !== null);
}

function jobDataToRecord(jobData: JobData): Record<string, unknown> {
  return isRecord(jobData) ? jobData : {};
}

function deepMergeState(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    const currentValue = next[key];
    if (isRecord(currentValue) && isRecord(patchValue)) {
      next[key] = deepMergeState(currentValue, patchValue);
      continue;
    }
    next[key] = patchValue;
  }
  return next;
}

type WorkflowTaskRuntimeStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

type WorkflowTaskCompletion = {
  output?: Record<string, unknown>;
  statePatch?: Record<string, unknown>;
  currentTaskKey?: string | null;
  currentTaskInstanceKey?: string | null;
  runStatus?: WorkflowTaskRuntimeStatus;
};

function parseGenerationWorkflowRuntimeContext(value: unknown): GenerationWorkflowRuntimeContext | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.workflowRunId !== 'string' || typeof record.workflowDefinitionId !== 'string') {
    return null;
  }
  if (typeof record.taskKey !== 'string' || !record.taskKey.trim()) {
    return null;
  }
  const toNullableString = (candidate: unknown): string | null =>
    typeof candidate === 'string' && candidate.trim() ? candidate : null;

  // Parse agentMap: Record<string, string> (task key → agent definition ID)
  const rawMap = record.agentMap;
  const agentMap: Record<string, string> = {};
  if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
    for (const [k, v] of Object.entries(rawMap as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) {
        agentMap[k] = v;
      }
    }
  }

  return {
    workflowRunId: record.workflowRunId,
    workflowDefinitionId: record.workflowDefinitionId,
    taskKey: record.taskKey,
    agentDefinitionId: toNullableString(record.agentDefinitionId),
    agentMap,
  };
}

type GenerationPromptOverride = {
  promptId: string;
  promptTemplate?: string;
  outputSchema?: Record<string, unknown>;
};

export const resolveGenerationPromptOverrideFromConfig = (
  rawConfig: unknown,
  fallbackPromptId: string,
): GenerationPromptOverride => {
  const config =
    rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
      ? (rawConfig as Record<string, unknown>)
      : {};
  const promptId =
    typeof config.promptId === 'string' && config.promptId.trim().length > 0
      ? config.promptId.trim()
      : fallbackPromptId;
  const promptTemplate =
    typeof config.promptTemplate === 'string' && config.promptTemplate.trim().length > 0
      ? config.promptTemplate
      : undefined;
  const outputSchema =
    config.outputSchema && typeof config.outputSchema === 'object' && !Array.isArray(config.outputSchema)
      ? (config.outputSchema as Record<string, unknown>)
      : undefined;
  return { promptId, promptTemplate, outputSchema };
};

function sanitizeJobResultForPublic(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const copy = { ...(result as Record<string, unknown>) };
  if (typeof copy.contentBase64 === 'string') {
    delete copy.contentBase64;
    copy.hasContent = true;
  }
  return copy;
}

function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeAutoGenerationSectionKeys(
  contextType: CommentContextType,
  sectionKeys: string[]
): string[] {
  return Array.from(
    new Set(
      sectionKeys
        .map((s) => {
          const sectionKey = String(s ?? '').trim();
          if (!sectionKey) return '';
          return contextType === 'initiative' && sectionKey.startsWith('data.')
            ? sectionKey.slice('data.'.length)
            : sectionKey;
        })
        .filter(Boolean)
    )
  );
}

export function buildGeneratedInitiativePayloadForPersistence(
  existingData: Partial<InitiativeData>,
  initiativeDetail: InitiativeDetail
): { initiativeData: InitiativeData; generatedInitiativeFields: string[] } {
  const initiativeData: InitiativeData = {
    name: existingData.name || initiativeDetail.name,
    description: existingData.description || initiativeDetail.description,
    problem: initiativeDetail.problem,
    solution: initiativeDetail.solution,
    domain: initiativeDetail.domain,
    technologies: initiativeDetail.technologies,
    deadline: initiativeDetail.leadtime,
    contact: initiativeDetail.contact,
    benefits: initiativeDetail.benefits,
    constraints: initiativeDetail.constraints,
    metrics: initiativeDetail.metrics,
    risks: initiativeDetail.risks,
    nextSteps: initiativeDetail.nextSteps,
    dataSources: initiativeDetail.dataSources,
    dataObjects: initiativeDetail.dataObjects,
    references: initiativeDetail.references || [],
    valueScores: initiativeDetail.valueScores,
    complexityScores: initiativeDetail.complexityScores
  };
  const generatedInitiativeFields = Object.keys(initiativeData)
    .filter((field) => {
      const beforeValue = (existingData as Record<string, unknown>)[field];
      const afterValue = (initiativeData as unknown as Record<string, unknown>)[field];
      return !isSameValue(beforeValue, afterValue);
    })
    .map((field) => `data.${field}`);

  return { initiativeData, generatedInitiativeFields };
}

export type JobType =
  | 'organization_enrich'
  | 'organization_batch_create'
  | 'organization_targets_join'
  | 'matrix_generate'
  | 'initiative_list'
  | 'initiative_detail'
  | 'executive_summary'
  | 'chat_message'
  | 'document_summary'
  | 'docx_generate';

export type MatrixMode = 'organization' | 'generate' | 'default';

export type GenerationWorkflowTaskKey = string;

export interface GenerationWorkflowRuntimeContext {
  workflowRunId: string;
  workflowDefinitionId: string;
  taskKey: string;
  agentDefinitionId: string | null;
  agentMap: Record<string, string>; // task key → agent definition ID
}

type WorkflowTaskExecutionDefinition = {
  taskKey: string;
  orderIndex: number;
  agentDefinitionId: string | null;
  metadata: Record<string, unknown>;
};

type WorkflowTransitionDefinition = {
  fromTaskKey: string | null;
  toTaskKey: string | null;
  transitionType: string;
  condition: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

type WorkflowRuntimeDefinition = {
  tasks: Map<string, WorkflowTaskExecutionDefinition>;
  transitions: WorkflowTransitionDefinition[];
  agentMap: Record<string, string>;
  agentIdsByKey: Record<string, string>;
};

type WorkflowDispatchDescriptor = {
  taskKey: string;
  taskInstanceKey: string;
  executor: string;
  jobType?: JobType;
  jobId?: string;
};

export interface OrganizationEnrichJobData {
  organizationId: string;
  organizationName: string;
  model?: string;
  initiatedByUserId?: string;
  locale?: string;
  workflow?: GenerationWorkflowRuntimeContext;
  skipIfCompleted?: boolean;
  wasCreated?: boolean;
}

export interface OrganizationBatchCreateJobData {
  folderId: string;
  input: string;
  model?: string;
  initiatedByUserId?: string;
  locale?: string;
  workflow?: GenerationWorkflowRuntimeContext;
}

export interface OrganizationTargetsJoinJobData {
  sourceTaskKey: string;
  initiatedByUserId?: string;
  locale?: string;
  workflow?: GenerationWorkflowRuntimeContext;
}

export interface MatrixGenerateJobData {
  folderId: string;
  input?: string;
  organizationId?: string;
  orgIds?: string[];
  matrixSource?: 'organization' | 'prompt' | 'default';
  model?: string;
  initiatedByUserId?: string;
  locale?: string;
  workflow?: GenerationWorkflowRuntimeContext;
}

export interface InitiativeListJobData {
  folderId: string;
  input: string;
  organizationId?: string;
  matrixMode?: MatrixMode;
  model?: string;
  initiativeCount?: number;
  initiatedByUserId?: string;
  locale?: string;
  workflow?: GenerationWorkflowRuntimeContext;
  /** Selected organization IDs for multi-org initiative generation (Lot 12) */
  orgIds?: string[];
}

export interface InitiativeDetailJobData {
  initiativeId: string;
  initiativeName: string;
  folderId: string;
  matrixMode?: MatrixMode;
  model?: string;
  initiatedByUserId?: string;
  locale?: string;
  workflow?: GenerationWorkflowRuntimeContext;
}

export interface ExecutiveSummaryJobData {
  folderId: string;
  valueThreshold?: number | null;
  complexityThreshold?: number | null;
  model?: string;
  initiatedByUserId?: string;
  locale?: string;
  workflow?: GenerationWorkflowRuntimeContext;
}

export interface ChatMessageJobData {
  userId: string;
  sessionId: string;
  assistantMessageId: string;
  providerId?: ProviderId;
  providerApiKey?: string;
  model?: string;
  // TODO Lot 10: remove 'usecase' once data migration is complete
  contexts?: Array<{ contextType: 'organization' | 'folder' | 'initiative' | 'executive_summary' | 'usecase'; contextId: string }>;
  tools?: string[];
  localToolDefinitions?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  vscodeCodeAgent?: VsCodeCodeAgentRuntimePayload;
  resumeFrom?: {
    previousResponseId: string;
    toolOutputs: Array<{ callId: string; output: string }>;
  };
  locale?: string;
}

export interface DocumentSummaryJobData {
  documentId: string;
  lang?: string; // default: 'fr'
  model?: string;
}

export interface DocxGenerateJobData {
  templateId?: DocxTemplateId;
  entityType: DocxEntityType;
  entityId: string;
  provided?: Record<string, unknown>;
  controls?: Record<string, unknown>;
  locale?: string;
  requestId?: string;
  sourceHash?: string;
  mode?: 'template' | 'freeform';
  code?: string;
}

export type JobData =
  | OrganizationEnrichJobData
  | OrganizationBatchCreateJobData
  | OrganizationTargetsJoinJobData
  | MatrixGenerateJobData
  | InitiativeListJobData
  | InitiativeDetailJobData
  | ExecutiveSummaryJobData
  | ChatMessageJobData
  | DocumentSummaryJobData
  | DocxGenerateJobData;

export interface Job {
  id: string;
  type: JobType;
  data: JobData;
  streamId: string;
  result?: unknown;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  workspaceId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export function getPublicJobStreamId(job: Pick<Job, 'id' | 'type' | 'data'>): string {
  const rawData = (job.data ?? {}) as unknown as Record<string, unknown>;
  if (job?.type === 'organization_enrich' && (job.data as OrganizationEnrichJobData | undefined)?.organizationId) {
    return `organization_${(job.data as OrganizationEnrichJobData).organizationId}`;
  }
  if (job?.type === 'initiative_list' && ((job.data as InitiativeListJobData | undefined)?.folderId || rawData.folder_id)) {
    const folderId =
      (job.data as InitiativeListJobData).folderId ??
      String(rawData.folder_id ?? '');
    return `folder_${folderId}`;
  }
  if (job?.type === 'matrix_generate' && ((job.data as MatrixGenerateJobData | undefined)?.folderId || rawData.folder_id)) {
    const folderId =
      (job.data as MatrixGenerateJobData).folderId ??
      String(rawData.folder_id ?? '');
    return `matrix_${folderId}`;
  }
  if (job?.type === 'initiative_detail' && ((job.data as InitiativeDetailJobData | undefined)?.initiativeId || rawData.use_case_id)) {
    const initiativeId =
      (job.data as InitiativeDetailJobData).initiativeId ??
      String(rawData.use_case_id ?? '');
    return `initiative_${initiativeId}`;
  }
  if (job?.type === 'executive_summary' && ((job.data as ExecutiveSummaryJobData | undefined)?.folderId || rawData.folder_id)) {
    const folderId =
      (job.data as ExecutiveSummaryJobData).folderId ??
      String(rawData.folder_id ?? '');
    return `folder_${folderId}`;
  }
  if (job?.type === 'document_summary' && ((job.data as DocumentSummaryJobData | undefined)?.documentId || rawData.document_id)) {
    const documentId =
      (job.data as DocumentSummaryJobData).documentId ??
      String(rawData.document_id ?? '');
    return `document_${documentId}`;
  }
  if (job?.type === 'chat_message' && typeof (job.data as { assistantMessageId?: unknown })?.assistantMessageId === 'string') {
    return String((job.data as { assistantMessageId: string }).assistantMessageId);
  }
  return `job_${job.id}`;
}

export class QueueManager {
  private isProcessing = false;
  private maxConcurrentJobs = 10; // AI queue class
  private maxPublishingJobs = 5; // Publishing queue class (docx, authoring, ...)
  private processingInterval = 1000; // Intervalle par défaut
  private paused = false;
  private cancelAllInProgress = false;
  private jobControllers: Map<string, AbortController> = new Map();

  constructor() {
    this.loadSettings();
  }

  private async notifyJobEvent(jobId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ job_id: jobId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY job_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private async notifyOrganizationEvent(organizationId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ organization_id: organizationId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY organization_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private async notifyFolderEvent(folderId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ folder_id: folderId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY folder_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private async notifyInitiativeEvent(initiativeId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ initiative_id: initiativeId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY initiative_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private async notifyCommentEvent(
    workspaceId: string,
    contextType: string,
    contextId: string,
    data: Record<string, unknown> = {}
  ): Promise<void> {
    const payload = JSON.stringify({ workspace_id: workspaceId, context_type: contextType, context_id: contextId, data });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY comment_events, '${payload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private getGenerationWorkflowContextForJobData(jobData: JobData): GenerationWorkflowRuntimeContext | null {
    if (!jobData || typeof jobData !== 'object') return null;
    return parseGenerationWorkflowRuntimeContext((jobData as { workflow?: unknown }).workflow);
  }

  private getWorkflowTaskInstanceKey(jobType: JobType, jobData: JobData): string {
    if (jobType === 'initiative_detail') {
      const initiativeId = (jobData as InitiativeDetailJobData | undefined)?.initiativeId;
      if (typeof initiativeId === 'string' && initiativeId.trim()) {
        return initiativeId;
      }
    }
    if (jobType === 'organization_enrich') {
      const organizationId = (jobData as OrganizationEnrichJobData | undefined)?.organizationId;
      if (typeof organizationId === 'string' && organizationId.trim()) {
        return organizationId;
      }
    }
    return 'main';
  }

  private getJobAttempt(jobData: JobData): number {
    const jobDataRecord = jobDataToRecord(jobData);
    const retry = isRecord(jobDataRecord._retry)
      ? (jobDataRecord._retry as Record<string, unknown>)
      : null;
    const attempt = retry && typeof retry.attempt === 'number' ? retry.attempt : 0;
    return Math.max(1, attempt + 1);
  }

  private async getWorkflowRunStateSnapshot(runId: string): Promise<{
    status: string;
    state: Record<string, unknown>;
    version: number;
    currentTaskKey: string | null;
    currentTaskInstanceKey: string | null;
  } | null> {
    const [row] = await db
      .select({
        status: workflowRunState.status,
        state: workflowRunState.state,
        version: workflowRunState.version,
        currentTaskKey: workflowRunState.currentTaskKey,
        currentTaskInstanceKey: workflowRunState.currentTaskInstanceKey,
      })
      .from(workflowRunState)
      .where(eq(workflowRunState.runId, runId))
      .limit(1);

    if (!row) return null;
    return {
      status: row.status,
      state: isRecord(row.state) ? row.state : {},
      version: row.version ?? 1,
      currentTaskKey: row.currentTaskKey ?? null,
      currentTaskInstanceKey: row.currentTaskInstanceKey ?? null,
    };
  }

  private async markExecutionRunStatus(
    runId: string,
    status: 'in_progress' | 'completed' | 'failed',
  ): Promise<void> {
    const now = new Date();
    await db
      .update(executionRuns)
      .set({
        status,
        completedAt: status === 'completed' || status === 'failed' ? now : null,
        updatedAt: now,
      })
      .where(eq(executionRuns.id, runId));
  }

  private async mergeWorkflowRunState(params: {
    runId: string;
    status?: WorkflowTaskRuntimeStatus;
    statePatch?: Record<string, unknown>;
    currentTaskKey?: string | null;
    currentTaskInstanceKey?: string | null;
  }): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.getWorkflowRunStateSnapshot(params.runId);
      if (!current) return;

      const nextState = params.statePatch ? deepMergeState(current.state, params.statePatch) : current.state;
      const now = new Date();
      const nextVersion = current.version + (params.statePatch ? 1 : 0);

      const updatedRows = await db
        .update(workflowRunState)
        .set({
          status: params.status ?? current.status,
          state: nextState,
          version: nextVersion,
          currentTaskKey:
            Object.prototype.hasOwnProperty.call(params, 'currentTaskKey')
              ? (params.currentTaskKey ?? null)
              : current.currentTaskKey,
          currentTaskInstanceKey:
            Object.prototype.hasOwnProperty.call(params, 'currentTaskInstanceKey')
              ? (params.currentTaskInstanceKey ?? null)
              : current.currentTaskInstanceKey,
          checkpointedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowRunState.runId, params.runId),
            eq(workflowRunState.version, current.version),
          ),
        )
        .returning({ runId: workflowRunState.runId });

      if (updatedRows.length > 0) {
        return;
      }
    }

    throw new Error(`Failed to merge workflow run state for ${params.runId} after concurrent updates`);
  }

  private async upsertWorkflowTaskResult(params: {
    workflow: GenerationWorkflowRuntimeContext;
    workspaceId: string;
    taskInstanceKey: string;
    status: WorkflowTaskRuntimeStatus;
    inputPayload?: Record<string, unknown>;
    output?: Record<string, unknown>;
    statePatch?: Record<string, unknown>;
    attempts?: number;
    lastError?: Record<string, unknown> | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
  }): Promise<void> {
    const now = new Date();
    const insertValues = {
      runId: params.workflow.workflowRunId,
      workspaceId: params.workspaceId,
      workflowDefinitionId: params.workflow.workflowDefinitionId,
      taskKey: params.workflow.taskKey,
      taskInstanceKey: params.taskInstanceKey,
      status: params.status,
      inputPayload: params.inputPayload ?? {},
      output: params.output ?? {},
      statePatch: params.statePatch ?? {},
      attempts: params.attempts ?? 1,
      lastError: params.lastError ?? null,
      startedAt: params.startedAt ?? now,
      completedAt: params.completedAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const updateSet = {
      status: params.status,
      inputPayload: params.inputPayload ?? {},
      output: params.output ?? {},
      statePatch: params.statePatch ?? {},
      attempts: params.attempts ?? 1,
      lastError: params.lastError ?? null,
      ...(params.startedAt !== undefined ? { startedAt: params.startedAt } : {}),
      ...(params.completedAt !== undefined ? { completedAt: params.completedAt } : {}),
      updatedAt: now,
    };
    await db
      .insert(workflowTaskResults)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [
          workflowTaskResults.runId,
          workflowTaskResults.taskKey,
          workflowTaskResults.taskInstanceKey,
        ],
        set: updateSet,
      });
  }

  private async markWorkflowTaskStarted(params: {
    workflow: GenerationWorkflowRuntimeContext;
    workspaceId: string;
    taskInstanceKey: string;
    jobData: JobData;
  }): Promise<void> {
    const startedAt = new Date();
    await this.upsertWorkflowTaskResult({
      workflow: params.workflow,
      workspaceId: params.workspaceId,
      taskInstanceKey: params.taskInstanceKey,
      status: 'in_progress',
      inputPayload: jobDataToRecord(params.jobData),
      output: {},
      statePatch: {},
      attempts: this.getJobAttempt(params.jobData),
      lastError: null,
      startedAt,
      completedAt: null,
    });
    await this.mergeWorkflowRunState({
      runId: params.workflow.workflowRunId,
      status: 'in_progress',
      currentTaskKey: params.workflow.taskKey,
      currentTaskInstanceKey: params.taskInstanceKey,
    });
    await this.markExecutionRunStatus(params.workflow.workflowRunId, 'in_progress');
  }

  private async completeWorkflowTask(params: {
    workflow: GenerationWorkflowRuntimeContext;
    workspaceId: string;
    taskInstanceKey: string;
    jobData: JobData;
    completion?: WorkflowTaskCompletion;
  }): Promise<void> {
    const completedAt = new Date();
    const output = params.completion?.output ?? {};
    const statePatch = params.completion?.statePatch ?? {};
    await this.upsertWorkflowTaskResult({
      workflow: params.workflow,
      workspaceId: params.workspaceId,
      taskInstanceKey: params.taskInstanceKey,
      status: 'completed',
      inputPayload: jobDataToRecord(params.jobData),
      output,
      statePatch,
      attempts: this.getJobAttempt(params.jobData),
      lastError: null,
      startedAt: undefined,
      completedAt,
    });
    await this.mergeWorkflowRunState({
      runId: params.workflow.workflowRunId,
      status: params.completion?.runStatus ?? 'in_progress',
      statePatch,
      currentTaskKey: params.completion?.currentTaskKey,
      currentTaskInstanceKey: params.completion?.currentTaskInstanceKey,
    });
    const nextRunStatus = params.completion?.runStatus ?? 'in_progress';
    if (nextRunStatus === 'completed') {
      await this.markExecutionRunStatus(params.workflow.workflowRunId, 'completed');
      return;
    }

    const runtimeState = await this.getWorkflowRunStateSnapshot(params.workflow.workflowRunId);
    if (!runtimeState) return;

    const runtimeDefinition = await this.loadWorkflowRuntimeDefinition(
      params.workspaceId,
      params.workflow.workflowDefinitionId,
    );
    const runContext = await this.getWorkflowRunContext(params.workflow.workflowRunId);
    await this.dispatchWorkflowTransitions({
      workspaceId: params.workspaceId,
      workflowRunId: params.workflow.workflowRunId,
      workflowDefinitionId: params.workflow.workflowDefinitionId,
      runtimeDefinition,
      runContext,
      state: runtimeState.state,
      fromTaskKey: params.workflow.taskKey,
    });
    await this.dispatchReadyWorkflowJoins({
      workspaceId: params.workspaceId,
      workflowRunId: params.workflow.workflowRunId,
      workflowDefinitionId: params.workflow.workflowDefinitionId,
      runtimeDefinition,
      runContext,
      state: runtimeState.state,
    });
  }

  private async failWorkflowTask(params: {
    workflow: GenerationWorkflowRuntimeContext;
    workspaceId: string;
    taskInstanceKey: string;
    jobData: JobData;
    error: unknown;
  }): Promise<void> {
    const completedAt = new Date();
    const errorPayload = {
      name: params.error instanceof Error ? params.error.name : 'Error',
      message: params.error instanceof Error ? params.error.message : String(params.error),
    };
    await this.upsertWorkflowTaskResult({
      workflow: params.workflow,
      workspaceId: params.workspaceId,
      taskInstanceKey: params.taskInstanceKey,
      status: 'failed',
      inputPayload: jobDataToRecord(params.jobData),
      output: {},
      statePatch: {},
      attempts: this.getJobAttempt(params.jobData),
      lastError: errorPayload,
      startedAt: undefined,
      completedAt,
    });
    await this.mergeWorkflowRunState({
      runId: params.workflow.workflowRunId,
      status: 'failed',
      currentTaskKey: params.workflow.taskKey,
      currentTaskInstanceKey: params.taskInstanceKey,
    });
    await this.markExecutionRunStatus(params.workflow.workflowRunId, 'failed');
  }

  private getPathValue(source: unknown, path: string): unknown {
    if (!path) return source;
    const segments = path.split('.').filter(Boolean);
    let current: unknown = source;
    for (const segment of segments) {
      if (!isRecord(current)) return undefined;
      current = current[segment];
    }
    return current;
  }

  private evaluateWorkflowCondition(condition: unknown, state: Record<string, unknown>): boolean {
    if (!isRecord(condition) || Object.keys(condition).length === 0) {
      return true;
    }
    if (Array.isArray(condition.all)) {
      return condition.all.every((entry) => this.evaluateWorkflowCondition(entry, state));
    }
    if (Array.isArray(condition.any)) {
      return condition.any.some((entry) => this.evaluateWorkflowCondition(entry, state));
    }
    if (condition.not !== undefined) {
      return !this.evaluateWorkflowCondition(condition.not, state);
    }
    const path = typeof condition.path === 'string' ? condition.path : '';
    const operator = typeof condition.operator === 'string' ? condition.operator : 'eq';
    const currentValue = path ? this.getPathValue(state, path) : undefined;
    switch (operator) {
      case 'eq':
        return currentValue === condition.value;
      case 'truthy':
        return Boolean(currentValue);
      case 'not_empty':
        if (Array.isArray(currentValue)) return currentValue.length > 0;
        if (typeof currentValue === 'string') return currentValue.trim().length > 0;
        return Boolean(currentValue);
      default:
        return false;
    }
  }

  private resolveWorkflowBindingValue(
    binding: unknown,
    context: {
      state: Record<string, unknown>;
      run: Record<string, unknown>;
      item?: unknown;
    },
  ): unknown {
    if (typeof binding === 'string') {
      if (binding === '$state') return context.state;
      if (binding.startsWith('$state.')) return this.getPathValue(context.state, binding.slice('$state.'.length));
      if (binding === '$run') return context.run;
      if (binding.startsWith('$run.')) return this.getPathValue(context.run, binding.slice('$run.'.length));
      if (binding === '$item') return context.item;
      if (binding.startsWith('$item.')) return this.getPathValue(context.item, binding.slice('$item.'.length));
      return binding;
    }
    if (Array.isArray(binding)) {
      return binding.map((entry) => this.resolveWorkflowBindingValue(entry, context));
    }
    if (isRecord(binding)) {
      return Object.fromEntries(
        Object.entries(binding).map(([key, value]) => [key, this.resolveWorkflowBindingValue(value, context)]),
      );
    }
    return binding;
  }

  private async loadWorkflowRuntimeDefinition(
    workspaceId: string,
    workflowDefinitionId: string,
  ): Promise<WorkflowRuntimeDefinition> {
    const [taskRows, transitionRows, agentRows] = await Promise.all([
      db
        .select({
          taskKey: workflowDefinitionTasks.taskKey,
          orderIndex: workflowDefinitionTasks.orderIndex,
          agentDefinitionId: workflowDefinitionTasks.agentDefinitionId,
          metadata: workflowDefinitionTasks.metadata,
        })
        .from(workflowDefinitionTasks)
        .where(
          and(
            eq(workflowDefinitionTasks.workspaceId, workspaceId),
            eq(workflowDefinitionTasks.workflowDefinitionId, workflowDefinitionId),
          ),
        )
        .orderBy(asc(workflowDefinitionTasks.orderIndex), asc(workflowDefinitionTasks.createdAt)),
      db
        .select({
          fromTaskKey: workflowTaskTransitions.fromTaskKey,
          toTaskKey: workflowTaskTransitions.toTaskKey,
          transitionType: workflowTaskTransitions.transitionType,
          condition: workflowTaskTransitions.condition,
          metadata: workflowTaskTransitions.metadata,
        })
        .from(workflowTaskTransitions)
        .where(
          and(
            eq(workflowTaskTransitions.workspaceId, workspaceId),
            eq(workflowTaskTransitions.workflowDefinitionId, workflowDefinitionId),
          ),
        )
        .orderBy(asc(workflowTaskTransitions.createdAt)),
      db
        .select({ key: agentDefinitions.key, id: agentDefinitions.id })
        .from(agentDefinitions)
        .where(eq(agentDefinitions.workspaceId, workspaceId)),
    ]);

    const tasks = new Map<string, WorkflowTaskExecutionDefinition>();
    const agentMap: Record<string, string> = {};
    for (const row of taskRows) {
      tasks.set(row.taskKey, {
        taskKey: row.taskKey,
        orderIndex: row.orderIndex,
        agentDefinitionId: row.agentDefinitionId ?? null,
        metadata: isRecord(row.metadata) ? row.metadata : {},
      });
      if (row.agentDefinitionId) {
        agentMap[row.taskKey] = row.agentDefinitionId;
      }
    }

    const agentIdsByKey: Record<string, string> = {};
    for (const row of agentRows) {
      agentIdsByKey[row.key] = row.id;
    }

    return {
      tasks,
      transitions: transitionRows.map((row) => ({
        fromTaskKey: row.fromTaskKey ?? null,
        toTaskKey: row.toTaskKey ?? null,
        transitionType: row.transitionType,
        condition: isRecord(row.condition) ? row.condition : {},
        metadata: isRecord(row.metadata) ? row.metadata : {},
      })),
      agentMap,
      agentIdsByKey,
    };
  }

  private async getWorkflowRunContext(runId: string): Promise<Record<string, unknown>> {
    const [runRow] = await db
      .select({
        startedByUserId: executionRuns.startedByUserId,
      })
      .from(executionRuns)
      .where(eq(executionRuns.id, runId))
      .limit(1);

    return {
      startedByUserId: runRow?.startedByUserId ?? null,
    };
  }

  private async getWorkflowTaskResultStatus(
    runId: string,
    taskKey: string,
    taskInstanceKey: string,
  ): Promise<WorkflowTaskRuntimeStatus | null> {
    const [row] = await db
      .select({ status: workflowTaskResults.status })
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, runId),
          eq(workflowTaskResults.taskKey, taskKey),
          eq(workflowTaskResults.taskInstanceKey, taskInstanceKey),
        ),
      )
      .limit(1);
    return (row?.status as WorkflowTaskRuntimeStatus | undefined) ?? null;
  }

  private async reserveWorkflowTaskDispatch(params: {
    workflowRunId: string;
    workflowDefinitionId: string;
    workspaceId: string;
    taskKey: string;
    taskInstanceKey: string;
    inputPayload: Record<string, unknown>;
  }): Promise<boolean> {
    const now = new Date();
    const inserted = await db
      .insert(workflowTaskResults)
      .values({
        runId: params.workflowRunId,
        workspaceId: params.workspaceId,
        workflowDefinitionId: params.workflowDefinitionId,
        taskKey: params.taskKey,
        taskInstanceKey: params.taskInstanceKey,
        status: 'pending',
        inputPayload: params.inputPayload,
        output: {},
        statePatch: {},
        attempts: 0,
        lastError: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          workflowTaskResults.runId,
          workflowTaskResults.taskKey,
          workflowTaskResults.taskInstanceKey,
        ],
      })
      .returning({ runId: workflowTaskResults.runId });

    return inserted.length > 0;
  }

  private buildWorkflowTaskInstanceKey(
    item: unknown,
    index: number,
    metadata: Record<string, unknown>,
    fallbackTaskKey: string,
  ): string {
    const fanout = isRecord(metadata.fanout) ? metadata.fanout : {};
    const configuredPath = typeof fanout.instanceKeyPath === 'string' ? fanout.instanceKeyPath : null;
    if (configuredPath) {
      const configuredValue = this.getPathValue(item, configuredPath);
      if (typeof configuredValue === 'string' && configuredValue.trim()) {
        return configuredValue.trim();
      }
    }
    if (isRecord(item)) {
      const candidateId = typeof item.id === 'string' ? item.id.trim() : '';
      if (candidateId) return candidateId;
      const candidateKey = typeof item.key === 'string' ? item.key.trim() : '';
      if (candidateKey) return candidateKey;
    }
    return `${fallbackTaskKey}:${index}`;
  }

  private async isWorkflowJoinTransitionReady(params: {
    workflowRunId: string;
    runtimeDefinition: WorkflowRuntimeDefinition;
    transition: WorkflowTransitionDefinition;
    state: Record<string, unknown>;
  }): Promise<boolean> {
    const join = isRecord(params.transition.metadata.join) ? params.transition.metadata.join : {};
    const requiredTaskKeys = Array.isArray(join.requiredTaskKeys)
      ? join.requiredTaskKeys.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];

    if (requiredTaskKeys.length > 0) {
      const completedMainRows = await db
        .select({ taskKey: workflowTaskResults.taskKey })
        .from(workflowTaskResults)
        .where(
          and(
            eq(workflowTaskResults.runId, params.workflowRunId),
            inArray(workflowTaskResults.taskKey, requiredTaskKeys),
            eq(workflowTaskResults.taskInstanceKey, 'main'),
            eq(workflowTaskResults.status, 'completed'),
          ),
        );
      const completedKeys = new Set(completedMainRows.map((row) => row.taskKey));
      return requiredTaskKeys.every((taskKey) => completedKeys.has(taskKey));
    }

    const joinedTaskKey =
      typeof join.taskKey === 'string' && join.taskKey.trim().length > 0
        ? join.taskKey
        : params.transition.fromTaskKey;
    if (!joinedTaskKey) return false;

    const completedRows = await db
      .select({ taskInstanceKey: workflowTaskResults.taskInstanceKey })
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, params.workflowRunId),
          eq(workflowTaskResults.taskKey, joinedTaskKey),
          eq(workflowTaskResults.status, 'completed'),
        ),
      );
    const completedInstanceKeys = new Set(
      completedRows
        .map((row) => row.taskInstanceKey?.trim())
        .filter((value): value is string => Boolean(value)),
    );

    const expectedSourcePath = typeof join.expectedSourcePath === 'string' ? join.expectedSourcePath : null;
    if (expectedSourcePath) {
      const expectedItems = this.getPathValue(params.state, expectedSourcePath);
      const allowEmpty = join.allowEmpty === true;
      if (!Array.isArray(expectedItems)) {
        return false;
      }
      if (expectedItems.length === 0) {
        return allowEmpty;
      }
      const upstreamFanoutTransition = params.runtimeDefinition.transitions.find(
        (transition) =>
          transition.transitionType === 'fanout' &&
          transition.toTaskKey === joinedTaskKey &&
          this.getPathValue(transition.metadata, 'fanout.sourcePath') === expectedSourcePath,
      );
      const instanceKeyMetadata = upstreamFanoutTransition?.metadata ?? params.transition.metadata;
      return expectedItems.every((item, index) =>
        completedInstanceKeys.has(
          this.buildWorkflowTaskInstanceKey(item, index, instanceKeyMetadata, joinedTaskKey),
        ),
      );
    }

    return completedInstanceKeys.has('main');
  }

  private resolveWorkflowTaskAgentDefinitionId(
    task: WorkflowTaskExecutionDefinition,
    state: Record<string, unknown>,
    agentIdsByKey: Record<string, string>,
  ): string | null {
    const metadata = isRecord(task.metadata) ? task.metadata : {};
    const selection = isRecord(metadata.agentSelection) ? metadata.agentSelection : null;
    if (!selection) {
      return task.agentDefinitionId;
    }
    const rules = Array.isArray(selection.rules) ? selection.rules : [];
    for (const rule of rules) {
      if (!isRecord(rule)) continue;
      if (!this.evaluateWorkflowCondition(rule.condition, state)) continue;
      const agentKey = typeof rule.agentKey === 'string' ? rule.agentKey : null;
      if (agentKey && agentIdsByKey[agentKey]) {
        return agentIdsByKey[agentKey];
      }
    }
    const defaultAgentKey = typeof selection.defaultAgentKey === 'string' ? selection.defaultAgentKey : null;
    if (defaultAgentKey && agentIdsByKey[defaultAgentKey]) {
      return agentIdsByKey[defaultAgentKey];
    }
    return task.agentDefinitionId;
  }

  private async dispatchWorkflowTask(params: {
    workspaceId: string;
    workflowRunId: string;
    workflowDefinitionId: string;
    runtimeDefinition: WorkflowRuntimeDefinition;
    runContext: Record<string, unknown>;
    state: Record<string, unknown>;
    taskKey: string;
    taskInstanceKey: string;
    item?: unknown;
  }): Promise<WorkflowDispatchDescriptor[]> {
    const task = params.runtimeDefinition.tasks.get(params.taskKey);
    if (!task) return [];

    const metadata = isRecord(task.metadata) ? task.metadata : {};
    const executor = typeof metadata.executor === 'string' ? metadata.executor : 'noop';
    const inputBindings = isRecord(metadata.inputBindings) ? metadata.inputBindings : {};
    const resolvedPayload = this.resolveWorkflowBindingValue(inputBindings, {
      state: params.state,
      run: params.runContext,
      item: params.item,
    });
    const inputPayload = isRecord(resolvedPayload) ? resolvedPayload : {};
    const agentDefinitionId = this.resolveWorkflowTaskAgentDefinitionId(
      task,
      params.state,
      params.runtimeDefinition.agentIdsByKey,
    );
    const workflowContext: GenerationWorkflowRuntimeContext = {
      workflowRunId: params.workflowRunId,
      workflowDefinitionId: params.workflowDefinitionId,
      taskKey: params.taskKey,
      agentDefinitionId,
      agentMap: {
        ...params.runtimeDefinition.agentMap,
        ...(agentDefinitionId ? { [params.taskKey]: agentDefinitionId } : {}),
      },
    };

    const existingStatus = await this.getWorkflowTaskResultStatus(
      params.workflowRunId,
      params.taskKey,
      params.taskInstanceKey,
    );
    if (existingStatus && existingStatus !== 'failed') {
      return [];
    }
    if (!existingStatus) {
      const reserved = await this.reserveWorkflowTaskDispatch({
        workflowRunId: params.workflowRunId,
        workflowDefinitionId: params.workflowDefinitionId,
        workspaceId: params.workspaceId,
        taskKey: params.taskKey,
        taskInstanceKey: params.taskInstanceKey,
        inputPayload,
      });
      if (!reserved) {
        return [];
      }
    }

    if (executor === 'noop') {
      const now = new Date();
      await this.upsertWorkflowTaskResult({
        workflow: workflowContext,
        workspaceId: params.workspaceId,
        taskInstanceKey: params.taskInstanceKey,
        status: 'completed',
        inputPayload,
        output: {},
        statePatch: {},
        attempts: 1,
        lastError: null,
        startedAt: now,
        completedAt: now,
      });
      await this.mergeWorkflowRunState({
        runId: params.workflowRunId,
        status: 'in_progress',
        currentTaskKey: params.taskKey,
        currentTaskInstanceKey: params.taskInstanceKey,
      });
      return this.dispatchWorkflowTransitions({
        workspaceId: params.workspaceId,
        workflowRunId: params.workflowRunId,
        workflowDefinitionId: params.workflowDefinitionId,
        runtimeDefinition: params.runtimeDefinition,
        runContext: params.runContext,
        state: params.state,
        fromTaskKey: params.taskKey,
      });
    }

    if (executor === 'job') {
      const jobType = typeof metadata.jobType === 'string' ? (metadata.jobType as JobType) : null;
      if (!jobType) {
        throw new Error(`Workflow task ${params.taskKey} is missing metadata.jobType`);
      }
      await this.upsertWorkflowTaskResult({
        workflow: workflowContext,
        workspaceId: params.workspaceId,
        taskInstanceKey: params.taskInstanceKey,
        status: 'pending',
        inputPayload,
        output: {},
        statePatch: {},
        attempts: 0,
        lastError: null,
        startedAt: null,
        completedAt: null,
      });
      let jobId: string;
      try {
        jobId = await this.addJob(
          jobType,
          {
            ...inputPayload,
            workflow: workflowContext,
          } as JobData,
          { workspaceId: params.workspaceId, maxRetries: 1 },
        );
      } catch (error) {
        await this.upsertWorkflowTaskResult({
          workflow: workflowContext,
          workspaceId: params.workspaceId,
          taskInstanceKey: params.taskInstanceKey,
          status: 'failed',
          inputPayload,
          output: {},
          statePatch: {},
          attempts: 0,
          lastError: {
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error),
          },
          startedAt: null,
          completedAt: new Date(),
        });
        throw error;
      }
      await this.mergeWorkflowRunState({
        runId: params.workflowRunId,
        status: 'in_progress',
        currentTaskKey: params.taskKey,
        currentTaskInstanceKey: params.taskInstanceKey,
      });
      return [{
        taskKey: params.taskKey,
        taskInstanceKey: params.taskInstanceKey,
        executor,
        jobType,
        jobId,
      }];
    }

    throw new Error(`Unsupported workflow executor "${executor}" for task ${params.taskKey}`);
  }

  private async dispatchWorkflowTransitions(params: {
    workspaceId: string;
    workflowRunId: string;
    workflowDefinitionId: string;
    runtimeDefinition: WorkflowRuntimeDefinition;
    runContext: Record<string, unknown>;
    state: Record<string, unknown>;
    fromTaskKey: string | null;
  }): Promise<WorkflowDispatchDescriptor[]> {
    const matchingTransitions = params.runtimeDefinition.transitions.filter(
      (transition) => transition.fromTaskKey === params.fromTaskKey,
    );
    const dispatched: WorkflowDispatchDescriptor[] = [];
    for (const transition of matchingTransitions) {
      const conditionMatches = this.evaluateWorkflowCondition(transition.condition, params.state);
      if (!conditionMatches) {
        continue;
      }
      if (transition.transitionType === 'end' || !transition.toTaskKey) {
        await this.mergeWorkflowRunState({
          runId: params.workflowRunId,
          status: 'completed',
          currentTaskKey: params.fromTaskKey,
          currentTaskInstanceKey: 'main',
        });
        await this.markExecutionRunStatus(params.workflowRunId, 'completed');
        continue;
      }
      if (transition.transitionType === 'fanout') {
        const fanout = isRecord(transition.metadata.fanout) ? transition.metadata.fanout : {};
        const sourcePath = typeof fanout.sourcePath === 'string' ? fanout.sourcePath : null;
        if (!sourcePath) {
          continue;
        }
        const sourceItems = this.getPathValue(params.state, sourcePath);
        if (!Array.isArray(sourceItems)) {
          continue;
        }
        for (const [index, item] of sourceItems.entries()) {
          dispatched.push(
            ...(await this.dispatchWorkflowTask({
              workspaceId: params.workspaceId,
              workflowRunId: params.workflowRunId,
              workflowDefinitionId: params.workflowDefinitionId,
              runtimeDefinition: params.runtimeDefinition,
              runContext: params.runContext,
              state: params.state,
              taskKey: transition.toTaskKey,
              taskInstanceKey: this.buildWorkflowTaskInstanceKey(
                item,
                index,
                transition.metadata,
                transition.toTaskKey,
              ),
              item,
            })),
          );
        }
        continue;
      }
      if (transition.transitionType === 'join') {
        const isReady = await this.isWorkflowJoinTransitionReady({
          workflowRunId: params.workflowRunId,
          runtimeDefinition: params.runtimeDefinition,
          transition,
          state: params.state,
        });
        if (!isReady) {
          continue;
        }
        dispatched.push(
          ...(await this.dispatchWorkflowTask({
            workspaceId: params.workspaceId,
            workflowRunId: params.workflowRunId,
            workflowDefinitionId: params.workflowDefinitionId,
            runtimeDefinition: params.runtimeDefinition,
            runContext: params.runContext,
            state: params.state,
            taskKey: transition.toTaskKey,
            taskInstanceKey: 'main',
          })),
        );
        continue;
      }
      dispatched.push(
        ...(await this.dispatchWorkflowTask({
          workspaceId: params.workspaceId,
          workflowRunId: params.workflowRunId,
          workflowDefinitionId: params.workflowDefinitionId,
          runtimeDefinition: params.runtimeDefinition,
          runContext: params.runContext,
          state: params.state,
          taskKey: transition.toTaskKey,
          taskInstanceKey: 'main',
        })),
      );
    }
    return dispatched;
  }

  private async dispatchReadyWorkflowJoins(params: {
    workspaceId: string;
    workflowRunId: string;
    workflowDefinitionId: string;
    runtimeDefinition: WorkflowRuntimeDefinition;
    runContext: Record<string, unknown>;
    state: Record<string, unknown>;
  }): Promise<WorkflowDispatchDescriptor[]> {
    const dispatched: WorkflowDispatchDescriptor[] = [];
    for (const transition of params.runtimeDefinition.transitions) {
      if (transition.transitionType !== 'join' || !transition.toTaskKey) {
        continue;
      }
      if (!this.evaluateWorkflowCondition(transition.condition, params.state)) {
        continue;
      }
      const isReady = await this.isWorkflowJoinTransitionReady({
        workflowRunId: params.workflowRunId,
        runtimeDefinition: params.runtimeDefinition,
        transition,
        state: params.state,
      });
      if (!isReady) {
        continue;
      }
      dispatched.push(
        ...(await this.dispatchWorkflowTask({
          workspaceId: params.workspaceId,
          workflowRunId: params.workflowRunId,
          workflowDefinitionId: params.workflowDefinitionId,
          runtimeDefinition: params.runtimeDefinition,
          runContext: params.runContext,
          state: params.state,
          taskKey: transition.toTaskKey,
          taskInstanceKey: 'main',
        })),
      );
    }
    return dispatched;
  }

  async dispatchWorkflowEntryTasks(params: {
    workspaceId: string;
    workflowRunId: string;
    workflowDefinitionId: string;
  }): Promise<WorkflowDispatchDescriptor[]> {
    const runtimeDefinition = await this.loadWorkflowRuntimeDefinition(
      params.workspaceId,
      params.workflowDefinitionId,
    );
    const runtimeState = await this.getWorkflowRunStateSnapshot(params.workflowRunId);
    if (!runtimeState) {
      throw new Error(`Workflow run state not found for ${params.workflowRunId}`);
    }
    const runContext = await this.getWorkflowRunContext(params.workflowRunId);
    return this.dispatchWorkflowTransitions({
      workspaceId: params.workspaceId,
      workflowRunId: params.workflowRunId,
      workflowDefinitionId: params.workflowDefinitionId,
      runtimeDefinition,
      runContext,
      state: runtimeState.state,
      fromTaskKey: null,
    });
  }

  private async resolveGenerationPromptOverride(
    workspaceId: string,
    agentDefinitionId: string | null | undefined,
    fallbackPromptId: string,
  ): Promise<GenerationPromptOverride> {
    if (!agentDefinitionId || !agentDefinitionId.trim()) {
      return { promptId: fallbackPromptId };
    }

    const [agent] = await db
      .select({
        config: agentDefinitions.config,
      })
      .from(agentDefinitions)
      .where(
        and(
          eq(agentDefinitions.workspaceId, workspaceId),
          eq(agentDefinitions.id, agentDefinitionId),
        ),
      )
      .limit(1);

    return resolveGenerationPromptOverrideFromConfig(
      agent?.config ?? {},
      fallbackPromptId,
    );
  }

  /**
   * Resolve the base matrix config from the agent definition's config.baseMatrixId.
   * Returns opportunityMatrixConfig when baseMatrixId is "opportunity", defaultMatrixConfig otherwise.
   */
  private async resolveBaseMatrixFromAgent(
    workspaceId: string,
    agentDefinitionId: string | null | undefined,
  ): Promise<MatrixConfig> {
    if (!agentDefinitionId || !agentDefinitionId.trim()) {
      return defaultMatrixConfig;
    }

    const [agent] = await db
      .select({ config: agentDefinitions.config })
      .from(agentDefinitions)
      .where(
        and(
          eq(agentDefinitions.workspaceId, workspaceId),
          eq(agentDefinitions.id, agentDefinitionId),
        ),
      )
      .limit(1);

    const config = agent?.config;
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      const baseMatrixId = (config as Record<string, unknown>).baseMatrixId;
      if (baseMatrixId === 'opportunity') {
        return opportunityMatrixConfig;
      }
    }

    return defaultMatrixConfig;
  }

  private getAutoGenerationFieldLabel(contextType: CommentContextType, sectionKey: string, locale: AppLocale): string {
    const key = String(sectionKey ?? '').trim();
    if (!key) return locale === 'en' ? 'General' : 'General';
    const labelByContext: Record<string, Record<string, { fr: string; en: string }>> = {
      usecase: {
        name: { fr: 'Nom', en: 'Name' },
        description: { fr: 'Description', en: 'Description' },
        problem: { fr: 'Probleme', en: 'Problem' },
        solution: { fr: 'Solution', en: 'Solution' },
        benefits: { fr: 'Benefices recherches', en: 'Target benefits' },
        constraints: { fr: 'Contraintes', en: 'Constraints' },
        metrics: { fr: 'Mesures du succes', en: 'Success metrics' },
        risks: { fr: 'Risques', en: 'Risks' },
        nextSteps: { fr: 'Prochaines etapes', en: 'Next steps' },
        technologies: { fr: 'Technologies', en: 'Technologies' },
        dataSources: { fr: 'Sources des donnees', en: 'Data sources' },
        dataObjects: { fr: 'Donnees', en: 'Data' },
        contact: { fr: 'Contact', en: 'Contact' },
        domain: { fr: 'Domaine', en: 'Domain' },
        deadline: { fr: 'Delai', en: 'Deadline' },
        valueScores: { fr: 'Axes de valeur', en: 'Value axes' },
        complexityScores: { fr: 'Axes de complexite', en: 'Complexity axes' },
      },
      organization: {
        name: { fr: 'Nom', en: 'Name' },
        industry: { fr: 'Secteur', en: 'Industry' },
        size: { fr: 'Taille', en: 'Size' },
        technologies: { fr: 'Technologies', en: 'Technologies' },
        products: { fr: 'Produits et Services', en: 'Products and services' },
        processes: { fr: 'Processus Metier', en: 'Business processes' },
        kpis: { fr: 'Indicateurs de performance', en: 'Performance indicators' },
        challenges: { fr: 'Defis Principaux', en: 'Key challenges' },
        objectives: { fr: 'Objectifs Strategiques', en: 'Strategic objectives' },
        references: { fr: 'References', en: 'References' },
      },
      folder: {
        name: { fr: 'Nom du dossier', en: 'Folder name' },
        description: { fr: 'Contexte', en: 'Context' },
      },
      executive_summary: {
        introduction: { fr: 'Introduction', en: 'Introduction' },
        analyse: { fr: 'Analyse', en: 'Analysis' },
        analysis: { fr: 'Analyse', en: 'Analysis' },
        recommandation: { fr: 'Recommandations', en: 'Recommendations' },
        recommendations: { fr: 'Recommandations', en: 'Recommendations' },
        synthese_executive: { fr: 'Synthese executive', en: 'Executive summary' },
        synthese: { fr: 'Synthese', en: 'Summary' },
        summary: { fr: 'Synthese', en: 'Summary' },
        references: { fr: 'References', en: 'References' },
      },
      matrix: {
        matrixConfig: { fr: 'Configuration de la matrice', en: 'Matrix configuration' },
        matrixTemplate: { fr: 'Modele de matrice', en: 'Matrix template' },
      },
    };
    const localized = labelByContext[contextType]?.[key];
    return localized ? (locale === 'en' ? localized.en : localized.fr) : key;
  }

  private formatAutoGenerationFieldComment(contextType: CommentContextType, sectionKey: string, locale: AppLocale): string {
    const localizedField = this.getAutoGenerationFieldLabel(contextType, sectionKey, locale);
    if (locale === 'en') {
      return `Field "${localizedField}" was generated by AI assistant. Please review and adjust if needed.`;
    }
    return `Le champ "${localizedField}" a ete genere par l'assistant IA. Merci de le verifier et de l'ajuster si necessaire.`;
  }

  private async resolveAutoGenerationCommentAuthorId(opts: {
    workspaceId: string;
    preferredUserId?: string | null | undefined;
  }): Promise<string | null> {
    const preferredUserId = (opts.preferredUserId ?? '').trim();
    if (preferredUserId) {
      const [preferredUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, preferredUserId))
        .limit(1);
      if (preferredUser?.id) return preferredUser.id;
    }

    const workspaceId = (opts.workspaceId ?? '').trim();
    if (!workspaceId) return null;

    const [fallbackMember] = await db
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, workspaceId))
      .limit(1);

    return (fallbackMember?.userId ?? '').trim() || null;
  }

  private async createAutoGenerationFieldComments(opts: {
    workspaceId: string;
    contextType: CommentContextType;
    contextId: string;
    sectionKeys: string[];
    createdBy: string | null | undefined;
    locale?: string;
  }): Promise<void> {
    const workspaceId = (opts.workspaceId ?? '').trim();
    const contextId = (opts.contextId ?? '').trim();
    const createdBy = await this.resolveAutoGenerationCommentAuthorId({
      workspaceId,
      preferredUserId: opts.createdBy
    });
    if (!workspaceId || !contextId || !createdBy) return;
    const locale = normalizeLocale(opts.locale) ?? 'fr';

    const uniqueSectionKeys = normalizeAutoGenerationSectionKeys(opts.contextType, opts.sectionKeys);
    for (const sectionKey of uniqueSectionKeys) {
      const now = new Date();
      const commentId = createId();
      await db.insert(comments).values({
        id: commentId,
        workspaceId,
        contextType: opts.contextType,
        contextId,
        sectionKey,
        createdBy,
        assignedTo: createdBy,
        status: 'open',
        threadId: createId(),
        content: this.formatAutoGenerationFieldComment(opts.contextType, sectionKey, locale),
        toolCallId: `auto_generation:${commentId}`,
        createdAt: now,
        updatedAt: now
      });
      await this.notifyCommentEvent(workspaceId, opts.contextType, contextId, { action: 'created', comment_id: commentId });
    }
  }

  private async hasAnyContextDocuments(
    workspaceId: string,
    contextType: 'organization' | 'folder' | 'initiative',
    contextId: string
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: contextDocuments.id })
      .from(contextDocuments)
      .where(and(eq(contextDocuments.workspaceId, workspaceId), eq(contextDocuments.contextType, contextType), eq(contextDocuments.contextId, contextId)))
      .limit(1);
    return Boolean(row?.id);
  }

  private async getDocumentsContextsForGeneration(opts: {
    workspaceId: string;
    folderId: string;
    organizationId?: string | null;
  }): Promise<Array<{ workspaceId: string; contextType: 'organization' | 'folder'; contextId: string }>> {
    const { workspaceId, folderId, organizationId } = opts;
    const contexts: Array<{ workspaceId: string; contextType: 'organization' | 'folder'; contextId: string }> = [];

    if (await this.hasAnyContextDocuments(workspaceId, 'folder', folderId)) {
      contexts.push({ workspaceId, contextType: 'folder', contextId: folderId });
    }
    if (organizationId && (await this.hasAnyContextDocuments(workspaceId, 'organization', organizationId))) {
      contexts.push({ workspaceId, contextType: 'organization', contextId: organizationId });
    }
    return contexts;
  }

  /**
   * Build a preloaded documents context (list + summaries) to inject in generation prompts.
   * Budget is enforced in characters to avoid overly large prompts.
   */
  private async buildDocumentsContextJsonForGeneration(opts: {
    workspaceId: string;
    contexts: Array<{ contextType: 'organization' | 'folder'; contextId: string }>;
    maxChars: number;
  }): Promise<string> {
    const { workspaceId, contexts, maxChars } = opts;
    if (!contexts || contexts.length === 0) return '';

    // Load docs from DB (summary is stored in context_documents.data.summary).
    const rows = await db.select({
      id: contextDocuments.id,
      contextType: contextDocuments.contextType,
      contextId: contextDocuments.contextId,
      filename: contextDocuments.filename,
      mimeType: contextDocuments.mimeType,
      status: contextDocuments.status,
      sizeBytes: contextDocuments.sizeBytes,
      createdAt: contextDocuments.createdAt,
      updatedAt: contextDocuments.updatedAt,
      data: contextDocuments.data,
    })
      .from(contextDocuments)
      .where(eq(contextDocuments.workspaceId, workspaceId));

    const allowed = new Set(contexts.map((c) => `${c.contextType}:${c.contextId}`));
    const candidates = rows
      .filter((r) => allowed.has(`${r.contextType}:${r.contextId}`))
      .map((r) => {
        const dataObj = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {};
        const summary = typeof dataObj.summary === 'string' ? dataObj.summary : '';
        return {
          id: r.id,
          contextType: r.contextType,
          contextId: r.contextId,
          filename: r.filename,
          mimeType: r.mimeType,
          status: r.status,
          sizeBytes: r.sizeBytes ?? null,
          updatedAt: (r.updatedAt ?? r.createdAt ?? null) ? new Date(r.updatedAt ?? r.createdAt ?? new Date()).toISOString() : null,
          summary,
        };
      })
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));

    const picked: Array<unknown> = [];
    let usedChars = 0;
    const reserve = 400; // headroom for wrapper fields
    const effectiveMax = Math.max(5_000, Math.floor(maxChars));

    for (const item of candidates) {
      const s = JSON.stringify(item);
      const next = usedChars + s.length + 2;
      if (next + reserve > effectiveMax) break;
      picked.push(item);
      usedChars = next;
    }

    const truncated = picked.length < candidates.length;
    const payload = {
      version: 1,
      limits: { maxChars: effectiveMax },
      truncated,
      items: picked,
    };
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Charger les paramètres de configuration
   */
  private async loadSettings(): Promise<void> {
    try {
      const settings = await settingsService.getAISettings();
      this.maxConcurrentJobs = settings.concurrency;
      this.maxPublishingJobs = settings.publishingConcurrency;
      this.processingInterval = settings.processingInterval;
      console.log(
        `🔧 Queue settings loaded: aiConcurrency=${this.maxConcurrentJobs}, publishingConcurrency=${this.maxPublishingJobs}, interval=${this.processingInterval}ms`
      );
    } catch (error) {
      console.warn('⚠️ Failed to load queue settings, using defaults:', error);
    }
  }

  /**
   * Recharger les paramètres de configuration
   */
  async reloadSettings(): Promise<void> {
    await this.loadSettings();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    if (!this.isProcessing) {
      this.processJobs().catch(console.error);
    }
  }

  async cancelAllProcessing(reason: string = 'cancel-all'): Promise<void> {
    this.cancelAllInProgress = true;
    for (const [, controller] of this.jobControllers.entries()) {
      try {
        controller.abort(new DOMException(reason, 'AbortError'));
      } catch {
        // Ignore abort errors if controller is already aborted
      }
    }
    await this.drain();
    this.cancelAllInProgress = false;
  }

  /**
   * Best-effort: cancel any in-flight jobs for a specific workspace.
   * This prevents leakage/cost when a user purges their own job history.
   */
  async cancelProcessingForWorkspace(workspaceId: string, reason: string = 'purge-mine'): Promise<void> {
    // Mark DB rows as failed first (best-effort) so other readers see them as cancelled.
    let processingIds: string[] = [];
    try {
      const rows = (await db.all(sql`
        SELECT id FROM job_queue
        WHERE status = 'processing' AND workspace_id = ${workspaceId}
      `)) as Array<{ id: string }>;
      processingIds = rows.map((r) => r.id);
    } catch (e) {
      console.warn('⚠️ Failed to load processing jobs for workspace cancellation:', e);
    }

    if (processingIds.length === 0) return;

    try {
      await db.run(sql`
        UPDATE job_queue
        SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error = ${`Job cancelled by ${reason}`}
        WHERE status = 'processing' AND workspace_id = ${workspaceId}
      `);
    } catch (e) {
      // ignore
    }

    for (const jobId of processingIds) {
      const controller = this.jobControllers.get(jobId);
      if (!controller) continue;
      try {
        controller.abort(new DOMException(reason, 'AbortError'));
      } catch {
        // ignore
      }
      try {
        await this.notifyJobEvent(jobId);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Annule un job spécifique (pending ou processing).
   * - chat_message => status "completed" (arrêt utilisateur).
   * - autres => status "failed".
   */
  async cancelJob(jobId: string, reason: string = 'cancelled'): Promise<{ status: string } | null> {
    const [row] = await db
      .select({ id: jobQueue.id, type: jobQueue.type, status: jobQueue.status })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    if (!row) return null;

    const isChat = row.type === 'chat_message';
    const nextStatus = isChat ? 'completed' : 'failed';
    await db.run(sql`
      UPDATE job_queue
      SET status = ${nextStatus},
          completed_at = ${new Date()},
          error = ${`Job cancelled: ${reason}`}
      WHERE id = ${jobId}
    `);
    await this.notifyJobEvent(jobId);

    const controller = this.jobControllers.get(jobId);
    if (controller) {
      try {
        controller.abort(new DOMException(reason, 'AbortError'));
      } catch {
        // ignore
      }
    }

    return { status: nextStatus };
  }

  async drain(timeoutMs: number = 10000): Promise<void> {
    const start = Date.now();
    while (this.jobControllers.size > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private queueClassSqlExpr(): string {
    return `
      CASE type
        WHEN 'docx_generate' THEN 'publishing'
        WHEN 'chat_message' THEN 'chat'
        ELSE 'ai'
      END
    `;
  }

  /**
   * Ajouter un job à la queue
   */
  async addJob(
    type: JobType,
    data: JobData,
    opts?: {
      workspaceId?: string;
      /**
       * Max number of retries after the initial attempt.
       * - 0 => 1 total attempt (default)
       * - 1 => up to 2 total attempts
       */
      maxRetries?: number;
    }
  ): Promise<string> {
    if (this.cancelAllInProgress || this.paused) {
      console.warn(`⏸️ Queue paused/cancelling, refusing to enqueue job ${type}`);
      throw new Error('Queue is paused or cancelling; job not accepted');
    }
    const jobId = createId();
    const workspaceId = opts?.workspaceId ?? ADMIN_WORKSPACE_ID;
    const maxRetries = Number.isFinite(opts?.maxRetries as number) ? Number(opts?.maxRetries) : 0;
    const payload = {
      ...(data as unknown as Record<string, unknown>),
      _retry: {
        attempt: 0,
        maxRetries: Math.max(0, Math.floor(maxRetries)),
      },
    };
    
    await db.run(sql`
      INSERT INTO job_queue (id, type, data, status, created_at, workspace_id)
      VALUES (${jobId}, ${type}, ${JSON.stringify(payload)}, 'pending', ${new Date()}, ${workspaceId})
    `);
    await this.notifyJobEvent(jobId);
    
    console.log(`📝 Job ${jobId} (${type}) added to queue`);
    
    // Démarrer le traitement si pas déjà en cours
    if (!this.isProcessing) {
      this.processJobs().catch(console.error);
    }
    
    return jobId;
  }

  /**
   * Traiter les jobs en attente
   */
  async processJobs(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    if (this.paused) {
      console.log('⏸️ Queue is paused; aborting processJobs start');
      return;
    }

    this.isProcessing = true;
    console.log('🚀 Starting job processing...');

    try {
      const inFlight = new Set<Promise<void>>();
      const queueClassExpr = sql.raw(this.queueClassSqlExpr());
      const queueClasses: Array<'ai' | 'chat' | 'publishing'> = ['chat', 'publishing', 'ai'];

      const sleep = async (ms: number) => new Promise((r) => setTimeout(r, ms));

      const getProcessingCountByClass = async (
        queueClass: 'ai' | 'chat' | 'publishing'
      ): Promise<number> => {
        try {
          const rows = (await db.all(sql`
            SELECT COUNT(*)::int AS count
            FROM job_queue
            WHERE status = 'processing'
              AND ${queueClassExpr} = ${queueClass}
          `)) as Array<{ count: number }>;
          return rows?.[0]?.count ?? 0;
        } catch {
          return 0;
        }
      };

      const hasAnyPending = async (): Promise<boolean> => {
        const rows = await db
          .select({ id: sql<string>`id` })
          .from(jobQueue)
          .where(eq(jobQueue.status, 'pending'))
          .limit(1);
        return rows.length > 0;
      };

      const claimPendingJobsByClass = async (
        queueClass: 'ai' | 'chat' | 'publishing',
        limit: number
      ): Promise<JobQueueRow[]> => {
        if (limit <= 0) return [];
        const orderByExpr =
          queueClass === 'ai'
            ? sql.raw(
                "CASE type WHEN 'chat_message' THEN 0 WHEN 'matrix_generate' THEN 1 WHEN 'initiative_list' THEN 1 ELSE 2 END, created_at ASC"
              )
            : sql.raw('created_at ASC');
        const now = new Date();
        const rows = (await db.all(sql`
          WITH picked AS (
            SELECT id
            FROM job_queue
            WHERE status = 'pending'
              AND ${queueClassExpr} = ${queueClass}
            ORDER BY ${orderByExpr}
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE job_queue q
          SET status = 'processing', started_at = ${now}
          FROM picked
          WHERE q.id = picked.id
          RETURNING
            q.id AS "id",
            q.type AS "type",
            q.status AS "status",
            q.workspace_id AS "workspaceId",
            q.data AS "data",
            q.result AS "result",
            q.error AS "error",
            q.created_at AS "createdAt",
            q.started_at AS "startedAt",
            q.completed_at AS "completedAt"
        `)) as JobQueueRow[];
        return rows ?? [];
      };

      while (!this.paused) {
        if (this.cancelAllInProgress) break;

        for (const queueClass of queueClasses) {
          const classLimit = queueClass === 'publishing' ? this.maxPublishingJobs : this.maxConcurrentJobs;
          const classProcessing = await getProcessingCountByClass(queueClass);
          const slots = Math.max(0, classLimit - classProcessing);
          if (slots <= 0) continue;

          const claimedJobs = await claimPendingJobsByClass(queueClass, slots);
          for (const job of claimedJobs) {
            await this.notifyJobEvent(job.id);
            const p = this.processJob(job).finally(() => {
              inFlight.delete(p);
            });
            inFlight.add(p);
          }
        }

        // If nothing is running and nothing is pending, we're done.
        if (inFlight.size === 0) {
          const more = await hasAnyPending();
          if (!more) break;
          // No local work but pending exists: either slots=0 (global limit reached) or a race. Wait briefly.
          await sleep(200);
          continue;
        }

        // Wait for at least one job to finish, then continue filling.
        // IMPORTANT: do not block indefinitely on long-running jobs.
        // New jobs can be enqueued while we are waiting; we must periodically wake up to claim
        // additional pending jobs (up to the configured global concurrency).
        await Promise.race([Promise.race(inFlight), sleep(this.processingInterval)]);
      }
    } finally {
      this.isProcessing = false;
      console.log('✅ Job processing completed');
    }
  }

  /**
   * Traiter un job individuel
   */
  private async processJob(job: JobQueueRow): Promise<void> {
    const jobId = job.id;
    const jobType = job.type as JobType;
    const jobData = JSON.parse(job.data) as JobData;
    const workflow = this.getGenerationWorkflowContextForJobData(jobData);
    const workflowTaskInstanceKey = this.getWorkflowTaskInstanceKey(jobType, jobData);
    const workspaceId = job.workspaceId ?? ADMIN_WORKSPACE_ID;

    const getRetryMeta = (value: unknown): { attempt: number; maxRetries: number } => {
      if (!value || typeof value !== 'object') return { attempt: 0, maxRetries: 0 };
      const retry = (value as { _retry?: unknown })._retry;
      if (!retry || typeof retry !== 'object') return { attempt: 0, maxRetries: 0 };
      const attemptRaw = (retry as { attempt?: unknown }).attempt;
      const maxRaw = (retry as { maxRetries?: unknown }).maxRetries;
      const attempt = typeof attemptRaw === 'number' && Number.isFinite(attemptRaw) ? attemptRaw : Number(attemptRaw);
      const maxRetries = typeof maxRaw === 'number' && Number.isFinite(maxRaw) ? maxRaw : Number(maxRaw);
      return {
        attempt: Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0,
        maxRetries: Number.isFinite(maxRetries) ? Math.max(0, Math.floor(maxRetries)) : 0,
      };
    };

    const { attempt: retryAttempt, maxRetries: retryMax } = getRetryMeta(jobData);

    const isAbort = (err: unknown): boolean => {
      if (!err) return false;
      if (err instanceof DOMException && err.name === 'AbortError') return true;
      if (err instanceof Error && err.name === 'AbortError') return true;
      const msg = err instanceof Error ? err.message : String(err);
      return msg.includes('AbortError') || msg.includes('aborted') || msg.includes('Request was aborted');
    };

    const isRetryableInitiativeError = (err: unknown): boolean => {
      const msg = err instanceof Error ? err.message : String(err);
      const lowerMsg = msg.toLowerCase();
      // JSON/format issues (LLM returned non-JSON or concatenated junk)
      if (msg.includes('Erreur lors du parsing') || msg.includes('Invalid JSON') || msg.includes('Unexpected non-whitespace character') || msg.includes('No JSON object boundaries')) {
        return true;
      }
      // Missing scores arrays leading to validateScores crash
      if (msg.includes("Cannot read properties of undefined (reading 'map')")) {
        return true;
      }
      // Transient network/OpenAI-ish issues (best-effort)
      if (
        msg.includes('429') ||
        lowerMsg.includes('rate limit') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('ENOTFOUND')
      ) {
        return true;
      }
      return false;
    };

    const isRetryableWorkflowError = (err: unknown): boolean => {
      if (isRetryableInitiativeError(err)) {
        return true;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const lowerMsg = msg.toLowerCase();
      return (
        lowerMsg.includes('aborterror') ||
        lowerMsg.includes('terminated') ||
        lowerMsg.includes('stream aborted') ||
        lowerMsg.includes('aborted') ||
        lowerMsg.includes('timed out') ||
        lowerMsg.includes('timeout') ||
        lowerMsg.includes('temporarily unavailable') ||
        lowerMsg.includes('upstream') ||
        lowerMsg.includes('overloaded') ||
        lowerMsg.includes('econnreset') ||
        lowerMsg.includes('etimedout') ||
        lowerMsg.includes('enotfound')
      );
    };

    let controller: AbortController | null = null;

    try {
      console.log(`🔄 Processing job ${jobId} (${jobType})`);

      // Safety: the job may have been purged between claim and processing start.
      // Also protects against any unexpected double-processing: only proceed if job is still processing.
      const [current] = await db
        .select({ status: jobQueue.status })
        .from(jobQueue)
        .where(eq(jobQueue.id, jobId))
        .limit(1);
      if (!current || current.status !== 'processing') {
        console.log(`⏭️ Skipping job ${jobId}: missing or not processing (likely purged/claimed elsewhere)`);
        return;
      }

      controller = new AbortController();
      this.jobControllers.set(jobId, controller);

      if (workflow) {
        await this.markWorkflowTaskStarted({
          workflow,
          workspaceId,
          taskInstanceKey: workflowTaskInstanceKey,
          jobData,
        });
      }

      // Traiter selon le type
      let workflowCompletion: WorkflowTaskCompletion | undefined;
      switch (jobType) {
        case 'organization_enrich':
          workflowCompletion = (await this.processOrganizationEnrich(
            jobData as OrganizationEnrichJobData,
            jobId,
            controller.signal,
          )) ?? undefined;
          break;
        case 'organization_batch_create':
          workflowCompletion = (await this.processOrganizationBatchCreate(
            jobData as OrganizationBatchCreateJobData,
            controller.signal,
          )) ?? undefined;
          break;
        case 'organization_targets_join':
          workflowCompletion = (await this.processOrganizationTargetsJoin(
            jobData as OrganizationTargetsJoinJobData,
            controller.signal,
          )) ?? undefined;
          break;
        case 'matrix_generate':
          workflowCompletion = (await this.processMatrixGenerate(jobData as MatrixGenerateJobData, controller.signal)) ?? undefined;
          break;
        case 'initiative_list':
          workflowCompletion = (await this.processInitiativeList(jobData as InitiativeListJobData, controller.signal)) ?? undefined;
          break;
        case 'initiative_detail':
          workflowCompletion = (await this.processInitiativeDetail(jobData as InitiativeDetailJobData, controller.signal)) ?? undefined;
          break;
        case 'executive_summary':
          workflowCompletion = (await this.processExecutiveSummary(jobData as ExecutiveSummaryJobData, controller.signal)) ?? undefined;
          break;
        case 'chat_message':
          await this.processChatMessage(jobData as ChatMessageJobData, controller.signal);
          break;
        case 'document_summary':
          await this.processDocumentSummary(
            jobData as DocumentSummaryJobData,
            jobId,
            controller.signal
          );
          break;
        case 'docx_generate':
          await this.processDocxGenerate(
            jobData as DocxGenerateJobData,
            jobId,
            controller.signal
          );
          break;
        default:
          throw new Error(`Unknown job type: ${jobType}`);
      }

      if (workflow) {
        await this.completeWorkflowTask({
          workflow,
          workspaceId,
          taskInstanceKey: workflowTaskInstanceKey,
          jobData,
          completion: workflowCompletion,
        });
      }

      // Marquer comme terminé
      await db.run(sql`
        UPDATE job_queue 
        SET status = 'completed', completed_at = ${new Date()}
        WHERE id = ${jobId}
      `);
      await this.notifyJobEvent(jobId);

      console.log(`✅ Job ${jobId} completed successfully`);
    } catch (error) {
      console.error(`❌ Job ${jobId} failed:`, error);

      // Retry logic (bounded) for workflow jobs on transient/provider failures.
      // IMPORTANT: only suppress retries for explicit local cancellations.
      const wasCancelledLocally = controller?.signal.aborted === true;
      if (workflow && retryMax > 0 && retryAttempt < retryMax && !wasCancelledLocally && isRetryableWorkflowError(error)) {
        const nextAttempt = retryAttempt + 1;
        const jobDataRecord = jobDataToRecord(jobData);
        const nextData =
          jobData && typeof jobData === 'object'
            ? { ...jobDataRecord, _retry: { attempt: nextAttempt, maxRetries: retryMax } }
            : { _retry: { attempt: nextAttempt, maxRetries: retryMax } };
        const msg = error instanceof Error ? error.message : 'Unknown error';
        await this.upsertWorkflowTaskResult({
          workflow,
          workspaceId,
          taskInstanceKey: workflowTaskInstanceKey,
          status: 'pending',
          inputPayload: nextData,
          output: {},
          statePatch: {},
          attempts: retryAttempt + 1,
          lastError: {
            name: error instanceof Error ? error.name : 'Error',
            message: msg,
          },
          startedAt: null,
          completedAt: null,
        });
        await db.run(sql`
          UPDATE job_queue
          SET status = 'pending',
              data = ${JSON.stringify(nextData)},
              error = ${`retry ${nextAttempt}/${retryMax}: ${msg}`},
              started_at = NULL,
              completed_at = NULL
          WHERE id = ${jobId}
        `);
        await this.notifyJobEvent(jobId);
        console.warn(`🔁 Retrying job ${jobId} (${jobType}) attempt ${nextAttempt}/${retryMax}`);
        return;
      }

      if (workflow) {
        await this.failWorkflowTask({
          workflow,
          workspaceId,
          taskInstanceKey: workflowTaskInstanceKey,
          jobData,
          error,
        });
      }

      // Annulation utilisateur: pour le chat, on finalise avec le contenu partiel.
      if (jobType === 'chat_message' && isAbort(error)) {
        const assistantMessageId =
          typeof (jobData as { assistantMessageId?: unknown })?.assistantMessageId === 'string'
            ? ((jobData as { assistantMessageId: string }).assistantMessageId as string)
            : null;
        if (assistantMessageId) {
          try {
            await chatService.finalizeAssistantMessageFromStream({
              assistantMessageId,
              reason: error instanceof Error ? error.message : 'cancelled',
              fallbackContent: 'Réponse interrompue.'
            });
          } catch {
            // ignore
          }
        }

        await db.run(sql`
          UPDATE job_queue 
          SET status = 'completed', completed_at = ${new Date()}, error = ${error instanceof Error ? error.message : 'cancelled'}
          WHERE id = ${jobId}
        `);
        await this.notifyJobEvent(jobId);
        return;
      }
      
      // Marquer comme échoué
      await db.run(sql`
        UPDATE job_queue 
        SET status = 'failed', error = ${error instanceof Error ? error.message : 'Unknown error'}
        WHERE id = ${jobId}
      `);
      await this.notifyJobEvent(jobId);

      // Best-effort: also propagate failure to context_documents for document_summary jobs,
      // so the UI can show `failed` without having to inspect job_queue.
      if (jobType === 'document_summary') {
        try {
          const docId =
            typeof (jobData as { documentId?: unknown })?.documentId === 'string'
              ? (jobData as { documentId: string }).documentId
              : null;
          if (docId) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            const safe = this.sanitizePgText(`Échec: ${msg}`).slice(0, 5000);
            await db.run(sql`
              UPDATE context_documents
              SET status = 'failed',
                  data = jsonb_set(coalesce(data, '{}'::jsonb), '{summary}', to_jsonb(${safe}), true),
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ${docId}
            `);

            // Best-effort: also stream an error for observers (streamId derived from documentId).
            const streamId = `document_${docId}`;
            const seq = await getNextSequence(streamId);
            await writeStreamEvent(streamId, 'error', { message: msg }, seq);
          }
        } catch {
          // ignore
        }
      }
    } finally {
      this.jobControllers.delete(jobId);
    }
  }

  /**
   * Worker pour l'enrichissement d'organisation
   */
  private async processOrganizationEnrich(
    data: OrganizationEnrichJobData,
    jobId: string,
    signal?: AbortSignal,
  ): Promise<WorkflowTaskCompletion | void> {
    const { organizationId, organizationName, model, initiatedByUserId, locale, skipIfCompleted, wasCreated } = data;
    
    // Générer un streamId pour le streaming
    // IMPORTANT:
    // Pour l'enrichissement organisation, on veut pouvoir suivre l'avancement côté UI avec uniquement l'organizationId
    // (les job_update peuvent être restreints). Donc on utilise un streamId déterministe basé sur l'entreprise.
    const streamId = `organization_${organizationId}`;
    
    // Fetch current org row (needed for workspace scope + preserve user-entered fields)
    const [existingOrg] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const workspaceId = typeof existingOrg?.workspaceId === 'string' ? existingOrg.workspaceId : '';
    const existingData = parseOrgData(existingOrg?.data);
    const effectiveName = (existingOrg?.name || organizationName || '').trim() || organizationName;

    if (skipIfCompleted && existingOrg?.status === 'completed') {
      return {
        output: {
          organizationId,
          organizationName: effectiveName,
          wasCreated: wasCreated === true,
          skipped: true,
        },
      };
    }

    // Only expose documents tool if this organization has attached documents.
    const hasOrgDocs = await (async () => {
      if (!workspaceId) return false;
      const rows = await db
        .select({ id: sql<string>`id` })
        .from(contextDocuments)
        .where(
          and(
            eq(contextDocuments.workspaceId, workspaceId),
            eq(contextDocuments.contextType, 'organization'),
            eq(contextDocuments.contextId, organizationId)
          )
        )
        .limit(1);
      return rows.length > 0;
    })();

    // Enrichir l'organisation avec streaming.
    // IMPORTANT: `documents` tool is enabled only when docs exist; otherwise the model must not call it.
    const enrichedData: OrganizationData = await enrichOrganization(effectiveName, model, signal, streamId, {
      organizationId,
      workspaceId,
      existingData,
      useDocuments: hasOrgDocs
    });

    // Safety: PostgreSQL text/json cannot contain NUL (\u0000). Strip control chars before DB write.
    const sanitizePgText = (input: string): string => {
      let out = '';
      for (let i = 0; i < input.length; i += 1) {
        const code = input.charCodeAt(i);
        if (code === 0) continue;
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
        out += input[i];
      }
      return out;
    };
    const clean = (s: string) => sanitizePgText(typeof s === 'string' ? s : String(s ?? ''));
    const cleanedReferences: Array<{ title: string; url: string; excerpt: string | undefined }> = Array.isArray(enrichedData.references)
      ? enrichedData.references
          .map((r) => ({
            title: clean(r.title),
            url: clean(r.url),
            excerpt: r.excerpt ? clean(r.excerpt) : undefined,
          }))
          .filter((r) => r.title.trim() && r.url.trim())
      : [];
    const cleanedData: OrganizationData = {
      industry: clean(enrichedData.industry),
      size: clean(enrichedData.size),
      products: clean(enrichedData.products),
      processes: clean(enrichedData.processes),
      kpis: clean(enrichedData.kpis),
      challenges: clean(enrichedData.challenges),
      objectives: clean(enrichedData.objectives),
      technologies: clean(enrichedData.technologies),
      references: cleanedReferences,
    };
    
    // Merge: preserve user-entered fields already present in organizations.data.
    const pickStr = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const keepIfFilled = (existing: unknown, next: string) => (pickStr(existing) ? pickStr(existing) : next);
    const mergeRefs = (
      existingRefs: unknown,
      nextRefs: Array<{ title: string; url: string; excerpt: string | undefined }>
    ): Array<{ title: string; url: string; excerpt: string | undefined }> => {
      const base = Array.isArray(existingRefs)
        ? existingRefs
            .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : null))
            .filter((r): r is Record<string, unknown> => !!r)
            .map((r) => ({
              title: clean(typeof r.title === 'string' ? r.title : String(r.title ?? '')),
              url: clean(typeof r.url === 'string' ? r.url : String(r.url ?? '')),
              excerpt: typeof r.excerpt === 'string' ? clean(r.excerpt) : undefined,
            }))
            .filter((r) => r.title.trim() && r.url.trim())
        : [];
      const byUrl = new Set(base.map((r) => r.url));
      const merged = [...base];
      for (const r of nextRefs || []) {
        if (!r?.url) continue;
        if (byUrl.has(r.url)) continue;
        merged.push({ title: r.title, url: r.url, excerpt: r.excerpt });
        byUrl.add(r.url);
      }
      return merged;
    };

    const mergedData: OrganizationData = {
      industry: keepIfFilled(existingData.industry, cleanedData.industry),
      size: keepIfFilled(existingData.size, cleanedData.size),
      products: keepIfFilled(existingData.products, cleanedData.products),
      processes: keepIfFilled(existingData.processes, cleanedData.processes),
      kpis: keepIfFilled(existingData.kpis, cleanedData.kpis),
      challenges: keepIfFilled(existingData.challenges, cleanedData.challenges),
      objectives: keepIfFilled(existingData.objectives, cleanedData.objectives),
      technologies: keepIfFilled(existingData.technologies, cleanedData.technologies),
      references: mergeRefs(existingData.references, cleanedReferences),
    };
    const generatedOrganizationFields = Object.keys(mergedData).filter((field) => {
      const beforeValue = (existingData as Record<string, unknown>)[field];
      const afterValue = (mergedData as unknown as Record<string, unknown>)[field];
      return !isSameValue(beforeValue, afterValue);
    });

    // Store enriched profile in organizations.data JSONB
    await db
      .update(organizations)
      .set({
        data: mergedData,
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId));

    await this.notifyOrganizationEvent(organizationId);
    await this.createAutoGenerationFieldComments({
      workspaceId,
      contextType: 'organization',
      contextId: organizationId,
      sectionKeys: generatedOrganizationFields,
      createdBy: initiatedByUserId,
      locale
    });

    return {
      output: {
        organizationId,
        organizationName: effectiveName,
        wasCreated: wasCreated === true,
        skipped: false,
      },
    };
  }

  private async processOrganizationBatchCreate(
    data: OrganizationBatchCreateJobData,
    _signal?: AbortSignal,
  ): Promise<WorkflowTaskCompletion> {
    const { folderId, input } = data;
    const workflow = parseGenerationWorkflowRuntimeContext(data.workflow);
    if (!workflow) {
      throw new Error('Workflow runtime metadata is required for organization_batch_create jobs');
    }

    const [folder] = await db
      .select({ id: folders.id, workspaceId: folders.workspaceId })
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1);
    if (!folder) {
      throw new Error('Folder not found for organization batch creation');
    }

    const runtimeState = await this.getWorkflowRunStateSnapshot(workflow.workflowRunId);
    const currentState = runtimeState?.state ?? {};
    const orgContextState = isRecord(currentState.orgContext) ? currentState.orgContext : {};
    const generationState = isRecord(currentState.generation) ? currentState.generation : {};
    const selectedOrgIds = readStringArray(orgContextState.selectedOrgIds);
    const generatedInitiatives = readGeneratedInitiatives(generationState.initiatives);
    if (generatedInitiatives.length === 0) {
      throw new Error('Organization target preparation requires org-aware list outputs');
    }

    const existingOrgRows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        status: organizations.status,
        data: organizations.data,
      })
      .from(organizations)
      .where(eq(organizations.workspaceId, folder.workspaceId));
    const existingById = new Map(existingOrgRows.map((org) => [org.id, org]));
    const existingByName = new Map(
      existingOrgRows.map((org) => [org.name.trim().toLocaleLowerCase('en-US'), org]),
    );
    const relatedInitiativesByOrgName = new Map<string, string[]>();
    const createdOrganizationsPayload: Array<{
      id: string;
      name: string;
      sector: string;
      description: string;
      location: string;
    }> = [];
    const organizationRowsToInsert: Array<typeof organizations.$inferInsert> = [];
    const organizationTargets = new Map<string, WorkflowOrganizationTarget>();
    const matchedExistingIds = new Set<string>();
    const createdOrgIds: string[] = [];
    const createdByName = new Map<string, { id: string; name: string }>();

    const registerTarget = (
      organizationId: string,
      organizationName: string,
      options: { skipIfCompleted: boolean; wasCreated: boolean },
    ) => {
      const existingTarget = organizationTargets.get(organizationId);
      if (existingTarget) {
        organizationTargets.set(organizationId, {
          organizationId,
          organizationName: existingTarget.organizationName || organizationName,
          skipIfCompleted: existingTarget.skipIfCompleted !== false && options.skipIfCompleted,
          wasCreated: existingTarget.wasCreated === true || options.wasCreated,
        });
        return;
      }
      organizationTargets.set(organizationId, {
        organizationId,
        organizationName,
        skipIfCompleted: options.skipIfCompleted,
        wasCreated: options.wasCreated,
      });
    };

    const ensureTargetForExistingId = (organizationId: string) => {
      const existingOrg = existingById.get(organizationId);
      if (!existingOrg) return null;
      matchedExistingIds.add(organizationId);
      registerTarget(existingOrg.id, existingOrg.name, {
        skipIfCompleted: existingOrg.status === 'completed',
        wasCreated: false,
      });
      return existingOrg.id;
    };

    const ensureTargetForOrganizationName = (organizationName: string) => {
      const normalizedName = organizationName.toLocaleLowerCase('en-US');
      if (!normalizedName) return null;

      const existingOrg = existingByName.get(normalizedName);
      if (existingOrg) {
        matchedExistingIds.add(existingOrg.id);
        registerTarget(existingOrg.id, existingOrg.name, {
          skipIfCompleted: existingOrg.status === 'completed',
          wasCreated: false,
        });
        return {
          organizationId: existingOrg.id,
          organizationName: existingOrg.name,
          wasCreated: false,
        };
      }

      const existingCreated = createdByName.get(normalizedName);
      if (existingCreated) {
        registerTarget(existingCreated.id, existingCreated.name, {
          skipIfCompleted: false,
          wasCreated: true,
        });
        return {
          organizationId: existingCreated.id,
          organizationName: existingCreated.name,
          wasCreated: true,
        };
      }

      const organizationId = createId();
      const relatedInitiatives = relatedInitiativesByOrgName.get(normalizedName) ?? [];
      const objectives = relatedInitiatives.length > 0
        ? `Initiatives candidates: ${relatedInitiatives.join('; ')}`
        : input;

      createdOrgIds.push(organizationId);
      createdByName.set(normalizedName, { id: organizationId, name: organizationName });
      createdOrganizationsPayload.push({
        id: organizationId,
        name: organizationName,
        sector: '',
        description: objectives,
        location: '',
      });
      organizationRowsToInsert.push({
        id: organizationId,
        workspaceId: folder.workspaceId,
        name: organizationName,
        status: 'generating',
        data: {
          industry: '',
          size: '',
          products: '',
          processes: '',
          kpis: '',
          challenges: '',
          objectives,
          technologies: '',
          references: [],
          location: '',
        } as OrganizationData & { location: string },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      registerTarget(organizationId, organizationName, {
        skipIfCompleted: false,
        wasCreated: true,
      });
      return {
        organizationId,
        organizationName,
        wasCreated: true,
      };
    };

    for (const initiative of generatedInitiatives) {
      const organizationName = normalizeOrganizationName(initiative.organizationName);
      if (!organizationName) continue;
      const normalizedName = organizationName.toLocaleLowerCase('en-US');
      relatedInitiativesByOrgName.set(normalizedName, [
        ...(relatedInitiativesByOrgName.get(normalizedName) ?? []),
        initiative.name,
      ]);
    }

    for (const selectedOrgId of selectedOrgIds) {
      ensureTargetForExistingId(selectedOrgId);
    }

    const resolvedInitiatives = generatedInitiatives.map((initiative) => {
      const resolvedIds = new Set<string>();
      for (const organizationId of initiative.organizationIds ?? []) {
        const existingId = ensureTargetForExistingId(organizationId);
        if (existingId) {
          resolvedIds.add(existingId);
        }
      }

      const organizationName = normalizeOrganizationName(initiative.organizationName);
      if (organizationName) {
        const resolvedByName = ensureTargetForOrganizationName(organizationName);
        if (resolvedByName?.organizationId) {
          resolvedIds.add(resolvedByName.organizationId);
        }
      }

      if (resolvedIds.size === 0 && selectedOrgIds.length === 1) {
        const selectedId = ensureTargetForExistingId(selectedOrgIds[0]);
        if (selectedId) {
          resolvedIds.add(selectedId);
        }
      }

      const normalizedIds = Array.from(resolvedIds);
      return {
        id: initiative.id,
        name: initiative.name,
        ...(initiative.description ? { description: initiative.description } : {}),
        ...(normalizedIds.length > 0 ? { organizationIds: normalizedIds } : {}),
        ...(organizationName ? { organizationName } : {}),
      };
    });

    if (organizationRowsToInsert.length > 0) {
      await db.insert(organizations).values(organizationRowsToInsert);
      for (const row of organizationRowsToInsert) {
        await this.notifyOrganizationEvent(row.id);
      }
    }

    for (const initiative of resolvedInitiatives) {
      if (!Array.isArray(initiative.organizationIds) || initiative.organizationIds.length !== 1) {
        continue;
      }
      await db
        .update(initiatives)
        .set({
          organizationId: initiative.organizationIds[0],
        })
        .where(and(eq(initiatives.id, initiative.id), eq(initiatives.workspaceId, folder.workspaceId)));
    }

    return {
      output: {
        organizationTargets: Array.from(organizationTargets.values()),
        createdOrgIds,
        matchedExistingIds: Array.from(matchedExistingIds),
        resolvedTargetCount: organizationTargets.size,
      },
      statePatch: {
        orgContext: {
          organizationTargets: Array.from(organizationTargets.values()),
          createdOrgIds,
          createdOrganizations: createdOrganizationsPayload,
        },
        generation: {
          initiatives: resolvedInitiatives,
        },
      },
    };
  }

  private async processOrganizationTargetsJoin(
    data: OrganizationTargetsJoinJobData,
    signal?: AbortSignal,
  ): Promise<WorkflowTaskCompletion> {
    if (signal?.aborted) {
      throw new Error('Organization targets join aborted');
    }

    const workflow = parseGenerationWorkflowRuntimeContext(data.workflow);
    if (!workflow) {
      throw new Error('Workflow runtime metadata is required for organization_targets_join jobs');
    }

    const runtimeState = await this.getWorkflowRunStateSnapshot(workflow.workflowRunId);
    const currentState = runtimeState?.state ?? {};
    const orgContextState = isRecord(currentState.orgContext) ? currentState.orgContext : {};
    const selectedOrgIds = readStringArray(orgContextState.selectedOrgIds);
    const organizationTargets = readOrganizationTargets(orgContextState.organizationTargets);
    if (organizationTargets.length === 0) {
      return {
        output: {
          effectiveOrgIds: selectedOrgIds,
          resolvedTargetCount: 0,
          createdOrgIds: readStringArray(orgContextState.createdOrgIds),
        },
        statePatch: {
          orgContext: {
            effectiveOrgIds: selectedOrgIds,
          },
        },
      };
    }

    const completedRows = await db
      .select({
        taskInstanceKey: workflowTaskResults.taskInstanceKey,
        output: workflowTaskResults.output,
      })
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, workflow.workflowRunId),
          eq(workflowTaskResults.taskKey, data.sourceTaskKey),
          eq(workflowTaskResults.status, 'completed'),
        ),
      );

    const completedByOrgId = new Map<string, Record<string, unknown>>();
    for (const row of completedRows) {
      if (!isRecord(row.output)) continue;
      const organizationId =
        typeof row.output.organizationId === 'string' && row.output.organizationId.trim()
          ? row.output.organizationId.trim()
          : (typeof row.taskInstanceKey === 'string' && row.taskInstanceKey.trim()
              ? row.taskInstanceKey.trim()
              : '');
      if (!organizationId) continue;
      completedByOrgId.set(organizationId, row.output);
    }

    const resolvedTargets = organizationTargets.filter((target) => completedByOrgId.has(target.organizationId));
    const effectiveOrgIds = Array.from(
      new Set([...selectedOrgIds, ...resolvedTargets.map((target) => target.organizationId)]),
    );
    if (effectiveOrgIds.length === 0) {
      throw new Error('Organization targets join resolved no organizations');
    }

    const createdOrgIds = resolvedTargets
      .filter((target) => completedByOrgId.get(target.organizationId)?.wasCreated === true)
      .map((target) => target.organizationId);

    const createdOrgRows =
      createdOrgIds.length > 0
        ? await db
            .select({ id: organizations.id, name: organizations.name, data: organizations.data })
            .from(organizations)
            .where(inArray(organizations.id, createdOrgIds))
        : [];

    const createdOrganizations = createdOrgRows.map((org) => {
      const orgData = parseOrgData(org.data);
      return {
        id: org.id,
        name: org.name,
        sector: typeof orgData.industry === 'string' ? orgData.industry : '',
        description: typeof orgData.objectives === 'string' ? orgData.objectives : '',
        location: typeof orgData.location === 'string' ? orgData.location : '',
      };
    });

    return {
      output: {
        effectiveOrgIds,
        createdOrgIds,
      },
      statePatch: {
        orgContext: {
          effectiveOrgIds,
          createdOrgIds,
          createdOrganizations,
        },
      },
    };
  }

  private async processMatrixGenerate(data: MatrixGenerateJobData, signal?: AbortSignal): Promise<WorkflowTaskCompletion | void> {
    const { folderId, input, organizationId, orgIds, model, initiatedByUserId, locale } = data;
    const workflow = parseGenerationWorkflowRuntimeContext(data.workflow);

    const [folder] = await db
      .select({
        id: folders.id,
        workspaceId: folders.workspaceId,
        name: folders.name,
        description: folders.description,
        organizationId: folders.organizationId,
      })
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1);
    if (!folder) throw new Error('Folder not found for matrix generation');
    const runtimeState = workflow ? await this.getWorkflowRunStateSnapshot(workflow.workflowRunId) : null;
    const currentState = runtimeState?.state ?? {};
    const orgContextState = isRecord(currentState.orgContext) ? currentState.orgContext : {};
    const inputsState = isRecord(currentState.inputs) ? currentState.inputs : {};
    const effectiveOrgIdsFromState = readStringArray(orgContextState.effectiveOrgIds);
    const selectedOrgIdsFromState = readStringArray(orgContextState.selectedOrgIds);
    const createdOrgIdsFromState = readStringArray(orgContextState.createdOrgIds);
    const requestedInputFromState =
      typeof inputsState.input === 'string' && inputsState.input.trim().length > 0
        ? inputsState.input.trim()
        : '';
    const resolvedOrgIds =
      orgIds && orgIds.length > 0
        ? orgIds
        : effectiveOrgIdsFromState.length > 0
          ? effectiveOrgIdsFromState
          : Array.from(new Set([...selectedOrgIdsFromState, ...createdOrgIdsFromState]));
    const resolvedOrganizationId =
      organizationId ??
      folder.organizationId ??
      (resolvedOrgIds.length === 1 ? resolvedOrgIds[0] : undefined);
    const effectiveResolvedOrgIds =
      resolvedOrgIds.length > 0
        ? resolvedOrgIds
        : resolvedOrganizationId
          ? [resolvedOrganizationId]
          : [];

    const organizationRows =
      effectiveResolvedOrgIds.length > 0
        ? await db
            .select({ id: organizations.id, name: organizations.name, data: organizations.data })
            .from(organizations)
            .where(and(
              eq(organizations.workspaceId, folder.workspaceId),
              sql`${organizations.id} = ANY(ARRAY[${sql.join(effectiveResolvedOrgIds.map((id) => sql`${id}`), sql`, `)}]::text[])`,
            ))
        : [];
    let selectedOrganization =
      organizationRows.find((organization) => organization.id === resolvedOrganizationId) ?? null;
    if (!selectedOrganization && resolvedOrganizationId) {
      const [organization] = await db
        .select({ id: organizations.id, name: organizations.name, data: organizations.data })
        .from(organizations)
        .where(and(eq(organizations.id, resolvedOrganizationId), eq(organizations.workspaceId, folder.workspaceId)))
        .limit(1);
      selectedOrganization = organization ?? null;
    }

    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;
    const folderName =
      typeof folder.name === 'string' &&
      folder.name.trim() &&
      folder.name.trim() !== 'Brouillon' &&
      !folder.name.startsWith('Génération -')
        ? folder.name.trim()
        : '';
    const contextName = folderName || selectedOrganization?.name || 'Dossier';
    const organizationContextRows =
      organizationRows.length > 0
        ? organizationRows
        : selectedOrganization
          ? [selectedOrganization]
          : [];
    const organizationContext = organizationContextRows.map((organization) => {
      const orgData = parseOrgData(organization.data);
      return {
        id: organization.id,
        name: organization.name,
        industry: orgData.industry,
        size: orgData.size,
        products: orgData.products,
        processes: orgData.processes,
        kpis: orgData.kpis,
        challenges: orgData.challenges,
        objectives: orgData.objectives,
        technologies: orgData.technologies,
      };
    });
    const contextInfo = JSON.stringify(
      {
        folder: {
          id: folder.id,
          name: folderName || null,
          description: folder.description || null,
        },
        requestedInput: input || requestedInputFromState || folder.description || folderName || null,
        selectedOrganizations: organizationContext,
      },
      null,
      2,
    );

    const streamId = `matrix_${folderId}`;
    const matrixAgentId = workflow?.agentDefinitionId ?? null;
    const matrixPromptOverride = await this.resolveGenerationPromptOverride(
      folder.workspaceId,
      matrixAgentId,
      'organization_matrix_template',
    );
    const baseMatrix = await this.resolveBaseMatrixFromAgent(folder.workspaceId, matrixAgentId);
    const template = await generateOrganizationMatrixTemplate(
      contextName,
      contextInfo,
      baseMatrix,
      selectedModel,
      signal,
      streamId,
      matrixPromptOverride,
    );
    const generatedMatrix = mergeOrganizationMatrixTemplate(baseMatrix, template);

    await db
      .update(folders)
      .set({
        matrixConfig: JSON.stringify(generatedMatrix),
        organizationId: effectiveResolvedOrgIds.length === 1 ? effectiveResolvedOrgIds[0] : null,
      })
      .where(and(eq(folders.id, folderId), eq(folders.workspaceId, folder.workspaceId)));

    await this.notifyFolderEvent(folderId);
    await this.createAutoGenerationFieldComments({
      workspaceId: folder.workspaceId,
      contextType: 'matrix',
      contextId: folderId,
      sectionKeys: ['matrixConfig'],
      createdBy: initiatedByUserId,
      locale
    });

    return {
      output: {
        folderId,
        organizationId: resolvedOrganizationId ?? null,
        effectiveOrgIds: effectiveResolvedOrgIds,
        generated: true,
      },
      statePatch: {
        orgContext: {
          effectiveOrgIds: effectiveResolvedOrgIds,
        },
      },
    };
  }

  private sanitizePgText(input: string): string {
    let out = '';
    for (let i = 0; i < input.length; i += 1) {
      const code = input.charCodeAt(i);
      if (code === 0) continue;
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
      out += input[i];
    }
    return out;
  }

  private async getLatestMatrixJobState(folderId: string): Promise<{ status: string; error: string | null } | null> {
    const rows = (await db.all(sql`
      SELECT status, error
      FROM job_queue
      WHERE type = 'matrix_generate'
        AND (data::jsonb ->> 'folderId') = ${folderId}
      ORDER BY created_at DESC
      LIMIT 1
    `)) as Array<{ status: string; error: string | null }>;
    return rows[0] ?? null;
  }

  private trimToMaxWords(text: string, maxWords: number): { text: string; trimmed: boolean; words: number } {
    const t = (text || '').trim();
    if (!t) return { text: '', trimmed: false, words: 0 };
    const words = t.split(/\s+/g).filter(Boolean);
    const max = Math.max(1, Math.min(10_000, Math.floor(maxWords || 10_000)));
    if (words.length <= max) return { text: t, trimmed: false, words: words.length };
    return { text: words.slice(0, max).join(' ') + '\n…(tronqué)…', trimmed: true, words: max };
  }

  private chunkByWords(text: string, chunkWords: number): string[] {
    const t = (text || '').trim();
    if (!t) return [];
    const words = t.split(/\s+/g).filter(Boolean);
    const size = Math.max(500, Math.min(8000, Math.floor(chunkWords || 4500)));
    const out: string[] = [];
    for (let i = 0; i < words.length; i += size) {
      out.push(words.slice(i, i + size).join(' '));
    }
    return out;
  }

  private async getNextModificationSequence(contextType: string, contextId: string): Promise<number> {
    const result = await db
      .select({ maxSequence: sql<number>`MAX(${contextModificationHistory.sequence})` })
      .from(contextModificationHistory)
      .where(and(eq(contextModificationHistory.contextType, contextType), eq(contextModificationHistory.contextId, contextId)));
    const maxSequence = result[0]?.maxSequence ?? 0;
    return maxSequence + 1;
  }

  /**
   * Worker: summarize an uploaded document and update context_documents.
   * MVP: supports text-like formats only (text/*, application/json).
   */
  private async processDocumentSummary(
    data: DocumentSummaryJobData,
    jobId: string,
    signal?: AbortSignal
  ): Promise<void> {
    const { documentId } = data;
    const lang = (data.lang || 'fr').trim() || 'fr';
    const streamId = `document_${documentId}`;

    const write = async (eventType: StreamEventType, payload: unknown) => {
      const seq = await getNextSequence(streamId);
      await writeStreamEvent(streamId, eventType, payload, seq);
    };

    // Ensure a deterministic "started" exists for monitors and any UI observers.
    await write('status', { state: 'started', jobType: 'document_summary', documentId });

    const [doc] = await db
      .select()
      .from(contextDocuments)
      .where(eq(contextDocuments.id, documentId))
      .limit(1);
    if (!doc) throw new Error('Document not found');
    const workspaceId = doc.workspaceId;

    try {
      await db
        .update(contextDocuments)
        .set({ status: 'processing', jobId, updatedAt: new Date() })
        .where(and(eq(contextDocuments.id, documentId), eq(contextDocuments.workspaceId, workspaceId)));

      const bucket = getDocumentsBucketName();
      const bytes = await getObjectBytes({ bucket, key: doc.storageKey });
      let text: string;
      let extractedMetaTitle: string | undefined;
      let extractedMetaPages: number | undefined;
      let extractedMetaWords: number | undefined;
      try {
        await write('status', { state: 'extracting' });
        const extracted = await extractDocumentInfoFromDocument({ bytes, filename: doc.filename, mimeType: doc.mimeType });
        text = extracted.text;
        extractedMetaTitle = extracted.metadata.title;
        extractedMetaPages = extracted.metadata.pages;
        extractedMetaWords = (extracted.metadata as unknown as { words?: unknown }).words as number | undefined;
      } catch (e) {
        await db
          .update(contextDocuments)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(and(eq(contextDocuments.id, documentId), eq(contextDocuments.workspaceId, workspaceId)));
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Unsupported mime type for summarization: ${doc.mimeType}. ${msg}`);
      }

      const trimmed = text.trim();
      if (trimmed.length < 80) {
        await db
          .update(contextDocuments)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(and(eq(contextDocuments.id, documentId), eq(contextDocuments.workspaceId, workspaceId)));
        throw new Error('No text extracted from document (empty or image-only PDF).');
      }

      const clipped = trimmed.length > 50_000 ? trimmed.slice(0, 50_000) : trimmed;
      const docTitleRaw = (extractedMetaTitle || doc.filename || '-').trim() || '-';
      const docTitle = docTitleRaw === '-' ? 'Non précisé' : docTitleRaw;
      const nbPages =
        typeof extractedMetaPages === 'number' && extractedMetaPages > 0 ? String(extractedMetaPages) : 'Non précisé';
      const nbWords = (() => {
        if (typeof extractedMetaWords === 'number' && Number.isFinite(extractedMetaWords) && extractedMetaWords > 0) {
          return String(extractedMetaWords);
        }
        // Fallback: count on full extracted text; if unavailable, count on clipped (aligned with what we send to the model).
        const fromFull = text.split(/\s+/).filter(Boolean).length;
        if (Number.isFinite(fromFull) && fromFull > 0) return String(fromFull);
        const fromClipped = clipped.split(/\s+/).filter(Boolean).length;
        return Number.isFinite(fromClipped) && fromClipped > 0 ? String(fromClipped) : 'Non précisé';
      })();

      await write('status', { state: 'summarizing' });
      const summary = await generateDocumentSummary({
        lang: lang === 'en' ? 'en' : 'fr',
        docTitle,
        nbPages,
        fullWords: nbWords,
        documentText: clipped,
        streamId,
        signal,
      });

      // For large documents: auto-generate a detailed summary (~10k words) and store it in data.
      // This is persisted so it is visible in db-query and reusable by tools.
      const wordsAsNumber = Number(nbWords);
      let detailedSummary: string | null = null;
      let detailedSummaryWords: number | null = null;
      if (Number.isFinite(wordsAsNumber) && wordsAsNumber > 10_000) {
        await write('status', { state: 'summarizing_detailed' });
        const detailed = await generateDocumentDetailedSummary({
          text,
          filename: doc.filename,
          lang: lang === 'en' ? 'en' : 'fr',
          streamId,
          signal,
        });
        const policy = getDocumentDetailedSummaryPolicy();
        if (!detailed.detailedSummary.trim() || detailed.words < policy.detailedSummaryMinWords) {
          throw new Error(
            `Résumé détaillé insuffisant: ${detailed.words} mots (min ${policy.detailedSummaryMinWords}). Relancer le job.`
          );
        }
        detailedSummary = detailed.detailedSummary;
        detailedSummaryWords = detailed.words;
      }

      const nextData = {
        ...(doc.data && typeof doc.data === 'object' ? (doc.data as Record<string, unknown>) : {}),
        summary,
        summaryLang: lang,
        extracted: {
          title: docTitle,
          pages: nbPages === 'Non précisé' ? null : Number(nbPages),
          words: nbWords === 'Non précisé' ? null : Number(nbWords),
        },
        prompts: {
          summaryPromptId: 'document_summary',
        }
      };

      const dataWithDetailed: Record<string, unknown> = detailedSummary
        ? {
            ...nextData,
            detailedSummary,
            detailedSummaryLang: lang,
            detailedSummaryWords,
            detailed_summary: detailedSummary,
            detailed_summary_lang: lang,
            detailed_summary_words: detailedSummaryWords,
            prompts: { ...(nextData.prompts as Record<string, unknown>), detailedPromptId: 'document_detailed_summary' }
          }
        : nextData;

      await db
        .update(contextDocuments)
        .set({ status: 'ready', data: dataWithDetailed, updatedAt: new Date() })
        .where(and(eq(contextDocuments.id, documentId), eq(contextDocuments.workspaceId, workspaceId)));

      await write('done', { state: 'done' });
    } catch (error) {
      // IMPORTANT: always reflect failure on the document row itself so the UI can show `failed`
      // even if the outer job error propagation fails for any reason.
      try {
        const msg = error instanceof Error ? error.message : String(error);
        const safe = this.sanitizePgText(`Échec: ${msg}`).slice(0, 5000);
        await db.run(sql`
          UPDATE context_documents
          SET status = 'failed',
              data = jsonb_set(coalesce(data, '{}'::jsonb), '{summary}', to_jsonb(${safe}), true),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${documentId} AND workspace_id = ${workspaceId}
        `);
      } catch {
        // ignore
      }
      throw error;
    }

    // History event
    let seq = await this.getNextModificationSequence(doc.contextType, doc.contextId);
    await db.insert(contextModificationHistory).values({
      id: createId(),
      contextType: doc.contextType,
      contextId: doc.contextId,
      sessionId: null,
      messageId: null,
      field: 'document_summarized',
      oldValue: null,
      newValue: { documentId, status: 'ready', summaryLang: lang },
      toolCallId: null,
      promptId: null,
      promptType: null,
      promptVersionId: null,
      jobId,
      sequence: seq,
      createdAt: new Date(),
    });
    seq += 1;
  }

  /**
   * Worker: generate DOCX asynchronously in publishing queue.
   * Result binary is stored in job_queue.result as base64 for direct download endpoint.
   */
  private async processDocxGenerate(
    data: DocxGenerateJobData,
    jobId: string,
    signal?: AbortSignal
  ): Promise<void> {
    const streamId = `job_${jobId}`;
    let emitStatusChain: Promise<void> = Promise.resolve();

    const emitStatus = async (
      state: string,
      progress: number,
      extra: Record<string, unknown> = {}
    ) => {
      emitStatusChain = emitStatusChain
        .catch(() => {
          // Keep the chain alive even if a previous status emission failed.
        })
        .then(async () => {
          const payload = {
            state,
            progress,
            ...extra,
            updatedAt: new Date().toISOString(),
          };
          await db.run(sql`
            UPDATE job_queue
            SET result = ${JSON.stringify(payload)}
            WHERE id = ${jobId}
          `);
          await this.notifyJobEvent(jobId);
          const seq = await getNextSequence(streamId);
          await writeStreamEvent(streamId, 'status', payload, seq);
        });

      await emitStatusChain;
    };

    const isAbort = (error: unknown): boolean => {
      if (!error) return false;
      if (error instanceof DOMException && error.name === 'AbortError') return true;
      if (error instanceof Error && error.name === 'AbortError') return true;
      const message = error instanceof Error ? error.message : String(error);
      return message.includes('AbortError') || message.includes('aborted');
    };

    const [jobRow] = await db
      .select({ workspaceId: jobQueue.workspaceId })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    if (!jobRow?.workspaceId) {
      throw new Error('Docx job workspace not found');
    }

    const isFreeform = data.mode === 'freeform' && typeof data.code === 'string';

    await emitStatus('queued', 0, {
      templateId: isFreeform ? 'freeform' : data.templateId,
      entityType: data.entityType,
      entityId: data.entityId,
      queueClass: 'publishing',
    });

    try {
      if (signal?.aborted) {
        throw new DOMException('Docx generation cancelled', 'AbortError');
      }

      await emitStatus('loading_data', 10);

      let result: { fileName: string; mimeType: string; buffer: Buffer };

      if (isFreeform) {
        // Freeform mode: sandbox execution
        result = await generateFreeformDocx({
          code: data.code!,
          entityType: data.entityType,
          entityId: data.entityId,
          workspaceId: jobRow.workspaceId,
        });
      } else {
        // Template mode (existing path)
        result = await runDocxGenerationInWorker({
          input: {
            templateId: data.templateId!,
            entityType: data.entityType,
            entityId: data.entityId,
            workspaceId: jobRow.workspaceId,
            provided: data.provided ?? {},
            controls: data.controls ?? {},
            locale: data.locale,
            requestId: data.requestId ?? jobId,
          },
          signal,
          onProgress: async (event) => {
            const progress = typeof event.progress === 'number' ? event.progress : 50;
            await emitStatus(event.state || 'rendering', progress, {
              current: event.current,
              total: event.total,
              message: event.message,
            });
          },
        });
      }

      if (signal?.aborted) {
        throw new DOMException('Docx generation cancelled', 'AbortError');
      }

      await emitStatus('packaging', 98, {
        fileName: result.fileName,
        mimeType: result.mimeType,
      });

      const bucket = getDocumentsBucketName();
      const templateSlug = isFreeform ? 'freeform' : (data.templateId ?? 'unknown');
      const objectKey = `docx-cache/${jobRow.workspaceId}/${templateSlug}/${data.entityType}/${data.entityId}/${jobId}.docx`;
      await putObject({
        bucket,
        key: objectKey,
        body: result.buffer,
        contentType: result.mimeType,
      });

      const finalPayload = {
        state: 'done',
        progress: 100,
        fileName: result.fileName,
        mimeType: result.mimeType,
        byteLength: result.buffer.byteLength,
        storageBucket: bucket,
        storageKey: objectKey,
        sourceHash: typeof data.sourceHash === 'string' ? data.sourceHash : null,
        queueClass: 'publishing',
        completedAt: new Date().toISOString(),
      };

      await db.run(sql`
        UPDATE job_queue
        SET result = ${JSON.stringify(finalPayload)}
        WHERE id = ${jobId}
      `);
      await this.notifyJobEvent(jobId);

      const seq = await getNextSequence(streamId);
      await writeStreamEvent(streamId, 'done', finalPayload, seq);
    } catch (error) {
      if (isAbort(error)) {
        await emitStatus('cancelled', 0, {
          message: error instanceof Error ? error.message : 'Docx generation cancelled',
        });
      } else {
        await emitStatus('failed', 0, {
          message: error instanceof Error ? error.message : 'Docx generation failed',
        });
      }
      throw error;
    }
  }

  /**
   * Worker pour la génération de liste de cas d'usage
   */
  private async processInitiativeList(
    data: InitiativeListJobData,
    signal?: AbortSignal,
  ): Promise<WorkflowTaskCompletion | void> {
    const { folderId, input, organizationId, matrixMode: _matrixMode, model, initiativeCount, initiatedByUserId, locale, orgIds } = data;
    const workflow = parseGenerationWorkflowRuntimeContext(data.workflow);

    const [folder] = await db
      .select({
        id: folders.id,
        workspaceId: folders.workspaceId,
        name: folders.name,
        description: folders.description,
        organizationId: folders.organizationId,
      })
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1);
    if (!folder) {
      throw new Error('Folder not found');
    }
    const workspaceId = folder.workspaceId;
    const runtimeState = workflow ? await this.getWorkflowRunStateSnapshot(workflow.workflowRunId) : null;
    const currentState = runtimeState?.state ?? {};
    const orgContextState = isRecord(currentState.orgContext) ? currentState.orgContext : {};
    const effectiveOrgIdsFromState = readStringArray(orgContextState.effectiveOrgIds);
    const selectedOrgIdsFromState = readStringArray(orgContextState.selectedOrgIds);
    const createdOrgIdsFromState = readStringArray(orgContextState.createdOrgIds);
    const resolvedOrgIds =
      orgIds && orgIds.length > 0
        ? orgIds
        : effectiveOrgIdsFromState.length > 0
          ? effectiveOrgIdsFromState
          : Array.from(new Set([...selectedOrgIdsFromState, ...createdOrgIdsFromState]));
    const resolvedOrganizationId =
      organizationId ??
      folder.organizationId ??
      (resolvedOrgIds.length === 1 ? resolvedOrgIds[0] : undefined);
    const effectiveResolvedOrgIds =
      resolvedOrgIds.length > 0
        ? resolvedOrgIds
        : resolvedOrganizationId
          ? [resolvedOrganizationId]
          : [];

    // Récupérer le modèle par défaut depuis les settings si non fourni
    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;

    // Récupérer les informations de l'organisation si nécessaire
    let organizationInfo = '';
    if (resolvedOrganizationId) {
      try {
        const [org] = await db
          .select()
          .from(organizations)
          .where(and(eq(organizations.id, resolvedOrganizationId), eq(organizations.workspaceId, workspaceId)));
        if (org) {
          const orgData = parseOrgData(org.data);
          organizationInfo = JSON.stringify({
            name: org.name,
            industry: orgData.industry,
            size: orgData.size,
            products: orgData.products,
            processes: orgData.processes,
            challenges: orgData.challenges,
            objectives: orgData.objectives,
            technologies: orgData.technologies
          }, null, 2);
          console.log(`📊 Organization info loaded for ${org.name}:`, organizationInfo);
        } else {
          console.warn(`⚠️ Organization not found with id: ${resolvedOrganizationId}`);
        }
      } catch (error) {
        console.warn('Error fetching organization info:', error);
      }
    } else {
      console.log('ℹ️ Aucune entreprise sélectionnée pour cette génération');
    }

    // Build multi-org organizations context (Lot 12)
    let organizationsContext = '';
    if (effectiveResolvedOrgIds.length > 0) {
      try {
        const orgRows = await db
          .select({ id: organizations.id, name: organizations.name, data: organizations.data })
          .from(organizations)
          .where(and(
            eq(organizations.workspaceId, workspaceId),
            sql`${organizations.id} = ANY(ARRAY[${sql.join(effectiveResolvedOrgIds.map(id => sql`${id}`), sql`, `)}]::text[])`,
          ));
        const orgDetails = orgRows.map((org) => {
          const orgData = parseOrgData(org.data);
          return {
            id: org.id,
            name: org.name,
            industry: orgData.industry,
            products: orgData.products,
            challenges: orgData.challenges,
            objectives: orgData.objectives,
          };
        });
        organizationsContext = JSON.stringify(orgDetails, null, 2);
        console.log(`📊 Multi-org context loaded for ${orgRows.length} organizations`);
      } catch (error) {
        console.warn('Error fetching multi-org context:', error);
      }
    }

    const documentsContexts = await this.getDocumentsContextsForGeneration({
      workspaceId,
      folderId,
      organizationId: resolvedOrganizationId,
    });
    const documentsContextJson = await this.buildDocumentsContextJsonForGeneration({
      workspaceId,
      contexts: documentsContexts.map((c) => ({ contextType: c.contextType, contextId: c.contextId })),
      // Single budget only (no separate doc-count cap): ~100k words equivalent in chars.
      maxChars: 600_000,
    });

    const userFolderName =
      typeof folder.name === 'string' && folder.name.trim() && folder.name.trim() !== 'Brouillon' && !folder.name.startsWith('Génération -')
        ? folder.name.trim()
        : '';

    // Générer la liste de cas d'usage
    const streamId = `folder_${folderId}`;
    const listPromptOverride = await this.resolveGenerationPromptOverride(
      workspaceId,
      workflow?.agentDefinitionId ?? null,
      'use_case_list',
    );
    const initiativeList = await generateInitiativeList(
      input,
      organizationInfo,
      selectedModel,
      initiativeCount,
      userFolderName,
      documentsContexts,
      documentsContextJson,
      signal,
      streamId,
      listPromptOverride,
      listPromptOverride.outputSchema,
      organizationsContext || undefined,
    );
    
    // Mettre à jour le nom du dossier
    // - si l'utilisateur a fourni un nom: le préserver
    // - sinon: utiliser le nom généré par l'IA (et ne jamais conserver "Brouillon" comme titre final)
    const generatedFolderName =
      typeof initiativeList.dossier === 'string' && initiativeList.dossier.trim() && initiativeList.dossier.trim() !== 'Brouillon'
        ? initiativeList.dossier.trim()
        : '';
    const nextFolderName = userFolderName || generatedFolderName;
    const generatedFolderFields: string[] = [];
    if (!userFolderName && generatedFolderName) {
      generatedFolderFields.push('name');
    }
    if (nextFolderName) {
      const shouldFillDescription = !folder.description || !folder.description.trim();
      await db
        .update(folders)
        .set({
          name: nextFolderName,
          ...(shouldFillDescription ? { description: input } : {}),
        })
        .where(eq(folders.id, folderId));
      console.log(`📁 Folder updated: ${nextFolderName} (ID: ${folderId}, Org: ${resolvedOrganizationId || 'None'})`);
      await this.notifyFolderEvent(folderId);
      await this.createAutoGenerationFieldComments({
        workspaceId,
        contextType: 'folder',
        contextId: folderId,
        sectionKeys: generatedFolderFields,
        createdBy: initiatedByUserId,
        locale
      });
    }

    const allowedOrgIds = new Set(
      Array.from(new Set([...effectiveResolvedOrgIds, ...selectedOrgIdsFromState, ...effectiveOrgIdsFromState])),
    );
    const normalizedListItems = initiativeList.initiatives.map((initiativeItem: InitiativeListItem) => {
      const title = initiativeItem.titre || String(initiativeItem);
      const mappedOrganizationIds = Array.from(
        new Set(
          readStringArray(initiativeItem.organizationIds).filter((organizationId) =>
            allowedOrgIds.size > 0 ? allowedOrgIds.has(organizationId) : false,
          ),
        ),
      );
      const fallbackOrganizationIds =
        mappedOrganizationIds.length > 0
          ? mappedOrganizationIds
          : allowedOrgIds.size === 1
            ? [Array.from(allowedOrgIds)[0]]
            : [];
      return {
        title,
        description: initiativeItem.description || '',
        organizationIds: fallbackOrganizationIds,
        organizationName: normalizeOrganizationName(initiativeItem.organizationName) || undefined,
      };
    });

    // Créer les cas d'usage en mode generating
    const draftInitiatives = normalizedListItems.map((initiativeItem) => {
      const title = initiativeItem.title;
      const initiativeData: InitiativeData = {
        name: title, // Stocker name dans data
        description: initiativeItem.description || '', // Stocker description dans data
        technologies: [],
        deadline: '',
        contact: '',
        benefits: [],
        metrics: [],
        risks: [],
        nextSteps: [],
        dataSources: [],
        dataObjects: [],
        valueScores: [],
        complexityScores: []
      };
      return {
        id: createId(),
        workspaceId,
        folderId: folderId,
        organizationId:
          initiativeItem.organizationIds.length === 1
            ? initiativeItem.organizationIds[0]
            : effectiveResolvedOrgIds.length === 1
              ? effectiveResolvedOrgIds[0]
              : null,
        data: initiativeData as InitiativeDataJson, // Drizzle accepte JSONB directement (inclut name et description)
        model: selectedModel,
        status: 'generating',
        createdAt: new Date()
      };
    });

    // Insérer les cas d'usage
    await db.insert(initiatives).values(draftInitiatives);
    for (const uc of draftInitiatives) {
      await this.notifyInitiativeEvent(uc.id);
      const data = uc.data as unknown as Record<string, unknown>;
      const generatedInitiativeFields: string[] = [];
      if (typeof data.name === 'string' && data.name.trim()) generatedInitiativeFields.push('data.name');
      if (typeof data.description === 'string' && data.description.trim()) generatedInitiativeFields.push('data.description');
      await this.createAutoGenerationFieldComments({
        workspaceId,
        contextType: 'initiative',
        contextId: uc.id,
        sectionKeys: generatedInitiativeFields,
        createdBy: initiatedByUserId,
        locale
      });
    }

    if (!workflow) {
      throw new Error('Workflow runtime metadata is required for initiative_list generation jobs');
    }
    console.log(`📋 Generated ${draftInitiatives.length} use cases and stored workflow fanout inputs`);

    return {
      output: {
        folderId,
        initiativeIds: draftInitiatives.map((initiative) => initiative.id),
        effectiveOrgIds: effectiveResolvedOrgIds,
        organizationId: resolvedOrganizationId ?? null,
        initiativeCount: draftInitiatives.length,
      },
      statePatch: {
        orgContext: {
          effectiveOrgIds: effectiveResolvedOrgIds,
        },
        generation: {
          initiativeIds: draftInitiatives.map((initiative) => initiative.id),
          initiatives: draftInitiatives.map((initiative, index) => ({
            id: initiative.id,
            name: (initiative.data as InitiativeData)?.name || 'Cas d\'usage sans nom',
            description: (initiative.data as InitiativeData)?.description || '',
            ...(normalizedListItems[index]?.organizationIds.length
              ? { organizationIds: normalizedListItems[index].organizationIds }
              : {}),
            ...(normalizedListItems[index]?.organizationName
              ? { organizationName: normalizedListItems[index].organizationName }
              : {}),
          })),
        },
      },
    };
  }

  /**
   * Worker pour le détail d'un cas d'usage
   */
  private async processInitiativeDetail(
    data: InitiativeDetailJobData,
    signal?: AbortSignal,
  ): Promise<WorkflowTaskCompletion | void> {
    const { initiativeId, initiativeName, folderId, matrixMode, model, initiatedByUserId, locale } = data;
    const workflow = parseGenerationWorkflowRuntimeContext(data.workflow);
    
    // Récupérer le modèle par défaut depuis les settings si non fourni
    const aiSettings = await settingsService.getAISettings();
    const selectedModel = model || aiSettings.defaultModel;
    
    // Récupérer la configuration de la matrice
    const [folder] = await db.select().from(folders).where(eq(folders.id, folderId));
    if (!folder) {
      throw new Error('Dossier non trouvé');
    }
    const [initiativeRow] = await db
      .select({ organizationId: initiatives.organizationId })
      .from(initiatives)
      .where(and(eq(initiatives.id, initiativeId), eq(initiatives.workspaceId, folder.workspaceId)))
      .limit(1);
    const runtimeState = workflow ? await this.getWorkflowRunStateSnapshot(workflow.workflowRunId) : null;
    const runtimeRunState = runtimeState?.state ?? {};
    const generationState = isRecord(runtimeRunState.generation) ? runtimeRunState.generation : {};
    const generatedInitiatives = readGeneratedInitiatives(generationState.initiatives);
    const generatedInitiative = generatedInitiatives.find((initiative) => initiative.id === initiativeId);
    const scopedOrganizationIds =
      generatedInitiative?.organizationIds && generatedInitiative.organizationIds.length > 0
        ? generatedInitiative.organizationIds
        : initiativeRow?.organizationId
          ? [initiativeRow.organizationId]
          : folder.organizationId
            ? [folder.organizationId]
            : [];
    const primaryOrganizationId = scopedOrganizationIds[0] ?? null;
    
    const matrixConfig = parseMatrixConfig(folder.matrixConfig ?? null);
    if (!matrixConfig) {
      if (matrixMode === 'generate') {
        const latestMatrixJob = await this.getLatestMatrixJobState(folderId);
        if (latestMatrixJob?.status === 'failed') {
          throw new Error(latestMatrixJob.error || 'Matrix generation failed');
        }
      }
      throw new Error('Configuration de matrice non trouvée');
    }
    
    // Organization info (prompt uses organization_info)
    let organizationInfo = '';
    if (scopedOrganizationIds.length > 0) {
      try {
        const orgRows = await db
          .select()
          .from(organizations)
          .where(inArray(organizations.id, scopedOrganizationIds));
        if (orgRows.length > 0) {
          const orgPayload = orgRows.map((org) => {
            const orgData = parseOrgData(org.data);
            return {
              id: org.id,
              name: org.name,
              industry: orgData.industry,
              size: orgData.size,
              products: orgData.products,
              processes: orgData.processes,
              challenges: orgData.challenges,
              objectives: orgData.objectives,
              technologies: orgData.technologies,
            };
          });
          organizationInfo = JSON.stringify(
            orgPayload.length === 1 ? orgPayload[0] : { organizations: orgPayload },
            null,
            2,
          );
          console.log(`📊 Organization info loaded for ${orgRows.length} organization(s):`, organizationInfo);
        } else {
          console.warn(`⚠️ Organization not found with ids: ${scopedOrganizationIds.join(', ')}`);
        }
      } catch (error) {
        console.error('Error fetching organization:', error);
      }
    }
    
    const context = folder.description || '';

    const documentsContexts = await this.getDocumentsContextsForGeneration({
      workspaceId: folder.workspaceId,
      folderId,
      organizationId: primaryOrganizationId,
    });
    const documentsContextJson = await this.buildDocumentsContextJsonForGeneration({
      workspaceId: folder.workspaceId,
      contexts: documentsContexts.map((c) => ({ contextType: c.contextType, contextId: c.contextId })),
      // Single budget only (no separate doc-count cap): ~100k words equivalent in chars.
      maxChars: 600_000,
    });
    
    // Générer le détail
    const streamId = `initiative_${initiativeId}`;
    const detailPromptOverride = await this.resolveGenerationPromptOverride(
      folder.workspaceId,
      workflow?.agentDefinitionId ?? null,
      'use_case_detail',
    );
    const initiativeDetail = await generateInitiativeDetail(
      initiativeName,
      context,
      matrixConfig,
      organizationInfo,
      selectedModel,
      documentsContexts,
      documentsContextJson,
      signal,
      streamId,
      detailPromptOverride,
      undefined, // options
      detailPromptOverride.outputSchema,
    );
    
    // Valider les scores générés
    const validation = validateScores(matrixConfig, initiativeDetail.valueScores, initiativeDetail.complexityScores);
    
    if (!validation.isValid) {
      console.warn(`⚠️ Scores invalides pour ${initiativeName}:`, validation.errors);
      console.log(`🔧 Correction automatique des scores...`);
      
      // Corriger les scores
      const fixedScores = fixScores(matrixConfig, initiativeDetail.valueScores, initiativeDetail.complexityScores);
      initiativeDetail.valueScores = fixedScores.valueScores;
      initiativeDetail.complexityScores = fixedScores.complexityScores;
      
      console.log(`✅ Scores corrigés:`, {
        valueAxes: initiativeDetail.valueScores.length,
        complexityAxes: initiativeDetail.complexityScores.length
      });
    } else {
      console.log(`✅ Scores valides pour ${initiativeName}`);
    }
    
    if (validation.warnings.length > 0) {
      console.warn(`⚠️ Avertissements pour ${initiativeName}:`, validation.warnings);
    }
    
    // Récupérer le cas d'usage existant pour préserver name et description s'ils existent déjà
    const [existingInitiative] = await db
      .select()
      .from(initiatives)
      .where(and(eq(initiatives.id, initiativeId), eq(initiatives.workspaceId, folder.workspaceId)));
    let existingData: Partial<InitiativeData> = {};
    if (existingInitiative?.data) {
      try {
        if (typeof existingInitiative.data === 'object') {
          existingData = existingInitiative.data as InitiativeData;
        } else if (typeof existingInitiative.data === 'string') {
          existingData = JSON.parse(existingInitiative.data) as InitiativeData;
        }
      } catch (error) {
        // Ignorer les erreurs de parsing
      }
    }
    
    const { initiativeData, generatedInitiativeFields } = buildGeneratedInitiativePayloadForPersistence(
      existingData,
      initiativeDetail
    );
    
    // Mettre à jour le cas d'usage
    // Note: Toutes les colonnes métier (deadline, contact, benefits, etc.) sont maintenant dans data JSONB (migration 0008)
    // On met à jour uniquement data qui contient toutes les colonnes métier
    await db.update(initiatives)
      .set({
        organizationId: primaryOrganizationId,
        data: initiativeData as InitiativeDataJson, // Drizzle accepte JSONB directement (inclut name, description, domain, technologies, deadline, contact, benefits, etc.)
        model: selectedModel,
        status: 'completed'
      })
      .where(and(eq(initiatives.id, initiativeId), eq(initiatives.workspaceId, folder.workspaceId)));
    await this.notifyInitiativeEvent(initiativeId);
    await this.createAutoGenerationFieldComments({
      workspaceId: folder.workspaceId,
      contextType: 'initiative',
      contextId: initiativeId,
      sectionKeys: generatedInitiativeFields,
      createdBy: initiatedByUserId,
      locale
    });

    return {
      output: {
        initiativeId,
        folderId,
      },
    };
  }

  /**
   * Worker pour la génération de synthèse exécutive
   */
  private async processExecutiveSummary(
    data: ExecutiveSummaryJobData,
    signal?: AbortSignal,
  ): Promise<WorkflowTaskCompletion | void> {
    const { folderId, valueThreshold, complexityThreshold, model, initiatedByUserId, locale } = data;
    const workflow = parseGenerationWorkflowRuntimeContext(data.workflow);

    console.log(`📊 Génération de la synthèse exécutive pour le dossier ${folderId}`);
    const [folderBefore] = await db
      .select({ workspaceId: folders.workspaceId, executiveSummary: folders.executiveSummary })
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1);
    const beforeExecutiveSummary =
      parseJsonField<Record<string, unknown>>(folderBefore?.executiveSummary ?? null) ?? {};
    const workspaceIdForPrompt = folderBefore?.workspaceId ?? "";
    const executivePromptOverride = await this.resolveGenerationPromptOverride(
      workspaceIdForPrompt,
      workflow?.agentDefinitionId ?? null,
      'executive_summary',
    );

    // Générer la synthèse exécutive
    await generateExecutiveSummary({
      folderId,
      valueThreshold,
      complexityThreshold,
      model,
      signal,
      streamId: `folder_${folderId}`,
      promptTemplate: executivePromptOverride.promptTemplate,
      promptId: executivePromptOverride.promptId,
    });

    const [folderAfter] = await db
      .select({ workspaceId: folders.workspaceId, executiveSummary: folders.executiveSummary })
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1);
    const workspaceId = folderAfter?.workspaceId ?? folderBefore?.workspaceId ?? '';
    const afterExecutiveSummary =
      parseJsonField<Record<string, unknown>>(folderAfter?.executiveSummary ?? null) ?? {};
    const generatedExecutiveSummaryFields = Object.keys(afterExecutiveSummary).filter((field) => {
      const beforeValue = (beforeExecutiveSummary as Record<string, unknown>)[field];
      const afterValue = (afterExecutiveSummary as Record<string, unknown>)[field];
      return !isSameValue(beforeValue, afterValue);
    });

    if (workspaceId) {
      await this.invalidateDocxCacheForEntity({
        workspaceId,
        templateId: 'executive-synthesis-multipage',
        entityType: 'folder',
        entityId: folderId,
      });
    }

    // Mettre à jour le statut du dossier à 'completed'
    await db.update(folders)
      .set({ status: 'completed' })
      .where(eq(folders.id, folderId));
    await this.notifyFolderEvent(folderId);
    if (workspaceId) {
      await this.createAutoGenerationFieldComments({
        workspaceId,
        contextType: 'executive_summary',
        contextId: folderId,
        sectionKeys: generatedExecutiveSummaryFields,
        createdBy: initiatedByUserId,
        locale
      });
    }

    console.log(`✅ Synthèse exécutive générée et stockée pour le dossier ${folderId}`);

    return {
      output: {
        folderId,
        generated: true,
      },
    };
  }

  /**
   * Worker chat (réponse assistant)
   * NOTE: on réutilise la table job_queue (type = chat_message) pour préparer le scaling via workers dédiés.
   */
  private async processChatMessage(data: ChatMessageJobData, signal?: AbortSignal): Promise<void> {
    const {
      userId,
      sessionId,
      assistantMessageId,
      providerId,
      providerApiKey,
      model,
      contexts,
      tools,
      localToolDefinitions,
      vscodeCodeAgent,
      resumeFrom,
      locale,
    } = data;
    await chatService.runAssistantGeneration({
      userId,
      sessionId,
      assistantMessageId,
      providerId: providerId ?? null,
      providerApiKey: providerApiKey ?? null,
      model: model ?? null,
      contexts,
      tools,
      localToolDefinitions,
      vscodeCodeAgent,
      resumeFrom,
      locale,
      signal
    });
  }

  /**
   * Obtenir le statut d'un job
   */
  async getJobStatus(jobId: string, opts?: { includeBinaryResult?: boolean }): Promise<Job | null> {
    const result = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    
    if (!result || result.length === 0) return null;
    
    const row = result[0];
    const job = {
      id: row.id,
      type: row.type as JobType,
      data: (parseJsonField<JobData>(row.data) ?? {}) as JobData,
      result:
        opts?.includeBinaryResult === true
          ? parseJsonField(row.result)
          : sanitizeJobResultForPublic(parseJsonField(row.result)),
      status: row.status as Job['status'],
      workspaceId: row.workspaceId,
      // Drizzle retourne createdAt, startedAt, completedAt en camelCase
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      error: row.error || undefined
    } satisfies Omit<Job, 'streamId'>;

    return {
      ...job,
      streamId: getPublicJobStreamId(job),
    };
  }

  /**
   * Obtenir tous les jobs
   */
  async getAllJobs(opts?: { workspaceId?: string }): Promise<Job[]> {
    const results = await db
      .select()
      .from(jobQueue)
      .where(opts?.workspaceId ? eq(jobQueue.workspaceId, opts.workspaceId) : undefined)
      .orderBy(desc(jobQueue.createdAt));
    
    return results.map((row) => {
      const job = {
      id: row.id,
      type: row.type as JobType,
      data: (parseJsonField<JobData>(row.data) ?? {}) as JobData,
      result: sanitizeJobResultForPublic(parseJsonField(row.result)),
      status: row.status as Job['status'],
      workspaceId: row.workspaceId,
      // Drizzle retourne createdAt, startedAt, completedAt en camelCase
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      error: row.error || undefined
      } satisfies Omit<Job, 'streamId'>;

      return {
        ...job,
        streamId: getPublicJobStreamId(job),
      };
    });
  }

  async findLatestDocxJobBySource(params: {
    workspaceId: string;
    templateId: DocxTemplateId;
    entityType: DocxEntityType;
    entityId: string;
    sourceHash: string;
  }): Promise<Job | null> {
    const jobs = await this.listDocxJobsForEntity(params);
    for (const job of jobs) {
      const data = (job.data ?? {}) as unknown as Record<string, unknown>;
      const result = (job.result ?? {}) as Record<string, unknown>;
      const sourceHash =
        typeof result.sourceHash === 'string'
          ? result.sourceHash
          : typeof data.sourceHash === 'string'
            ? data.sourceHash
            : '';
      if (sourceHash !== params.sourceHash) continue;

      if (job.status === 'completed') {
        const storageKey = typeof result.storageKey === 'string' ? result.storageKey : '';
        const storageBucket =
          typeof result.storageBucket === 'string' && result.storageBucket.trim().length > 0
            ? result.storageBucket
            : getDocumentsBucketName();
        if (!storageKey) continue;
        try {
          await headObject({ bucket: storageBucket, key: storageKey });
        } catch {
          continue;
        }
      }
      return job;
    }
    return null;
  }

  async invalidateDocxCacheForEntity(params: {
    workspaceId: string;
    templateId: DocxTemplateId;
    entityType: DocxEntityType;
    entityId: string;
    keepSourceHash?: string;
  }): Promise<number> {
    const jobs = await this.listDocxJobsForEntity(params);
    let purged = 0;

    for (const job of jobs) {
      const data = (job.data ?? {}) as unknown as Record<string, unknown>;
      const result = (job.result ?? {}) as Record<string, unknown>;
      const sourceHash =
        typeof result.sourceHash === 'string'
          ? result.sourceHash
          : typeof data.sourceHash === 'string'
            ? data.sourceHash
            : null;
      if (params.keepSourceHash && sourceHash === params.keepSourceHash) {
        continue;
      }

      if (job.status === 'processing' || job.status === 'pending') {
        try {
          await this.cancelJob(job.id, 'docx-cache-invalidated');
        } catch {
          // ignore
        }
      }

      const storageKey = typeof result.storageKey === 'string' ? result.storageKey : '';
      if (storageKey) {
        const storageBucket =
          typeof result.storageBucket === 'string' && result.storageBucket.trim().length > 0
            ? result.storageBucket
            : getDocumentsBucketName();
        try {
          await deleteObject({ bucket: storageBucket, key: storageKey });
        } catch {
          // ignore: object may already be missing
        }
      }

      await db.delete(jobQueue).where(eq(jobQueue.id, job.id));
      purged += 1;
    }

    return purged;
  }

  private async listDocxJobsForEntity(params: {
    workspaceId: string;
    templateId: DocxTemplateId;
    entityType: DocxEntityType;
    entityId: string;
  }): Promise<Job[]> {
    const rows = await db
      .select()
      .from(jobQueue)
      .where(and(eq(jobQueue.workspaceId, params.workspaceId), eq(jobQueue.type, 'docx_generate')))
      .orderBy(desc(jobQueue.createdAt))
      .limit(200);

    const matches = rows.filter((row) => {
      const data = (parseJsonField<DocxGenerateJobData>(row.data) ?? {}) as DocxGenerateJobData;
      return (
        data.templateId === params.templateId &&
        data.entityType === params.entityType &&
        data.entityId === params.entityId
      );
    });

    return matches.map((row) => ({
      id: row.id,
      type: row.type as JobType,
      data: (parseJsonField<JobData>(row.data) ?? {}) as JobData,
      streamId: getPublicJobStreamId({
        id: row.id,
        type: row.type as JobType,
        data: (parseJsonField<JobData>(row.data) ?? {}) as JobData,
      }),
      result: parseJsonField(row.result),
      status: row.status as Job['status'],
      workspaceId: row.workspaceId,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      error: row.error || undefined,
    }));
  }
}

// Instance singleton
export const queueManager = new QueueManager();
