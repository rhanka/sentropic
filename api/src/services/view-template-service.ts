/**
 * View Template Service — CRUD + resolution + fork/detach + seed data for view templates.
 *
 * Resolution key: (workspace_type, object_type, maturity_stage?) → descriptor.
 * Fork/detach follows the same pattern as agent_definitions / workflow_definitions.
 *
 * Seed descriptors use the spec §12.3 format (tabs → rows → fields) with field types:
 *   text, list, scores, scores-summary, chart, child-list.
 */

import { db } from '../db/client';
import { viewTemplates } from '../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { createId } from '../utils/id';
import type { ViewTemplateRow } from '../db/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceType = 'neutral' | 'ai-ideas' | 'opportunity' | 'code';
export type ObjectType =
  | 'container'
  | 'initiative'
  | 'solution'
  | 'product'
  | 'proposal'
  | 'organization'
  | 'dashboard'
  | 'workflow_launch';

export interface CreateViewTemplateInput {
  workspaceId?: string | null;
  workspaceType: string;
  objectType: string;
  maturityStage?: string | null;
  descriptor: Record<string, unknown>;
  sourceLevel?: string;
}

export interface UpdateViewTemplateInput {
  descriptor?: Record<string, unknown>;
  sourceLevel?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const viewTemplateService = {
  /**
   * List view templates for a workspace (includes system seeds where workspace_id is null).
   */
  async list(workspaceId: string, workspaceType?: string): Promise<ViewTemplateRow[]> {
    const conditions = [];
    if (workspaceType) {
      conditions.push(eq(viewTemplates.workspaceType, workspaceType));
    }

    const wsTemplates = await db
      .select()
      .from(viewTemplates)
      .where(
        conditions.length > 0
          ? and(eq(viewTemplates.workspaceId, workspaceId), ...conditions)
          : eq(viewTemplates.workspaceId, workspaceId),
      )
      .orderBy(viewTemplates.objectType, viewTemplates.maturityStage);

    const systemTemplates = await db
      .select()
      .from(viewTemplates)
      .where(
        conditions.length > 0
          ? and(isNull(viewTemplates.workspaceId), ...conditions)
          : isNull(viewTemplates.workspaceId),
      )
      .orderBy(viewTemplates.objectType, viewTemplates.maturityStage);

    const byKey = new Map<string, ViewTemplateRow>();
    for (const t of systemTemplates) {
      const key = `${t.workspaceType}:${t.objectType}:${t.maturityStage ?? ''}`;
      byKey.set(key, t);
    }
    for (const t of wsTemplates) {
      const key = `${t.workspaceType}:${t.objectType}:${t.maturityStage ?? ''}`;
      byKey.set(key, t);
    }

    return Array.from(byKey.values());
  },

  async getById(id: string): Promise<ViewTemplateRow | null> {
    const [row] = await db
      .select()
      .from(viewTemplates)
      .where(eq(viewTemplates.id, id));
    return row ?? null;
  },

  /**
   * Resolve a view template for a given resolution key.
   * Priority: workspace-specific > system seed.
   */
  async resolve(
    workspaceId: string,
    workspaceType: string,
    objectType: string,
    maturityStage?: string | null,
  ): Promise<ViewTemplateRow | null> {
    if (maturityStage) {
      const [exact] = await db
        .select()
        .from(viewTemplates)
        .where(
          and(
            eq(viewTemplates.workspaceId, workspaceId),
            eq(viewTemplates.workspaceType, workspaceType),
            eq(viewTemplates.objectType, objectType),
            eq(viewTemplates.maturityStage, maturityStage),
          ),
        )
        .limit(1);
      if (exact) return exact;
    }

    const [wsGeneric] = await db
      .select()
      .from(viewTemplates)
      .where(
        and(
          eq(viewTemplates.workspaceId, workspaceId),
          eq(viewTemplates.workspaceType, workspaceType),
          eq(viewTemplates.objectType, objectType),
          isNull(viewTemplates.maturityStage),
        ),
      )
      .limit(1);
    if (wsGeneric) return wsGeneric;

    if (maturityStage) {
      const [sysExact] = await db
        .select()
        .from(viewTemplates)
        .where(
          and(
            isNull(viewTemplates.workspaceId),
            eq(viewTemplates.workspaceType, workspaceType),
            eq(viewTemplates.objectType, objectType),
            eq(viewTemplates.maturityStage, maturityStage),
          ),
        )
        .limit(1);
      if (sysExact) return sysExact;
    }

    const [sysGeneric] = await db
      .select()
      .from(viewTemplates)
      .where(
        and(
          isNull(viewTemplates.workspaceId),
          eq(viewTemplates.workspaceType, workspaceType),
          eq(viewTemplates.objectType, objectType),
          isNull(viewTemplates.maturityStage),
        ),
      )
      .limit(1);
    return sysGeneric ?? null;
  },

  async create(input: CreateViewTemplateInput): Promise<ViewTemplateRow> {
    const id = createId();
    const now = new Date();

    await db.insert(viewTemplates).values({
      id,
      workspaceId: input.workspaceId ?? null,
      workspaceType: input.workspaceType,
      objectType: input.objectType,
      maturityStage: input.maturityStage ?? null,
      descriptor: input.descriptor,
      version: 1,
      sourceLevel: input.sourceLevel ?? 'code',
      parentId: null,
      isDetached: false,
      createdAt: now,
      updatedAt: now,
    });

    const [row] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, id));
    return row;
  },

  async update(id: string, input: UpdateViewTemplateInput): Promise<ViewTemplateRow | null> {
    const [existing] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, id));
    if (!existing) return null;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.descriptor !== undefined) {
      updates.descriptor = input.descriptor;
      updates.version = existing.version + 1;
    }
    if (input.sourceLevel !== undefined) updates.sourceLevel = input.sourceLevel;

    await db.update(viewTemplates).set(updates).where(eq(viewTemplates.id, id));
    const [row] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, id));
    return row;
  },

  async fork(sourceId: string, workspaceId: string): Promise<ViewTemplateRow> {
    const [source] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, sourceId));
    if (!source) throw new Error('Source view template not found');

    const id = createId();
    const now = new Date();

    await db.insert(viewTemplates).values({
      id,
      workspaceId,
      workspaceType: source.workspaceType,
      objectType: source.objectType,
      maturityStage: source.maturityStage,
      descriptor: source.descriptor as Record<string, unknown>,
      version: 1,
      sourceLevel: 'admin',
      parentId: sourceId,
      isDetached: false,
      createdAt: now,
      updatedAt: now,
    });

    const [row] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, id));
    return row;
  },

  async detach(id: string): Promise<ViewTemplateRow | null> {
    const [existing] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, id));
    if (!existing) return null;
    if (!existing.parentId) return existing;

    await db
      .update(viewTemplates)
      .set({ isDetached: true, updatedAt: new Date() })
      .where(eq(viewTemplates.id, id));

    const [row] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, id));
    return row;
  },

  async remove(id: string): Promise<boolean> {
    const [existing] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, id));
    if (!existing) return false;
    if (!existing.workspaceId) return false;

    await db.delete(viewTemplates).where(eq(viewTemplates.id, id));
    return true;
  },

  /**
   * Seed default view templates for a workspace type.
   * Called on workspace creation.
   */
  async seedForWorkspace(workspaceId: string, workspaceType: string): Promise<void> {
    const seeds = getDefaultViewTemplates(workspaceType);
    if (seeds.length === 0) return;

    const now = new Date();
    for (const seed of seeds) {
      const id = createId();
      await db.insert(viewTemplates).values({
        id,
        workspaceId,
        workspaceType: seed.workspaceType,
        objectType: seed.objectType,
        maturityStage: seed.maturityStage ?? null,
        descriptor: seed.descriptor,
        version: 1,
        sourceLevel: 'code',
        parentId: null,
        isDetached: false,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
};

// ---------------------------------------------------------------------------
// Default view template descriptors per workspace type (spec §12.5 format)
// ---------------------------------------------------------------------------

interface ViewTemplateSeed {
  workspaceType: string;
  objectType: string;
  maturityStage?: string | null;
  descriptor: Record<string, unknown>;
}

function getDefaultViewTemplates(workspaceType: string): ViewTemplateSeed[] {
  switch (workspaceType) {
    case 'ai-ideas':
      return getAiIdeasTemplates();
    case 'opportunity':
      return getOpportunityTemplates();
    case 'code':
      return []; // code workspace uses ai-ideas templates (same initiative layout)
    case 'neutral':
      return []; // neutral workspace has no detail views (container-only)
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// ai-ideas templates (spec §12.5 — Initiative ai-ideas, Organization, Dashboard)
// ---------------------------------------------------------------------------

function getAiIdeasTemplates(): ViewTemplateSeed[] {
  return [
    {
      workspaceType: 'ai-ideas',
      objectType: 'initiative',
      descriptor: {
        tabs: [{
          key: 'detail', label: 'Detail', always: true,
          rows: [
            { columns: 3, fields: [
              { key: 'totalValue', type: 'scores-summary', color: 'green' },
              { key: 'totalComplexity', type: 'scores-summary', color: 'red' },
              { key: 'deadline', type: 'text' },
            ]},
            { columns: 3,
              main: { span: 2, columns: 2, fields: [
                { key: 'description', type: 'text', span: 2 },
                { key: 'problem', type: 'text', color: 'orange' },
                { key: 'solution', type: 'text', color: 'blue' },
                { key: 'benefits', type: 'list', color: 'green' },
                { key: 'constraints', type: 'list', color: 'red' },
                { key: 'metrics', type: 'list', color: 'blue' },
                { key: 'risks', type: 'list', color: 'red' },
              ]},
              sidebar: { span: 1, fields: [
                { key: 'contact', type: 'text' },
                { key: 'domain', type: 'text' },
                { key: 'technologies', type: 'list' },
                { key: 'dataSources', type: 'list' },
                { key: 'dataObjects', type: 'list' },
              ]},
            },
            { columns: 2, fields: [
              { key: 'nextSteps', type: 'list', color: 'purple' },
              { key: 'references', type: 'list' },
            ]},
            { columns: 2, fields: [
              { key: 'valueScores', type: 'scores', color: 'green' },
              { key: 'complexityScores', type: 'scores', color: 'red' },
            ]},
          ],
        }],
      },
    },
    {
      workspaceType: 'ai-ideas',
      objectType: 'organization',
      descriptor: {
        tabs: [{
          key: 'detail', label: 'Detail', always: true,
          rows: [
            { columns: 2, fields: [
              { key: 'size', type: 'text' },
              { key: 'technologies', type: 'text' },
            ]},
            { columns: 1, fields: [
              { key: 'products', type: 'text' },
              { key: 'processes', type: 'text' },
              { key: 'kpis', type: 'text' },
              { key: 'challenges', type: 'text' },
              { key: 'objectives', type: 'text' },
            ]},
          ],
        }],
      },
    },
    {
      workspaceType: 'ai-ideas',
      objectType: 'dashboard',
      descriptor: {
        tabs: [{
          key: 'summary', label: 'Summary', always: true,
          rows: [
            { columns: 1, fields: [
              { key: 'synthese_executive', type: 'text' },
              { key: 'scatterPlot', type: 'chart' },
              { key: 'introduction', type: 'text' },
              { key: 'analyse', type: 'text' },
              { key: 'recommandation', type: 'text' },
            ]},
          ],
        }],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// opportunity templates (spec §12.5 — Initiative opportunity)
// ---------------------------------------------------------------------------

function getOpportunityTemplates(): ViewTemplateSeed[] {
  return [
    {
      workspaceType: 'opportunity',
      objectType: 'initiative',
      descriptor: {
        tabs: [
          {
            key: 'detail', label: 'Detail', always: true,
            rows: [
              { columns: 3, fields: [
                { key: 'totalValue', type: 'scores-summary', color: 'green' },
                { key: 'totalComplexity', type: 'scores-summary', color: 'red' },
                { key: 'deadline', type: 'text' },
              ]},
              { columns: 3,
                main: { span: 2, columns: 2, fields: [
                  { key: 'description', type: 'text', span: 2 },
                  { key: 'problem', type: 'text', color: 'orange' },
                  { key: 'solution', type: 'text', color: 'blue' },
                  { key: 'benefits', type: 'list', color: 'green' },
                  { key: 'constraints', type: 'list', color: 'red' },
                  { key: 'metrics', type: 'list', color: 'blue' },
                  { key: 'risks', type: 'list', color: 'red' },
                ]},
                sidebar: { span: 1, fields: [
                  { key: 'contact', type: 'text' },
                  { key: 'domain', type: 'text' },
                  { key: 'technologies', type: 'list' },
                ]},
              },
              { columns: 2, fields: [
                { key: 'nextSteps', type: 'list', color: 'purple' },
                { key: 'references', type: 'list' },
              ]},
              { columns: 2, fields: [
                { key: 'valueScores', type: 'scores', color: 'green' },
                { key: 'complexityScores', type: 'scores', color: 'red' },
              ]},
            ],
          },
          {
            key: 'solutions', label: 'Solutions', showWhen: 'hasSolutions',
            rows: [{ columns: 1, fields: [{ key: 'solutions', type: 'child-list' }] }],
          },
          {
            key: 'proposals', label: 'Proposals', showWhen: 'hasProposals',
            rows: [{ columns: 1, fields: [{ key: 'proposals', type: 'child-list' }] }],
          },
        ],
      },
    },
    {
      workspaceType: 'opportunity',
      objectType: 'organization',
      descriptor: {
        tabs: [{
          key: 'detail', label: 'Detail', always: true,
          rows: [
            { columns: 2, fields: [
              { key: 'size', type: 'text' },
              { key: 'technologies', type: 'text' },
            ]},
            { columns: 1, fields: [
              { key: 'products', type: 'text' },
              { key: 'processes', type: 'text' },
              { key: 'kpis', type: 'text' },
              { key: 'challenges', type: 'text' },
              { key: 'objectives', type: 'text' },
            ]},
          ],
        }],
      },
    },
    {
      workspaceType: 'opportunity',
      objectType: 'dashboard',
      descriptor: {
        tabs: [{
          key: 'summary', label: 'Summary', always: true,
          rows: [
            { columns: 1, fields: [
              { key: 'synthese_executive', type: 'text' },
              { key: 'scatterPlot', type: 'chart' },
              { key: 'introduction', type: 'text' },
              { key: 'analyse', type: 'text' },
              { key: 'recommandation', type: 'text' },
            ]},
          ],
        }],
      },
    },
  ];
}
