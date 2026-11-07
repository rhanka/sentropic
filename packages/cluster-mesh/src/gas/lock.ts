// Publish serialization over LockService.getScriptLock(); failure to lock refuses the operation.
import { LockTimeoutError } from './errors.js';

export interface LockLike {
  tryLock(timeoutMs: number): boolean;
  releaseLock(): void;
}
export interface LockServiceLike {
  getScriptLock(): LockLike;
}

export function withScriptLock<T>(service: LockServiceLike, timeoutMs: number, fn: () => T): T {
  const lock = service.getScriptLock();
  if (!lock.tryLock(timeoutMs)) throw new LockTimeoutError();
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
