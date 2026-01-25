import { Hono, type Context } from 'hono';
import { queueManager } from '../../services/queue-manager';
import { db } from '../../db/client';
import { sql } from 'drizzle-orm';
import { requireRole } from '../../middleware/rbac';
import { getWorkspaceRole } from '../../services/workspace-access';
import { ADMIN_WORKSPACE_ID } from '../../db/schema';

const queueRouter = new Hono();

async function resolveTargetWorkspaceId(c: Context): Promise<string> {
  const { role, workspaceId, userId } = c.get('user') as { role: string; workspaceId: string; userId: string };
  const requested = c.req.query('workspace_id');

  // Default: always own workspace
  if (!requested) return workspaceId;

  // Only admin_app can request another workspace
  if (role !== 'admin_app') return workspaceId;

  // Admin workspace always allowed
  if (requested === ADMIN_WORKSPACE_ID) return requested;

  const accessRole = await getWorkspaceRole(userId, requested);
  if (!accessRole) {
    throw new Error('Workspace not accessible');
  }
  return requested;
}

// GET /queue/jobs - Récupérer tous les jobs
queueRouter.get('/jobs', async (c) => {
  try {
    const targetWorkspaceId = await resolveTargetWorkspaceId(c);
    const jobs = await queueManager.getAllJobs({ workspaceId: targetWorkspaceId });
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
    const targetWorkspaceId = await resolveTargetWorkspaceId(c);
    const job = await queueManager.getJobStatus(jobId);
    
    if (!job) {
      return c.json({ message: 'Job not found' }, 404);
    }

    if (job.workspaceId && job.workspaceId !== targetWorkspaceId) {
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
    // Pour l'instant, on ne peut pas vraiment annuler un job en cours
    // On peut juste marquer qu'il a échoué
    // TODO: Implémenter une vraie annulation si nécessaire
    // const jobId = c.req.param('id');
    
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
    const targetWorkspaceId = await resolveTargetWorkspaceId(c);
    if (originalJob.workspaceId && originalJob.workspaceId !== targetWorkspaceId) {
      return c.json({ message: 'Job not found' }, 404);
    }
    const newJobId = await queueManager.addJob(originalJob.type, originalJob.data, { workspaceId: targetWorkspaceId });
    
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

// DELETE /queue/jobs/:id - Supprimer un job
queueRouter.delete('/jobs/:id', async (c) => {
  try {
    const targetWorkspaceId = await resolveTargetWorkspaceId(c);
    const id = c.req.param('id');
    const job = await queueManager.getJobStatus(id);
    if (!job) {
      return c.json({ message: 'Job not found' }, 404);
    }
    if (job.workspaceId && job.workspaceId !== targetWorkspaceId) {
      return c.json({ message: 'Job not found' }, 404);
    }
    // Supprimer le job de la base de données
    await db.run(sql`
      DELETE FROM job_queue WHERE id = ${id} AND workspace_id = ${targetWorkspaceId}
    `);
    return c.json({ success: true, message: 'Job deleted successfully' });
  } catch (error) {
    console.error('Error deleting job:', error);
    return c.json({ message: 'Failed to delete job' }, 500);
  }
});

// GET /queue/stats - Statistiques de la queue
queueRouter.get('/stats', async (c) => {
  try {
    const targetWorkspaceId = await resolveTargetWorkspaceId(c);
    const jobs = await queueManager.getAllJobs({ workspaceId: targetWorkspaceId });
    
    const stats = {
      total: jobs.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      byType: {
        organization_enrich: jobs.filter(j => j.type === 'organization_enrich').length,
        usecase_list: jobs.filter(j => j.type === 'usecase_list').length,
        usecase_detail: jobs.filter(j => j.type === 'usecase_detail').length,
        document_summary: jobs.filter(j => j.type === 'document_summary').length,
      }
    };
    
    return c.json(stats);
  } catch (error) {
    console.error('Error fetching queue stats:', error);
    return c.json({ message: 'Failed to fetch queue stats' }, 500);
  }
});

// POST /queue/purge - Purger les jobs
queueRouter.post('/purge', requireRole('admin_app'), async (c) => {
  let paused = false;
  try {
    const targetWorkspaceId = await resolveTargetWorkspaceId(c);
    const { status } = await c.req.json().catch(() => ({ status: 'pending' }));
    // Mettre en pause pour empêcher de nouveaux départs
    queueManager.pause();
    paused = true;
    // Avant toute purge, annuler les jobs en cours et drainer
    await queueManager.cancelAllProcessing('purge');
    
    const jobs = await queueManager.getAllJobs();
    let jobsToPurge = [];
    
    if (status === 'processing') {
      // Purger les jobs en cours depuis plus de 2h (probablement bloqués)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      jobsToPurge = jobs.filter(job => 
        job.status === 'processing' && 
        job.startedAt && 
        job.startedAt < twoHoursAgo
      );
    } else if (status === 'force' || status === 'all') {
      // Purge forcée: marquer en failed puis supprimer en une seule requête
      await db.run(sql`
        UPDATE job_queue
        SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error = 'Job cancelled by purge'
        WHERE status IN ('pending','processing') AND workspace_id = ${targetWorkspaceId}
      `);
      const del = await db.run(sql`DELETE FROM job_queue WHERE workspace_id = ${targetWorkspaceId}`);
      const purgedCount = (del as { changes?: number }).changes ?? 0;
      console.log(`🧹 Purged ALL jobs: ${purgedCount}`);
      queueManager.resume();
      paused = false;
      return c.json({ success: true, message: `${purgedCount} jobs purgés avec succès (toute la queue)`, purgedCount });
    } else {
      jobsToPurge = jobs.filter(job => job.status === status);
    }
    
    if (jobsToPurge.length === 0) {
      let message = '';
      if (status === 'all') {
        message = 'Aucun job à purger';
      } else if (status === 'processing') {
        message = 'Aucun job en cours bloqué depuis plus de 2h à purger';
      } else {
        message = `Aucun job avec le statut '${status}' à purger`;
      }
      return c.json({ 
        success: true, 
        message,
        purgedCount: 0
      });
    }
    
    for (const job of jobsToPurge) {
      await db.run(sql`
        DELETE FROM job_queue WHERE id = ${job.id} AND workspace_id = ${targetWorkspaceId}
      `);
    }
    
    let message = '';
    if (status === 'all') {
      message = `${jobsToPurge.length} jobs purgés avec succès (toute la queue)`;
    } else if (status === 'processing') {
      message = `${jobsToPurge.length} jobs en cours bloqués purgés avec succès`;
    } else {
      message = `${jobsToPurge.length} jobs avec le statut '${status}' purgés avec succès`;
    }
    
    console.log(`🧹 Purged ${jobsToPurge.length} jobs (status: ${status})`);
    
    return c.json({ 
      success: true, 
      message,
      purgedCount: jobsToPurge.length
    });
  } catch (error) {
    console.error('Error purging queue:', error);
    return c.json({ message: 'Failed to purge queue' }, 500);
  } finally {
    // Safety: never leave the queue paused after an admin action.
    if (paused) queueManager.resume();
  }
});

// POST /queue/purge-global - Purger les jobs (tous workspaces)
queueRouter.post('/purge-global', requireRole('admin_app'), async (c) => {
  let paused = false;
  try {
    const { status } = await c.req.json().catch(() => ({ status: 'all' as string }));

    queueManager.pause();
    paused = true;
    await queueManager.cancelAllProcessing('purge-global');

    if (status === 'force' || status === 'all') {
      await db.run(sql`
        UPDATE job_queue
        SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error = 'Job cancelled by purge-global'
        WHERE status IN ('pending','processing')
      `);
      const del = await db.run(sql`DELETE FROM job_queue`);
      const purgedCount = (del as { changes?: number }).changes ?? 0;
      console.log(`🧹 Purged GLOBAL ALL jobs: ${purgedCount}`);
      return c.json({
        success: true,
        message: `${purgedCount} jobs purgés avec succès (global, tous workspaces)`,
        purgedCount
      });
    }

    if (status === 'processing') {
      // Purger les jobs en cours depuis plus de 2h (probablement bloqués)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const del = await db.run(sql`
        DELETE FROM job_queue
        WHERE status = 'processing' AND started_at IS NOT NULL AND started_at < ${twoHoursAgo}
      `);
      const purgedCount = (del as { changes?: number }).changes ?? 0;
      console.log(`🧹 Purged GLOBAL stuck processing jobs: ${purgedCount}`);
      return c.json({
        success: true,
        message: `${purgedCount} jobs en cours bloqués purgés (global)`,
        purgedCount
      });
    }

    // Purge by exact status, globally
    const del = await db.run(sql`
      DELETE FROM job_queue
      WHERE status = ${status}
    `);
    const purgedCount = (del as { changes?: number }).changes ?? 0;
    console.log(`🧹 Purged GLOBAL jobs (status=${status}): ${purgedCount}`);
    return c.json({
      success: true,
      message: `${purgedCount} jobs purgés (global, statut: ${status})`,
      purgedCount
    });
  } catch (error) {
    console.error('Error purging queue globally:', error);
    return c.json({ message: 'Failed to purge queue globally' }, 500);
  } finally {
    if (paused) queueManager.resume();
  }
});

// POST /queue/purge-mine - Purger les jobs du workspace courant (utilisateur)
queueRouter.post('/purge-mine', async (c) => {
  try {
    const { workspaceId } = c.get('user') as { workspaceId: string };
    const { status } = await c.req.json().catch(() => ({ status: 'all' as string }));

    // Best-effort: cancel in-flight jobs for this workspace only.
    await queueManager.cancelProcessingForWorkspace(workspaceId, 'purge-mine');

    if (status === 'force' || status === 'all') {
      await db.run(sql`
        UPDATE job_queue
        SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error = 'Job cancelled by purge-mine'
        WHERE status IN ('pending','processing') AND workspace_id = ${workspaceId}
      `);
      const del = await db.run(sql`DELETE FROM job_queue WHERE workspace_id = ${workspaceId}`);
      const purgedCount = (del as { changes?: number }).changes ?? 0;
      return c.json({ success: true, message: `${purgedCount} jobs purgés (mes jobs)`, purgedCount });
    }

    // Purge by status for current workspace
    const del = await db.run(sql`
      DELETE FROM job_queue
      WHERE workspace_id = ${workspaceId} AND status = ${status}
    `);
    const purgedCount = (del as { changes?: number }).changes ?? 0;
    return c.json({ success: true, message: `${purgedCount} jobs purgés (statut: ${status})`, purgedCount });
  } catch (error) {
    console.error('Error purging my queue:', error);
    return c.json({ message: 'Failed to purge my queue' }, 500);
  }
});

// POST /queue/pause - Mettre en pause le traitement
queueRouter.post('/pause', requireRole('admin_app'), async (c) => {
  try {
    queueManager.pause();
    return c.json({ success: true });
  } catch (error) {
    console.error('Error pausing queue:', error);
    return c.json({ message: 'Failed to pause queue' }, 500);
  }
});

// POST /queue/resume - Reprendre le traitement
queueRouter.post('/resume', requireRole('admin_app'), async (c) => {
  try {
    queueManager.resume();
    return c.json({ success: true });
  } catch (error) {
    console.error('Error resuming queue:', error);
    return c.json({ message: 'Failed to resume queue' }, 500);
  }
});

// POST /queue/cancel-all - Annuler tous les jobs en cours
queueRouter.post('/cancel-all', requireRole('admin_app'), async (c) => {
  try {
    await queueManager.cancelAllProcessing('manual-cancel');
    return c.json({ success: true });
  } catch (error) {
    console.error('Error cancelling jobs:', error);
    return c.json({ message: 'Failed to cancel jobs' }, 500);
  }
});

export default queueRouter;
