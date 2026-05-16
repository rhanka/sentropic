/**
 * BR14b Lot 15.5 — InMemoryMeshDispatch.
 *
 * Reference in-memory adapter for the `MeshDispatchPort`. Mandated by
 * SPEC_STUDY_ARCHITECTURE_BOUNDARIES §5.
 *
 * Scriptable adapter: tests enqueue pre-canned responses (for `invoke`)
 * and event sequences (for `invokeStream`) and the adapter returns them
 * FIFO. Throws on over-consumption so tests fail loudly when call counts
 * drift from expectations.
 */
import type {
  MeshDispatchPort,
  MeshInvokeRequest,
  MeshInvokeResponse,
  MeshStreamEvent,
  MeshStreamRequest,
} from '../mesh-port.js';

export class InMemoryMeshDispatch implements MeshDispatchPort {
  private invokeQueue: MeshInvokeResponse[] = [];
  private streamQueue: MeshStreamEvent[][] = [];
  invokeCalls: MeshInvokeRequest[] = [];
  streamCalls: MeshStreamRequest[] = [];

  /** Test helper — enqueue a `MeshInvokeResponse` for the next invoke call. */
  enqueueInvoke(response: MeshInvokeResponse): void {
    this.invokeQueue.push(response);
  }

  /**
   * Test helper — enqueue an ordered list of `MeshStreamEvent` for the
   * next invokeStream call.
   */
  enqueueStream(events: ReadonlyArray<MeshStreamEvent>): void {
    this.streamQueue.push([...events]);
  }

  /** Test helper — wipe all internal state. */
  reset(): void {
    this.invokeQueue = [];
    this.streamQueue = [];
    this.invokeCalls = [];
    this.streamCalls = [];
  }

  async invoke(request: MeshInvokeRequest): Promise<MeshInvokeResponse> {
    this.invokeCalls.push(request);
    const next = this.invokeQueue.shift();
    if (!next) {
      throw new Error('InMemoryMeshDispatch: no enqueued invoke response');
    }
    return next;
  }

  invokeStream(request: MeshStreamRequest): AsyncIterable<MeshStreamEvent> {
    this.streamCalls.push(request);
    const next = this.streamQueue.shift();
    if (!next) {
      throw new Error('InMemoryMeshDispatch: no enqueued stream sequence');
    }
    return (async function* () {
      for (const event of next) {
        yield event;
      }
    })();
  }
}
