import type { IdentityImportRowV1, IdentityEmailTicketTokenPortV1 } from '@sentropic/cluster-mesh';
import type { PoolClient } from 'pg';
import { mapA4Account, mapA4Credential, mapA4Login, mapA4Proof } from './cm-import-mapping';
import { mapA4EmailTicket, mapA4Invitation, mapA4Social } from './cm-import-continuations';
import { mapA4OAuthConsent, mapA4ServiceClient, mapA4Tenant, mapA4TenantMembership,
  mapA4Workspace, mapA4WorkspaceMembership } from './cm-import-tenancy';
import { invalidA4Import, type A4SourceRow } from './cm-import-values';

export const a4IdentitySourceTables = ['users', 'webauthn_credentials', 'webauthn_challenges',
  'email_verification_codes', 'magic_links', 'auth_invite_tokens', 'user_sessions', 'identities',
  'tenants', 'tenant_memberships', 'workspaces', 'workspace_memberships', 'oauth_consents', 'service_clients'] as const;
type Table = typeof a4IdentitySourceTables[number];
export interface A4SourceSnapshot {
  readonly rows: ReadonlyMap<Table, readonly A4SourceRow[]>;
  readonly inventory: Readonly<Record<string, { readonly count: number; readonly fields: readonly string[] }>>;
}

/** Called on the migration connection after legacy writers have been quiesced. */
export async function readA4IdentitySource(client: PoolClient): Promise<A4SourceSnapshot> {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  // The table names are fixed source inventory, never request or configuration input.
  await client.query(`LOCK TABLE ${a4IdentitySourceTables.map(table => `public.${table}`).join(', ')},
    public.federation_flow_states, public.settings, public.document_connector_accounts,
    control.event_outbox IN ACCESS EXCLUSIVE MODE`);
  const live = await client.query('SELECT count(*)::int AS count FROM public.federation_flow_states WHERE expires_at > now()');
  const secrets = await client.query('SELECT count(*)::int AS count FROM public.identities WHERE token_secret IS NOT NULL');
  if (live.rows[0]?.count !== 0 || secrets.rows[0]?.count !== 0) return invalidA4Import();
  const rows = new Map<Table, readonly A4SourceRow[]>();
  const inventory: Record<string, { count: number; fields: string[] }> = {};
  for (const table of a4IdentitySourceTables) {
    const fields = await client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table]);
    const result = await client.query<{ source: A4SourceRow }>(`SELECT to_jsonb(source) AS source FROM public.${table} source`);
    rows.set(table, result.rows.map(row => row.source));
    inventory[table] = { count: result.rows.length, fields: fields.rows.map(row => row.column_name) };
  }
  return { rows, inventory };
}

export async function mapA4IdentitySource(source: A4SourceSnapshot, options: {
  readonly importedAt: string; readonly rpId: string; readonly origins: readonly string[];
  readonly ticketTokens: IdentityEmailTicketTokenPortV1;
  readonly remotelyRevokedSessionIds: ReadonlySet<string>;
}): Promise<IdentityImportRowV1[]> {
  const rows: IdentityImportRowV1[] = [];
  const each = (table: Table): readonly A4SourceRow[] => source.rows.get(table) ?? invalidA4Import();
  for (const row of each('users')) rows.push(mapA4Account(row));
  for (const row of each('webauthn_credentials')) rows.push({ entity: 'credential', record: mapA4Credential(row, options.rpId) });
  for (const [table, kind] of [['webauthn_challenges', 'webauthn_challenge'], ['email_verification_codes', 'email_code'],
    ['magic_links', 'magic_link']] as const) {
    for (const row of each(table)) rows.push({ entity: 'single_use_proof', record: mapA4Proof(kind, row, options) });
  }
  for (const row of each('email_verification_codes')) {
    const ticket = await mapA4EmailTicket(row, options.ticketTokens);
    if (ticket) rows.push({ entity: 'email_ticket', record: ticket });
  }
  for (const row of each('auth_invite_tokens')) rows.push({ entity: 'invitation', record: mapA4Invitation(row) });
  for (const row of each('user_sessions')) rows.push({ entity: 'login_session',
    record: mapA4Login(row, options.importedAt, options.remotelyRevokedSessionIds.has(String(row.id))) });
  for (const row of each('identities')) rows.push({ entity: 'social_link', record: mapA4Social(row) });
  for (const row of each('tenants')) rows.push({ entity: 'tenant', record: mapA4Tenant(row) });
  for (const row of each('tenant_memberships')) rows.push({ entity: 'tenant_membership', record: mapA4TenantMembership(row) });
  for (const row of each('workspaces')) rows.push({ entity: 'workspace', record: mapA4Workspace(row) });
  for (const row of each('workspace_memberships')) rows.push({ entity: 'workspace_membership', record: mapA4WorkspaceMembership(row) });
  for (const row of each('oauth_consents')) rows.push({ entity: 'oauth_consent', record: mapA4OAuthConsent(row) });
  for (const row of each('service_clients')) {
    // A null protocol tenant grants no tenant authority and remains null in the protocol table.
    if (row.tenant_id !== null) rows.push({ entity: 'service_client', record: mapA4ServiceClient(row) });
  }
  return rows;
}
