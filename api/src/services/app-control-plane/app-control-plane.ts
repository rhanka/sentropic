/**
 * AppControlPlane — the PRODUCT control-plane service for apps (ARCH-01 / BR-45,
 * SPEC_EVOL_APP_CATALOG §2 Q2).
 *
 * Owns: `app_templates` lifecycle (draft→published[IMMUTABLE]→deprecated; family-grouped
 * version rows), `app_instances` (pin a PUBLISHED template@version + a separate
 * provisioning→active→suspended→retired state machine), `app_instance_hostnames`
 * (one host→one instance), `app_workspace_bindings` (M:N workspace↔instance).
 *
 * NOT here (boundaries): the `kind:'app'` catalog projection (D2 — BR-46), deployment
 * execution / `observed_state` runtime health (ARCH-17), any `@sentropic/contracts`
 * `TenantContext` mutation (BR-46 D0). Tenant = composite columns, NO re-key (ARCH-11).
 *
 * Concurrency: lifecycle transitions are atomic via `UPDATE ... WHERE id AND status=<from>`
 * (not read-then-update); instance creation runs in a transaction that locks the template
 * row (`FOR UPDATE`) so a concurrent deprecation cannot let an instance pin a non-published
 * template; binding upsert uses `ON CONFLICT`; hostname insert relies on the PK + 23505.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  appInstanceHostnames,
  appInstances,
  appTemplates,
  appWorkspaceBindings,
  type AppInstanceHostnameRow,
  type AppInstanceRow,
  type AppTemplateRow,
  type AppWorkspaceBindingRow,
} from '../../db/control-schema';

export class AppControlPlaneValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppControlPlaneValidationError';
  }
}

export class AppControlPlaneNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppControlPlaneNotFoundError';
  }
}

export class AppControlPlaneConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppControlPlaneConflictError';
  }
}

export type AppTemplateStatus = 'draft' | 'published' | 'deprecated';
export type AppEnvironment = 'prod' | 'preview' | 'local';
export type AppInstanceStatus = 'provisioning' | 'active' | 'suspended' | 'retired';

const MAX_TEMPLATES_PER_FAMILY = 500;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Official SemVer 2.0.0 regex (semver.org) — rejects leading zeros, accepts +build metadata.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const ENVIRONMENTS: ReadonlySet<string> = new Set(['prod', 'preview', 'local']);

// Instance lifecycle state machine (provisioning→active→suspended→retired).
const INSTANCE_TRANSITIONS: Readonly<Record<AppInstanceStatus, ReadonlyArray<AppInstanceStatus>>> = {
  provisioning: ['active', 'retired'],
  active: ['suspended', 'retired'],
  suspended: ['active', 'retired'],
  retired: [],
};

function isUniqueViolation(err: unknown): boolean {
  // drizzle wraps the pg error: the original 23505 sits on `.code` OR on `.cause.code`.
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

function first<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new AppControlPlaneNotFoundError('expected a returned row but got none');
  }
  return row;
}

export interface CreateTemplateInput {
  /** Stable app-family id; omit to start a new family. */
  readonly familyId?: string;
  readonly appSlug: string;
  readonly version: string;
  readonly blueprint: unknown;
  readonly blueprintSchemaVersion?: number;
}

export type DraftPatch = Partial<{ blueprint: unknown; blueprintSchemaVersion: number }>;

export interface CreateInstanceInput {
  readonly templateFamilyId: string;
  readonly templateVersion: string;
  readonly tenantId: string;
  readonly environment?: AppEnvironment;
  readonly desiredState?: unknown;
}

export interface BindWorkspaceInput {
  readonly appInstanceId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly allowedWorkspaceTypes?: ReadonlyArray<string>;
  readonly defaultWorkspaceTemplate?: string | null;
}

