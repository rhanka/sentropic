import { productLocksPorts } from './locks-product-ports';
import type { StreamsLocksPort } from './streams-ports';

export const productStreamsLocksPort: StreamsLocksPort = {
  clearForUser: (userId) => productLocksPorts.stream.clearForUser(userId),
  readPresence: (input) => productLocksPorts.stream.readPresence(input),
  readSnapshot: (input) => productLocksPorts.stream.readLock(input),
};
