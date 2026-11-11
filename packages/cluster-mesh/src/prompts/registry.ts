/**
 * CMP-P1 prompt registry v1 (GD-7), code only.
 *
 * Versioned, content-addressed, immutable versions with an audit log.
 * No database, no migration: the registry is pure and injectable; the
 * API adapter seeds it from settings (current store) at composition time.
 */
import { createHash } from 'node:crypto';

const PROMPT_ID = /^[A-Za-z0-9_.-]+$/;

export interface PromptDefinition {
  readonly promptId: string;
  readonly title: string;
  readonly description?: string;
}

export interface PromptVersion {
  readonly promptId: string;
  readonly version: string;
  readonly digest: string;
  readonly content: string;
  readonly author: string;
  readonly createdAt: string;
  readonly approvedBy?: string;
}

export interface PromptAuditEvent {
  readonly at: string;
  readonly by: string;
  readonly action: 'register' | 'approve';
  readonly promptId: string;
  readonly version: string;
  readonly digest: string;
}

/** Canonical content digest (`sha256:<hex>`); approval pins this value. */
export const promptContentDigest = (content: string): string =>
  `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;

export interface PromptRegistry {
  registerDefinition(def: PromptDefinition): PromptDefinition;
  registerVersion(input: {
    readonly promptId: string;
    readonly version: string;
    readonly content: string;
    readonly author: string;
    readonly approvedBy?: string;
  }): PromptVersion;
  get(promptId: string, version?: string): PromptVersion | undefined;
  list(promptId?: string): readonly PromptVersion[];
  audit(): readonly PromptAuditEvent[];
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/** In-memory registry; the durable control-plane registry lands with GD-7. */
export class InMemoryPromptRegistry implements PromptRegistry {
  private readonly defs = new Map<string, PromptDefinition>();
  private readonly versions = new Map<string, PromptVersion>();
  private readonly events: PromptAuditEvent[] = [];

  registerDefinition(def: PromptDefinition): PromptDefinition {
    if (!nonEmpty(def?.promptId) || !PROMPT_ID.test(def.promptId)) {
      throw new Error('prompt needs promptId ^[A-Za-z0-9_.-]+$');
    }
    if (!nonEmpty(def.title)) throw new Error('prompt needs title');
    const frozen = Object.freeze({ ...def });
    this.defs.set(def.promptId, frozen);
    return frozen;
  }

  registerVersion(input: {
    readonly promptId: string;
    readonly version: string;
    readonly content: string;
    readonly author: string;
    readonly approvedBy?: string;
  }): PromptVersion {
    if (!this.defs.has(input.promptId)) throw new Error(`unknown prompt: ${input.promptId}`);
    if (!nonEmpty(input.version)) throw new Error('prompt version is required');
    if (!nonEmpty(input.content)) throw new Error('prompt content is required');
    if (!nonEmpty(input.author)) throw new Error('prompt author is required');
    const key = `${input.promptId}@${input.version}`;
    const digest = promptContentDigest(input.content);
    const existing = this.versions.get(key);
    if (existing) {
      if (existing.digest !== digest) {
        throw new Error(`prompt version immutable: ${key}`);
      }
      return existing;
    }
    const version: PromptVersion = Object.freeze({
      promptId: input.promptId,
      version: input.version,
      digest,
      content: input.content,
      author: input.author,
      createdAt: new Date().toISOString(),
      ...(input.approvedBy ? { approvedBy: input.approvedBy } : {}),
    });
    this.versions.set(key, version);
    this.events.push({
      at: version.createdAt, by: input.author, action: 'register',
      promptId: input.promptId, version: input.version, digest,
    });
    return version;
  }

  get(promptId: string, version?: string): PromptVersion | undefined {
    if (version) return this.versions.get(`${promptId}@${version}`);
    const matches = [...this.versions.values()].filter((v) => v.promptId === promptId);
    return matches.length > 0 ? matches[matches.length - 1] : undefined;
  }

  list(promptId?: string): readonly PromptVersion[] {
    const all = [...this.versions.values()];
    return promptId ? all.filter((v) => v.promptId === promptId) : all;
  }

  audit(): readonly PromptAuditEvent[] {
    return [...this.events];
  }
}
