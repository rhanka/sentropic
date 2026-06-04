import { describe, expect, it } from 'vitest';

import { InMemorySkillRegistry } from '../../src/registry/registry.js';
import {
  isSkillVisibleTo,
  resolveAuthorizedTools,
} from '../../src/registry/resolve.js';
import type { AuthzContext } from '../../src/registry/authz.js';
import type { Skill } from '../../src/types/skill.js';
import type { SkillMetadata } from '../../src/types/metadata.js';

const buildSkill = (
  name: string,
  meta: Partial<SkillMetadata> = {},
  toolNames: ReadonlyArray<string> = [`${name}_run`],
): Skill => ({
  metadata: {
    name,
    description: meta.description ?? `${name} description`,
    version: meta.version ?? '1.0.0',
    category: meta.category ?? 'test',
    contextFilter: meta.contextFilter,
    sandbox: meta.sandbox,
    authzRequirements: meta.authzRequirements,
    toolNames,
  },
  tools: toolNames.map((toolName) => ({
    name: toolName,
    description: `${toolName} tool`,
    inputSchema: { type: 'object' },
  })),
  body: '',
});

const buildAuthz = (overrides: Partial<AuthzContext> = {}): AuthzContext => ({
  tenant: { tenantId: 't-1', workspaceType: 'ai-priorities' },
  roles: ['editor'],
  permissions: [],
  permissionMode: 'open',
  allowedTools: [],
  ...overrides,
});

describe('isSkillVisibleTo', () => {
  it('exposes a skill with no contextFilter to any caller', () => {
    const meta = buildSkill('public').metadata;
    expect(isSkillVisibleTo(meta, buildAuthz())).toBe(true);
  });

  it('denies when workspaceTypes does not include the caller workspace', () => {
    const meta = buildSkill('docs', {
      contextFilter: { workspaceTypes: ['opportunity'] },
    }).metadata;
    expect(isSkillVisibleTo(meta, buildAuthz({ tenant: { tenantId: 't', workspaceType: 'ai-priorities' } }))).toBe(false);
  });

  it('denies when caller has no workspaceType but skill declares one', () => {
    const meta = buildSkill('docs', {
      contextFilter: { workspaceTypes: ['ai-priorities'] },
    }).metadata;
    expect(isSkillVisibleTo(meta, buildAuthz({ tenant: { tenantId: 't' } }))).toBe(false);
  });

  it('exposes when caller has at least one matching role', () => {
    const meta = buildSkill('docs', {
      contextFilter: { roles: ['admin', 'editor'] },
    }).metadata;
    expect(isSkillVisibleTo(meta, buildAuthz({ roles: ['editor'] }))).toBe(true);
  });

  it('denies when caller has none of the required roles', () => {
    const meta = buildSkill('docs', {
      contextFilter: { roles: ['admin'] },
    }).metadata;
    expect(isSkillVisibleTo(meta, buildAuthz({ roles: ['editor'] }))).toBe(false);
  });

  it('requires every authzRequirements.permission (AND-combined)', () => {
    const meta = buildSkill('docs', {
      authzRequirements: { permissions: ['document.generate', 'document.export'] },
    }).metadata;
    expect(
      isSkillVisibleTo(meta, buildAuthz({ permissions: ['document.generate'] })),
    ).toBe(false);
    expect(
      isSkillVisibleTo(meta, buildAuthz({ permissions: ['document.generate', 'document.export'] })),
    ).toBe(true);
  });
});

describe('resolveAuthorizedTools (open mode)', () => {
  it('returns every visible tool from every visible skill', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', {}, ['web_search', 'web_extract']));
    reg.register(buildSkill('docs', {}, ['document_generate']));
    const tools = resolveAuthorizedTools(
      [reg.get('web')!, reg.get('docs')!],
      buildAuthz(),
    );
    expect(tools.map((t) => t.name).sort()).toEqual([
      'document_generate',
      'web_extract',
      'web_search',
    ]);
    expect(tools.find((t) => t.name === 'web_search')!.skillName).toBe('web');
  });

  it('drops tools whose owning skill fails contextFilter', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', {}, ['web_search']));
    reg.register(
      buildSkill(
        'admin-only',
        { contextFilter: { roles: ['admin'] } },
        ['admin_purge'],
      ),
    );
    const tools = resolveAuthorizedTools(
      [reg.get('web')!, reg.get('admin-only')!],
      buildAuthz({ roles: ['editor'] }),
    );
    expect(tools.map((t) => t.name)).toEqual(['web_search']);
  });

  it('narrows to a single skill via options.skillName', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', {}, ['web_search']));
    reg.register(buildSkill('docs', {}, ['document_generate']));
    const tools = resolveAuthorizedTools(
      [reg.get('web')!, reg.get('docs')!],
      buildAuthz(),
      { skillName: 'docs' },
    );
    expect(tools.map((t) => t.name)).toEqual(['document_generate']);
  });
});

describe('resolveAuthorizedTools (allowlist mode)', () => {
  it('exposes only tools whose name is in allowedTools', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', {}, ['web_search', 'web_extract']));
    const authz = buildAuthz({
      permissionMode: 'allowlist',
      allowedTools: ['web_search'],
    });
    const tools = resolveAuthorizedTools([reg.get('web')!], authz);
    expect(tools.map((t) => t.name)).toEqual(['web_search']);
  });

  it('returns empty when allowedTools is empty in allowlist mode', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(buildSkill('web', {}, ['web_search']));
    const tools = resolveAuthorizedTools(
      [reg.get('web')!],
      buildAuthz({ permissionMode: 'allowlist', allowedTools: [] }),
    );
    expect(tools).toEqual([]);
  });

  it('still requires skill visibility before the allowlist check', () => {
    const reg = new InMemorySkillRegistry();
    reg.register(
      buildSkill(
        'admin-only',
        { contextFilter: { roles: ['admin'] } },
        ['admin_purge'],
      ),
    );
    const tools = resolveAuthorizedTools(
      [reg.get('admin-only')!],
      buildAuthz({
        roles: ['editor'],
        permissionMode: 'allowlist',
        allowedTools: ['admin_purge'],
      }),
    );
    expect(tools).toEqual([]);
  });
});
