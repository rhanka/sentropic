/**
 * @experimental — mutation gating (published, NOT frozen, semver-exempt).
 *
 * - `assertMutationGate` / `invokeGuardedTool`: a mutating capability
 *   (`mutatesExternalSystem`) requires an elicitation gate + idempotency key +
 *   audit (§10 parity probes, §11 "Mutation gating").
 *
 * R1a (BR-42l): this is the mutation half of the former `guard.ts`, relocated to
 * `./experimental`. `GuardedInvokeDeps.audit` is retyped against the local
 * `AuditSinkPort` (a minimal audit port) — NOT the mock `InMemoryAuditSink` —
 * so this surface never structurally imports the `./testing` mock.
 *
 * MOCK-ONLY: in-memory; no network, no DB.
 */
import type { ElicitationManager } from '../elicitation.js';
import { idempotencyDigest } from '../digest.js';
import type { CapabilityTool } from '../manifest.js';
import type { AppToolInvocation, AppToolResult } from '../runtime.js';

/**
 * Minimal audit sink port the guarded mutation path emits through. A host injects
 * any implementation (DB/KMS-backed audit); the mock `InMemoryAuditSink`
 * (`./testing`) satisfies it structurally but is never referenced here.
 */
export interface AuditSinkPort {
  emit(event: unknown): Promise<void>;
}

export type MutationGateReason = 'gate_required' | 'idempotency_required';

export type MutationGateResult =
  | { ok: true }
  | { ok: false; missing: MutationGateReason[] };

/**
 * Verify a mutating capability's gate + idempotency before invocation. Read-only
 * capabilities pass through. A mutation missing its elicitation gate (resumed)
 * or idempotency key is denied fail-closed.
 *
 * The gate is NON-FUNGIBLE (§5/§11 replay): a `resumed` elicitation only releases
 * the gate for the SAME capability, session and principal it was raised for. A
 * resumed record for capability X, another session or another principal can never
 * be replayed to release the gate for this invocation.
 */
export function assertMutationGate(
  capability: CapabilityTool,
  envelope: AppToolInvocation,
  elicitations: ElicitationManager,
): MutationGateResult {
  if (!capability.mutatesExternalSystem) return { ok: true };
  const missing: MutationGateReason[] = [];

  const needsGate =
    capability.gates.requiresElicitation ||
    capability.gates.requiresHumanConfirmation ||
    capability.gates.requiresPrincipalGate;
  if (needsGate) {
    const ref = envelope.elicitationRef;
    const rec = ref ? elicitations.get(ref) : undefined;
    const bound =
      rec !== undefined &&
      rec.state === 'resumed' &&
      rec.capabilityRef === capability.name &&
      rec.sessionRef === envelope.ctx.session.mcpSessionId &&
      rec.actor.sub === envelope.ctx.principal.sub;
    if (!bound) missing.push('gate_required');
  }

  if (capability.idempotency.required && !envelope.idempotencyKey) {
    missing.push('idempotency_required');
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export type GuardedInvokeDeps = {
  elicitations: ElicitationManager;
  audit: AuditSinkPort;
  auditId: string;
  // The domain mutation, run only after the gate passes. Returns model-safe output.
  run: (envelope: AppToolInvocation) => Promise<unknown>;
};

/**
 * Full guarded mutation path: enforce gate + idempotency, run the mutation, then
 * emit a redacted audit event. Every successful mutation leaves an audit record;
 * a gate failure runs nothing and emits a denial audit event.
 */
export async function invokeGuardedTool(
  capability: CapabilityTool,
  envelope: AppToolInvocation,
  deps: GuardedInvokeDeps,
): Promise<AppToolResult> {
  const gate = assertMutationGate(capability, envelope, deps.elicitations);
  if (!gate.ok) {
    await deps.audit.emit({
      kind: 'tool.invoke.denied',
      auditId: deps.auditId,
      at: new Date().toISOString(),
      detail: { capability: capability.name, missing: gate.missing },
    });
    return {
      ok: false,
      auditId: deps.auditId,
      redactionClass: capability.redactionClass,
      error: { code: 'gate_failed', message: gate.missing.join(','), retriable: false },
    };
  }
  const output = await deps.run(envelope);
  await deps.audit.emit({
    kind: 'tool.invoke',
    auditId: deps.auditId,
    at: new Date().toISOString(),
    detail: {
      capability: capability.name,
      mutatesExternalSystem: capability.mutatesExternalSystem,
      // Fix G4: audit a stable opaque digest, never the raw caller-controlled
      // idempotencyKey (which may be a token / secret / PII string).
      idempotencyKeyDigest: idempotencyDigest(envelope.idempotencyKey),
    },
  });
  return { ok: true, output, auditId: deps.auditId, redactionClass: capability.redactionClass };
}
