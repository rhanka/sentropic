<script lang="ts">
  import { onMount } from 'svelte';
  import { queueStore, loadJobs, getJobProgress, getJobDuration, cancelJob, retryJob, deleteJob } from '$lib/stores/queue';
  import type { JobStatus, JobType } from '$lib/stores/queue';
  import { addToast } from '$lib/stores/toast';
  import { isAuthenticated } from '$lib/stores/session';
  import StreamMessage from '$lib/components/StreamMessage.svelte';
  import { Clock, Loader2, CheckCircle2, XCircle, HelpCircle, Menu, X, RotateCcw, Trash2 } from '@lucide/svelte';
  import { _ } from 'svelte-i18n';

  // Détails par job (éviter N relectures d’historique au montage)
  let expandedJobId: string | null = null;

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

  const getStatusIcon = (status: JobStatus) => {
    switch (status) {
      case 'pending': return Clock;
      case 'processing': return Loader2;
      case 'completed': return CheckCircle2;
      case 'failed': return XCircle;
      default: return HelpCircle;
    }
  };

  const getTypeLabel = (type: JobType): string => {
    switch (type) {
      case 'organization_enrich': return $_('queueMonitor.type.organizationEnrich');
      case 'matrix_generate': return $_('queueMonitor.type.matrixGenerate');
      case 'usecase_list': return $_('queueMonitor.type.usecaseList');
      case 'usecase_detail': return $_('queueMonitor.type.usecaseDetail');
      case 'executive_summary': return $_('queueMonitor.type.executiveSummary');
      case 'document_summary': return $_('queueMonitor.type.documentSummary');
      case 'chat_message': return $_('queueMonitor.type.chatMessage');
      case 'docx_generate': return $_('queueMonitor.type.docxGenerate');
      default: return type;
    }
  };

  const getStatusLabel = (status: JobStatus): string => {
    switch (status) {
      case 'pending': return $_('queueMonitor.status.pending');
      case 'processing': return $_('queueMonitor.status.processing');
      case 'completed': return $_('queueMonitor.status.completed');
      case 'failed': return $_('queueMonitor.status.failed');
      default: return status;
    }
  };

  const getStreamIdForJob = (job: any): string => {
    // Pour organization_enrich: streamId déterministe basé sur l'organisation (organization_<id>)
    if (job?.type === 'organization_enrich' && job?.data?.organizationId) {
      return `organization_${job.data.organizationId}`;
    }
    // Pour usecase_list: streamId déterministe basé sur le dossier (folder_<folderId>)
    if (job?.type === 'usecase_list' && (job?.data?.folderId || job?.data?.folder_id)) {
      const folderId = job.data.folderId ?? job.data.folder_id;
      return `folder_${folderId}`;
    }
    // Pour matrix_generate: streamId déterministe basé sur le dossier (matrix_<folderId>)
    if (job?.type === 'matrix_generate' && (job?.data?.folderId || job?.data?.folder_id)) {
      const folderId = job.data.folderId ?? job.data.folder_id;
      return `matrix_${folderId}`;
    }
    // Pour usecase_detail: streamId déterministe basé sur le cas (usecase_<useCaseId>)
    if (job?.type === 'usecase_detail' && (job?.data?.useCaseId || job?.data?.use_case_id)) {
      const useCaseId = job.data.useCaseId ?? job.data.use_case_id;
      return `usecase_${useCaseId}`;
    }
    // Pour executive_summary: streamId déterministe basé sur le dossier (folder_<folderId>)
    if (job?.type === 'executive_summary' && (job?.data?.folderId || job?.data?.folder_id)) {
      const folderId = job.data.folderId ?? job.data.folder_id;
      return `folder_${folderId}`;
    }
    // Pour document_summary: streamId déterministe basé sur le document (document_<documentId>)
    if (job?.type === 'document_summary' && (job?.data?.documentId || job?.data?.document_id)) {
      const documentId = job.data.documentId ?? job.data.document_id;
      return `document_${documentId}`;
    }
    // Pour chat_message: le SSE chat est sur streamId == assistantMessageId
    if (job?.type === 'chat_message' && job?.data?.assistantMessageId) {
      return String(job.data.assistantMessageId);
    }
    // Fallback générique: streamId basé sur jobId
    return `job_${job?.id}`;
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await cancelJob(jobId);
      addToast({
        type: 'success',
        message: $_('queueMonitor.toast.cancelled')
      });
      await loadJobs();
    } catch (error) {
      console.error('Failed to cancel job:', error);
      addToast({
        type: 'error',
        message: $_('queueMonitor.errors.cancel')
      });
    }
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      await retryJob(jobId);
      addToast({
        type: 'success',
        message: $_('queueMonitor.toast.retried')
      });
      await loadJobs();
    } catch (error) {
      console.error('Failed to retry job:', error);
      addToast({
        type: 'error',
        message: $_('queueMonitor.errors.retry')
      });
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm($_('queueMonitor.confirmDelete'))) {
      return;
    }
    
    try {
      await deleteJob(jobId);
      addToast({
        type: 'success',
        message: $_('queueMonitor.toast.deleted')
      });
      await loadJobs();
    } catch (error) {
      console.error('Failed to delete job:', error);
      addToast({
        type: 'error',
        message: $_('queueMonitor.errors.delete')
      });
    }
  };
