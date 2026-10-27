// Independent Node process, own TCP pool, same installed Engram constructor.
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith('.js') && specifier.startsWith('.')) {
    try { return next(specifier.slice(0, -3) + '.ts', context); } catch { /* default resolver below */ }
  }
  return next(specifier, context);
} });
const { memoryPgExisting } = await import('./memory-pg-existing.ts');
const { memoryCampaignHost } = await import('./memory-pg-host.ts');
const [schema, mode] = process.argv.slice(2);
let host;
try {
  const pg = await memoryPgExisting(schema);
  host = await memoryCampaignHost(pg, mode === 'crash-before' ? async () => { process.kill(process.pid, 'SIGKILL'); } : undefined);
  if (mode === 'open') {
    const result = await host.store.readiness();
    process.stdout.write(JSON.stringify(result));
    await host.close();
  } else {
    const digest = `sha256:${'a'.repeat(64)}`;
    const candidate_id = 'candidate-crash';
    const result = await host.store.commitPending({
      control: { candidate_id, envelope_digest: digest, state: 'pending', created_cursor: '0', policy_id: 'policy-memory',
        policy_version: '1', capture_content_digest: digest, capture_receipt_digest: digest },
      sealed: { candidate_id, envelope_ref: 'envelope-crash', envelope_digest: digest, key_ref: 'key-crash', ciphertext: 'opaque' },
      capture_event: { schema_version: 2, event_id: 'capture-candidate-crash', cursor: '0', recorded_at: '2026-10-27T00:00:00.000Z',
        operation: 'capture', candidate_id, to_state: 'pending', authorization_receipt_digest: digest,
        previous_event_digest: digest, event_digest: digest },
    });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    // Private crash witness, not an application acknowledgement.
    process.stdout.write(JSON.stringify(result), () => process.kill(process.pid, 'SIGKILL'));
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error?.code, message: String(error?.message ?? error) }));
  await host?.close().catch(() => undefined);
  process.exitCode = 3;
}
