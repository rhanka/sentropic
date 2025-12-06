import { db } from '../db/client';
import { jobQueue, type JobQueueRow } from '../db/schema';
import { sql } from 'drizzle-orm';

async function showQueueStatus() {
  try {
    console.log('📊 Queue Status:');
    
    // Get job counts by status
    const statusCounts = await db.select({
      status: jobQueue.status,
      count: sql<number>`COUNT(*)`.as('count')
    })
    .from(jobQueue)
    .groupBy(jobQueue.status);
    
    console.log('\n📈 Jobs by status:');
    statusCounts.forEach(({ status, count }) => {
      console.log(`  ${status}: ${count}`);
    });
    
    // Get recent jobs
    const recentJobs = await db.select()
      .from(jobQueue)
      .orderBy(sql`created_at DESC`)
      .limit(10);
    
    console.log('\n🕒 Recent jobs:');
    recentJobs.forEach((job: JobQueueRow) => {
      const createdAt = new Date(job.createdAt).toLocaleString();
      console.log(`  ${job.id}: ${job.type} (${job.status}) - ${createdAt}`);
    });
    
    // Get total count
    const totalJobs = await db.select({ count: sql<number>`COUNT(*)`.as('count') }).from(jobQueue);
    console.log(`\n📊 Total jobs: ${totalJobs[0].count}`);
    
  } catch (error) {
    console.error('❌ Error getting queue status:', error);
    process.exit(1);
  }
}

showQueueStatus();
