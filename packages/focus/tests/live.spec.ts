import { describe, expect, it } from "vitest";

import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  FocusLiveSessionDriver,
  InMemoryTrackOwnerSignaturePort,
} from "../src/index.js";
import type {
  AuthenticatedOwnPrincipal,
  OwnerSignatureRequest,
  PersistedOwnerSignature,
  TrackNativeDecisionTarget,
  TrackOwnerSignaturePort,
  TrackOwnerSignatureWrite,
  TrackOwnerSignatureWriteResult,
} from "../src/index.js";

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

interface LiveOptions {
  readonly owner?: AuthenticatedOwnPrincipal | null;
  readonly authenticate?: (input: OwnerSignatureRequest) => Promise<AuthenticatedOwnPrincipal | undefined>;
  readonly authorize?: (input: {
    readonly owner: AuthenticatedOwnPrincipal;
    readonly target: TrackNativeDecisionTarget;
  }) => boolean | Promise<boolean>;
}

const makeLive = (track: TrackOwnerSignaturePort, options: LiveOptions = {}) => {
  const configuredOwner = options.owner === undefined ? OWNER : options.owner;
  return new FocusLiveSessionDriver({
    ownPrincipal: {
      authenticate: options.authenticate ?? (async () => configuredOwner ?? undefined),
    },
    authorizer: {
      authorize: async (input) => (options.authorize ?? (() => true))(input),
    },
    track,
  });
};

const asPersisted = (value: unknown): PersistedOwnerSignature => value as PersistedOwnerSignature;

const makeWrongReadBackPort = (
  change: (persisted: PersistedOwnerSignature) => PersistedOwnerSignature,
) => {
  const store = new InMemoryTrackOwnerSignaturePort();
  const track: TrackOwnerSignaturePort = {
    contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
    appendOwnerSignature: (input) => store.appendOwnerSignature(input),
    async readOwnerSignature(identity) {
      const persisted = await store.readOwnerSignature(identity);
      return persisted === undefined ? undefined : change(persisted);
    },
  };
  return { store, track };
};

const expectNoIngest = async (
  live: FocusLiveSessionDriver,
  store: InMemoryTrackOwnerSignaturePort,
  request: OwnerSignatureRequest,
  reason: string,
) => {
  await expect(live.sign(request)).resolves.toEqual({ status: "not-done", reason });
  expect(store.appendAttempts).toBe(0);
  expect(store.recordCount).toBe(0);
};

