/**
 * Slice 2 — Typed, fail-closed elicitation state machine.
 *
 * Concrete TypeScript for SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM §5.1 (state
 * machine) + §5.2 (normative rules). The forward path is
 * requested -> rendered -> answered -> validated -> resumed; every non-completing
 * outcome is an absorbing terminal that DENIES the gated capability. Only
 * `resumed` releases the gate.
 *
 * MOCK-ONLY: in-memory, deterministic; no network, no secrets in form mode.
 */
import type { DurableCallRef } from './runtime.js';

export type ElicitationState =
  // forward path
  | 'requested'
  | 'rendered'
  | 'answered'
  | 'validated'
  | 'resumed'
  // terminals (all fail-closed: the gated capability is NOT invoked)
  | 'cancelled'
  | 'timed_out'
  | 'denied'
  | 'expired';

export type ElicitationMode = 'form' | 'confirm' | 'consent' | 'url' | 'credential';

export type ElicitationRecord = {
  id: string;
  state: ElicitationState;
  mode: ElicitationMode;
  durableCallRef?: DurableCallRef; // when gating a durable call (§8)
  sessionRef: string; // owning MCP session (§6.3)
  capabilityRef: string; // gated capability
  actor: { sub: string; client?: string }; // authorization-derived subject + MCP client
  ttlSeconds: number;
  auditId: string;
  failClosed: true; // only state === 'resumed' authorizes the gated action
  createdAt: string;
  updatedAt: string;
};

// Modes that require initiator.sub == completer.sub anti-phishing (§5.2 a).
const SUB_MATCH_MODES: ReadonlySet<ElicitationMode> = new Set(['url', 'credential', 'consent']);
// Human-targeted modes for the NHI fail-closed rule (§5.2 c).
const HUMAN_TARGETED_MODES: ReadonlySet<ElicitationMode> = new Set([
  'confirm',
  'consent',
  'credential',
]);

const TERMINALS: ReadonlySet<ElicitationState> = new Set([
  'cancelled',
  'timed_out',
  'denied',
  'expired',
]);

const FORWARD: Record<ElicitationState, ElicitationState | null> = {
  requested: 'rendered',
  rendered: 'answered',
  answered: 'validated',
  validated: 'resumed',
  resumed: null,
  cancelled: null,
  timed_out: null,
  denied: null,
  expired: null,
};

export type Completer = {
  sub: string;
  isHuman: boolean; // false for a non-human / agent principal (NHI)
  delegatingHumanSub?: string; // present when an NHI routes to its delegating human
  client?: string;
};

export type CreateInput = {
  id: string;
  mode: ElicitationMode;
  sessionRef: string;
  capabilityRef: string;
  actor: { sub: string; client?: string };
  ttlSeconds: number;
  auditId: string;
  durableCallRef?: DurableCallRef;
  now?: number; // injectable clock (ms)
};

/** Manages elicitation records and enforces the §5 fail-closed transitions. */
export class ElicitationManager {
  readonly #records = new Map<string, ElicitationRecord>();

  create(input: CreateInput): ElicitationRecord {
    const at = new Date(input.now ?? Date.now()).toISOString();
    const rec: ElicitationRecord = {
      id: input.id,
      state: 'requested',
      mode: input.mode,
      durableCallRef: input.durableCallRef,
      sessionRef: input.sessionRef,
      capabilityRef: input.capabilityRef,
      actor: input.actor,
      ttlSeconds: input.ttlSeconds,
      auditId: input.auditId,
      failClosed: true,
      createdAt: at,
      updatedAt: at,
    };
    this.#records.set(rec.id, rec);
    return rec;
  }

  get(id: string): ElicitationRecord | undefined {
    return this.#records.get(id);
  }

  /** Only a record in state `resumed` releases the gated capability. */
  isGateReleased(id: string): boolean {
    return this.#records.get(id)?.state === 'resumed';
  }

  #set(rec: ElicitationRecord, state: ElicitationState): ElicitationRecord {
    rec.state = state;
    rec.updatedAt = new Date().toISOString();
    return rec;
  }

  /** Advance one forward step. Refuses to move out of a terminal (absorbing). */
  advance(id: string): ElicitationRecord {
    const rec = this.#require(id);
    if (TERMINALS.has(rec.state)) return rec; // terminals are absorbing
    const next = FORWARD[rec.state];
    if (next) this.#set(rec, next);
    return rec;
  }

  render(id: string): ElicitationRecord {
    const rec = this.#require(id);
    if (rec.state === 'requested') this.#set(rec, 'rendered');
    return rec;
  }

  /**
   * Submit an answer. Enforces §5.2 anti-phishing sub-match (a) and NHI
   * fail-closed (c) BEFORE accepting. A failing check moves the record to
   * `denied` (terminal, fail-closed) and the gate is never released.
   */
  answer(id: string, completer: Completer): ElicitationRecord {
    const rec = this.#require(id);
    if (TERMINALS.has(rec.state)) return rec;
    if (rec.state !== 'rendered') return this.#set(rec, 'denied');

    // (a) anti-phishing: sensitive/url/consent require initiator.sub == completer.sub.
    if (SUB_MATCH_MODES.has(rec.mode) && rec.actor.sub !== completer.sub) {
      return this.#set(rec, 'denied');
    }

    // (c) NHI: human-targeted elicitation must be satisfied by a human, or routed
    // to the delegating human; a model/agent MUST NEVER auto-satisfy it.
    if (HUMAN_TARGETED_MODES.has(rec.mode) && !completer.isHuman && !completer.delegatingHumanSub) {
      return this.#set(rec, 'denied');
    }

    return this.#set(rec, 'answered');
  }

  validate(id: string, ok = true): ElicitationRecord {
    const rec = this.#require(id);
    if (TERMINALS.has(rec.state)) return rec;
    if (rec.state !== 'answered') return this.#set(rec, 'denied');
    return this.#set(rec, ok ? 'validated' : 'denied');
  }

  resume(id: string): ElicitationRecord {
    const rec = this.#require(id);
    if (TERMINALS.has(rec.state)) return rec;
    if (rec.state !== 'validated') return this.#set(rec, 'denied');
    return this.#set(rec, 'resumed');
  }

  cancel(id: string): ElicitationRecord {
    return this.#terminate(id, 'cancelled');
  }

  deny(id: string): ElicitationRecord {
    return this.#terminate(id, 'denied');
  }

  /** Move to `timed_out`/`expired` when the TTL has elapsed (fail-closed). */
  tick(id: string, now = Date.now()): ElicitationRecord {
    const rec = this.#require(id);
    if (TERMINALS.has(rec.state) || rec.state === 'resumed') return rec;
    const ageMs = now - new Date(rec.createdAt).getTime();
    if (ageMs >= rec.ttlSeconds * 1000) this.#set(rec, 'timed_out');
    return rec;
  }

  #terminate(id: string, state: ElicitationState): ElicitationRecord {
    const rec = this.#require(id);
    if (rec.state === 'resumed' || TERMINALS.has(rec.state)) return rec;
    return this.#set(rec, state);
  }

  #require(id: string): ElicitationRecord {
    const rec = this.#records.get(id);
    if (!rec) throw new Error(`unknown elicitation '${id}'`);
    return rec;
  }
}
