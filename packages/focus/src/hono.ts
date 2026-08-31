import { Hono, type Context } from "hono";

import type { OwnerSignatureRequest } from "./model.js";
import type {
  CreateFocusRouterOptions,
  FocusDecisionValidatorPort,
} from "./hono-ports.js";

export type {
  CreateFocusRouterOptions,
  FocusDecisionValidatorPort,
  FocusHttpPrincipal,
  FocusOwnerSignaturePort,
  FocusTenancyPort,
  FocusTrackPort,
  FocusTrackReadResult,
} from "./hono-ports.js";

const principalOf = async (context: Context, options: CreateFocusRouterOptions) => {
  try {
    return await options.resolvePrincipal(context);
  } catch {
    return undefined;
  }
};

const parseSignatureBody = async (context: Context) => {
  try {
    const value: unknown = await context.req.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "decision_id" && key !== "idempotency_key")) return undefined;
    if (typeof record.decision_id !== "string" || typeof record.idempotency_key !== "string") return undefined;
    const decisionId = record.decision_id.trim();
    const idempotencyKey = record.idempotency_key.trim();
    if (!decisionId || decisionId.length > 512 || !idempotencyKey || idempotencyKey.length > 512) return undefined;
    return { decisionId, idempotencyKey };
  } catch {
    return undefined;
  }
};

export const createFocusRouter = (options: CreateFocusRouterOptions): Hono => {
  const router = new Hono();

  router.get("/decisions/:decisionId", async (context) => {
    const principal = await principalOf(context, options);
    if (!principal) return context.json({ error: "Authentication required" }, 401);
    const target = { workspace: principal.workspaceId, decisionId: context.req.param("decisionId") };
    try {
      if (!await options.tenancy.authorize({ principal, target, action: "read" })) {
        return context.json({ error: "authorization_denied" }, 403);
      }
      const result = await options.track.readDecision(target);
      if (result.status === "unavailable") return context.json({ error: "track_unavailable" }, 503);
      if (result.status === "not-found") return context.json({ error: "decision_not_found" }, 404);
      return context.json({ item: result.document });
    } catch {
      return context.json({ error: "track_unavailable" }, 503);
    }
  });

  router.post("/owner-signatures", async (context) => {
    const principal = await principalOf(context, options);
    if (!principal) return context.json({ error: "Authentication required" }, 401);
    const body = await parseSignatureBody(context);
    if (!body) return context.json({ error: "Invalid owner signature request" }, 400);
    const target = { workspace: principal.workspaceId, decisionId: body.decisionId };
    let validation: Awaited<ReturnType<FocusDecisionValidatorPort["validate"]>>;
    try {
      validation = await options.decisionValidator.validate({
        workspace: target.workspace, decisionId: target.decisionId,
        userId: principal.userId, userEmail: principal.email,
      });
    } catch {
      validation = { authorized: false, reason: "decision-validation-unavailable" };
    }
    if (!validation.authorized) {
      const denied = validation.reason === "authorization-denied" || validation.reason === "not-decision-owner";
      return context.json({ status: "not-done", reason: validation.reason ?? "decision-validation-unavailable" }, denied ? 403 : 503);
    }
    try {
      const track = await options.track.getOwnerSignaturePort();
      if (!track) return context.json({ status: "not-done", reason: "track-port-unavailable" }, 503);
      const session = options.ownerSignature.createSession({
        principal,
        track,
        authorize: (owner, ownerTarget) => options.tenancy.authorize({
          principal, owner, target: ownerTarget, action: "sign",
        }),
      });
      const request: OwnerSignatureRequest = {
        target,
        authentication: { kind: "own-principal", proof: principal.sessionId },
        idempotencyKey: body.idempotencyKey,
      };
      const result = await session.sign(request);
      if (result.status === "signed") return context.json(result, result.duplicate ? 200 : 201);
      return context.json(result, result.reason === "authorization-denied" ? 403 : 409);
    } catch {
      return context.json({ status: "not-done", reason: "track-port-unavailable" }, 503);
    }
  });

  return router;
};
