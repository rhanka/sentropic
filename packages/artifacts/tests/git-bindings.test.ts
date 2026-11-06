import { createMemoryGitBindingStore } from '../src/server/git-bindings.js';
import { gitBindingConformance } from './fixtures/git-binding-conformance.js';

gitBindingConformance('in-memory tenant git bindings', async () => createMemoryGitBindingStore());
