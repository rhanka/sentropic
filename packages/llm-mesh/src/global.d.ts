declare module 'crypto' {
  export function createHash(algorithm: string): {
    update(data: string | Uint8Array): {
      digest(): Buffer;
    };
  };
  export function randomBytes(size: number): Buffer;
  export function randomUUID(): string;
}

declare module 'http' {
  export interface IncomingMessage {
    url?: string;
  }
  export interface ServerResponse {
    headersSent?: boolean;
    writeHead(statusCode: number, headers?: Record<string, string>): void;
    end(data?: string): void;
  }
  export interface Server {
    address(): { port: number } | null | string;
    listen(port: number, host: string, callback?: () => void): void;
    close(callback?: () => void): void;
  }
  export function createServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Server;
}

declare interface Buffer {
  toString(encoding?: string): string;
}

declare const process: {
  env: Record<string, string | undefined>;
};
