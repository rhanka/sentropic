import { describe, expect, it } from "vitest";

import {
  FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
  FocusLiveSessionDriver,
} from "../src/index.js";
import { TestOnlyInMemoryTrackOwnerSignaturePort } from "../src/live/in-memory.js";
import type {
  AuthenticatedOwnPrincipal,
  OwnerSignatureRequest,
  PersistedOwnerSignature,
  RelayerProvenance,
  TrackNativeDecisionTarget,
  TrackOwnerSignaturePort,
  TrackOwnerSignatureWrite,
  TrackOwnerSignatureWriteResult,
} from "../src/index.js";

const OWNER: AuthenticatedOwnPrincipal = {
  principalId: "owner-verified",
  canonicalIdentity: { issuer: "https://auth.example", subject: "owner-verified" },
  authenticatedAt: "2026-08-08T12:00:00.000Z",
};
const RELAYER: RelayerProvenance = {
  transport: "http",
  relayerId: "signature-gateway",
  canonicalIdentity: { issuer: "https://gateway.example", subject: "signature-gateway" },
};
const REQUEST: OwnerSignatureRequest = {
  target: { workspace: "focus", decisionId: "decision-track-native" },
  authentication: { kind: "own-principal", proof: { session: "verified" } },
  idempotencyKey: "focus-signature:decision-track-native:owner-verified",
};

interface LiveOptions {
  readonly authenticate?: (input: OwnerSignatureRequest) => unknown | Promise<unknown>;
  readonly getRelayerProvenance?: () => unknown | Promise<unknown>;
  readonly authorize?: (input: {
    readonly owner: AuthenticatedOwnPrincipal;
    readonly target: TrackNativeDecisionTarget;
  }) => unknown | Promise<unknown>;
}

const makeLive = (track: TrackOwnerSignaturePort, options: LiveOptions = {}) =>
  new FocusLiveSessionDriver({
    ownPrincipal: {
      authenticate: async (input) =>
        ((options.authenticate === undefined ? OWNER : await options.authenticate(input)) as AuthenticatedOwnPrincipal | undefined),
    },
    relayerProvenance: {
      getRelayerProvenance: async () =>
        ((options.getRelayerProvenance === undefined
          ? RELAYER
          : await options.getRelayerProvenance()) as RelayerProvenance),
    },
    authorizer: {
      authorize: async (input) => ((options.authorize === undefined ? true : await options.authorize(input)) as boolean),
    },
    track,
  });

const asPersisted = (value: unknown): PersistedOwnerSignature => value as PersistedOwnerSignature;

const persistedFromWrite = (write: TrackOwnerSignatureWrite, recordId: string): PersistedOwnerSignature =>
  asPersisted(
    Object.freeze({
      contractVersion: write.contractVersion,
      target: Object.freeze({ workspace: write.target.workspace, decisionId: write.target.decisionId }),
      attestation: Object.freeze({
        attester: Object.freeze({
          principalId: write.attestation.attester.principalId,
          canonicalIdentity: Object.freeze({
            issuer: write.attestation.attester.canonicalIdentity.issuer,
            subject: write.attestation.attester.canonicalIdentity.subject,
          }),
          authenticatedAt: write.attestation.attester.authenticatedAt,
        }),
      }),
      relayer: Object.freeze({
        transport: write.relayer.transport,
        relayerId: write.relayer.relayerId,
        canonicalIdentity: Object.freeze({
          issuer: write.relayer.canonicalIdentity.issuer,
          subject: write.relayer.canonicalIdentity.subject,
        }),
      }),
      idempotencyKey: write.idempotencyKey,
      recordId,
    }),
  );

const makeWrongReadBackPort = (
  change: (persisted: PersistedOwnerSignature) => PersistedOwnerSignature,
) => {
  const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
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
  store: TestOnlyInMemoryTrackOwnerSignaturePort,
  request: OwnerSignatureRequest,
  reason: string,
) => {
  await expect(live.sign(request)).resolves.toEqual({ status: "not-done", reason });
  expect(store.appendAttempts).toBe(0);
  expect(store.recordCount).toBe(0);
  expect(store.readAttempts).toBe(0);
};

/**
 * Production-like test adapter: both writers cross the barrier, then one synchronous section
 * models a database unique constraint/upsert on canonical owner + workspace + decision only.
 */
class BarrierSynchronizedDurableAtomicTrackOwnerSignaturePort implements TrackOwnerSignaturePort {
  readonly contractVersion = FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION;

