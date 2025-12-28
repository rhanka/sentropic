import { db } from '../db/client';
import { organizations } from '../db/schema';
import { createId } from '../utils/id';

await db.insert(organizations).values({
  id: createId(),
  name: 'Demo Organization',
  status: 'completed',
  data: {
    industry: 'Technology',
    size: '500+',
    products: 'AI Solutions',
    processes: 'R&D, Marketing',
    challenges: 'Scaling AI use cases',
    objectives: 'Identify ROI positive AI initiatives',
    technologies: 'Cloud, AI platforms',
    kpis: '',
    references: [],
  }
});
