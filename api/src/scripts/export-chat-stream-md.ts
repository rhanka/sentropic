import { Client } from 'pg';
import { env } from '../config/env';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type DbEventRow = {
  sequence: number;
  eventType: string;
  data: unknown;
  createdAt: string;
};

type DbTraceRow = {
  createdAt: string;
  phase: string;
  iteration: number;
  model: string | null;
  toolChoice: string | null;
  tools: unknown;
  openaiMessages: unknown;
  toolCalls: unknown;
  meta: unknown;
};

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function jsonPretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function fenceJson(value: unknown): string {
  return `\n\`\`\`json\n${jsonPretty(value)}\n\`\`\`\n`;
}

function fenceText(value: string): string {
  return `\n\`\`\`\n${value}\n\`\`\`\n`;
}

function summarizeTools(events: DbEventRow[]): Array<{ name: string; n: number }> {
  const counts = new Map<string, number>();
  for (const ev of events) {
    if (ev.eventType !== 'tool_call_start') continue;
    const data = asRecord(ev.data);
    const name = String(data.name ?? 'unknown');
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

async function main() {
  const streamId = mustGetEnv('STREAM_ID');
  const outFile = mustGetEnv('OUT_FILE');

  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  const msgRes = await client.query(
    `
    SELECT
      m.id AS "messageId",
      m.session_id AS "sessionId",
      m.sequence AS "messageSeq",
      m.role AS "messageRole",
      m.model AS "messageModel",
      s.user_id AS "userId",
      s.workspace_id AS "workspaceId",
      s.primary_context_type AS "primaryContextType",
      s.primary_context_id AS "primaryContextId"
    FROM chat_messages m
    JOIN chat_sessions s ON s.id = m.session_id
    WHERE m.id = $1
    LIMIT 1
  `,
    [streamId]
  );
  const msg = msgRes.rows[0] as
    | {
        messageId: string;
        sessionId: string;
        messageSeq: number;
        messageRole: string;
        messageModel: string | null;
        userId: string;
        workspaceId: string | null;
        primaryContextType: string | null;
        primaryContextId: string | null;
      }
    | undefined;

  const prevUserRes = msg
    ? await client.query(
        `
    SELECT id, content
    FROM chat_messages
    WHERE session_id = $1 AND sequence = $2 AND role = 'user'
    LIMIT 1
  `,
        [msg.sessionId, msg.messageSeq - 1]
      )
    : { rows: [] as unknown[] };
  const prevUser = prevUserRes.rows[0] as { id: string; content: string } | undefined;

  const evRes = await client.query(
    `
    SELECT
      sequence,
      event_type AS "eventType",
      data,
      created_at AS "createdAt"
    FROM chat_stream_events
    WHERE stream_id = $1
    ORDER BY sequence ASC
  `,
    [streamId]
  );
  const events: DbEventRow[] = (evRes.rows as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      sequence: Number(r.sequence),
      eventType: String(r.eventType),
      data: r.data,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt)
    };
  });

  const traceRes = await client.query(
    `
    SELECT
      created_at AS "createdAt",
      phase,
      iteration,
      model,
      tool_choice AS "toolChoice",
      tools,
      openai_messages AS "openaiMessages",
      tool_calls AS "toolCalls",
      meta
    FROM chat_generation_traces
    WHERE assistant_message_id = $1
    ORDER BY created_at ASC
  `,
    [streamId]
  );
  const traces: DbTraceRow[] = (traceRes.rows as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      phase: String(r.phase),
      iteration: Number(r.iteration),
      model: (r.model as string | null | undefined) ?? null,
      toolChoice: (r.toolChoice as string | null | undefined) ?? null,
      tools: r.tools,
      openaiMessages: r.openaiMessages,
      toolCalls: r.toolCalls,
      meta: r.meta
    };
  });

  await client.end();

  const toolsSummary = summarizeTools(events);
  const first = events[0];
  const last = events[events.length - 1];

  // Reconstruct tool args (tool_call_delta) by tool_call_id
  const toolMeta = new Map<
    string,
    { id: string; name?: string; startSeq?: number; startAt?: string; argsText: string; result?: unknown; resultSeq?: number; resultAt?: string }
  >();

  for (const ev of events) {
    if (ev.eventType === 'tool_call_start') {
      const data = asRecord(ev.data);
      const id = String(data.tool_call_id ?? '').trim();
      if (!id) continue;
      const entry = toolMeta.get(id) ?? { id, argsText: '' };
      entry.name = String(data.name ?? entry.name ?? 'unknown');
      entry.startSeq = entry.startSeq ?? ev.sequence;
      entry.startAt = entry.startAt ?? ev.createdAt;
      const args = String(data.args ?? '');
      if (args) entry.argsText += args;
      toolMeta.set(id, entry);
    } else if (ev.eventType === 'tool_call_delta') {
      const data = asRecord(ev.data);
      const id = String(data.tool_call_id ?? '').trim();
      if (!id) continue;
      const entry = toolMeta.get(id) ?? { id, argsText: '' };
      entry.argsText += String(data.delta ?? '');
      toolMeta.set(id, entry);
    } else if (ev.eventType === 'tool_call_result') {
      const data = asRecord(ev.data);
      const id = String(data.tool_call_id ?? '').trim();
      if (!id) continue;
      const entry = toolMeta.get(id) ?? { id, argsText: '' };
      entry.result = data.result ?? ev.data;
      entry.resultSeq = ev.sequence;
      entry.resultAt = ev.createdAt;
      toolMeta.set(id, entry);
    }
  }

  // Build detailed transcript with delta aggregation
  type Step =
    | { kind: 'status'; seq: number; at: string; data: unknown }
    | { kind: 'reasoning'; seqStart: number; seqEnd: number; atStart: string; atEnd: string; text: string }
    | { kind: 'content'; seqStart: number; seqEnd: number; atStart: string; atEnd: string; text: string }
    | { kind: 'tool'; toolCallId: string; name: string; startSeq?: number; resultSeq?: number; startAt?: string; resultAt?: string; args: unknown; result: unknown }
    | { kind: 'terminal'; seq: number; at: string; eventType: 'done' | 'error'; data: unknown };

  const steps: Step[] = [];
  let bufReason: { seqStart: number; atStart: string; lastSeq: number; lastAt: string; text: string } | null = null;
  let bufContent: { seqStart: number; atStart: string; lastSeq: number; lastAt: string; text: string } | null = null;

  const flushReason = () => {
    if (!bufReason) return;
    steps.push({
      kind: 'reasoning',
      seqStart: bufReason.seqStart,
      seqEnd: bufReason.lastSeq,
      atStart: bufReason.atStart,
      atEnd: bufReason.lastAt,
      text: bufReason.text
    });
    bufReason = null;
  };
  const flushContent = () => {
    if (!bufContent) return;
    steps.push({
      kind: 'content',
      seqStart: bufContent.seqStart,
      seqEnd: bufContent.lastSeq,
      atStart: bufContent.atStart,
      atEnd: bufContent.lastAt,
      text: bufContent.text
    });
    bufContent = null;
  };

  const emittedTools = new Set<string>();

  for (const ev of events) {
    if (ev.eventType === 'reasoning_delta') {
      const delta = String(asRecord(ev.data).delta ?? '');
      if (!bufReason) bufReason = { seqStart: ev.sequence, atStart: ev.createdAt, lastSeq: ev.sequence, lastAt: ev.createdAt, text: '' };
      bufReason.text += delta;
      bufReason.lastSeq = ev.sequence;
      bufReason.lastAt = ev.createdAt;
      continue;
    }
    if (ev.eventType === 'content_delta') {
      const delta = String(asRecord(ev.data).delta ?? '');
      if (!bufContent) bufContent = { seqStart: ev.sequence, atStart: ev.createdAt, lastSeq: ev.sequence, lastAt: ev.createdAt, text: '' };
      bufContent.text += delta;
      bufContent.lastSeq = ev.sequence;
      bufContent.lastAt = ev.createdAt;
      continue;
    }

    // non-delta => flush aggregated buffers to keep ordering
    flushReason();
    flushContent();

    if (ev.eventType === 'status') {
      steps.push({ kind: 'status', seq: ev.sequence, at: ev.createdAt, data: ev.data });
      continue;
    }
    if (ev.eventType === 'tool_call_result') {
      const data = asRecord(ev.data);
      const toolCallId = String(data.tool_call_id ?? '').trim();
      if (toolCallId && !emittedTools.has(toolCallId)) {
        const meta = toolMeta.get(toolCallId);
        steps.push({
          kind: 'tool',
          toolCallId,
          name: meta?.name ?? 'unknown',
          startSeq: meta?.startSeq,
          resultSeq: meta?.resultSeq,
          startAt: meta?.startAt,
          resultAt: meta?.resultAt,
          args: safeJsonParse(meta?.argsText ?? ''),
          result: meta?.result ?? data.result ?? ev.data
        });
        emittedTools.add(toolCallId);
      }
      continue;
    }
    if (ev.eventType === 'done' || ev.eventType === 'error') {
      steps.push({ kind: 'terminal', seq: ev.sequence, at: ev.createdAt, eventType: ev.eventType, data: ev.data });
      continue;
    }
    // Ignore tool_call_start/tool_call_delta here (we’ll present them via tool_call_result step)
  }
  flushReason();
  flushContent();

  // Markdown output
  const lines: string[] = [];
  lines.push(`# Analyse — Stream \`${streamId}\``);
  lines.push('');
  lines.push('## Métadonnées');
  lines.push('');
  if (msg) {
    lines.push(`- **messageId**: \`${msg.messageId}\``);
    lines.push(`- **sessionId**: \`${msg.sessionId}\``);
    lines.push(`- **role**: \`${msg.messageRole}\``);
    lines.push(`- **sequence (message)**: ${msg.messageSeq}`);
    lines.push(`- **model (message)**: ${msg.messageModel ?? '(null)'} (NB: le job queue peut surcharger)`);
    lines.push(`- **userId**: \`${msg.userId}\``);
    lines.push(`- **workspaceId**: \`${msg.workspaceId ?? '(null)'}\``);
    lines.push(`- **primaryContext**: \`${msg.primaryContextType ?? '(null)'}\` / \`${msg.primaryContextId ?? '(null)'}\``);
  } else {
    lines.push('- **messageId**: (introuvable dans `chat_messages`)');
  }
  lines.push(`- **events**: ${events.length}`);
  lines.push(`- **first**: seq ${first?.sequence ?? '-'} (${first?.eventType ?? '-'}) @ ${first?.createdAt ?? '-'}`);
  lines.push(`- **last**: seq ${last?.sequence ?? '-'} (${last?.eventType ?? '-'}) @ ${last?.createdAt ?? '-'}`);
  lines.push('');
  lines.push('### Tools (résumé)');
  lines.push('');
  if (toolsSummary.length === 0) {
    lines.push('- (aucun tool)');
  } else {
    for (const t of toolsSummary) lines.push(`- **${t.name}**: ${t.n}`);
  }
  lines.push('');

  lines.push('## Appels OpenAI (traces) — payload exact envoyé');
  lines.push('');
  if (traces.length === 0) {
    lines.push('- (aucune trace trouvée) — vérifier `CHAT_TRACE_ENABLED=true` et la rétention');
    lines.push('');
  } else {
    lines.push(`- **traces**: ${traces.length}`);
    lines.push('');
    for (let i = 0; i < traces.length; i++) {
      const t = traces[i];
      const meta = asRecord(t.meta);
      lines.push(`### Trace ${i + 1}`);
      lines.push(`- **at**: ${t.createdAt}`);
      lines.push(`- **phase**: \`${t.phase}\``);
      lines.push(`- **iteration**: ${t.iteration}`);
      lines.push(`- **model**: ${t.model ?? '(null)'}`);
      lines.push(`- **toolChoice**: ${t.toolChoice ?? '(null)'}`);
      lines.push(`- **callSite**: \`${String(meta.callSite ?? '(unknown)')}\``);
      lines.push(`- **openaiApi**: \`${String(meta.openaiApi ?? '(unknown)')}\``);
      lines.push('');
      lines.push('**tools (exposés)**:');
      lines.push(fenceJson(t.tools ?? null));
      lines.push('**openai_messages (payload exact)**:');
      lines.push(fenceJson(t.openaiMessages ?? null));
      if (t.toolCalls) {
        lines.push('**tool_calls (exécutés — args + result)**:');
        lines.push(fenceJson(t.toolCalls));
      }
    }
    lines.push('');
  }

  lines.push('## Transcription complète (étapes) — du début à la fin');
  lines.push('');
  if (prevUser) {
    lines.push('### Demande utilisateur (message précédent)');
    lines.push('');
    lines.push(`- **messageId**: \`${prevUser.id}\``);
    lines.push(fenceText(prevUser.content ?? ''));
  }

  lines.push('### Étapes (ordre chronologique)');
  lines.push('');
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    lines.push(`#### Étape ${i + 1}`);
    if (s.kind === 'status') {
      lines.push(`- **type**: \`status\``);
      lines.push(`- **seq**: ${s.seq}`);
      lines.push(`- **at**: ${s.at}`);
      lines.push(fenceJson(s.data));
    } else if (s.kind === 'reasoning') {
      lines.push(`- **type**: \`reasoning\``);
      lines.push(`- **seq**: ${s.seqStart}..${s.seqEnd}`);
      lines.push(`- **at**: ${s.atStart} .. ${s.atEnd}`);
      lines.push(fenceText(s.text));
    } else if (s.kind === 'content') {
      lines.push(`- **type**: \`content\``);
      lines.push(`- **seq**: ${s.seqStart}..${s.seqEnd}`);
      lines.push(`- **at**: ${s.atStart} .. ${s.atEnd}`);
      lines.push(fenceText(s.text));
    } else if (s.kind === 'tool') {
      lines.push(`- **type**: \`tool\``);
      lines.push(`- **name**: \`${s.name}\``);
      lines.push(`- **tool_call_id**: \`${s.toolCallId}\``);
      if (s.startSeq) lines.push(`- **start seq**: ${s.startSeq}${s.startAt ? ` @ ${s.startAt}` : ''}`);
      if (s.resultSeq) lines.push(`- **result seq**: ${s.resultSeq}${s.resultAt ? ` @ ${s.resultAt}` : ''}`);
      lines.push('');
      lines.push('**Args**:');
      lines.push(fenceJson(s.args));
      lines.push('**Result**:');
      lines.push(fenceJson(s.result));
    } else if (s.kind === 'terminal') {
      lines.push(`- **type**: \`${s.eventType}\``);
      lines.push(`- **seq**: ${s.seq}`);
      lines.push(`- **at**: ${s.at}`);
      lines.push(fenceJson(s.data));
    }
  }

  // Analysis
  lines.push('## Analyse');
  lines.push('');
  lines.push('### Constat');
  lines.push('');
  lines.push(`- **Nombre total d’événements**: ${events.length}`);
  lines.push(`- **Nombre d’étapes (après agrégation)**: ${steps.length}`);
  lines.push(`- **Tools**: ${toolsSummary.map((t) => `${t.name}×${t.n}`).join(', ') || '(aucun)'}`);
  lines.push('');
  lines.push('### Hypothèses (à vérifier avec `chat_generation_traces`)');
  lines.push('');
  lines.push('- **Qualité des messages envoyés à OpenAI**: la section “Appels OpenAI (traces)” ci-dessus montre les payloads exacts par itération.');
  lines.push('- **Boucle / répétition**: vérifier si le modèle re-demande un tool déjà exécuté faute de “signal d’arrêt” clair.');
  lines.push('- **Disponibilité des tools**: vérifier la liste `tools` réellement passée (elle est maintenant traçée par itération).');
  lines.push('');
  lines.push('### Pistes de remédiation (options)');
  lines.push('');
  lines.push('- **Option 1 (garde-fou)**: détecter tool identique répété (même args) et forcer `toolChoice=none` + réponse.');
  lines.push('- **Option 2 (orchestration déterministe)**: pour “références”, enchaîner serveur: read_usecase → web_extract (toutes URLs) → rédaction sans tools.');
  lines.push('- **Option 3 (fix fondamental)**: revoir l’intégration Responses API pour conserver une sémantique tool output (au lieu de “tool→user JSON”).');
  lines.push('');

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, lines.join('\n'), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outFile} (${lines.length} lines)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


