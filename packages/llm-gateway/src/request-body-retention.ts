import type { GatewayBodyByteLease } from './request-body-pool.js';

/** Request-scoped ownership: clear every registered holder before returning bytes. */
export class CheckedGatewayBody {
  private readonly holders = new Set<() => void>();
  private detached = false;
  private released = false;
  transferred = false;
  constructor(public body: unknown, readonly bytes: number, readonly lease: GatewayBodyByteLease) {}
  get retainedHolders() { return this.holders.size + (this.body === undefined ? 0 : 1); }
  trackDetach(clear: () => void): void {
    if (this.detached) clear();
    else this.holders.add(clear);
  }
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.body = undefined;
    for (const clear of this.holders) clear();
    this.holders.clear();
    this.lease.shrink(0);
  }
  transfer(): void { this.transferred = true; }
  release(): void {
    if (this.released) return;
    this.detach();
    this.released = true;
    this.lease.release();
  }
}