</script>

<!-- QueuePanel : contenu uniquement (header/bulle gérés par ChatWidget) -->
<div class="overflow-y-scroll h-full slim-scroll" style="scrollbar-gutter: stable;">
        {#if $queueStore.jobs.length === 0}
          <div class="p-4 text-center text-gray-500">
            <Menu class="w-12 h-12 mx-auto mb-2 text-gray-300" />
            <p>{$_('queueMonitor.empty')}</p>
          </div>
        {:else}
          {#each $queueStore.jobs as job (`${job.id}-${job.status}-${job.completedAt || ''}`)}
            {@const StatusIcon = getStatusIcon(job.status)}
            <div class="p-4 border-b border-gray-100 last:border-b-0">
              <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <StatusIcon class="w-5 h-5 {job.status === 'processing' ? 'animate-spin' : ''}" />
                    <span class="font-medium text-sm">{getTypeLabel(job.type)}</span>
                    <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium {getStatusColor(job.status)}">
                      {getStatusLabel(job.status)}
                    </span>
                  </div>

                  {#if job.status === 'processing'}
                    <div class="w-full bg-gray-200 rounded-full h-2 mb-2">
                      <div 
                        class="bg-primary h-2 rounded-full transition-all duration-300" 
                        style="width: {getJobProgress(job)}%"
                      ></div>
                    </div>
                    <p class="text-xs text-gray-500">{$_('queueMonitor.duration', { values: { duration: getJobDuration(job) } })}</p>
                  {/if}

            {#if job.status === 'pending' || job.status === 'processing' || expandedJobId === job.id}
              <StreamMessage
                streamId={getStreamIdForJob(job)}
                status={job.status}
                variant="job"
                historySource={expandedJobId === job.id ? 'stream' : 'none'}
                historyLimit={expandedJobId === job.id ? 200 : 0}
                maxHistory={6}
              />
            {/if}

                  {#if job.error}
                    <p class="text-xs text-red-600 mt-1 bg-red-50 p-2 rounded">
                      {$_('queueMonitor.errorPrefix', { values: { error: job.error } })}
                    </p>
                  {/if}
                </div>

                <div class="flex gap-1 ml-2">
                  {#if (job.status === 'completed' || job.status === 'failed') && expandedJobId !== job.id}
                    <button
                      class="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded"
                      on:click={() => (expandedJobId = job.id)}
                      title={$_('queueMonitor.actions.viewDetails')}
                    >
                      <Menu class="w-4 h-4" />
                    </button>
                  {:else if expandedJobId === job.id}
                    <button
                      class="p-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded"
                      on:click={() => (expandedJobId = null)}
                      title={$_('queueMonitor.actions.hideDetails')}
                    >
                      <X class="w-4 h-4" />
                    </button>
                  {/if}
                  {#if job.status === 'pending' || job.status === 'processing'}
                    <button
                      class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                      on:click={() => handleCancelJob(job.id)}
                      title={$_('queueMonitor.actions.cancel')}
                    >
                      <X class="w-4 h-4" />
                    </button>
                  {/if}
                  
                  {#if job.status === 'failed'}
                    <button
                      class="p-1 text-green-500 hover:text-green-700 hover:bg-green-50 rounded"
                      on:click={() => handleRetryJob(job.id)}
                      title={$_('queueMonitor.actions.retry')}
                    >
                      <RotateCcw class="w-4 h-4" />
                    </button>
                    <button
                      class="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                      on:click={() => handleDeleteJob(job.id)}
                      title={$_('queueMonitor.actions.delete')}
                    >
                      <Trash2 class="w-4 h-4" />
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
