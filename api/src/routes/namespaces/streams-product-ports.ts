import { env } from '../../config/env';
import type { StreamsNamespacePorts } from './streams-ports';
import { productStreamsBusinessPort } from './streams-product-business';
import { productStreamsChatPort, productStreamsOutboxPort } from './streams-product-events';
import { productStreamsJobsPort } from './streams-product-jobs';
import { productStreamsLocksPort } from './streams-product-locks';
import { productStreamsNotificationsPort } from './streams-product-notifications';
import {
  productStreamsCommentsPort,
  productStreamsWorkspacesPort,
} from './streams-product-workspaces';

export const createProductStreamsPorts = (): StreamsNamespacePorts => ({
  retentionDays: env.STREAM_RETENTION_DAYS ?? 7,
  outbox: productStreamsOutboxPort,
  chat: productStreamsChatPort,
  jobs: productStreamsJobsPort,
  business: productStreamsBusinessPort,
  workspaces: productStreamsWorkspacesPort,
  comments: productStreamsCommentsPort,
  locks: productStreamsLocksPort,
  notifications: productStreamsNotificationsPort,
});
