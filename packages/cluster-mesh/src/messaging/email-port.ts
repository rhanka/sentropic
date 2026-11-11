/**
 * CMP-E1 multi-app transactional email provider port, code only.
 *
 * Pure module: per-app sender allowlist, rate limits, audit log. No database,
 * no migration, no transport import. The API adapter injects the TEM client.
 */
import { createHash } from 'node:crypto';

export interface EmailSendRequest {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly fromEmail: string;
  readonly fromName?: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly appInstanceId: string;
}

export interface EmailSendResult {
  readonly messageId: string;
}

export interface EmailAuditEvent {
  readonly at: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly appInstanceId: string;
  readonly toDomain: string;
  readonly subjectDigest: string;
  readonly messageId: string;
}

export interface EmailTransport {
  send(request: Omit<EmailSendRequest, 'tenantId' | 'workspaceId' | 'appInstanceId'>): Promise<EmailSendResult>;
}

export interface EmailPort {
  send(request: EmailSendRequest): Promise<EmailSendResult>;
  audit(): readonly EmailAuditEvent[];
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toDomain = (email: string): string => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/** Exact sender or `@domain` suffix entry; fail closed on unknown shape. */
export const isSenderAllowed = (allowlist: readonly string[], fromEmail: string): boolean => {
  const from = fromEmail.trim().toLowerCase();
  for (const entry of allowlist) {
    const rule = entry.trim().toLowerCase();
    if (rule === from) return true;
    if (rule.startsWith('@') && from.endsWith(rule)) return true;
  }
  return false;
};

/** Fixed-window per-app rate limiter (pure, injectable clock for tests). */
export const createEmailRateLimiter = (options: {
  readonly maxPerWindow: number;
  readonly windowMs: number;
  readonly now?: () => number;
}): { tryAcquire(key: string): boolean } => {
  if (!Number.isFinite(options.maxPerWindow) || options.maxPerWindow <= 0) {
    throw new Error('maxPerWindow must be positive');
  }
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    tryAcquire(key: string): boolean {
      const at = now();
      const kept = (hits.get(key) ?? []).filter((t) => at - t < options.windowMs);
      if (kept.length >= options.maxPerWindow) {
        hits.set(key, kept);
        return false;
      }
      kept.push(at);
      hits.set(key, kept);
      return true;
    },
  };
};

/** Validates, allowlists, rate-limits, delegates, then audits (PII-free). */
export const createEmailPort = (options: {
  readonly allowedSenders: readonly string[];
  readonly limiter: { tryAcquire(key: string): boolean };
  readonly transport: EmailTransport;
}): EmailPort => {
  const events: EmailAuditEvent[] = [];
  return {
    async send(request: EmailSendRequest): Promise<EmailSendResult> {
      if (!EMAIL.test(request.to.trim())) throw new Error('email needs a valid to address');
      if (!nonEmpty(request.subject) || request.subject.length > 200) {
        throw new Error('email needs a subject of 1..200 chars');
      }
      if (!nonEmpty(request.text)) throw new Error('email needs a text body');
      if (!EMAIL.test(request.fromEmail.trim())) throw new Error('email needs a valid from address');
      if (!nonEmpty(request.tenantId) || !nonEmpty(request.workspaceId)
        || !nonEmpty(request.appInstanceId)) {
        throw new Error('email needs tenant, workspace and app scope');
      }
      if (!isSenderAllowed(options.allowedSenders, request.fromEmail)) {
        throw new Error(`sender not allowed: ${request.fromEmail}`);
      }
      if (!options.limiter.tryAcquire(request.appInstanceId)) {
        throw new Error(`email rate exceeded for ${request.appInstanceId}`);
      }
      const result = await options.transport.send({
        to: request.to,
        subject: request.subject,
        text: request.text,
        ...(request.html ? { html: request.html } : {}),
        fromEmail: request.fromEmail,
        ...(request.fromName ? { fromName: request.fromName } : {}),
      });
      events.push({
        at: new Date().toISOString(),
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        appInstanceId: request.appInstanceId,
        toDomain: toDomain(request.to),
        subjectDigest: `sha256:${createHash('sha256').update(request.subject, 'utf8').digest('hex')}`,
        messageId: result.messageId,
      });
      return result;
    },
    audit(): readonly EmailAuditEvent[] {
      return [...events];
    },
  };
};
