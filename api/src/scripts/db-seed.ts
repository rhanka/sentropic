import { db } from '../db/client';
import { companies } from '../db/schema';
import { createId } from '../utils/id';

await db.insert(companies).values({
  id: createId(),
  name: 'Demo Company',
  industry: 'Technology',
  size: '500+',
  products: 'AI Solutions',
  processes: 'R&D, Marketing',
  challenges: 'Scaling AI use cases',
  objectives: 'Identify ROI positive AI initiatives',
  technologies: 'Cloud, AI platforms'
});
