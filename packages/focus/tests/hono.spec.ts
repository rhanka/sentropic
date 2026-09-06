import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  FocusLiveSessionDriver,
  type PersistedOwnerSignature,
  type TrackOwnerSignatureWrite,
} from "../src/index.js";
import {
  createFocusRouter,
  type CreateFocusRouterOptions,
} from "../src/hono.js";
import { describe, expect, it, vi } from "vitest";

import { decisionDossierFixture } from "./fixture.data.js";

const principal = {
  userId: "user-1",
  sessionId: "session-1",
  authenticatedAt: "2026-08-31T12:00:00.000Z",
  workspaceId: "workspace-1",
  email: "owner@example.com",
};

const createOptions = (): CreateFocusRouterOptions => {
  let persisted: PersistedOwnerSignature | undefined;
  return {
    resolvePrincipal: async () => principal,
    decisionValidator: { validate: vi.fn().mockResolvedValue({ authorized: true }) },
    ownerSignature: {
      createSession: ({ principal: caller, track, authorize }) => new FocusLiveSessionDriver({
        ownPrincipal: {
          authenticate: async (request) => request.authentication.proof === caller.sessionId
            ? {
                principalId: caller.userId,
                canonicalIdentity: { issuer: "test-session", subject: "human:owner@example.com" },
                authenticatedAt: caller.authenticatedAt,
              }
            : undefined,
        },
        relayerProvenance: {
          getRelayerProvenance: async () => ({
            transport: "http",
            relayerId: "focus-test",
            canonicalIdentity: { issuer: "test-api", subject: "focus-route" },
          }),
        },
        authorizer: { authorize: ({ owner, target }) => authorize(owner, target) },
        track,
      }),
    },
    tenancy: { authorize: vi.fn().mockResolvedValue(true) },
    track: {
      readDecision: vi.fn().mockResolvedValue({ status: "found", document: decisionDossierFixture }),
      getOwnerSignaturePort: async () => ({
        contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
        appendOwnerSignature: async (write: TrackOwnerSignatureWrite) => {
          persisted = { ...write, recordId: "signature-1" };
          return { status: "written", recordId: "signature-1" };
        },
        readOwnerSignature: async () => persisted,
      }),
    },
  };
};

describe("createFocusRouter", () => {
  it("reads and signs through injected ports as a standalone router", async () => {
    const options = createOptions();
    const router = createFocusRouter(options);

    const read = await router.request("/decisions/decision-1");
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual({ item: decisionDossierFixture });

    const sign = await router.request("/owner-signatures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision_id: "decision-1", idempotency_key: "request-1" }),
    });
    expect(sign.status).toBe(201);
    await expect(sign.json()).resolves.toMatchObject({ status: "signed", duplicate: false });
    expect(options.decisionValidator.validate).toHaveBeenCalledWith({
      workspace: "workspace-1",
      decisionId: "decision-1",
      userId: "user-1",
      userEmail: "owner@example.com",
    });
    expect(options.track.readDecision).toHaveBeenCalledOnce();
  });

  it("fails closed when the external Track port is unavailable", async () => {
    const defaults = createOptions();
    const options: CreateFocusRouterOptions = {
      ...defaults,
      track: {
        readDecision: vi.fn().mockResolvedValue({ status: "unavailable" }),
        getOwnerSignaturePort: async () => undefined,
      },
    };
    const router = createFocusRouter(options);

    const read = await router.request("/decisions/decision-1");
    expect(read.status).toBe(503);
    await expect(read.json()).resolves.toEqual({ error: "track_unavailable" });

    const sign = await router.request("/owner-signatures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision_id: "decision-1", idempotency_key: "request-1" }),
    });
    expect(sign.status).toBe(503);
    await expect(sign.json()).resolves.toEqual({ status: "not-done", reason: "track-port-unavailable" });
  });
});
