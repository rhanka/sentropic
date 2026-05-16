/**
 * Per SPEC §12 — generic CheckpointStore with strategy adapters.
 * Single port owns versioning, listing, tagging, forking, optional watch.
 * Strategy concerns (cadence, redaction) live in the adapter, not the port.
 *
 * Isolated from `./ports.ts` (which pulls @sentropic/contracts and
 * @sentropic/events) so that downstream packages can consume the
 * CheckpointStore surface without the full chat-core dependency closure.
 * Pre BR14b Lot 4 wiring of contracts/events into the api Dockerfile,
 * this isolation is required for the api workspace to typecheck.
 */
export type CheckpointMeta = {
  key: string;
  version: number;
  tags?: ReadonlyArray<string>;
  createdAt: string;
  updatedAt: string;
};

export type SaveResult = {
  version: number;
  success: boolean;
  reason?: 'VersionMismatch';
};

export interface CheckpointStore<T> {
  load(key: string): Promise<{ state: T; version: number } | null>;
  save(
    key: string,
    state: T,
    expectedVersion?: number,
  ): Promise<SaveResult>;
  list(
    prefix?: string,
    limit?: number,
  ): Promise<ReadonlyArray<CheckpointMeta>>;
  delete(key: string): Promise<void>;
  tag(key: string, label: string): Promise<void>;
  fork(sourceKey: string, targetKey: string): Promise<void>;
  watch?(
    key: string,
    callback: (state: T, version: number) => void,
  ): () => void;
}