export interface AppControlPlane {
  createTemplate(input: CreateTemplateInput): Promise<AppTemplateRow>;
  updateDraft(id: string, patch: DraftPatch): Promise<AppTemplateRow>;
  publishTemplate(id: string): Promise<AppTemplateRow>;
  deprecateTemplate(id: string): Promise<AppTemplateRow>;
  getTemplate(id: string): Promise<AppTemplateRow | null>;
  listTemplates(filter?: { familyId?: string; appSlug?: string; status?: AppTemplateStatus }): Promise<AppTemplateRow[]>;
  createInstance(input: CreateInstanceInput): Promise<AppInstanceRow>;
  transitionInstance(id: string, toStatus: AppInstanceStatus): Promise<AppInstanceRow>;
  getInstance(id: string): Promise<AppInstanceRow | null>;
  listInstances(filter?: { tenantId?: string; templateFamilyId?: string }): Promise<AppInstanceRow[]>;
  addHostname(appInstanceId: string, hostname: string): Promise<AppInstanceHostnameRow>;
  getInstanceByHostname(hostname: string): Promise<AppInstanceRow | null>;
  bindWorkspace(input: BindWorkspaceInput): Promise<AppWorkspaceBindingRow>;
  listBindings(filter?: { appInstanceId?: string; tenantId?: string; workspaceId?: string }): Promise<AppWorkspaceBindingRow[]>;
}

export class PgAppControlPlane implements AppControlPlane {
  // -- templates ------------------------------------------------------------

