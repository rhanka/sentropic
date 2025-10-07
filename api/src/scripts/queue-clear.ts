import { db } from '../db/client';
import { jobQueue } from '../db/schema';
import { sql } from 'drizzle-orm';

async function clearQueue() {
  try {
    console.log('🧹 Clearing job queue...');
    
    // Clear all pending and processing jobs
    const result = await db.delete(jobQueue).where(
      sql`status IN ('pending', 'processing', 'enriching', 'generating')`
    );
    
    console.log(`✅ Cleared ${result.changes} jobs from queue`);
    
    // Show remaining jobs
    const remainingJobs = await db.select().from(jobQueue);
    console.log(`📊 Remaining jobs: ${remainingJobs.length}`);
    
    if (remainingJobs.length > 0) {
      console.log('Remaining jobs:');
      remainingJobs.forEach(job => {
        console.log(`  - ${job.id}: ${job.type} (${job.status})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error clearing queue:', error);
    process.exit(1);
  }
}

clearQueue();
