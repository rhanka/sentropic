/**
 * BR-72 Wave-2 Lot 3 — Gmail EXPERIMENTAL write-surface tests.
 *
 * Everything under test is imported from `../src/experimental.ts` (never a
 * write-* module directly) so these tests also prove the experimental entry
 * wiring actually re-exports a working surface. Asserts: every write tool
 * declares `mutatesExternalSystem: true` + `idempotency.required: true` (scope
 * `principal`); the 2 destructive/external tools (`send_email`, `delete_draft`)
 * declare `gates.requiresHumanConfirmation: true`, others do not; an ungated
 * mutation is REJECTED by `assertMutationGate` (both directly and through
 * `invokeGmailWriteTool`); a properly-gated + idempotent mutation succeeds
 * with a synthetic fixture result. No real network. The read-only Wave-1 root
 * (`../src/index.ts`) is asserted to remain mutation-free (regression guard).
 */
import { describe, expect, it, vi } from 'vitest';
import { assertMutationGate } from '../../mcp-platform/src/experimental/mutation-gate.js';
import { ElicitationManager, type Completer } from '../../mcp-platform/src/elicitation.js';
import type { AppToolInvocation, StpConnectorContext } from '../../mcp-platform/src/runtime.js';
import { gmailManifest } from '../src/index.js';
import {
  getWriteToolFixture,
  gmailWriteManifest,
  gmailWriteToolsByName,
  invokeGmailWriteTool,
} from '../src/experimental.js';

const DESTRUCTIVE_TOOL_NAMES = new Set(['send_email', 'delete_draft']);
const WRITE_TOOL_NAMES = [
  'send_email',
  'create_draft',
  'update_draft',
  'delete_draft',
  'create_label',
  'add_label_to_email',
  'move_to_trash',
  'create_filter',
];

function makeCtx(getSecretSpy: ReturnType<typeof vi.fn>): StpConnectorContext {
  return {
    requestId: 'req-1',
    correlationId: 'corr-1',
    auditId: 'audit-seed',
    principal: {
      sub: 'user-1',
      claims: {},
      scopes: [
        'gmail.readonly',
        'gmail.compose',
        'gmail.send',
        'gmail.modify',
        'gmail.labels',
        'gmail.settings.basic',
      ],
      tenantRef: 'tenant-1',
      authTime: new Date().toISOString(),
    },
    surface: 'backend',
    session: { mcpSessionId: 'session-1' },
    tenantRef: 'tenant-1',
    connectorInstanceId: 'connector-instance-1',
    consentRefs: [],
    grantRefs: [],
    getSecret: getSecretSpy,
    connectorConfig: {},
    audit: { emit: vi.fn(async () => {}) },
    logger: console,
  };
}

/** Drive an elicitation through the forward path to `resumed` (§5.1). */
function driveElicitationToResumed(
  elicitations: ElicitationManager,
  input: { id: string; capabilityRef: string; sessionRef: string; sub: string },
): void {
  elicitations.create({
    id: input.id,
    mode: 'confirm',
    sessionRef: input.sessionRef,
    capabilityRef: input.capabilityRef,
    actor: { sub: input.sub },
    ttlSeconds: 300,
    auditId: 'audit-elicit-1',
  });
  elicitations.render(input.id);
  const completer: Completer = { sub: input.sub, isHuman: true };
  elicitations.answer(input.id, completer);
  elicitations.validate(input.id);
  elicitations.resume(input.id);
}

