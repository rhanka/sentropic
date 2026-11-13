import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

/** Hash/stat/config I/O never occupies the TLS revocation loop synchronously. */
export class PortsActivation {
  enabled = false;
  private fingerprint = '';
  private digest = '';
  private refreshing = false;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly config: string, private readonly binary: string) {
    this.timer = setInterval(() => { void this.refresh(); }, 50); this.timer.unref();
    void this.refresh();
  }
  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const text = await readFile(this.config, 'utf8');
      const flags = text.split('\n').filter(line => line.startsWith('EXECUTION_NODE_PORTS_ENABLED='));
      const digests = text.split('\n').filter(line => line.startsWith('EXECUTION_NODE_PORTS_RUNSC_SHA256='));
      const enabled = flags.length === 1 && flags[0] === 'EXECUTION_NODE_PORTS_ENABLED=true';
      const expected = digests.length === 1 ? /^EXECUTION_NODE_PORTS_RUNSC_SHA256=([a-f0-9]{64})$/.exec(digests[0]!)?.[1] : undefined;
      if (!enabled || !expected) { this.enabled = false; return; }
      const s = await stat(this.binary, { bigint: true });
      const fingerprint = `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
      if (fingerprint !== this.fingerprint) {
        this.enabled = false; // Replaced binary closes before potentially slow hashing.
        const hash = createHash('sha256');
        for await (const bytes of createReadStream(this.binary, { highWaterMark: 65536 })) hash.update(bytes);
        this.digest = hash.digest('hex'); this.fingerprint = fingerprint;
        return; // Re-read config and identity before activation, including during replacement.
      }
      this.enabled = this.digest === expected;
    } catch { this.enabled = false; }
    finally { this.refreshing = false; }
  }
  close() { clearInterval(this.timer); this.enabled = false; }
}
