import { describe, expect, it } from "vitest";

import { FocusLiveSessionDriver } from "../src/index.js";
import type {
  AuthenticatedOwnPrincipal,
  OwnerSignatureRequest,
  PersistedOwnerSignature,
  TrackOwnerSignaturePort,
  TrackOwnerSignatureWrite,
} from "../src/index.js";

const CONTRACT = "track-owner-signature/1.0.0";
const OWNER: AuthenticatedOwnPrincipal = {
  principalId: "owner-verified",
  authenticatedAt: "2026-08-08T12:00:00.000Z",
};
const REQUEST: OwnerSignatureRequest = {
  target: { workspace: "focus", decisionId: "decision-track-native" },
  authentication: { kind: "own-principal", proof: { session: "verified" } },
  relayer: { transport: "http", relayerId: "signature-gateway" },
  idempotencyKey: "focus-signature:decision-track-native:owner-verified",
};

const keyOf = (input: { target: OwnerSignatureRequest["target"]; idempotencyKey: string }): string =>
  `${input.target.workspace}:${input.target.decisionId}:${input.idempotencyKey}`;

function makeTrack(options: { contractVersion?: string; readError?: Error } = {}) {
  const records = new Map<string, PersistedOwnerSignature>();
  let writes = 0;
  const track: TrackOwnerSignaturePort = {
    contractVersion: options.contractVersion ?? CONTRACT,
    async appendOwnerSignature(write: TrackOwnerSignatureWrite) {
      writes += 1;
      const key = keyOf(write);
      const existing = records.get(key);
      if (existing !== undefined) return { status: "duplicate", recordId: existing.recordId } as const;
      const persisted = { ...write, recordId: `signature-${records.size + 1}` };
      records.set(key, persisted);
      return { status: "written", recordId: persisted.recordId } as const;
    },
    async readOwnerSignature(input) {
      if (options.readError !== undefined) throw options.readError;
      return records.get(keyOf(input));
    },
  };
  return { track, records, writeCount: () => writes };
}

function makeLive(
  track: TrackOwnerSignaturePort,
  owner: AuthenticatedOwnPrincipal | null = OWNER,
  authorize: (request: OwnerSignatureRequest) => boolean = () => true,
) {
  return new FocusLiveSessionDriver({
    ownPrincipal: { authenticate: async () => owner ?? undefined },
    authorizer: { authorize: async ({ target }) => authorize({ ...REQUEST, target }) },
    track,
    expectedTrackContractVersion: CONTRACT,
  });
}

describe("FocusLiveSession owner-signature gate", () => {
  it("returns not-done and does not write when own-principal authentication is required", async () => {
    const store = makeTrack();
    const result = await makeLive(store.track, null).sign(REQUEST);

    expect(result).toEqual({ status: "not-done", reason: "owner-authentication-required" });
    expect(store.writeCount()).toBe(0);
  });

  it("records the authenticated owner as attester and rejects an identity-colliding relayer", async () => {
    const store = makeTrack();
    const signed = await makeLive(store.track).sign({
      ...REQUEST,
      relayer: { transport: "http", relayerId: "relayer-claiming-owner" },
    });

    expect(signed.status).toBe("signed");
    if (signed.status === "signed") {
      expect(signed.persisted.attestation.attester.principalId).toBe(OWNER.principalId);
      expect(signed.persisted.relayer.relayerId).toBe("relayer-claiming-owner");
    }
    const forged = await makeLive(store.track).sign({
      ...REQUEST,
      idempotencyKey: "different-key",
      relayer: { transport: "http", relayerId: OWNER.principalId },
    });
    expect(forged).toEqual({ status: "not-done", reason: "attester-relayer-conflict" });
  });

  it("persists one record and reports duplicate on idempotent double-submit", async () => {
    const store = makeTrack();
    const live = makeLive(store.track);

    const first = await live.sign(REQUEST);
    const second = await live.sign(REQUEST);

    expect(first.status).toBe("signed");
    expect(second).toMatchObject({ status: "signed", duplicate: true });
    expect(store.records).toHaveLength(1);
    expect(store.writeCount()).toBe(2);
  });

  it("returns not-done after a successful write whose persisted read-back fails", async () => {
    const store = makeTrack({ readError: new Error("read unavailable") });
    const result = await makeLive(store.track).sign(REQUEST);

    expect(result).toEqual({ status: "not-done", reason: "persisted-attestation-not-confirmed" });
    expect(store.records).toHaveLength(1);
  });

  it.each([
    ["workspace", { ...REQUEST, target: { ...REQUEST.target, workspace: "other-workspace" } }],
    ["decision", { ...REQUEST, target: { ...REQUEST.target, decisionId: "other-decision" } }],
  ])("denies an unauthorized %s before Track ingest", async (_scope, request) => {
    const store = makeTrack();
    const result = await makeLive(
      store.track,
      OWNER,
      (candidate) => candidate.target.workspace === REQUEST.target.workspace && candidate.target.decisionId === REQUEST.target.decisionId,
    ).sign(request);

    expect(result).toEqual({ status: "not-done", reason: "authorization-denied" });
    expect(store.writeCount()).toBe(0);
  });

  it("returns not-done when the supplied Track signature contract is not the pinned version", async () => {
    const store = makeTrack({ contractVersion: "track-owner-signature/2.0.0" });
    const result = await makeLive(store.track).sign(REQUEST);

    expect(result).toEqual({ status: "not-done", reason: "track-contract-mismatch" });
    expect(store.writeCount()).toBe(0);
  });
});
