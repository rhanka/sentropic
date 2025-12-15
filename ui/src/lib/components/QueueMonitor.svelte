<script lang="ts">
  import { onMount } from 'svelte';
  import { queueStore, loadJobs, getJobProgress, getJobDuration, cancelJob, retryJob, deleteJob } from '$lib/stores/queue';
  import type { JobStatus, JobType } from '$lib/stores/queue';
  import { addToast } from '$lib/stores/toast';
  import { isAuthenticated } from '$lib/stores/session';
  import StreamMessage from '$lib/components/StreamMessage.svelte';

  // Charger les jobs au montage et toutes les 5 secondes (seulement si authentifié)
  onMount(async () => {
    if ($isAuthenticated) {
      await loadJobs();
    }
  });

  // Réagir aux changements d'authentification
  $: if ($isAuthenticated) {
    loadJobs();
  }

  const getStatusColor = (status: JobStatus): string => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: JobStatus): string => {
    switch (status) {
      case 'pending': return '⏳';
      case 'processing': return '🔄';
      case 'completed': return '✅';
      case 'failed': return '❌';
      default: return '❓';
    }
  };

  const getTypeLabel = (type: JobType): string => {
    switch (type) {
      case 'company_enrich': return 'Enrichissement entreprise';
      case 'usecase_list': return 'Génération cas d\'usage';
      case 'usecase_detail': return 'Détail cas d\'usage';
      default: return type;
    }
  };

  const getStreamIdForJob = (job: any): string => {
    // Pour company_enrich: streamId déterministe basé sur l'entreprise (company_<companyId>)
    if (job?.type === 'company_enrich' && job?.data?.companyId) {
      return `company_${job.data.companyId}`;
    }
    // Fallback générique: streamId basé sur jobId
    return `job_${job?.id}`;
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await cancelJob(jobId);
      addToast({
        type: 'success',
        message: 'Job annulé avec succès'
      });
      await loadJobs();
    } catch (error) {
      console.error('Failed to cancel job:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de l\'annulation du job'
      });
    }
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      await retryJob(jobId);
      addToast({
        type: 'success',
        message: 'Job relancé avec succès'
      });
      await loadJobs();
    } catch (error) {
      console.error('Failed to retry job:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors du relancement du job'
      });
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce job ? Cette action est irréversible.')) {
      return;
    }
    
    try {
      await deleteJob(jobId);
      addToast({
        type: 'success',
        message: 'Job supprimé avec succès'
      });
      await loadJobs();
    } catch (error) {
      console.error('Failed to delete job:', error);
      addToast({
        type: 'error',
        message: 'Erreur lors de la suppression du job'
      });
    }
  };
</script>

<!-- QueuePanel : contenu uniquement (header/bulle gérés par ChatWidget) -->
<div class="overflow-y-scroll h-full" style="scrollbar-gutter: stable;">
        {#if $queueStore.jobs.length === 0}
          <div class="p-4 text-center text-gray-500">
            <svg class="w-12 h-12 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
            </svg>
            <p>Aucun job en cours</p>
          </div>
        {:else}
          {#each $queueStore.jobs as job (job.id)}
            <div class="p-4 border-b border-gray-100 last:border-b-0">
              <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-lg">{getStatusIcon(job.status)}</span>
                    <span class="font-medium text-sm">{getTypeLabel(job.type)}</span>
                    <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium {getStatusColor(job.status)}">
                      {job.status}
                    </span>
                  </div>

                  {#if job.status === 'processing'}
                    <div class="w-full bg-gray-200 rounded-full h-2 mb-2">
                      <div 
                        class="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                        style="width: {getJobProgress(job)}%"
                      ></div>
                    </div>
                    <p class="text-xs text-gray-500">Durée: {getJobDuration(job)}</p>
                  {/if}

            <StreamMessage
              streamId={getStreamIdForJob(job)}
              status={job.status}
              variant="job"
              historySource="stream"
              historyLimit={2000}
            />

                  {#if job.error}
                    <p class="text-xs text-red-600 mt-1 bg-red-50 p-2 rounded">
                      Erreur: {job.error}
                    </p>
                  {/if}
                </div>

                <div class="flex gap-1 ml-2">
                  {#if job.status === 'pending' || job.status === 'processing'}
                    <button
                      class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                      on:click={() => handleCancelJob(job.id)}
                      title="Annuler le job"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                      </svg>
                    </button>
                  {/if}
                  
                  {#if job.status === 'failed'}
                    <button
                      class="p-1 text-green-500 hover:text-green-700 hover:bg-green-50 rounded"
                      on:click={() => handleRetryJob(job.id)}
                      title="Relancer le job"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                      </svg>
                    </button>
                    <button
                      class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                      on:click={() => handleDeleteJob(job.id)}
                      title="Supprimer le job"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                      </svg>
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