  async createTemplate(input: CreateTemplateInput): Promise<AppTemplateRow> {
    if (!SLUG_RE.test(input.appSlug)) {
      throw new AppControlPlaneValidationError(`invalid app_slug (kebab-case): '${input.appSlug}'`);
    }
    if (!SEMVER_RE.test(input.version)) {
      throw new AppControlPlaneValidationError(`invalid version (semver): '${input.version}'`);
    }
    const familyId = input.familyId ?? randomUUID();
    const familyRows = await db
      .select({ appSlug: appTemplates.appSlug })
      .from(appTemplates)
      .where(eq(appTemplates.familyId, familyId));
    if (familyRows.length >= MAX_TEMPLATES_PER_FAMILY) {
      throw new AppControlPlaneValidationError(`version cap reached for family '${familyId}'`);
    }
    // Family invariant (no DB FK): a family groups versions of ONE app — one app_slug.
    const slugMismatch = familyRows.find((r) => r.appSlug !== input.appSlug);
    if (slugMismatch) {
      throw new AppControlPlaneValidationError(
        `family '${familyId}' is bound to app_slug '${slugMismatch.appSlug}', not '${input.appSlug}'`
      );
    }
    try {
      const rows = await db
        .insert(appTemplates)
        .values({
          id: randomUUID(),
          familyId,
          appSlug: input.appSlug,
          version: input.version,
          status: 'draft',
          blueprint: input.blueprint,
          ...(input.blueprintSchemaVersion !== undefined
            ? { blueprintSchemaVersion: input.blueprintSchemaVersion }
            : {}),
        })
        .returning();
      return first(rows);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppControlPlaneValidationError(`template ${input.appSlug}@${input.version} already exists`);
      }
      throw err;
    }
  }

  async updateDraft(id: string, patch: DraftPatch): Promise<AppTemplateRow> {
    const rows = await db
      .update(appTemplates)
      .set({
        ...(patch.blueprint !== undefined ? { blueprint: patch.blueprint } : {}),
        ...(patch.blueprintSchemaVersion !== undefined
          ? { blueprintSchemaVersion: patch.blueprintSchemaVersion }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(and(eq(appTemplates.id, id), eq(appTemplates.status, 'draft')))
      .returning();
    if (rows[0]) return rows[0];
    await this.assertTemplateStatus(id, 'draft', 'mutate');
    throw new AppControlPlaneValidationError(`template '${id}' update failed`);
  }

  async publishTemplate(id: string): Promise<AppTemplateRow> {
    return this.transitionTemplate(id, ['draft'], 'published');
  }

  async deprecateTemplate(id: string): Promise<AppTemplateRow> {
    // Lifecycle is draft→published→deprecated: only a PUBLISHED template deprecates.
    return this.transitionTemplate(id, ['published'], 'deprecated');
  }

  private async transitionTemplate(
    id: string,
    from: AppTemplateStatus[],
    to: AppTemplateStatus
  ): Promise<AppTemplateRow> {
    const rows = await db
      .update(appTemplates)
      .set({ status: to, updatedAt: sql`now()` })
      .where(and(eq(appTemplates.id, id), inArray(appTemplates.status, from)))
      .returning();
    if (rows[0]) return rows[0];
    const cur = await this.getTemplate(id);
    if (!cur) throw new AppControlPlaneNotFoundError(`template '${id}' not found`);
    throw new AppControlPlaneValidationError(
      `template '${id}' is '${cur.status}'; cannot transition to '${to}' (allowed from: ${from.join(',')})`
    );
  }

  private async assertTemplateStatus(id: string, expected: AppTemplateStatus, action: string): Promise<void> {
    const cur = await this.getTemplate(id);
    if (!cur) throw new AppControlPlaneNotFoundError(`template '${id}' not found`);
    if (cur.status !== expected) {
      throw new AppControlPlaneValidationError(`template '${id}' is '${cur.status}'; only '${expected}' can ${action}`);
    }
  }

  async getTemplate(id: string): Promise<AppTemplateRow | null> {
    const rows = await db.select().from(appTemplates).where(eq(appTemplates.id, id));
    return rows[0] ?? null;
  }

  async listTemplates(filter?: {
    familyId?: string;
    appSlug?: string;
    status?: AppTemplateStatus;
  }): Promise<AppTemplateRow[]> {
    const conds = [];
    if (filter?.familyId !== undefined) conds.push(eq(appTemplates.familyId, filter.familyId));
    if (filter?.appSlug !== undefined) conds.push(eq(appTemplates.appSlug, filter.appSlug));
    if (filter?.status !== undefined) conds.push(eq(appTemplates.status, filter.status));
    const where = conds.length > 0 ? and(...conds) : undefined;
    return db.select().from(appTemplates).where(where).orderBy(desc(appTemplates.createdAt));
  }

  // -- instances ------------------------------------------------------------

  async createInstance(input: CreateInstanceInput): Promise<AppInstanceRow> {
    const environment = input.environment ?? 'preview';
    if (!ENVIRONMENTS.has(environment)) {
      throw new AppControlPlaneValidationError(`invalid environment: '${environment}'`);
    }
    // Atomic: lock the pinned template row so a concurrent deprecate cannot race us.
    return db.transaction(async (tx) => {
      const tpl = await tx
        .select()
        .from(appTemplates)
        .where(and(eq(appTemplates.familyId, input.templateFamilyId), eq(appTemplates.version, input.templateVersion)))
        .for('update');
      const template = tpl[0];
      if (!template) {
        throw new AppControlPlaneNotFoundError(
          `template family '${input.templateFamilyId}' version '${input.templateVersion}' not found`
        );
      }
      if (template.status !== 'published') {
        throw new AppControlPlaneValidationError(
          `instances may only pin a PUBLISHED template (family '${input.templateFamilyId}'@${input.templateVersion} is '${template.status}')`
        );
      }
      const rows = await tx
        .insert(appInstances)
        .values({
          id: randomUUID(),
          templateFamilyId: input.templateFamilyId,
          templateVersion: input.templateVersion,
          tenantId: input.tenantId,
          environment,
          status: 'provisioning',
          ...(input.desiredState !== undefined ? { desiredState: input.desiredState } : {}),
        })
        .returning();
      return first(rows);
    });
  }

  async transitionInstance(id: string, toStatus: AppInstanceStatus): Promise<AppInstanceRow> {
    const allowedFrom = (Object.keys(INSTANCE_TRANSITIONS) as AppInstanceStatus[]).filter((from) =>
      INSTANCE_TRANSITIONS[from].includes(toStatus)
    );
    if (allowedFrom.length === 0) {
      throw new AppControlPlaneValidationError(`'${toStatus}' is not a reachable instance status`);
    }
    const rows = await db
      .update(appInstances)
      .set({ status: toStatus, updatedAt: sql`now()` })
      .where(and(eq(appInstances.id, id), inArray(appInstances.status, allowedFrom)))
      .returning();
    if (rows[0]) return rows[0];
    const cur = await this.getInstance(id);
    if (!cur) throw new AppControlPlaneNotFoundError(`instance '${id}' not found`);
    throw new AppControlPlaneValidationError(
      `instance '${id}' is '${cur.status}'; cannot transition to '${toStatus}'`
    );
  }

  async getInstance(id: string): Promise<AppInstanceRow | null> {
    const rows = await db.select().from(appInstances).where(eq(appInstances.id, id));
    return rows[0] ?? null;
  }

  async listInstances(filter?: { tenantId?: string; templateFamilyId?: string }): Promise<AppInstanceRow[]> {
    const conds = [];
    if (filter?.tenantId !== undefined) conds.push(eq(appInstances.tenantId, filter.tenantId));
    if (filter?.templateFamilyId !== undefined) conds.push(eq(appInstances.templateFamilyId, filter.templateFamilyId));
    const where = conds.length > 0 ? and(...conds) : undefined;
    return db.select().from(appInstances).where(where).orderBy(desc(appInstances.createdAt));
  }

  // -- hostnames ------------------------------------------------------------

  async addHostname(appInstanceId: string, hostname: string): Promise<AppInstanceHostnameRow> {
    const canonical = hostname.trim().toLowerCase();
    if (canonical.length === 0) {
      throw new AppControlPlaneValidationError('hostname must not be empty');
    }
    const instance = await this.getInstance(appInstanceId);
    if (!instance) throw new AppControlPlaneNotFoundError(`instance '${appInstanceId}' not found`);
    try {
      const rows = await db
        .insert(appInstanceHostnames)
        .values({ hostname: canonical, appInstanceId })
        .returning();
      return first(rows);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppControlPlaneConflictError(`hostname '${canonical}' is already bound to an instance`);
      }
      throw err;
    }
  }

  async getInstanceByHostname(hostname: string): Promise<AppInstanceRow | null> {
    const host = await db
      .select()
      .from(appInstanceHostnames)
      .where(eq(appInstanceHostnames.hostname, hostname.trim().toLowerCase()));
    if (!host[0]) return null;
    return this.getInstance(host[0].appInstanceId);
  }

  // -- workspace bindings ---------------------------------------------------

  async bindWorkspace(input: BindWorkspaceInput): Promise<AppWorkspaceBindingRow> {
    const instance = await this.getInstance(input.appInstanceId);
    if (!instance) throw new AppControlPlaneNotFoundError(`instance '${input.appInstanceId}' not found`);
    // Cross-tenant isolation (no DB FK): the binding tenant MUST match the instance's tenant,
    // else tenant B could create/hijack a binding on tenant A's instance.
    if (input.tenantId !== instance.tenantId) {
      throw new AppControlPlaneValidationError(
        `tenant '${input.tenantId}' cannot bind an instance owned by tenant '${instance.tenantId}'`
      );
    }
    const rows = await db
      .insert(appWorkspaceBindings)
      .values({
        id: randomUUID(),
        appInstanceId: input.appInstanceId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        ...(input.allowedWorkspaceTypes !== undefined ? { allowedWorkspaceTypes: [...input.allowedWorkspaceTypes] } : {}),
        defaultWorkspaceTemplate: input.defaultWorkspaceTemplate ?? null,
      })
      .onConflictDoUpdate({
        target: [appWorkspaceBindings.appInstanceId, appWorkspaceBindings.workspaceId],
        set: {
          tenantId: input.tenantId,
          ...(input.allowedWorkspaceTypes !== undefined ? { allowedWorkspaceTypes: [...input.allowedWorkspaceTypes] } : {}),
          ...(input.defaultWorkspaceTemplate !== undefined
            ? { defaultWorkspaceTemplate: input.defaultWorkspaceTemplate }
            : {}),
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return first(rows);
  }

  async listBindings(filter?: {
    appInstanceId?: string;
    tenantId?: string;
    workspaceId?: string;
  }): Promise<AppWorkspaceBindingRow[]> {
    const conds = [];
    if (filter?.appInstanceId !== undefined) conds.push(eq(appWorkspaceBindings.appInstanceId, filter.appInstanceId));
    if (filter?.tenantId !== undefined) conds.push(eq(appWorkspaceBindings.tenantId, filter.tenantId));
    if (filter?.workspaceId !== undefined) conds.push(eq(appWorkspaceBindings.workspaceId, filter.workspaceId));
    const where = conds.length > 0 ? and(...conds) : undefined;
    return db.select().from(appWorkspaceBindings).where(where).orderBy(desc(appWorkspaceBindings.createdAt));
  }
}

/** Process-wide singleton. */
export const appControlPlane: AppControlPlane = new PgAppControlPlane();
