/**
 * Slice 2 — In-memory audit sink + secret redaction.
 *
 * Backs the §4.5 audit hook and the §5/§6 "no secret in logs/prompts/traces/
 * fixtures" rule. The redactor is given the set of known secret values and
 * replaces any occurrence with a fixed token before anything is recorded.
 *
 * MOCK-ONLY: in-memory, no persistence, no network.
 */

export const REDACTION_TOKEN = '[REDACTED]';

export type AuditEvent = {
  kind: string;
  auditId: string;
  correlationId?: string;
  at: string;
  // Redacted, model-safe details only. Secret VALUES never reach this object.
  detail?: Record<string, unknown>;
};

/**
 * A registry of live secret VALUES. Used purely to assert/guarantee redaction;
 * it is never serialized or exposed. Values are added when a secret is minted
 * and removed on rotation/revocation.
 */
export class SecretRedactor {
  readonly #values = new Set<string>();

  register(value: string): void {
    if (value.length > 0) this.#values.add(value);
  }

  forget(value: string): void {
    this.#values.delete(value);
  }

  /** Deep-redact any registered secret value found anywhere in the payload. */
  redact<T>(payload: T): T {
    const serialized = JSON.stringify(payload, (_key, value) =>
      typeof value === 'string' ? this.redactString(value) : value,
    );
    return serialized === undefined ? payload : (JSON.parse(serialized) as T);
  }

  redactString(value: string): string {
    let out = value;
    for (const secret of this.#values) {
      if (secret && out.includes(secret)) {
        out = out.split(secret).join(REDACTION_TOKEN);
      }
    }
    return out;
  }
}

/** In-memory audit sink. Every emitted event is redacted before being stored. */
export class InMemoryAuditSink {
  readonly events: AuditEvent[] = [];
  readonly logs: string[] = [];
  readonly #redactor: SecretRedactor;

  constructor(redactor: SecretRedactor) {
    this.#redactor = redactor;
  }

  async emit(event: AuditEvent): Promise<void> {
    this.events.push(this.#redactor.redact(event));
  }

  /** A logger that redacts before recording — models never see raw secrets. */
  log(...parts: unknown[]): void {
    const line = parts
      .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
      .join(' ');
    this.logs.push(this.#redactor.redactString(line));
  }

  /** All recorded text (events + logs) flattened, for leak assertions in tests. */
  dump(): string {
    return JSON.stringify(this.events) + '\n' + this.logs.join('\n');
  }
}
