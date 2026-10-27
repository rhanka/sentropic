import { runMemoryCorpus } from './memory-corpus.js';
import { memoryCampaignHost } from './memory-pg-host.js';
import { runMemoryU64Corpus } from './memory-u64.js';

// Acceptance infrastructure is mandatory. Never turn an absent PG into a skip.
runMemoryCorpus(memoryCampaignHost);
runMemoryU64Corpus(memoryCampaignHost);
