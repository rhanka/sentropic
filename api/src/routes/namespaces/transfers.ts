import { Hono } from 'hono';

export const TRANSFER_ROUTES = [
  ['POST', '/exports'],
  ['POST', '/imports/preview'],
  ['POST', '/imports'],
] as const;

export const TRANSFER_PATHS = [
  '/exports',
  '/imports/preview',
  '/imports',
] as const;

export interface TransferArchiveLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxUncompressedBytes: number;
}

export interface TransferManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface TransferArchiveEntry {
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

export interface TransferArchive {
  read(path: string): TransferArchiveEntry | null;
  write(path: string, bytes: Uint8Array): void;
  generate(): Promise<Uint8Array>;
}

export interface TransferArchiveHashPort {
  readonly limits: TransferArchiveLimits;
  create(): TransferArchive;
  open(bytes: Uint8Array): Promise<TransferArchive>;
  encodeJson(value: unknown): Uint8Array;
  sha256(bytes: Uint8Array): string;
  validateManifest(files: readonly TransferManifestFile[]): void;
}

export interface TransferStoragePort {
  defaultBucket(): string;
  getBytes(ref: { bucket: string; key: string }): Promise<Uint8Array>;
  put(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType?: string;
    expectedChecksum?: string;
  }): Promise<unknown>;
}

export interface TransferAuthorizationPort {
  requireWorkspaceAdmin(userId: string, workspaceId: string): Promise<void>;
  requireWorkspaceEditor(userId: string, workspaceId: string): Promise<void>;
}

export interface TransferDomainRuntimePorts {
  readonly storage: TransferStoragePort;
  readonly authorization: TransferAuthorizationPort;
  readonly archive: TransferArchiveHashPort;
}

export interface TransferDomainPort {
  createRouters(ports: TransferDomainRuntimePorts): {
    readonly exports: Hono;
    readonly imports: Hono;
  };
}

export interface TransfersNamespacePorts extends TransferDomainRuntimePorts {
  readonly domain: TransferDomainPort;
}

export class TransferArchiveLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferArchiveLimitError';
  }
}

const assertTransfersPorts = (ports: TransfersNamespacePorts): void => {
  if (!ports.domain?.createRouters
    || !ports.storage?.defaultBucket
    || !ports.storage?.getBytes
    || !ports.storage?.put
    || !ports.authorization?.requireWorkspaceAdmin
    || !ports.authorization?.requireWorkspaceEditor
    || !ports.archive?.create
    || !ports.archive?.open
    || !ports.archive?.encodeJson
    || !ports.archive?.sha256
    || !ports.archive?.validateManifest) {
    throw new Error('transfer product ports are unavailable');
  }
};

export const createTransfersTransportRouter = (ports: TransfersNamespacePorts): Hono => {
  assertTransfersPorts(ports);
  const routers = ports.domain.createRouters({
    storage: ports.storage,
    authorization: ports.authorization,
    archive: ports.archive,
  });
  if (!routers.exports || !routers.imports) {
    throw new Error('transfer domain routers are unavailable');
  }
  return new Hono()
    .route('/exports', routers.exports)
    .route('/imports', routers.imports);
};
