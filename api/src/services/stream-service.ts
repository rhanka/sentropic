import { db, pool } from '../db/client';
import { chatStreamEvents } from '../db/schema';
import { createId } from '../utils/id';
import { sql, eq, desc, and, gt } from 'drizzle-orm';
import type { StreamEventType } from './openai';

/**
 * Génère un stream_id unique
 * - Pour générations classiques : `prompt_id` + timestamp (ou `job_id` si disponible)
 * - Pour chat : `message_id` (sera utilisé plus tard)
 */
export function generateStreamId(promptId?: string, jobId?: string, messageId?: string): string {
  if (messageId) {
    return messageId; // Pour chat, stream_id = message_id
  }
  
  if (jobId) {
    return `job_${jobId}_${Date.now()}`;
  }
  
  if (promptId) {
    return `prompt_${promptId}_${Date.now()}`;
  }
  
  // Fallback : générer un ID unique
  return `stream_${createId()}_${Date.now()}`;
}

/**
 * Écrit un événement de streaming dans la base de données
 * et envoie un NOTIFY PostgreSQL pour temps réel
 */
export async function writeStreamEvent(
  streamId: string,
  eventType: StreamEventType,
  data: any,
  sequence: number,
  messageId?: string | null
): Promise<void> {
  const eventId = createId();

  // Écrire l'événement dans chat_stream_events
  await db.insert(chatStreamEvents).values({
    id: eventId,
    messageId: messageId || null,
    streamId,
    eventType,
    data,
    sequence
  });

  // Envoyer un NOTIFY PostgreSQL pour temps réel
  // Payload minimal : stream_id, sequence, event_type (pour éviter dépassement 8k)
  const notifyPayload = JSON.stringify({
    stream_id: streamId,
    sequence,
    event_type: eventType
  });

  // Utiliser le pool PostgreSQL directement pour NOTIFY
  const client = await pool.connect();
  try {
    await client.query(`NOTIFY stream_events, '${notifyPayload.replace(/'/g, "''")}'`);
  } finally {
    client.release();
  }
}

/**
 * Récupère le prochain numéro de séquence pour un stream_id
 */
export async function getNextSequence(streamId: string): Promise<number> {
  const result = await db
    .select({ maxSequence: sql<number>`MAX(${chatStreamEvents.sequence})` })
    .from(chatStreamEvents)
    .where(eq(chatStreamEvents.streamId, streamId));

  const maxSequence = result[0]?.maxSequence ?? 0;
  return maxSequence + 1;
}

/**
 * Lit les événements d'un stream depuis la base de données
 * Utile pour rehydratation ou relecture
 */
export async function readStreamEvents(
  streamId: string,
  sinceSequence?: number
): Promise<Array<{
  id: string;
  messageId: string | null;
  streamId: string;
  eventType: string;
  data: any;
  sequence: number;
  createdAt: Date;
}>> {
  const conditions = sinceSequence !== undefined
    ? and(eq(chatStreamEvents.streamId, streamId), gt(chatStreamEvents.sequence, sinceSequence))
    : eq(chatStreamEvents.streamId, streamId);

  const events = await db
    .select()
    .from(chatStreamEvents)
    .where(conditions)
    .orderBy(chatStreamEvents.sequence);

  return events.map(event => ({
    id: event.id,
    messageId: event.messageId,
    streamId: event.streamId,
    eventType: event.eventType,
    data: event.data,
    sequence: event.sequence,
    createdAt: event.createdAt
  }));
}