  private readonly records = new Map<string, PersistedOwnerSignature>();
  private readonly barrier: Promise<void>;
  private releaseBarrier: (() => void) | undefined;
  private waiting = 0;
  appendAttempts = 0;
  readonly receiptStatuses: TrackOwnerSignatureWriteResult["status"][] = [];

  constructor() {
    this.barrier = new Promise((resolve) => {
      this.releaseBarrier = resolve;
    });
  }

  get recordCount(): number {
    return this.records.size;
  }

  async appendOwnerSignature(input: TrackOwnerSignatureWrite): Promise<TrackOwnerSignatureWriteResult> {
    this.appendAttempts += 1;
    this.waiting += 1;
    if (this.waiting === 2) this.releaseBarrier?.();
    await this.barrier;

    const key = this.key(input.attestation.attester.canonicalIdentity, input.target);
    const existing = this.records.get(key);
    if (existing !== undefined) {
      this.receiptStatuses.push("duplicate");
      return { status: "duplicate", recordId: existing.recordId };
    }

    const persisted = persistedFromWrite(input, `racy-owner-signature-${this.appendAttempts}`);
    this.records.set(key, persisted);
    this.receiptStatuses.push("written");
    return { status: "written", recordId: persisted.recordId };
  }

  readOwnerSignature(input: Parameters<TrackOwnerSignaturePort["readOwnerSignature"]>[0]) {
    return Promise.resolve(this.records.get(this.key(input.ownerCanonicalIdentity, input.target)));
  }

  private key(owner: AuthenticatedOwnPrincipal["canonicalIdentity"], target: TrackNativeDecisionTarget): string {
    return `${owner.issuer}\u0000${owner.subject}\u0000${target.workspace}\u0000${target.decisionId}`;
  }
}

