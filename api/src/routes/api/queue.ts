import { Hono } from 'hono';
import { z } from 'zod';
import { queueManager } from '../../services/queue-manager';

const queueRouter = new Hono();

// GET /queue/jobs - Récupérer tous les jobs
queueRouter.get('/jobs', async (c) => {
  try {
    const jobs = await queueManager.getAllJobs();
    return c.json(jobs);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return c.json({ message: 'Failed to fetch jobs' }, 500);
  }
});

// GET /queue/jobs/:id - Récupérer le statut d'un job
queueRouter.get('/jobs/:id', async (c) => {
  try {
    const jobId = c.req.param('id');
    const job = await queueManager.getJobStatus(jobId);
    
    if (!job) {
      return c.json({ message: 'Job not found' }, 404);
    }
    
    return c.json(job);
  } catch (error) {
    console.error('Error fetching job status:', error);
    return c.json({ message: 'Failed to fetch job status' }, 500);
  }
});

// POST /queue/jobs/:id/cancel - Annuler un job
queueRouter.post('/jobs/:id/cancel', async (c) => {
  try {
    const jobId = c.req.param('id');
    
    // Pour l'instant, on ne peut pas vraiment annuler un job en cours
    // On peut juste marquer qu'il a échoué
    // TODO: Implémenter une vraie annulation si nécessaire
    
    return c.json({ 
      success: true, 
      message: 'Job cancellation requested (not yet implemented)' 
    });
  } catch (error) {
    console.error('Error cancelling job:', error);
    return c.json({ message: 'Failed to cancel job' }, 500);
  }
});

// POST /queue/jobs/:id/retry - Relancer un job
queueRouter.post('/jobs/:id/retry', async (c) => {
  try {
    const jobId = c.req.param('id');
    
    // Récupérer le job original
    const originalJob = await queueManager.getJobStatus(jobId);
    if (!originalJob) {
      return c.json({ message: 'Job not found' }, 404);
    }
    
    if (originalJob.status !== 'failed') {
      return c.json({ message: 'Can only retry failed jobs' }, 400);
    }
    
    // Créer un nouveau job avec les mêmes données
    const newJobId = await queueManager.addJob(originalJob.type, originalJob.data);
    
    return c.json({ 
      success: true, 
      message: 'Job retried successfully',
      newJobId 
    });
  } catch (error) {
    console.error('Error retrying job:', error);
    return c.json({ message: 'Failed to retry job' }, 500);
  }
});

// GET /queue/stats - Statistiques de la queue
queueRouter.get('/stats', async (c) => {
  try {
    const jobs = await queueManager.getAllJobs();
    
    const stats = {
      total: jobs.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      byType: {
        company_enrich: jobs.filter(j => j.type === 'company_enrich').length,
        usecase_list: jobs.filter(j => j.type === 'usecase_list').length,
        usecase_detail: jobs.filter(j => j.type === 'usecase_detail').length,
      }
    };
    
    return c.json(stats);
  } catch (error) {
    console.error('Error fetching queue stats:', error);
    return c.json({ message: 'Failed to fetch queue stats' }, 500);
  }
});

export default queueRouter;
