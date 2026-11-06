import { draftConformance } from './fixtures/live-draft-conformance.js';
import { createMemoryLiveStore } from '../src/server/live-drafts.js';

draftConformance('memory retained encrypted drafts', async () => createMemoryLiveStore());
