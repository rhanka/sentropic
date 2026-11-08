import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { ARTIFACTS_TOOL_DEFINITIONS, ARTIFACTS_TOOL_NAMES } from '../src/mcp-core.js';
import { LIVE_INVITATION_TOOL_CLASSES } from '../src/git-tool-definitions.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createTransportWorld } from './fixtures/transport-world.js';
import { invitationWorld } from './fixtures/live-invitation-world.js';

const names = ['artifacts_live_invite', 'artifacts_live_accept_invitation', 'artifacts_live_revoke_invitation',
  'artifacts_live_invitations'] as const;
const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const sortKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(sortKeys) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => [k, sortKeys(v)])) : value;
const profileFor = (selected: readonly string[]) => ({ ...RADAR_ARTIFACTS_PROFILE, selectedCapabilities: selected,
  operations: selected.map(name => ({ operation: name.slice(10), defaults: {},
    limits: name === 'artifacts_live_invitations' ? {} : { idempotencyKeyMaxUnits: 256 } })) });

it('should keep the 35 previous definitions byte-identical and append the four invitation tools', () => {
  expect(ARTIFACTS_TOOL_NAMES).toHaveLength(39);
  expect(ARTIFACTS_TOOL_NAMES.slice(35)).toEqual(names);
  const previous = Object.fromEntries(ARTIFACTS_TOOL_NAMES.slice(0, 35).map(name => [name, ARTIFACTS_TOOL_DEFINITIONS[name]]));
  expect(createHash('sha256').update(JSON.stringify(sortKeys(previous))).digest('hex'))
    .toBe('3f14f08e9277cb926f08203033ea278a6069eb1528ad84db788f635b7a6a8277');
});

it('should freeze closed invitation schemas with the contract access classes', () => {
  for (const name of names) {
    const { inputSchema } = ARTIFACTS_TOOL_DEFINITIONS[name] as { inputSchema: Record<string, any> };
    expect(inputSchema).toMatchObject({ type: 'object', additionalProperties: false,
      properties: { artifactId: { type: 'string', pattern: UUID } } });
    expect(inputSchema.required).toContain('artifactId');
  }
  const invite = ARTIFACTS_TOOL_DEFINITIONS.artifacts_live_invite.inputSchema as Record<string, any>;
  expect(invite.required).toEqual(['artifactId', 'liveSessionId', 'userRef', 'expiresInSeconds', 'idempotencyKey']);
  expect(invite.properties.expiresInSeconds).toEqual({ type: 'integer', minimum: 300, maximum: 86400 });
  for (const name of ['artifacts_live_accept_invitation', 'artifacts_live_revoke_invitation'] as const) {
    expect((ARTIFACTS_TOOL_DEFINITIONS[name].inputSchema as any).required).toEqual(['artifactId', 'invitationId', 'idempotencyKey']);
  }
  for (const name of names.slice(0, 3)) {
    expect(ARTIFACTS_TOOL_DEFINITIONS[name]).toMatchObject({ mutability: 'state-transition',
      idempotency: { required: true, scope: 'principal' } });
  }
  expect(ARTIFACTS_TOOL_DEFINITIONS.artifacts_live_invitations).toMatchObject({ mutability: 'read-only',
    idempotency: { required: false } });
  expect(LIVE_INVITATION_TOOL_CLASSES).toEqual({ artifacts_live_invite: 'write', artifacts_live_accept_invitation: 'read',
    artifacts_live_revoke_invitation: 'read', artifacts_live_invitations: 'read' });
});

it('should select, validate and route the invitation tools without a new operation limit', () => {
  const profile = compileArtifactsProfile(profileFor(names));
  for (const name of names) expect(profile.capabilityForRoute('POST', '/' + name.slice(10))).toBe(name);
  const artifactId = '11111111-1111-4111-8111-111111111111';
  expect(profile.validate('artifacts_live_invitations', { artifactId })).toEqual({ artifactId });
  expect(() => profile.validate('artifacts_live_accept_invitation', { artifactId, invitationId: artifactId }))
    .toThrow();
  expect(() => compileArtifactsProfile({ ...profileFor(['artifacts_live_invite']),
    operations: [{ operation: 'live_invite', defaults: {}, limits: {} }] })).toThrow('incomplete operation profile');
});

it('should dispatch the invitation tools from HTTP and MCP to the live service', async () => {
  const v = invitationWorld(); const sid = await v.start();
  const world = createTransportWorld(['alice'], v.identity.storageScopeId, { profile: profileFor(names), live: v.w.service });
  const invite = { artifactId: v.identity.artifactId, liveSessionId: sid, userRef: 'ref-bob', expiresInSeconds: 900,
    idempotencyKey: 'http-invite' };
  expect(await world.http('/live_invite', invite)).toMatchObject({ ok: true, commitState: 'committed',
    result: { status: 200, body: { status: 'pending', liveSessionId: sid } } });
  expect(await world.mcp.execute({ tool: 'artifacts_live_invitations', args: { artifactId: v.identity.artifactId },
    invocation: world.invocation() })).toMatchObject({ ok: true, commitState: 'not_committed',
    result: { body: { liveSessionId: sid, invitations: [{ status: 'pending' }] } } });
});
