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
    // Helper: a descriptor is valid only if it uses the §12.3 format (tabs → rows → fields).
    // Rows seeded with placeholder descriptors like {"layout":"default"} or legacy
    // formats (left/right, sections) that TemplateRenderer can't render are skipped.
    const hasValidDescriptor = (row: ViewTemplateRow | undefined): row is ViewTemplateRow => {
      if (!row) return false;
      const desc = row.descriptor as Record<string, unknown> | null;
      if (!Array.isArray(desc?.tabs) || (desc!.tabs as unknown[]).length === 0) return false;
      // At least one tab must have a `rows` array (the §12.3 format).
      // Legacy formats use `left`/`right`/`sections` instead.
      const tabs = desc!.tabs as Array<Record<string, unknown>>;
      return tabs.some((tab) => Array.isArray(tab.rows) && (tab.rows as unknown[]).length > 0);
    };

    // 1. Check for user-customized templates in DB (sourceLevel='user' only).
    //    Templates with sourceLevel='code' in DB are redundant with the code-level
    //    defaults and may be stale — always prefer the code-level defaults.
    if (maturityStage) {
      const [userExact] = await db
        .select()
        .from(viewTemplates)
        .where(
          and(
            eq(viewTemplates.workspaceId, workspaceId),
            eq(viewTemplates.workspaceType, workspaceType),
            eq(viewTemplates.objectType, objectType),
            eq(viewTemplates.maturityStage, maturityStage),
            eq(viewTemplates.sourceLevel, 'user'),
          ),
        )
        .limit(1);
      if (hasValidDescriptor(userExact)) return userExact;
    }

    const [userGeneric] = await db
      .select()
      .from(viewTemplates)
      .where(
        and(
          eq(viewTemplates.workspaceId, workspaceId),
          eq(viewTemplates.workspaceType, workspaceType),
          eq(viewTemplates.objectType, objectType),
          isNull(viewTemplates.maturityStage),
          eq(viewTemplates.sourceLevel, 'user'),
        ),
      )
      .limit(1);
    if (hasValidDescriptor(userGeneric)) return userGeneric;

    // 2. Always use code-level defaults — they are the source of truth.
    const codeFallback = getDefaultViewTemplates(workspaceType)
      .find((s) => s.objectType === objectType && (!maturityStage || !s.maturityStage))
      ?? getDefaultViewTemplates('ai-ideas')
        .find((s) => s.objectType === objectType && (!maturityStage || !s.maturityStage));
    if (codeFallback) {
      return {
        id: `code-default:${workspaceType}:${objectType}`,
        workspaceId: null,
        workspaceType: codeFallback.workspaceType,
        objectType: codeFallback.objectType,
        maturityStage: null,
        descriptor: codeFallback.descriptor,
        version: 0,
        sourceLevel: 'code',
        parentId: null,
        isDetached: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ViewTemplateRow;
    }

    return null;
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

  /**
   * Copy a system/admin view template into a workspace-specific copy.
   * Creates row with sourceLevel='user', parentId=source.id, isDetached=false.
   * Only one copy per parent per workspace is allowed.
   */
  async copy(sourceId: string, workspaceId: string): Promise<ViewTemplateRow> {
    const [source] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, sourceId));
    if (!source) throw new Error('Source view template not found');

    // Check if a copy already exists for this parent in this workspace
    const [existingCopy] = await db
      .select()
      .from(viewTemplates)
      .where(
        and(
          eq(viewTemplates.workspaceId, workspaceId),
          eq(viewTemplates.parentId, sourceId),
        ),
      )
      .limit(1);
    if (existingCopy) throw new Error('A copy already exists for this template in the workspace');

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
      sourceLevel: 'user',
      parentId: sourceId,
      isDetached: false,
      createdAt: now,
      updatedAt: now,
    });

    const [row] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, id));
    return row;
  },

  /**
   * Fork (deprecated alias for copy).
   */
  async fork(sourceId: string, workspaceId: string): Promise<ViewTemplateRow> {
    return this.copy(sourceId, workspaceId);
  },

  /**
   * Reset a copied view template — delete the copy and return the system default.
   * Only works on templates that have a parentId.
   */
  async reset(id: string): Promise<ViewTemplateRow | null> {
    const [existing] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, id));
    if (!existing) return null;
    if (!existing.parentId) throw new Error('Cannot reset a template without a parent');

    const parentId = existing.parentId;

    // Delete the copy
    await db.delete(viewTemplates).where(eq(viewTemplates.id, id));

    // Return the parent (system default)
    const [parent] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, parentId));
    return parent ?? null;
  },

  /**
   * Detach a forked view template from its parent (deprecated — no longer used in UX).
   */
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

  /**
   * Delete a view template.
   * Only allowed for user-created templates (sourceLevel='user' + parentId=null).
   * Returns { deleted: boolean, forbidden: boolean }.
   */
  async remove(id: string): Promise<{ deleted: boolean; forbidden: boolean }> {
    const [existing] = await db.select().from(viewTemplates).where(eq(viewTemplates.id, id));
    if (!existing) return { deleted: false, forbidden: false };
    if (!existing.workspaceId) return { deleted: false, forbidden: true }; // system seed

    // Guard: only user-created with no parent
    if (existing.sourceLevel !== 'user' || existing.parentId !== null) {
      return { deleted: false, forbidden: true };
    }

    await db.delete(viewTemplates).where(eq(viewTemplates.id, id));
    return { deleted: true, forbidden: false };
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
            { columns: 3, printClass: 'layout-head', fields: [
              { key: 'totalValue', type: 'scores-summary', color: 'green' },
              { key: 'totalComplexity', type: 'scores-summary', color: 'red' },
              { key: 'deadline', type: 'text' },
            ]},
            { columns: 3, printClass: 'layout-main',
              main: { span: 2, columns: 2, printClass: 'column-a colspan-2-print', printGridClass: 'layout-quad', fields: [
                { key: 'description', type: 'text', span: 2 },
                { key: 'problem', type: 'text', color: 'orange' },
                { key: 'solution', type: 'text', color: 'blue' },
                { key: 'benefits', type: 'list', color: 'green' },
                { key: 'constraints', type: 'list', color: 'red' },
                { key: 'metrics', type: 'list', color: 'blue' },
                { key: 'risks', type: 'list', color: 'red' },
              ]},
              sidebar: { span: 1, printClass: 'column-b', fields: [
                { key: 'contact', type: 'text' },
                { key: 'domain', type: 'text' },
                { key: 'technologies', type: 'list' },
                { key: 'dataSources', type: 'list' },
                { key: 'dataObjects', type: 'list' },
              ]},
            },
            { columns: 2, printClass: 'layout-bottom', fields: [
              { key: 'nextSteps', type: 'list', color: 'purple' },
              { key: 'references', type: 'list', hideExcerptInPrint: true },
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
            { columns: 1, fields: [
              { key: 'references', type: 'list' },
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
          key: 'main', always: true,
          rows: [
            { columns: 1, fields: [{ key: 'cover_page', type: 'component', printOnly: true, pageContext: 'cover' }] },
            { columns: 1, fields: [{ key: 'executiveSummary.synthese_executive', type: 'text', color: 'white', screenOnly: true }] },
            { columns: 1, printClass: 'report-introduction', pageBreakAfter: 'always', pageBreakInside: 'avoid', fields: [
              { key: 'scatter_plot', type: 'component' },
              { key: 'executiveSummary.introduction', type: 'text', color: 'white', id: 'section-introduction' },
            ] },
            { columns: 1, fields: [{ key: 'sommaire', type: 'component', printOnly: true }] },
            { columns: 1, printClass: 'report-analyse', pageBreakBefore: 'always', pageBreakAfter: 'always', fields: [
              { key: 'executiveSummary.analyse', type: 'text', color: 'white', id: 'section-analyse' },
            ] },
            { columns: 1, printClass: 'report-analyse', pageBreakBefore: 'always', pageBreakAfter: 'always', fields: [{ key: 'executiveSummary.recommandation', type: 'text', color: 'white', id: 'section-recommandations' }] },
            { columns: 1, printClass: 'report-analyse', fields: [{ key: 'executiveSummary.references', type: 'list', id: 'section-references' }] },
            { columns: 1, fields: [{ key: 'annex_cover', type: 'component', printOnly: true, pageContext: 'cover' }] },
            { columns: 1, fields: [{ key: 'initiatives', type: 'entity-loop', collection: 'initiatives', templateRef: 'initiative', printOnly: true, pageContext: 'annex' }] },
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
              { columns: 3, printClass: 'layout-head', fields: [
                { key: 'totalValue', type: 'scores-summary', color: 'green' },
                { key: 'totalComplexity', type: 'scores-summary', color: 'red' },
                { key: 'deadline', type: 'text' },
              ]},
              { columns: 3, printClass: 'layout-main',
                main: { span: 2, columns: 2, printClass: 'column-a colspan-2-print', printGridClass: 'layout-quad', fields: [
                  { key: 'description', type: 'text', span: 2 },
                  { key: 'problem', type: 'text', color: 'orange' },
                  { key: 'solution', type: 'text', color: 'blue' },
                  { key: 'benefits', type: 'list', color: 'green' },
                  { key: 'constraints', type: 'list', color: 'red' },
                  { key: 'metrics', type: 'list', color: 'blue' },
                  { key: 'risks', type: 'list', color: 'red' },
                ]},
                sidebar: { span: 1, printClass: 'column-b', fields: [
                  { key: 'contact', type: 'text' },
                  { key: 'domain', type: 'text' },
                  { key: 'technologies', type: 'list' },
                ]},
              },
              { columns: 2, printClass: 'layout-bottom', fields: [
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
            { columns: 1, fields: [
              { key: 'references', type: 'list' },
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
          key: 'main', always: true,
          rows: [
            { columns: 1, fields: [{ key: 'cover_page', type: 'component', printOnly: true, pageContext: 'cover' }] },
            { columns: 1, fields: [{ key: 'executiveSummary.synthese_executive', type: 'text', color: 'white', screenOnly: true }] },
            { columns: 1, printClass: 'report-introduction', pageBreakAfter: 'always', pageBreakInside: 'avoid', fields: [
              { key: 'scatter_plot', type: 'component' },
              { key: 'executiveSummary.introduction', type: 'text', color: 'white', id: 'section-introduction' },
            ] },
            { columns: 1, fields: [{ key: 'sommaire', type: 'component', printOnly: true }] },
            { columns: 1, printClass: 'report-analyse', pageBreakBefore: 'always', pageBreakAfter: 'always', fields: [
              { key: 'executiveSummary.analyse', type: 'text', color: 'white', id: 'section-analyse' },
            ] },
            { columns: 1, printClass: 'report-analyse', pageBreakBefore: 'always', pageBreakAfter: 'always', fields: [{ key: 'executiveSummary.recommandation', type: 'text', color: 'white', id: 'section-recommandations' }] },
            { columns: 1, printClass: 'report-analyse', fields: [{ key: 'executiveSummary.references', type: 'list', id: 'section-references' }] },
            { columns: 1, fields: [{ key: 'annex_cover', type: 'component', printOnly: true, pageContext: 'cover' }] },
            { columns: 1, fields: [{ key: 'initiatives', type: 'entity-loop', collection: 'initiatives', templateRef: 'initiative', printOnly: true, pageContext: 'annex' }] },
          ],
        }],
      },
    },
  ];
}