describe("FocusLiveSession owner-signature gate", () => {
  it("records the authenticated owner as attester and trusted relayer provenance separately", async () => {
    const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
    const result = await makeLive(store).sign(REQUEST);

    expect(result.status).toBe("signed");
    if (result.status === "signed") {
      expect(result.persisted.attestation.attester).toEqual(OWNER);
      expect(result.persisted.relayer).toEqual(RELAYER);
    }
  });

  it.each([
    ["target workspace", (record: PersistedOwnerSignature) => asPersisted({ ...record, target: { ...record.target, workspace: "other" } })],
    ["target decision", (record: PersistedOwnerSignature) => asPersisted({ ...record, target: { ...record.target, decisionId: "other" } })],
    ["record id", (record: PersistedOwnerSignature) => asPersisted({ ...record, recordId: "other-record" })],
    ["contract version", (record: PersistedOwnerSignature) => asPersisted({ ...record, contractVersion: "track-owner-signature/other" })],
    ["attester principal", (record: PersistedOwnerSignature) => asPersisted({ ...record, attestation: { attester: { ...record.attestation.attester, principalId: "other-owner" } } })],
    ["attester canonical identity", (record: PersistedOwnerSignature) => asPersisted({ ...record, attestation: { attester: { ...record.attestation.attester, canonicalIdentity: { ...record.attestation.attester.canonicalIdentity, subject: "other-owner" } } } })],
    ["attester authentication time", (record: PersistedOwnerSignature) => asPersisted({ ...record, attestation: { attester: { ...record.attestation.attester, authenticatedAt: "2026-08-08T13:00:00.000Z" } } })],
    ["relayer transport", (record: PersistedOwnerSignature) => asPersisted({ ...record, relayer: { ...record.relayer, transport: "cli" } })],
    ["relayer identity", (record: PersistedOwnerSignature) => asPersisted({ ...record, relayer: { ...record.relayer, relayerId: "other-relayer" } })],
    ["relayer canonical identity", (record: PersistedOwnerSignature) => asPersisted({ ...record, relayer: { ...record.relayer, canonicalIdentity: { ...record.relayer.canonicalIdentity, subject: "other-relayer" } } })],
    ["idempotency key", (record: PersistedOwnerSignature) => asPersisted({ ...record, idempotencyKey: "other-key" })],
  ])("returns not-done when read-back has the wrong %s", async (_field, change) => {
    const { store, track } = makeWrongReadBackPort(change);
    const result = await makeLive(track).sign(REQUEST);

    expect(result).toEqual({ status: "not-done", reason: "persisted-attestation-not-confirmed" });
    expect(store.recordCount).toBe(1);
  });

  it("returns not-done when the port returns no persisted read-back", async () => {
    const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
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
    const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
    let appendCalls = 0;
    let readCalls = 0;
    const track: TrackOwnerSignaturePort = {
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
      async appendOwnerSignature(): Promise<TrackOwnerSignatureWriteResult> {
        appendCalls += 1;
        return receipt as TrackOwnerSignatureWriteResult;
      },
      async readOwnerSignature(identity) {
        readCalls += 1;
        return store.readOwnerSignature(identity);
      },
    };

    await expect(makeLive(track).sign(REQUEST)).resolves.toEqual({ status: "not-done", reason: "track-write-failed" });
    expect(appendCalls).toBe(1);
    expect(readCalls).toBe(0);
    expect(store.appendAttempts).toBe(0);
    expect(store.recordCount).toBe(0);
  });

  it("fails honestly when append throws without durable records or read-back calls", async () => {
    const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
    let appendCalls = 0;
    let readCalls = 0;
    const track: TrackOwnerSignaturePort = {
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
      async appendOwnerSignature() {
        appendCalls += 1;
        throw new Error("Track unavailable");
      },
      async readOwnerSignature(identity) {
        readCalls += 1;
        return store.readOwnerSignature(identity);
      },
    };

    await expect(makeLive(track).sign(REQUEST)).resolves.toEqual({ status: "not-done", reason: "track-write-failed" });
    expect(appendCalls).toBe(1);
    expect(store.recordCount).toBe(0);
    expect(readCalls).toBe(0);
  });

  it.each(["false", { authorized: false }, { authorized: true }])(
    "denies truthy-malformed authorization results without append: %j",
    async (authorizationResult) => {
      const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
      await expectNoIngest(
        makeLive(store, { authorize: () => authorizationResult }),
        store,
        REQUEST,
        "authorization-denied",
      );
    },
  );

  it("does not ingest for every pre-ingest denial", async () => {
    const invalidRequests: readonly OwnerSignatureRequest[] = [
      { ...REQUEST, target: { ...REQUEST.target, workspace: " " } },
      { ...REQUEST, target: { ...REQUEST.target, decisionId: " " } },
      { ...REQUEST, idempotencyKey: " " },
      { ...REQUEST, authentication: { ...REQUEST.authentication, kind: "other" as never } },
    ];

    for (const invalidRequest of invalidRequests) {
      const invalid = new TestOnlyInMemoryTrackOwnerSignaturePort();
      await expectNoIngest(makeLive(invalid), invalid, invalidRequest, "invalid-signature-request");
    }

    const authenticationRequired = new TestOnlyInMemoryTrackOwnerSignaturePort();
    await expectNoIngest(
      makeLive(authenticationRequired, { authenticate: async () => undefined }),
      authenticationRequired,
      REQUEST,
      "owner-authentication-required",
    );

    const authenticationRejected = new TestOnlyInMemoryTrackOwnerSignaturePort();
    await expectNoIngest(
      makeLive(authenticationRejected, {
        authenticate: async () => {
          throw new Error("rejected");
        },
      }),
      authenticationRejected,
      REQUEST,
      "owner-authentication-invalid",
    );

    const authorizationRejected = new TestOnlyInMemoryTrackOwnerSignaturePort();
    await expectNoIngest(
      makeLive(authorizationRejected, { authorize: () => false }),
      authorizationRejected,
      REQUEST,
      "authorization-denied",
    );

    const authorizationError = new TestOnlyInMemoryTrackOwnerSignaturePort();
    await expectNoIngest(
      makeLive(authorizationError, {
        authorize: () => {
          throw new Error("denied");
        },
      }),
      authorizationError,
      REQUEST,
      "authorization-denied",
    );

    const contractStore = new TestOnlyInMemoryTrackOwnerSignaturePort();
    const wrongContract: TrackOwnerSignaturePort = {
      contractVersion: "track-owner-signature/2.0.0" as never,
      appendOwnerSignature: (input) => contractStore.appendOwnerSignature(input),
      readOwnerSignature: (identity) => contractStore.readOwnerSignature(identity),
    };
    await expectNoIngest(makeLive(wrongContract), contractStore, REQUEST, "track-contract-mismatch");
  });

  it.each([
    ["raw null", null],
    ["array", []],
    ["wrong shape", { principalId: OWNER.principalId, authenticatedAt: OWNER.authenticatedAt }],
    ["blank scalar", { ...OWNER, principalId: " " }],
  ])("returns not-done for a runtime-invalid authentication result: %s", async (_label, owner) => {
    const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
    await expectNoIngest(
      makeLive(store, { authenticate: async () => owner }),
      store,
      REQUEST,
      "owner-authentication-invalid",
    );
  });

  it.each([
    [
      "request target",
      () =>
        ({
          get target() {
            throw new Error("request target unavailable");
          },
          authentication: REQUEST.authentication,
          idempotencyKey: REQUEST.idempotencyKey,
        }) as OwnerSignatureRequest,
    ],
    [
      "target workspace",
      () =>
        ({
          target: {
            get workspace() {
              throw new Error("workspace unavailable");
            },
            decisionId: REQUEST.target.decisionId,
          } as TrackNativeDecisionTarget,
          authentication: REQUEST.authentication,
          idempotencyKey: REQUEST.idempotencyKey,
        }) as OwnerSignatureRequest,
    ],
    [
      "target decision id",
      () =>
        ({
          target: {
            workspace: REQUEST.target.workspace,
            get decisionId() {
              throw new Error("decision unavailable");
            },
          } as TrackNativeDecisionTarget,
          authentication: REQUEST.authentication,
          idempotencyKey: REQUEST.idempotencyKey,
        }) as OwnerSignatureRequest,
    ],
    [
      "authentication",
      () =>
        ({
          target: REQUEST.target,
          get authentication() {
            throw new Error("authentication unavailable");
          },
          idempotencyKey: REQUEST.idempotencyKey,
        }) as OwnerSignatureRequest,
    ],
    [
      "authentication kind",
      () =>
        ({
          target: REQUEST.target,
          authentication: {
            get kind() {
              throw new Error("authentication kind unavailable");
            },
            proof: REQUEST.authentication.proof,
          } as OwnerSignatureRequest["authentication"],
          idempotencyKey: REQUEST.idempotencyKey,
        }) as OwnerSignatureRequest,
    ],
    [
      "authentication proof",
      () =>
        ({
          target: REQUEST.target,
          authentication: {
            kind: "own-principal",
            get proof() {
              throw new Error("authentication proof unavailable");
            },
          } as OwnerSignatureRequest["authentication"],
          idempotencyKey: REQUEST.idempotencyKey,
        }) as OwnerSignatureRequest,
    ],
    [
      "idempotency key",
      () =>
        ({
          target: REQUEST.target,
          authentication: REQUEST.authentication,
          get idempotencyKey() {
            throw new Error("idempotency key unavailable");
          },
        }) as OwnerSignatureRequest,
    ],
  ])("fails closed without ingest when the %s accessor throws", async (_label, requestFactory) => {
    const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
    await expectNoIngest(makeLive(store), store, requestFactory(), "invalid-signature-request");
  });

  it("captures a getter-backed request field once, so its changed second value cannot enter the signed write", async () => {
    const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
    let idempotencyKeyReads = 0;
    const getterRequest = {
      target: REQUEST.target,
      authentication: REQUEST.authentication,
      get idempotencyKey() {
        idempotencyKeyReads += 1;
        return idempotencyKeyReads === 1 ? REQUEST.idempotencyKey : " ";
      },
    } as OwnerSignatureRequest;

    const result = await makeLive(store).sign(getterRequest);

    expect(idempotencyKeyReads).toBe(1);
    expect(result).toMatchObject({ status: "signed", persisted: { idempotencyKey: REQUEST.idempotencyKey } });
  });

  it("captures accessor-backed receipts once before validating and reading back", async () => {
    let statusReads = 0;
    let recordIdReads = 0;
    let write: TrackOwnerSignatureWrite | undefined;
    const track: TrackOwnerSignaturePort = {
      contractVersion: FOCUS_OWNER_SIGNATURE_CONTRACT_VERSION,
      async appendOwnerSignature(input) {
        write = input;
        return {
          get status() {
            statusReads += 1;
            return statusReads === 1 ? "written" : "failed";
          },
          get recordId() {
            recordIdReads += 1;
            return recordIdReads === 1 ? "accessor-receipt" : " ";
          },
        } as TrackOwnerSignatureWriteResult;
      },
      async readOwnerSignature() {
        if (write === undefined) throw new Error("expected append before read");
        return persistedFromWrite(write, "accessor-receipt");
      },
    };

    await expect(makeLive(track).sign(REQUEST)).resolves.toMatchObject({
      status: "signed",
      duplicate: false,
      persisted: { recordId: "accessor-receipt" },
    });
    expect(statusReads).toBe(1);
    expect(recordIdReads).toBe(1);
  });

  it("gives the port immutable request, owner, and trusted relayer copies", async () => {
    const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
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
    const mutableRequest: OwnerSignatureRequest = {
      target: { ...REQUEST.target },
      authentication: REQUEST.authentication,
      idempotencyKey: REQUEST.idempotencyKey,
    };

    const pending = live.sign(mutableRequest);
    mutableRequest.target.workspace = "caller-mutated";
    mutableRequest.idempotencyKey = "caller-mutated";
    const result = await pending;

    expect(result.status).toBe("signed");
    expect(mutationRejected).toBe(true);
    expect(submitted).toBeDefined();
    if (submitted === undefined || authorizedTarget === undefined) throw new Error("expected captured port boundaries");
    expect(Object.isFrozen(submitted.target)).toBe(true);
    expect(Object.isFrozen(submitted.attestation)).toBe(true);
    expect(Object.isFrozen(submitted.attestation.attester)).toBe(true);
    expect(Object.isFrozen(submitted.attestation.attester.canonicalIdentity)).toBe(true);
    expect(Object.isFrozen(submitted.relayer)).toBe(true);
    expect(Object.isFrozen(submitted.relayer.canonicalIdentity)).toBe(true);
    expect(Object.isFrozen(authorizedTarget)).toBe(true);
    expect(submitted.target).not.toBe(authorizedTarget);
    expect(result).toMatchObject({
      status: "signed",
      persisted: { target: REQUEST.target, relayer: RELAYER, idempotencyKey: REQUEST.idempotencyKey },
    });
  });

  it("rejects an owner-relayer canonical collision before authorization or append", async () => {
    const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
    let authorizationCalls = 0;
    const collidingOwner: AuthenticatedOwnPrincipal = {
      ...OWNER,
      canonicalIdentity: { issuer: "HTTPS://AUTH.EXAMPLE", subject: "RELAY@EXAMPLE.COM" },
    };
    const collidingRelayer: RelayerProvenance = {
      ...RELAYER,
      canonicalIdentity: { issuer: "https://auth.example", subject: "relay@example.com" },
    };

    await expect(
      makeLive(store, {
        authenticate: async () => collidingOwner,
        getRelayerProvenance: async () => collidingRelayer,
        authorize: () => {
          authorizationCalls += 1;
          return true;
        },
      }).sign(REQUEST),
    ).resolves.toEqual({ status: "not-done", reason: "attester-relayer-conflict" });
    expect(authorizationCalls).toBe(0);
    expect(store.appendAttempts).toBe(0);
  });

  it("cannot let caller-asserted relayer text replace the authenticated owner attester", async () => {
    const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
    const callerAssertedRelayer = {
      ...REQUEST,
      relayer: {
        transport: "internal",
        relayerId: OWNER.principalId,
        canonicalIdentity: OWNER.canonicalIdentity,
      },
    } as unknown as OwnerSignatureRequest;

    const result = await makeLive(store).sign(callerAssertedRelayer);

    expect(result).toMatchObject({
      status: "signed",
      persisted: { attestation: { attester: OWNER }, relayer: RELAYER },
    });
  });

  it("returns one duplicate from a barrier-synchronized durable atomic owner-decision write", async () => {
    const atomicPort = new BarrierSynchronizedDurableAtomicTrackOwnerSignaturePort();
    const live = makeLive(atomicPort);
    const [first, second] = await Promise.all([
      live.sign({ ...REQUEST, idempotencyKey: "race-key-one" }),
      live.sign({ ...REQUEST, idempotencyKey: "race-key-two" }),
    ]);

    expect([first, second].filter((result) => result.status === "signed" && !result.duplicate)).toHaveLength(1);
    expect([first, second].filter((result) => result.status === "signed" && result.duplicate)).toHaveLength(1);
    expect(atomicPort.appendAttempts).toBe(2);
    expect(atomicPort.recordCount).toBe(1);
    expect(atomicPort.receiptStatuses.filter((status) => status === "written")).toHaveLength(1);
    expect(atomicPort.receiptStatuses.filter((status) => status === "duplicate")).toHaveLength(1);
  });

  it("uses the test-only adapter's synchronous atomic owner-decision uniqueness for same-key replay", async () => {
    const store = new TestOnlyInMemoryTrackOwnerSignaturePort();
    const live = makeLive(store);
    const [first, second] = await Promise.all([live.sign(REQUEST), live.sign(REQUEST)]);

    expect(first).toMatchObject({ status: "signed" });
    expect(second).toMatchObject({ status: "signed" });
    expect([first, second].filter((result) => result.status === "signed" && result.duplicate)).toHaveLength(1);
    expect(store.appendAttempts).toBe(2);
    expect(store.recordCount).toBe(1);
  });
});
