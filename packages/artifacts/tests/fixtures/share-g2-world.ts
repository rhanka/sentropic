/**
 * Shared G2 world builder for the sharing-tool acceptance tests
 * (converged-r2 §2.3/§2.4/§2.5, §4 row G2). Internal principal ids are
 * deliberately distinct from the opaque userRefs so any leak of the internal
 * form is observable in model payloads.
 */
import { expect } from 'vitest';
import { RADAR_ARTIFACTS_PROFILE, type ArtifactProviderProfile } from '../../src/profile/index.js';
import type { SharingPolicyPort } from '../../src/server/ports.js';
import { createTransportWorld } from './transport-world.js';
import { createMemoryDirectory, type MemoryDirectory } from './memory-directory.js';

export const G2_SCOPE = 'scope-g2';
export const G2_ACCOUNTS = [
  { internalId: 'idp-sub-alice', userRef: 'ref-alice', displayName: 'Alice Author', email: 'alice@example.com' },
  { internalId: 'idp-sub-bob', userRef: 'ref-bob', displayName: 'Bob Reader', email: 'bob@example.com' },
  { internalId: 'idp-sub-carol', userRef: 'ref-carol', displayName: 'Carol Third', email: 'carol@example.com' },
  { internalId: 'idp-sub-farid', userRef: 'ref-farid', displayName: 'Farid Colleague', email: 'farid@example.com' },
  { internalId: 'idp-sub-farid-2', userRef: 'ref-farid-2', displayName: 'Farid Dupont', email: 'farid.dupont@example.com' },
  { internalId: 'idp-sub-peter', userRef: 'ref-peter', displayName: 'Peter Pending', email: 'peter@example.com', approved: false },
  { internalId: 'idp-sub-oscar', userRef: 'ref-oscar', displayName: 'Oscar Other', email: 'oscar@example.com', scopes: ['scope-other'] },
  { internalId: 'idp-sub-admin', userRef: 'ref-admin', displayName: 'Admin One', email: 'admin@example.com' },
] as const;
export const G2_ACTORS = G2_ACCOUNTS.map((account) => account.internalId);

/** Shipped radar profile with the G2 sharing tools selected (operations ship in radar since G2). */
export const g2Profile = (): ArtifactProviderProfile => ({
  ...RADAR_ARTIFACTS_PROFILE,
  selectedCapabilities: [...RADAR_ARTIFACTS_PROFILE.selectedCapabilities,
    'artifacts_set_access', 'artifacts_lookup_people', 'artifacts_list_access'],
});

export interface G2World {
  world: ReturnType<typeof createTransportWorld>;
  directory: MemoryDirectory;
  artifactId: string;
  lookup(actor: string, body: Record<string, unknown>): Promise<{ status: number; body: any }>;
  listAccess(actor: string): Promise<{ status: number; body: any }>;
  setAccess(args: Record<string, unknown>, actor?: string): Promise<{ status: number; body: any }>;
  get(actor: string): Promise<{ status: number; body: any }>;
  list(actor: string): Promise<{ status: number; body: any }>;
  setApproved(internalId: string, value: boolean): void;
}

export async function g2WorldWith(opts: {
  sharingPolicy?: SharingPolicyPort;
  actorIsAdmin?: (actorId: string, storageScopeId: string) => boolean | Promise<boolean>;
  withDirectory?: boolean;
} = {}): Promise<G2World> {
  const directory = createMemoryDirectory(G2_SCOPE, G2_ACCOUNTS);
  const world = createTransportWorld(G2_ACTORS, G2_SCOPE, {
    profile: g2Profile(),
    sharingPolicy: opts.sharingPolicy,
    actorIsAdmin: opts.actorIsAdmin,
    ...(opts.withDirectory === false ? {} : { directory }),
  });
  const ensured = await world.http('/ensure', { bindingName: 'page', idempotencyKey: 'ensure' });
  if (!ensured.ok) throw new Error('ensure failed');
  const artifactId = (ensured.result.body as { artifactId: string }).artifactId;
  // the transport world approves every listed actor by default; sync the
  // directory's initial approval state into the account guard
  for (const account of G2_ACCOUNTS) {
    if (account.approved === false) world.setAccountApproved(account.internalId, false);
  }
  const call = (method: string, path: string, body: unknown, actor: string) => world.app.handle({
    method, path, body, actorId: actor,
  }, world.invocation(actor));
  return {
    world, directory, artifactId,
    lookup: (actor, body) => call('POST', '/lookup_people', body, actor),
    listAccess: (actor) => call('POST', '/list_access', { artifactId }, actor),
    setAccess: (args, actor = 'idp-sub-alice') => call('POST', '/set_access', { artifactId, ...args }, actor),
    get: (actor) => call('GET', `/meta/${artifactId}`, undefined, actor),
    list: (actor) => call('POST', '/list', {}, actor),
    setApproved: (internalId, value) => { world.setAccountApproved(internalId, value); directory.setApproved(internalId, value); },
  };
}

/** Every internal id and full email that must never reach a model payload. */
const INTERNAL_FORMS = G2_ACCOUNTS.map((account) => account.internalId);
const FULL_EMAIL_RE = /[A-Za-z0-9._%+-]+@example\.com/;

export function expectNoInternalLeak(body: unknown) {
  const serialized = JSON.stringify(body);
  for (const internal of INTERNAL_FORMS) {
    expect(serialized).not.toContain(`"${internal}"`);
  }
  expect(serialized).not.toMatch(FULL_EMAIL_RE);
}
