/**
 * BR14b Lot 15.5 — in-memory port adapters barrel.
 * Per SPEC_STUDY_ARCHITECTURE_BOUNDARIES §5, each chat-core port ships
 * with a reference in-memory adapter so downstream consumers can build
 * without Postgres.
 */
export { InMemoryMessageStore } from './message-store.js';
export { InMemorySessionStore } from './session-store.js';
export { InMemoryStreamBuffer } from './stream-buffer.js';
export { InMemoryCheckpointStore } from './checkpoint-store.js';
export { InMemoryMeshDispatch } from './mesh-dispatch.js';
export { InMemoryStreamSequencer } from './stream-sequencer.js';
