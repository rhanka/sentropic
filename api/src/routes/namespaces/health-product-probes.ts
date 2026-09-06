import type { HealthProbePort } from '@sentropic/cluster-mesh';

import { db } from '../../db/client';
import { jobQueue, settings } from '../../db/schema';

export const productDatabaseHealthProbe: HealthProbePort = {
  name: 'database',
  async check() {
    await Promise.all([
      db.select().from(settings).limit(1),
      db.select().from(jobQueue).limit(1),
    ]);
    return {
      status: 'ok',
      services: {
        database: 'ok',
        tables: { settings: 'accessible', jobQueue: 'accessible' },
      },
    };
  },
};