describe('gmail connector EXPERIMENTAL write surface (BR-72 Wave-2 Lot 3)', () => {
  it('declares exactly the 8 planned write tools', () => {
    const names = gmailWriteManifest.tools.map((t) => t.name).sort();
    expect(names).toEqual([...WRITE_TOOL_NAMES].sort());
    expect(gmailWriteManifest.resources).toHaveLength(0);
  });

  it('every write tool declares mutatesExternalSystem:true and idempotency.required:true (scope principal)', () => {
    for (const tool of gmailWriteManifest.tools) {
      expect(tool.mutatesExternalSystem).toBe(true);
      expect(tool.idempotency.required).toBe(true);
      expect(tool.idempotency.scope).toBe('principal');
      expect(['write', 'workflow', 'transaction']).toContain(tool.category);
      expect(tool.gates.requiresPrincipalGate).toBe(true);
      expect(tool.gates.requiresPolicy).toBe(true);
    }
  });

  it('destructive/external tools (send_email, delete_draft) require human confirmation; others do not', () => {
    for (const tool of gmailWriteManifest.tools) {
      if (DESTRUCTIVE_TOOL_NAMES.has(tool.name)) {
        expect(tool.gates.requiresHumanConfirmation).toBe(true);
        if (tool.name === 'send_email') {
          expect(tool.mutability).toBe('append');
          expect(tool.category).toBe('transaction');
        } else if (tool.name === 'delete_draft') {
          expect(tool.mutability).toBe('delete');
          expect(tool.category).toBe('transaction');
        }
      } else {
        expect(tool.gates.requiresHumanConfirmation).toBe(false);
      }
    }
  });

  it('the read-only Wave-1 root manifest stays mutation-free (regression guard)', () => {
    for (const resource of gmailManifest.resources) {
      expect(resource.mutatesExternalSystem).toBe(false);
    }
    for (const tool of gmailManifest.tools) {
      expect(tool.mutatesExternalSystem).toBe(false);
    }
    const readOnlyToolNames = gmailManifest.tools.map((t) => t.name);
    for (const writeName of WRITE_TOOL_NAMES) {
      expect(readOnlyToolNames).not.toContain(writeName);
    }
  });

  it('assertMutationGate rejects an ungated mutation (no elicitation, no idempotency key)', () => {
    const elicitations = new ElicitationManager();
    const capability = gmailWriteToolsByName.get('create_draft');
    expect(capability).toBeDefined();
    const ctx = makeCtx(vi.fn(async () => 'SHOULD_NOT_BE_CALLED'));
    const envelope: AppToolInvocation = {
      capabilityRef: 'create_draft',
      input: { to: ['test@example.invalid'], subject: 'Synthetic subject', body: 'Body' },
      ctx,
    };
    const gate = assertMutationGate(capability!, envelope, elicitations);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.missing).toContain('gate_required');
      expect(gate.missing).toContain('idempotency_required');
    }
  });

  for (const capabilityRef of WRITE_TOOL_NAMES) {
    it(`invokeGmailWriteTool(${capabilityRef}) rejects an ungated invocation with ok:false + gate_failed, never touches getSecret`, async () => {
      const elicitations = new ElicitationManager();
      const auditEmit = vi.fn(async () => {});
      const getSecretSpy = vi.fn(async () => 'SHOULD_NOT_BE_CALLED');
      const ctx = makeCtx(getSecretSpy);
      const result = await invokeGmailWriteTool(
        { capabilityRef, input: {}, ctx },
        { elicitations, audit: { emit: auditEmit } },
      );
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('gate_failed');
      expect(auditEmit).toHaveBeenCalled();
      expect(getSecretSpy).not.toHaveBeenCalled();
    });
  }

  for (const capabilityRef of WRITE_TOOL_NAMES) {
    it(`invokeGmailWriteTool(${capabilityRef}) succeeds once gated + idempotent, returning the synthetic fixture`, async () => {
      const elicitations = new ElicitationManager();
      const auditEmit = vi.fn(async () => {});
      const getSecretSpy = vi.fn(async () => 'SHOULD_NOT_BE_CALLED');
      const ctx = makeCtx(getSecretSpy);
      const elicitationRef = `elicit-${capabilityRef}-1`;
      driveElicitationToResumed(elicitations, {
        id: elicitationRef,
        capabilityRef,
        sessionRef: ctx.session.mcpSessionId,
        sub: ctx.principal.sub,
      });
      const result = await invokeGmailWriteTool(
        {
          capabilityRef,
          input: {},
          ctx,
          idempotencyKey: `idem-${capabilityRef}-1`,
          elicitationRef,
        },
        { elicitations, audit: { emit: auditEmit } },
      );
      expect(result.ok).toBe(true);
      expect(result.output).toEqual(getWriteToolFixture(capabilityRef));
      expect(result.auditId).toBeTruthy();
      expect(auditEmit).toHaveBeenCalled();
      expect(getSecretSpy).not.toHaveBeenCalled();
    });
  }

  it('invokeGmailWriteTool returns ok:false unknown_tool for an unregistered capability', async () => {
    const elicitations = new ElicitationManager();
    const ctx = makeCtx(vi.fn(async () => 'SHOULD_NOT_BE_CALLED'));
    const result = await invokeGmailWriteTool(
      { capabilityRef: 'not_a_real_tool', input: {}, ctx },
      { elicitations, audit: { emit: vi.fn(async () => {}) } },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('unknown_tool');
  });
});
