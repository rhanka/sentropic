declare module 'crypto' {
  export function createHash(algorithm: string): {
    update(data: string | Uint8Array): {
      digest(): Buffer;
    };
  };
  export function randomBytes(size: number): Buffer;
  export function randomUUID(): string;
}

declare module 'node:crypto' {
  interface CipherGCM {
    setAAD(data: Uint8Array): void;
    update(data: Uint8Array): Buffer;
    final(): Buffer;
    getAuthTag(): Buffer;
  }

  interface DecipherGCM {
    setAAD(data: Uint8Array): void;
    setAuthTag(tag: Uint8Array): void;
    update(data: Uint8Array): Buffer;
    final(): Buffer;
  }

  export function createCipheriv(
    algorithm: string,
    key: Uint8Array,
    iv: Uint8Array,
  ): CipherGCM;
  export function createDecipheriv(
    algorithm: string,
    key: Uint8Array,
    iv: Uint8Array,
  ): DecipherGCM;
  export function createHash(algorithm: string): {
    update(data: string | Uint8Array): {
      digest(encoding: 'hex'): string;
    };
  };
  export function randomBytes(size: number): Buffer;
}

declare module 'node:fs/promises' {
  export function chmod(path: string, mode: number): Promise<void>;
  export function link(existingPath: string, newPath: string): Promise<void>;
  export function mkdir(
    path: string,
    options: { recursive: true; mode?: number },
  ): Promise<string | undefined>;
  export function readFile(path: string): Promise<Buffer>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function writeFile(
    path: string,
    data: string | Uint8Array,
    options: { flag?: string; mode?: number },
  ): Promise<void>;
}

declare module 'node:os' {
  export function homedir(): string;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
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

declare interface Buffer extends Uint8Array {
  readonly length: number;
  toString(encoding?: string): string;
}

declare const Buffer: {
  from(data: string, encoding?: string): Buffer;
  concat(list: readonly Uint8Array[]): Buffer;
};

declare const process: {
  env: Record<string, string | undefined>;
};
