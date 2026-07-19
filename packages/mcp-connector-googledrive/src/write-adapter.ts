/**
 * BR-72 Wave-2 Lot 2 — Google Drive EXPERIMENTAL write-surface adapter.
 *
 * MUTATION ONLY. Every write tool routes through `invokeGuardedTool` —
 * `@sentropic/mcp-platform`'s guarded mutation path (`../../mcp-platform/src/
 * experimental/mutation-gate.ts`) — which calls `assertMutationGate` BEFORE
 * any mutation runs. A tool missing its gate (unresumed elicitation, given
 * every write tool here declares `gates.requiresPrincipalGate: true`) or its
 * idempotency key is REJECTED fail-closed and the synthetic mutation never
 * executes. Every outcome (denied or succeeded) is audited.
 *
 * Synthetic fixtures only (`./write-fixtures.ts`) — no real network call is
 * ever made. Recoded independently against the Sentropic
 * `@sentropic/mcp-platform` EXPERIMENTAL contract; not the production
 * connector (production connector residence is an architect D4 decision,
 * deferred).
 */
import { invokeGuardedTool } from '../../mcp-platform/src/experimental/mutation-gate.js';
import type {
  AuditSinkPort,
  GuardedInvokeDeps,
} from '../../mcp-platform/src/experimental/mutation-gate.js';
import type { ElicitationManager } from '../../mcp-platform/src/elicitation.js';
import type { AppToolInvocation, AppToolResult } from '../../mcp-platform/src/runtime.js';
import { getWriteToolFixture } from './write-fixtures.js';
import { googleDriveWriteManifest, googleDriveWriteToolsByName } from './write-manifest.js';

let writeAuditSequence = 0;
function nextWriteAuditId(): string {
  writeAuditSequence += 1;
  return `googledrive-write-tool-${writeAuditSequence}`;
}

/** Dependencies a host injects to drive a guarded Google Drive write invocation. */
export type GoogleDriveWriteInvokeDeps = {
  elicitations: ElicitationManager;
  audit: AuditSinkPort;
};

/**
 * Invoke a Google Drive write capability. Looks the capability up in the
 * EXPERIMENTAL write manifest, then delegates to `invokeGuardedTool` — which
 * calls `assertMutationGate` first and only runs the synthetic mutation (a
 * fixture lookup) once the gate + idempotency key are satisfied.
 */
export async function invokeGoogleDriveWriteTool(
  req: AppToolInvocation,
  deps: GoogleDriveWriteInvokeDeps,
): Promise<AppToolResult> {
  const capability = googleDriveWriteToolsByName.get(req.capabilityRef);
  if (!capability) {
    return {
      ok: false,
      auditId: nextWriteAuditId(),
      redactionClass: 'none',
      error: {
        code: 'unknown_tool',
        message: `No write capability registered for tool "${req.capabilityRef}".`,
        retriable: false,
      },
    };
  }

  const guardedDeps: GuardedInvokeDeps = {
    elicitations: deps.elicitations,
    audit: deps.audit,
    auditId: nextWriteAuditId(),
    run: async () => getWriteToolFixture(capability.name),
  };

  return invokeGuardedTool(capability, req, guardedDeps);
}

export const googleDriveWriteAdapter = {
  manifest: googleDriveWriteManifest,
  invokeTool: invokeGoogleDriveWriteTool,
};
