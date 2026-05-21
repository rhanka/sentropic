import type { Component } from 'svelte';
import type {
  GeneratedFileCard,
  StreamHubClient,
} from '../client/streamTypes.js';

type StreamMessageClient = Pick<StreamHubClient, 'setStream' | 'delete'>;
type LabelOptions = { values?: Record<string, unknown> };

export type StreamMessageLabelResolver = (
  key: string,
  options?: LabelOptions,
) => string;

export type StreamMessageRuntimeSummary = {
  hasReasoning: boolean;
  hasTools: boolean;
  toolCount: number;
  contextBudgetPct: number | null;
  durationMs: number | null;
  reasoningEffortLabel: string | null;
  generatedFileCards?: GeneratedFileCard[];
  docxCards?: Array<{ jobId: string; fileName: string }>;
};

export type StreamMessageEvent = {
  eventType: string;
  data: unknown;
  sequence: number;
  createdAt?: string;
};

export type StreamMessageTodoRuntimeUpdate = {
  toolCallId: string;
  toolName: 'plan';
  result: Record<string, unknown>;
};

export type StreamMessageProps = {
  streamClient: StreamMessageClient;
  labels?: StreamMessageLabelResolver;
  streamId: string;
  status: string | undefined;
  maxHistory?: number;
  initiallyExpanded?: boolean;
  placeholderTitle?: string | undefined;
  placeholderBody?: string | undefined;
  variant?: 'chat' | 'job';
  finalContent?: string | null | undefined;
  initialEvents?: StreamMessageEvent[] | undefined;
  historyPending?: boolean;
  subscriptionMode?: 'live' | 'passive';
  smoothContentStreaming?: boolean;
  smoothChunkThreshold?: number;
  acknowledgementText?: string | undefined;
  showRuntimeInlinePreview?: boolean;
  deferCollapsedDetails?: boolean;
  requestDeferredDetails?: (() => Promise<void>) | undefined;
  runtimeSummary?: StreamMessageRuntimeSummary | undefined;
  onTerminal?: ((t: 'done' | 'error') => void) | undefined;
  onStreamEvent?: ((t: string) => void) | undefined;
  onGeneratedFile?: ((card: GeneratedFileCard) => void) | undefined;
  onTodoRuntime?: ((update: StreamMessageTodoRuntimeUpdate) => void) | undefined;
};

declare const StreamMessage: Component<StreamMessageProps>;

export default StreamMessage;
