// Minimal `node:net` surface for the pure-Node Linux Secret Service reader.
// Type-only and erased on emit; at runtime this is Node's built-in `node:net`.
declare module 'node:net' {
  export interface Socket {
    on(event: 'connect', listener: () => void): this;
    on(event: 'data', listener: (chunk: Uint8Array) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'timeout', listener: () => void): this;
    setTimeout(timeout: number): this;
    write(data: string | Uint8Array): boolean;
    end(): this;
    destroy(): this;
  }
  export function createConnection(path: string): Socket;
}
