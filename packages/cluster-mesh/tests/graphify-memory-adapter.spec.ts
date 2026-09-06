import { readFileSync } from 'node:fs';
import type { VerifiedInvocationContext } from '../../contracts/src/index.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createGraphifyMemoryAdapter,
  type GraphifyMemoryContractEvidence,
  type H2aGraphifyMemoryPort,
} from '../src/index.js';

interface FixtureAuthorization {
  readonly principalRef: string;
  readonly workspaceRef: string;
  readonly scopes: readonly string[];
  readonly policyRevision: string;
}

interface FixtureQueryIntent {
  readonly questionRef: string;
}

const evidence = Object.freeze({
  contractVersion: 'synthetic-h2a-graphify-memory/v2',
  fixtureDigest: 'sha256:synthetic-memory-fixture',
  releaseEvidenceRef: 'release:synthetic-graphify',
}) satisfies GraphifyMemoryContractEvidence;

const context: VerifiedInvocationContext = {
  invocationId: 'invocation-1', correlationId: 'correlation-1', generationId: 'generation-1',
  principal: { principalId: 'principal-1', kind: 'human', verifierId: 'verifier-1' },
  workspace: { bindingId: 'binding-1', workspaceId: 'workspace-1', revision: '7' },
  scopes: ['memory:query'], policyRevision: 'policy-3', issuedAt: '2026-08-31T12:00:00.000Z',
};

const makeProvider = (input: {
  readonly providerEvidence?: GraphifyMemoryContractEvidence;
  readonly finalAccepted?: boolean;
} = {}): H2aGraphifyMemoryPort<FixtureAuthorization, FixtureQueryIntent> => ({
  evidence: input.providerEvidence ?? evidence,
  mapAuthorization: vi.fn(async (verified) => ({
    principalRef: verified.principal.principalId,
    workspaceRef: verified.workspace.workspaceId,
    scopes: verified.scopes,
    policyRevision: verified.policyRevision,
  })),
  mapQueryIntent: vi.fn(async (value) => {
    if (!value || typeof value !== 'object') return undefined;
    const questionRef = (value as Record<string, unknown>).questionRef;
    return typeof questionRef === 'string' ? { questionRef } : undefined;
  }),
  evaluateEligibility: vi.fn(async () => ({
    eligible: true,
    receiptRef: 'graphify:eligibility-receipt:1',
  })),
  shadowQueryIntent: vi.fn(async () => ({
    cursorRef: 'graphify:cursor:17',
    receiptRef: 'graphify:query-receipt:1',
  })),
  revalidateFinal: vi.fn(async () => input.finalAccepted === false
    ? { accepted: false, refusalRef: 'graphify:refusal:scope-changed' }
    : { accepted: true }),
});

describe('Graphify memory adapter', () => {
  const shadow = (provider: H2aGraphifyMemoryPort<FixtureAuthorization, FixtureQueryIntent>) =>
    createGraphifyMemoryAdapter({ provider, expectedEvidence: evidence }).shadowQuery({
      context,
      queryIntent: { questionRef: 'question:1' },
    });

  it('should fail closed when provider or pinned release evidence is unavailable', async () => {
    const absent = createGraphifyMemoryAdapter({});
    expect(absent.availability()).toBe('memory_provider_unavailable');
    await expect(absent.shadowQuery({ context, queryIntent: {} })).resolves.toEqual({
      ok: false,
      reason: 'memory_provider_unavailable',
    });

    const unpinned = createGraphifyMemoryAdapter({ provider: makeProvider() });
    expect(unpinned.availability()).toBe('memory_provider_unpinned');
  });

  it('should reject a fixture digest mismatch before invoking the provider author', async () => {
    const provider = makeProvider({
      providerEvidence: { ...evidence, fixtureDigest: 'sha256:mismatch' },
    });
    const adapter = createGraphifyMemoryAdapter({ provider, expectedEvidence: evidence });

    await expect(adapter.shadowQuery({ context, queryIntent: { questionRef: 'question:1' } }))
      .resolves.toEqual({ ok: false, reason: 'memory_provider_incompatible' });
    expect(provider.mapAuthorization).not.toHaveBeenCalled();
    expect(provider.evaluateEligibility).not.toHaveBeenCalled();
    expect(provider.shadowQueryIntent).not.toHaveBeenCalled();
  });

  it('should map verified authorization beneath the driven adapter surface', async () => {
    const provider = makeProvider();
    const adapter = createGraphifyMemoryAdapter({ provider, expectedEvidence: evidence });

    await expect(adapter.shadowQuery({
      context,
      queryIntent: { questionRef: 'question:1' },
    })).resolves.toEqual({
      ok: true,
      cursorRef: 'graphify:cursor:17',
      receiptRef: 'graphify:query-receipt:1',
    });
    expect(provider.evaluateEligibility).toHaveBeenCalledWith({
      authorization: {
        principalRef: 'principal-1',
        workspaceRef: 'workspace-1',
        scopes: ['memory:query'],
        policyRevision: 'policy-3',
      },
      queryIntent: { questionRef: 'question:1' },
    });
    expect(provider.evaluateEligibility).toHaveBeenCalledOnce();
    expect(provider.shadowQueryIntent).toHaveBeenCalledOnce();
    expect(provider.revalidateFinal).toHaveBeenCalledOnce();
  });

  it('should refuse when provider authorization cannot be mapped', async () => {
    const provider = makeProvider();
    vi.mocked(provider.mapAuthorization).mockResolvedValueOnce(undefined);
    await expect(shadow(provider)).resolves.toEqual({
      ok: false, reason: 'memory_authorization_unavailable',
    });
  });

  it('should refuse an invalid provider query intent', async () => {
    const provider = makeProvider();
    vi.mocked(provider.mapQueryIntent).mockResolvedValueOnce(undefined);
    await expect(shadow(provider)).resolves.toEqual({
      ok: false, reason: 'memory_query_intent_invalid',
    });
  });

  it('should refuse an ineligible provider query', async () => {
    const provider = makeProvider();
    vi.mocked(provider.evaluateEligibility).mockResolvedValueOnce({
      eligible: false, receiptRef: 'graphify:eligibility-refusal:1',
    });
    await expect(shadow(provider)).resolves.toEqual({
      ok: false, reason: 'memory_query_ineligible',
    });
  });

  it('should refuse an invalid provider response', async () => {
    const provider = makeProvider();
    vi.mocked(provider.evaluateEligibility).mockResolvedValueOnce({
      eligible: true, receiptRef: '',
    });
    await expect(shadow(provider)).resolves.toEqual({
      ok: false, reason: 'memory_provider_response_invalid',
    });
  });

  it('should refuse a query when final canonical revalidation rejects it', async () => {
    const provider = makeProvider({ finalAccepted: false });
    const adapter = createGraphifyMemoryAdapter({ provider, expectedEvidence: evidence });

    await expect(adapter.shadowQuery({
      context,
      queryIntent: { questionRef: 'question:1' },
    })).resolves.toEqual({
      ok: false,
      reason: 'memory_final_revalidation_refused',
      refusalRef: 'graphify:refusal:scope-changed',
    });
  });

  it('should expose no local canonical episode, ranking, or projection store', () => {
    const source = readFileSync(new URL('../src/memory.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"][^'"]*(?:db|persistence|storage)[^'"]*['"]/);
    expect(source).not.toMatch(/\bnew (?:Map|Set)\b|\b(?:writeFile|appendFile)\b/);
    expect(Object.keys(createGraphifyMemoryAdapter({}))).toEqual(['availability', 'shadowQuery']);
  });
});
