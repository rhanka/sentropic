/** Application gateway route plane (spec §16.3/§16.6, R4-MAJ-4): a request
 * requiring an execution feature the application runtime does not serve is
 * refused at plan time — pre-dispatch, no provider call, no billed estimate.
 * No network, no DB (the refusal fires before target resolution). */
import { describe, expect, it, vi } from 'vitest';
import type { VerifiedRoutingSubject } from '@sentropic/llm-mesh';
import { RoutePlanError } from '@sentropic/llm-mesh';

vi.mock('../../src/services/llm-runtime/index', () => ({
  callLLM: vi.fn(),
  callLLMStream: vi.fn(),
  resolveRuntimeSelection: vi.fn(),
}));

import { createApplicationGatewayRoutePlane } from '../../src/services/llm-runtime/gateway-route-plane';
import { resolveRuntimeSelection } from '../../src/services/llm-runtime/index';

const SUBJECT: VerifiedRoutingSubject = { principalRef: 'user-1', ownerScopeRef: 'owner-1' };

describe('application gateway route plane execution features', () => {
  it('refuses a feature-requiring request at plan time (R4-MAJ-4)', async () => {
    const plane = createApplicationGatewayRoutePlane();
    const failure = await plane.planner.plan(SUBJECT, {
      requestedModel: 'claude-opus-5-high',
      requiredCapabilities: [],
      requiredExecutionFeatures: ['named-tool-choice', 'parallel-tool-control'],
    }).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(RoutePlanError);
    expect((failure as RoutePlanError).code).toBe('capabilities-unmet');
    expect((failure as RoutePlanError).unmetExecutionFeatures).toEqual(
      ['named-tool-choice', 'parallel-tool-control'],
    );
  });

  it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5-xhigh'])(
    'refuses bare alias-only %s as unknown-model on the non-native quote and plan', async (model) => {
      vi.mocked(resolveRuntimeSelection).mockClear();
      const plane = createApplicationGatewayRoutePlane();
      expect(() => plane.planner.quote!({
        requestedModel: model, now: new Date('2026-10-04T00:00:00Z'),
        ceiling: { inputTokens: 100, outputTokens: 16 },
      })).toThrow(expect.objectContaining({ code: 'unknown-model' }));
      await expect(plane.planner.plan(SUBJECT, { requestedModel: model }))
        .rejects.toMatchObject({ code: 'unknown-model' });
      expect(resolveRuntimeSelection).not.toHaveBeenCalled();
    });
});
