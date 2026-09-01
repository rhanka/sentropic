export interface StreamPrincipal {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role?: string;
}

export interface StreamEventEnvelope {
  readonly streamId: string;
  readonly eventType: string;
  readonly data: unknown;
  readonly sequence: number;
}

export interface StreamNotification {
  readonly channel: string;
  readonly payload?: string;
}

export type BusinessStreamKind = 'organization' | 'folder' | 'initiative';
export type PresenceObjectType = BusinessStreamKind;

export interface StreamsOutboxPort {
  listActive(input: { sinceMinutes: number; limit: number }): Promise<string[]>;
  read(input: { streamId: string; sinceSequence: number }): Promise<StreamEventEnvelope[]>;
  readOne(input: { streamId: string; sequence: number }): Promise<StreamEventEnvelope | null>;
}

export interface StreamsChatPort {
  read(input: {
    streamId: string;
    sinceSequence: number;
    principal: StreamPrincipal;
    targetWorkspaceId: string;
  }): Promise<StreamEventEnvelope[]>;
}

export interface StreamsJobsPort {
  canRead(input: { jobId: string; workspaceId: string }): Promise<boolean>;
  listActive(input: { workspaceId: string; limit: number }): Promise<string[]>;
  readSnapshot(input: { jobId: string; workspaceId: string }): Promise<unknown | null>;
}

export interface StreamsBusinessPort {
  canRead(input: {
    kind: BusinessStreamKind;
    id: string;
    workspaceId: string;
  }): Promise<boolean>;
  readOrganization(input: { id: string; workspaceId: string }): Promise<unknown | null>;
  readFolder(input: { id: string; workspaceId: string }): Promise<unknown | null>;
  readInitiative(input: { id: string; workspaceId: string }): Promise<unknown | null>;
}

export interface StreamsWorkspacesPort {
  resolveTarget(input: {
    principal: StreamPrincipal;
    requestedWorkspaceId: string | null;
  }): Promise<string>;
  canObserve(input: {
    principal: StreamPrincipal;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<boolean>;
}

export interface StreamsCommentsPort {
  canObserve(input: {
    principal: StreamPrincipal;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<boolean>;
}

export interface StreamsLocksPort {
  clearForUser(userId: string): Promise<void>;
  readSnapshot(input: {
    objectType: string;
    objectId: string;
    workspaceId: string;
  }): Promise<unknown | null>;
  readPresence(input: {
    objectType: PresenceObjectType;
    objectId: string;
    workspaceId: string;
  }): Promise<unknown>;
}

export interface StreamsNotificationsPort {
  subscribe(input: {
    channels: readonly string[];
    onNotification(notification: StreamNotification): void;
  }): Promise<() => Promise<void>>;
}

export interface StreamsNamespacePorts {
  readonly retentionDays: number;
  readonly outbox: StreamsOutboxPort;
  readonly chat: StreamsChatPort;
  readonly jobs: StreamsJobsPort;
  readonly business: StreamsBusinessPort;
  readonly workspaces: StreamsWorkspacesPort;
  readonly comments: StreamsCommentsPort;
  readonly locks: StreamsLocksPort;
  readonly notifications: StreamsNotificationsPort;
}
