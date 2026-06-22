/**
 * app-control-plane.test.ts — BR-45 / ARCH-01 (SPEC_EVOL_APP_CATALOG §2 Q2).
 *
 * Covers: template lifecycle (draft mutable → published IMMUTABLE → deprecated +
 * invalid transitions) with family-grouped versions, instance pinning a PUBLISHED
 * template@version + the provisioning→active→suspended→retired state machine,
 * hostname uniqueness (one host→one instance), and workspace-binding upsert.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  appInstanceHostnames,
  appInstances,
  appTemplates,
  appWorkspaceBindings,
} from '../../src/db/control-schema';
import {
  PgAppControlPlane,
  AppControlPlaneValidationError,
  AppControlPlaneNotFoundError,
  AppControlPlaneConflictError,
} from '../../src/services/app-control-plane';

const SLUG_PREFIX = 'test-acp-';
const HOST_PREFIX = 'test-acp-';
const TENANT = 'test-acp-tenant';
const acp = new PgAppControlPlane();

async function cleanup(): Promise<void> {
  await db.delete(appInstanceHostnames).where(sql`${appInstanceHostnames.hostname} like ${HOST_PREFIX + '%'}`);
  await db.delete(appWorkspaceBindings).where(sql`${appWorkspaceBindings.tenantId} = ${TENANT}`);
  await db.delete(appInstances).where(sql`${appInstances.tenantId} = ${TENANT}`);
  await db.delete(appTemplates).where(sql`${appTemplates.appSlug} like ${SLUG_PREFIX + '%'}`);
}

beforeEach(cleanup);
afterEach(cleanup);

function draft(slug: string, version = '1.0.0', familyId?: string) {
  return { ...(familyId ? { familyId } : {}), appSlug: SLUG_PREFIX + slug, version, blueprint: { packages: [] } };
}

async function publishedTemplate(slug: string, version = '1.0.0') {
  const t = await acp.createTemplate(draft(slug, version));
  return acp.publishTemplate(t.id);
}

describe('AppControlPlane — templates', () => {
  it('creates a draft; rejects bad slug/version; enforces (app_slug, version) uniqueness', async () => {
    const t = await acp.createTemplate(draft('alpha'));
    expect(t.status).toBe('draft');
    expect(t.familyId).toBeTruthy();
    await expect(acp.createTemplate(draft('Bad_Slug'))).rejects.toBeInstanceOf(AppControlPlaneValidationError);
    await expect(acp.createTemplate({ ...draft('beta'), version: '01.2.3' })).rejects.toBeInstanceOf(
      AppControlPlaneValidationError
    );
    await expect(acp.createTemplate(draft('alpha'))).rejects.toBeInstanceOf(AppControlPlaneValidationError);
  });

  it('groups versions under one family_id', async () => {
    const v1 = await acp.createTemplate(draft('gamma', '1.0.0'));
    const v2 = await acp.createTemplate(draft('gamma', '1.1.0', v1.familyId));
    expect(v2.familyId).toBe(v1.familyId);
    const versions = await acp.listTemplates({ familyId: v1.familyId });
    expect(versions).toHaveLength(2);
  });

  it('enforces family = one app_slug (rejects a version bound to a different slug)', async () => {
    const v1 = await acp.createTemplate(draft('mono', '1.0.0'));
    await expect(
      acp.createTemplate(draft('other', '2.0.0', v1.familyId))
    ).rejects.toBeInstanceOf(AppControlPlaneValidationError);
  });

  it('lifecycle: draft mutable → published immutable → deprecated; invalid transitions rejected', async () => {
    const t = await acp.createTemplate(draft('delta'));
    const patched = await acp.updateDraft(t.id, { blueprintSchemaVersion: 2 });
    expect(patched.blueprintSchemaVersion).toBe(2);

    const published = await acp.publishTemplate(t.id);
    expect(published.status).toBe('published');
    await expect(acp.updateDraft(t.id, { blueprintSchemaVersion: 3 })).rejects.toBeInstanceOf(
      AppControlPlaneValidationError
    );
    await expect(acp.publishTemplate(t.id)).rejects.toBeInstanceOf(AppControlPlaneValidationError);

    const deprecated = await acp.deprecateTemplate(t.id);
    expect(deprecated.status).toBe('deprecated');
    // re-deprecate rejected
    await expect(acp.deprecateTemplate(t.id)).rejects.toBeInstanceOf(AppControlPlaneValidationError);
  });

  it('cannot deprecate a draft (lifecycle is draft→published→deprecated)', async () => {
    const t = await acp.createTemplate(draft('zeta'));
    await expect(acp.deprecateTemplate(t.id)).rejects.toBeInstanceOf(AppControlPlaneValidationError);
  });

  it('rejects publish/deprecate of a missing template', async () => {
    await expect(acp.publishTemplate('nope')).rejects.toBeInstanceOf(AppControlPlaneNotFoundError);
    await expect(acp.deprecateTemplate('nope')).rejects.toBeInstanceOf(AppControlPlaneNotFoundError);
  });
});

describe('AppControlPlane — instances', () => {
  it('pins a PUBLISHED template@version exactly; starts provisioning', async () => {
    const t = await acp.createTemplate(draft('epsilon'));
    // a draft template cannot back an instance
    await expect(
      acp.createInstance({ templateFamilyId: t.familyId, templateVersion: '1.0.0', tenantId: TENANT })
    ).rejects.toBeInstanceOf(AppControlPlaneValidationError);

    await acp.publishTemplate(t.id);
    // version mismatch → not found (no published row for that family@version)
    await expect(
      acp.createInstance({ templateFamilyId: t.familyId, templateVersion: '9.9.9', tenantId: TENANT })
    ).rejects.toBeInstanceOf(AppControlPlaneNotFoundError);

    const inst = await acp.createInstance({
      templateFamilyId: t.familyId,
      templateVersion: '1.0.0',
      tenantId: TENANT,
      environment: 'preview',
    });
    expect(inst.status).toBe('provisioning');
    expect(inst.environment).toBe('preview');
  });

  it('walks the instance state machine and rejects illegal transitions', async () => {
    const t = await publishedTemplate('eta');
    const inst = await acp.createInstance({ templateFamilyId: t.familyId, templateVersion: '1.0.0', tenantId: TENANT });
    // provisioning → suspended is illegal
    await expect(acp.transitionInstance(inst.id, 'suspended')).rejects.toBeInstanceOf(AppControlPlaneValidationError);
    expect((await acp.transitionInstance(inst.id, 'active')).status).toBe('active');
    expect((await acp.transitionInstance(inst.id, 'suspended')).status).toBe('suspended');
    expect((await acp.transitionInstance(inst.id, 'retired')).status).toBe('retired');
    // retired is terminal
    await expect(acp.transitionInstance(inst.id, 'active')).rejects.toBeInstanceOf(AppControlPlaneValidationError);
  });
});

describe('AppControlPlane — hostnames', () => {
  it('binds one host to exactly one instance (canonical lowercase)', async () => {
    const t = await publishedTemplate('theta');
    const inst = await acp.createInstance({ templateFamilyId: t.familyId, templateVersion: '1.0.0', tenantId: TENANT });
    const host = `${HOST_PREFIX}App.Example.COM`;
    const bound = await acp.addHostname(inst.id, host);
    expect(bound.hostname).toBe(`${HOST_PREFIX}app.example.com`);

    const resolved = await acp.getInstanceByHostname(host);
    expect(resolved?.id).toBe(inst.id);

    // a second instance cannot claim the same hostname
    const inst2 = await acp.createInstance({ templateFamilyId: t.familyId, templateVersion: '1.0.0', tenantId: TENANT });
    await expect(acp.addHostname(inst2.id, host)).rejects.toBeInstanceOf(AppControlPlaneConflictError);
  });
});

describe('AppControlPlane — workspace bindings', () => {
  it('upserts a binding idempotently on (instance, workspace)', async () => {
    const t = await publishedTemplate('iota');
    const inst = await acp.createInstance({ templateFamilyId: t.familyId, templateVersion: '1.0.0', tenantId: TENANT });
    const a = await acp.bindWorkspace({
      appInstanceId: inst.id,
      workspaceId: 'ws-1',
      tenantId: TENANT,
      allowedWorkspaceTypes: ['ai-priorities'],
    });
    const b = await acp.bindWorkspace({
      appInstanceId: inst.id,
      workspaceId: 'ws-1',
      tenantId: TENANT,
      allowedWorkspaceTypes: ['ai-priorities', 'code'],
    });
    expect(b.id).toBe(a.id);
    expect(b.allowedWorkspaceTypes).toEqual(['ai-priorities', 'code']);

    const listed = await acp.listBindings({ appInstanceId: inst.id });
    expect(listed).toHaveLength(1);
  });

  it('rejects a cross-tenant workspace binding (isolation, no DB FK)', async () => {
    const t = await publishedTemplate('kappa');
    const inst = await acp.createInstance({ templateFamilyId: t.familyId, templateVersion: '1.0.0', tenantId: TENANT });
    await expect(
      acp.bindWorkspace({ appInstanceId: inst.id, workspaceId: 'ws-x', tenantId: 'other-acp-tenant', allowedWorkspaceTypes: [] })
    ).rejects.toBeInstanceOf(AppControlPlaneValidationError);
  });
});
