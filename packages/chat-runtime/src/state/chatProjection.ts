import {
  getLinkedSteerMessageIds,
  type ProjectedRunSegment,
  type ProjectionStreamEvent,
} from '../utils/chat-run-projection.js';

export type ChatProjectionMessage = {
  id: string;
  role: string;
  content?: string | null;
  attachments?: readonly ChatMessageAttachment[];
  _localStatus?: 'processing' | 'completed' | 'failed';
  _streamId?: string;
  _optimisticSteerTargetAssistantId?: string;
  _optimisticSteerSubmittedAtMs?: number;
};

export type ChatMessageAttachment = {
  id?: string;
  kind: 'image' | 'file';
  source?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  state?: 'pending' | 'uploading' | 'ready' | 'failed';
  documentId?: string;
