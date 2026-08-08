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
  TrackOwnerSignaturePort,
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

});
