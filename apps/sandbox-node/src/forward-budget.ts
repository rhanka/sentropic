import { ExecutionNodeError } from './errors.js';

/** Shared by every sandbox: helpers inherit the agent's 192M/TasksMax cgroup. */
export class ForwardBudget {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(readonly limit = Number(process.env.EXECUTION_NODE_PORT_FORWARD_MAX ?? 2), readonly queued = 8) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error('EXECUTION_NODE_PORT_FORWARD_MAX must be 1..8');
  }
  acquire(): Promise<() => void> {
    if (this.active < this.limit) { this.active++; return Promise.resolve(this.release()); }
    if (this.queue.length >= this.queued) return Promise.reject(new ExecutionNodeError('ports_saturated', undefined, 100));
    return new Promise((resolve, reject) => {
      const admit = () => { clearTimeout(timer); resolve(this.release()); };
      const timer = setTimeout(() => {
        this.queue.splice(this.queue.indexOf(admit), 1);
        reject(new ExecutionNodeError('ports_saturated', undefined, 100));
      }, 100);
      this.queue.push(admit);
    });
  }
  private release(): () => void {
    let released = false;
    return () => {
      if (released) return; released = true;
      const next = this.queue.shift();
      if (next) next(); else this.active--;
    };
  }
}
export const forwardBudget = new ForwardBudget();
