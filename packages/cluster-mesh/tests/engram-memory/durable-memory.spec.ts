import { runMemoryCorpus } from './memory-corpus.js';
import { memoryCampaignHost } from './memory-pg-host.js';

// Acceptance infrastructure is mandatory. Never turn an absent PG into a skip.
runMemoryCorpus(memoryCampaignHost);