describe("FocusLiveSession owner-signature gate", () => {
  it("records the authenticated owner as attester and retains distinct relayer provenance", async () => {
    const store = new InMemoryTrackOwnerSignaturePort();
    const result = await makeLive(store).sign(REQUEST);

    expect(result.status).toBe("signed");
    if (result.status === "signed") {
      expect(result.persisted.attestation.attester).toEqual(OWNER);
      expect(result.persisted.relayer).toEqual(REQUEST.relayer);
    }
  });

  it.each([
    ["target workspace", (record: PersistedOwnerSignature) => asPersisted({ ...record, target: { ...record.target, workspace: "other" } })],
    ["target decision", (record: PersistedOwnerSignature) => asPersisted({ ...record, target: { ...record.target, decisionId: "other" } })],
    ["record id", (record: PersistedOwnerSignature) => asPersisted({ ...record, recordId: "other-record" })],
    ["contract version", (record: PersistedOwnerSignature) => asPersisted({ ...record, contractVersion: "track-owner-signature/other" })],
    ["attester principal", (record: PersistedOwnerSignature) => asPersisted({ ...record, attestation: { attester: { ...record.attestation.attester, principalId: "other-owner" } } })],
    ["attester authentication time", (record: PersistedOwnerSignature) => asPersisted({ ...record, attestation: { attester: { ...record.attestation.attester, authenticatedAt: "2026-08-08T13:00:00.000Z" } } })],
    ["relayer transport", (record: PersistedOwnerSignature) => asPersisted({ ...record, relayer: { ...record.relayer, transport: "cli" } })],
    ["relayer identity", (record: PersistedOwnerSignature) => asPersisted({ ...record, relayer: { ...record.relayer, relayerId: "other-relayer" } })],
    ["idempotency key", (record: PersistedOwnerSignature) => asPersisted({ ...record, idempotencyKey: "other-key" })],
  ])("returns not-done when read-back has the wrong %s", async (_field, change) => {
    const { store, track } = makeWrongReadBackPort(change);
    const result = await makeLive(track).sign(REQUEST);

    expect(result).toEqual({ status: "not-done", reason: "persisted-attestation-not-confirmed" });
    expect(store.recordCount).toBe(1);
  });

  it("returns not-done when the port returns no persisted read-back", async () => {
    const store = new InMemoryTrackOwnerSignaturePort();
    const track: TrackOwnerSignaturePort = {
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
      appendOwnerSignature: (input) => store.appendOwnerSignature(input),
      readOwnerSignature: async () => undefined,
    };

    await expect(makeLive(track).sign(REQUEST)).resolves.toEqual({
      status: "not-done",
      reason: "persisted-attestation-not-confirmed",
    });
    expect(store.recordCount).toBe(1);
  });

  it.each([
    ["undefined receipt", undefined],
    ["failed receipt", { status: "failed", recordId: "not-a-success" }],
    ["blank record id", { status: "written", recordId: "   " }],
    ["missing record id", { status: "duplicate" }],
  ])("rejects a runtime-invalid %s without reading or persisting", async (_label, receipt) => {
    const store = new InMemoryTrackOwnerSignaturePort();
    let appendCalls = 0;
    let readCalls = 0;
    const track = {
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
      async appendOwnerSignature(): Promise<TrackOwnerSignatureWriteResult> {
        appendCalls += 1;
        return receipt as TrackOwnerSignatureWriteResult;
      },
      async readOwnerSignature(identity: Parameters<TrackOwnerSignaturePort["readOwnerSignature"]>[0]) {
        readCalls += 1;
        return store.readOwnerSignature(identity);
      },
    } as TrackOwnerSignaturePort;

    await expect(makeLive(track).sign(REQUEST)).resolves.toEqual({ status: "not-done", reason: "track-write-failed" });
    expect(appendCalls).toBe(1);
    expect(readCalls).toBe(0);
    expect(store.appendAttempts).toBe(0);
    expect(store.recordCount).toBe(0);
  });

  it("does not ingest for every pre-ingest denial", async () => {
    const invalidRequests: readonly OwnerSignatureRequest[] = [
      { ...REQUEST, target: { ...REQUEST.target, workspace: " " } },
      { ...REQUEST, target: { ...REQUEST.target, decisionId: " " } },
      { ...REQUEST, idempotencyKey: " " },
      { ...REQUEST, relayer: { ...REQUEST.relayer, relayerId: " " } },
      { ...REQUEST, relayer: { ...REQUEST.relayer, transport: "smtp" as never } },
      { ...REQUEST, authentication: { ...REQUEST.authentication, kind: "other" as never } },
    ];
    const relayerCollision = { ...REQUEST, relayer: { ...REQUEST.relayer, relayerId: OWNER.principalId } };

    for (const invalidRequest of invalidRequests) {
      const invalid = new InMemoryTrackOwnerSignaturePort();
      await expectNoIngest(makeLive(invalid), invalid, invalidRequest, "invalid-signature-request");
    }

    const authenticationRequired = new InMemoryTrackOwnerSignaturePort();
    await expectNoIngest(makeLive(authenticationRequired, { owner: null }), authenticationRequired, REQUEST, "owner-authentication-required");

    const authenticationInvalid = new InMemoryTrackOwnerSignaturePort();
    await expectNoIngest(makeLive(authenticationInvalid, { owner: { ...OWNER, principalId: "" } }), authenticationInvalid, REQUEST, "owner-authentication-invalid");

    const authenticationRejected = new InMemoryTrackOwnerSignaturePort();
    await expectNoIngest(makeLive(authenticationRejected, { authenticate: async () => { throw new Error("rejected"); } }), authenticationRejected, REQUEST, "owner-authentication-invalid");

    const collision = new InMemoryTrackOwnerSignaturePort();
    await expectNoIngest(makeLive(collision), collision, relayerCollision, "attester-relayer-conflict");

    const authorizationRejected = new InMemoryTrackOwnerSignaturePort();
    await expectNoIngest(makeLive(authorizationRejected, { authorize: () => false }), authorizationRejected, REQUEST, "authorization-denied");

    const authorizationError = new InMemoryTrackOwnerSignaturePort();
    await expectNoIngest(makeLive(authorizationError, { authorize: () => { throw new Error("denied"); } }), authorizationError, REQUEST, "authorization-denied");

    const contractStore = new InMemoryTrackOwnerSignaturePort();
    const wrongContract: TrackOwnerSignaturePort = {
      contractVersion: "track-owner-signature/2.0.0" as never,
      appendOwnerSignature: (input) => contractStore.appendOwnerSignature(input),
      readOwnerSignature: (identity) => contractStore.readOwnerSignature(identity),
    };
    await expectNoIngest(makeLive(wrongContract), contractStore, REQUEST, "track-contract-mismatch");
  });

  it("snapshots caller values and gives the port a separate deeply frozen copy", async () => {
    const store = new InMemoryTrackOwnerSignaturePort();
    let authorizedTarget: TrackNativeDecisionTarget | undefined;
    let submitted: TrackOwnerSignatureWrite | undefined;
    let mutationRejected = false;
    const track: TrackOwnerSignaturePort = {
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
      appendOwnerSignature(input) {
        submitted = input;
        try {
          (input.target as { workspace: string }).workspace = "port-mutated";
        } catch {
          mutationRejected = true;
        }
        return store.appendOwnerSignature(input);
      },
      readOwnerSignature: (identity) => store.readOwnerSignature(identity),
    };
    const live = makeLive(track, {
      authorize: ({ target }) => {
        authorizedTarget = target;
        return true;
      },
    });
    const mutableRequest: {
      target: { workspace: string; decisionId: string };
      authentication: OwnerSignatureRequest["authentication"];
      relayer: { transport: OwnerSignatureRequest["relayer"]["transport"]; relayerId: string };
      idempotencyKey: string;
    } = {
      target: { ...REQUEST.target },
      authentication: REQUEST.authentication,
      relayer: { ...REQUEST.relayer },
      idempotencyKey: REQUEST.idempotencyKey,
    };

    const pending = live.sign(mutableRequest);
    mutableRequest.target.workspace = "caller-mutated";
    mutableRequest.relayer.relayerId = "caller-mutated";
    mutableRequest.idempotencyKey = "caller-mutated";
    const result = await pending;

    expect(result.status).toBe("signed");
    expect(mutationRejected).toBe(true);
    expect(submitted).toBeDefined();
    if (submitted === undefined || authorizedTarget === undefined) throw new Error("expected captured port boundaries");
    expect(Object.isFrozen(submitted.target)).toBe(true);
    expect(Object.isFrozen(submitted.attestation)).toBe(true);
    expect(Object.isFrozen(submitted.attestation.attester)).toBe(true);
    expect(Object.isFrozen(submitted.relayer)).toBe(true);
    expect(Object.isFrozen(authorizedTarget)).toBe(true);
    expect(submitted.target).not.toBe(authorizedTarget);
    expect(result).toMatchObject({
      status: "signed",
      persisted: { target: REQUEST.target, relayer: REQUEST.relayer, idempotencyKey: REQUEST.idempotencyKey },
    });
  });

  it("uses the reference adapter's atomic owner-decision uniqueness for concurrent double-submit", async () => {
    const store = new InMemoryTrackOwnerSignaturePort();
    const live = makeLive(store);
    const [first, second] = await Promise.all([live.sign(REQUEST), live.sign(REQUEST)]);

    expect(first).toMatchObject({ status: "signed" });
    expect(second).toMatchObject({ status: "signed" });
    expect([first, second].filter((result) => result.status === "signed" && result.duplicate)).toHaveLength(1);
    expect(store.appendAttempts).toBe(2);
    expect(store.recordCount).toBe(1);
  });

});
