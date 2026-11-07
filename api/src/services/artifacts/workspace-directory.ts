import type { Pool } from 'pg';
import { ARTIFACT_AUTHORITY_SOURCE, artifactAuthority, artifactReadClient,
  type ArtifactHostIdentity, type CurrentArtifactIdentity } from './authorization';

/** Host tool descriptor: no arguments, a closed schema; never a registry provider tool. */
export const WORKSPACES_LIST_TOOL = Object.freeze({
  name: 'workspaces_list',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}), additionalProperties: false }),
});

export type WorkspaceDirectoryRole = 'viewer' | 'commenter' | 'editor' | 'admin';
export interface WorkspaceDirectoryEntry {
  readonly workspaceRef: string;
  readonly name: string;
  readonly role: WorkspaceDirectoryRole;
  readonly publishable: boolean;
}
export interface WorkspaceDirectory { readonly workspaces: WorkspaceDirectoryEntry[] }

/** Exactly the workspaces createArtifactAuthorization(...).current() finds readable for the
 * verified identity and its token tenant; publishable is that same decision's writable.
 * Returns null when the current credential is denied (revoked, expired, substituted).
 */
export function createWorkspaceDirectory(options: { pool: Pool; currentIdentity: CurrentArtifactIdentity }) {
  return async (identity: ArtifactHostIdentity): Promise<WorkspaceDirectory | null> => {
    const client = artifactReadClient(options.pool);
    // No workspace binding: a workspace-bound (chat turn) credential is never current here.
    const credential = await options.currentIdentity(client, identity, '');
    if (credential.readable !== true) return null;
    const { rows } = await client.query<{ workspace_ref: string; name: string; role: string; approved: boolean }>(
      `SELECT w.id AS workspace_ref, w.name, ${ARTIFACT_AUTHORITY_SOURCE}`,
      [identity.subject, identity.tenantId],
    );
    const workspaces = rows.flatMap((row): WorkspaceDirectoryEntry[] => {
      const authority = artifactAuthority(row, credential);
      return authority.readable ? [{ workspaceRef: row.workspace_ref, name: row.name,
        role: row.role as WorkspaceDirectoryRole, publishable: authority.writable }] : [];
    });
    // UTF-16 code unit order, independent of any database collation.
    const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return { workspaces: workspaces.sort((a, b) => order(a.name, b.name) || order(a.workspaceRef, b.workspaceRef)) };
  };
}
