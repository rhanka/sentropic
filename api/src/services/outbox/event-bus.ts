/**
 * EventBusPort — wake-up-only publish(channel, payload) interface.
 *
 * Design (SPEC_EVOL_EVENT_SPINE.md §2 Q3 / SPEC_EVOL_OUTBOX_V0.md §1 item 4):
 * - The outbox is the DURABLE source of truth; the bus is wake-up-only.
 * - A dropped publish() only delays a snapshot-on-wake consumer (which re-reads DB).
 * - Default binding wraps pg NOTIFY; swappable to NATS/Kafka without touching producers.
 * - Signature: publish(channel, payload) — not publish(channel, key) — because
 *   payload-carrying channels push data verbatim (Q3 resolution).
 *
 * Producers (outbox-dispatcher.ts) call publish() AFTER claiming + marking rows
 * `dispatched`. They never call this directly — only via the dispatcher path.
 */

import { pool } from '../../db/client';
import { logger } from '../../logger';

/**
 * EventBusPort — the swappable publish interface.
 */
export interface EventBusPort {
  /**
   * Publish an event to the named channel.
   * Wake-up-only: fire-and-forget, non-transactional.
   *
   * @param channel - The NOTIFY/publish channel name.
   * @param payload - The payload to send (will be JSON-serialized for pg NOTIFY).
   */
  publish(channel: string, payload: unknown): Promise<void>;
}

/**
 * PgEventBus — default EventBusPort binding backed by PostgreSQL NOTIFY.
 *
 * Constraints (from pg NOTIFY):
 * - Payload is non-transactional (fire-and-forget).
 * - Payload is limited to ~8 KB by PostgreSQL.
 * - No durability guarantee (the outbox table is the durable source).
 */
export class PgEventBus implements EventBusPort {
  async publish(channel: string, payload: unknown): Promise<void> {
    const client = await pool.connect();
    try {
      // Serialize payload to JSON string; escape single quotes for NOTIFY.
      const payloadStr = JSON.stringify(payload ?? {}).replace(/'/g, "''");
      await client.query(`NOTIFY ${channel}, '${payloadStr}'`);
    } catch (err) {
      // Non-fatal: a dropped NOTIFY only delays consumer wake-up.
      // The outbox ensures at-least-once delivery via the periodic sweep.
      logger.warn({ err, channel }, 'event-bus: pg NOTIFY failed (non-fatal)');
    } finally {
      client.release();
    }
  }
}

/** Default singleton — pg-backed. Swap at startup for NATS/Kafka. */
export const eventBus: EventBusPort = new PgEventBus();
