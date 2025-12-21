import { writable } from 'svelte/store';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type JobType = 'company_enrich' | 'usecase_list' | 'usecase_detail' | 'executive_summary' | 'chat_message';

export interface Job {
  id: string;
  type: JobType;
  data: any;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface QueueState {
  jobs: Job[];
  isLoading: boolean;
  lastUpdate: string | null;
}

const initialState: QueueState = {
  jobs: [],
  isLoading: false,
  lastUpdate: null
};

export const queueStore = writable<QueueState>(initialState);

import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '$lib/utils/api';

// Fonctions API pour la queue
export const fetchAllJobs = async (): Promise<Job[]> => {
  try {
    const data = await apiGet<Job[]>('/queue/jobs');
    return data || [];
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 429)) {
      // Return empty array if not authenticated or rate limited
      return [];
    }
    throw error;
  }
};

export const fetchJobStatus = async (jobId: string): Promise<Job | null> => {
  try {
    const data = await apiGet<Job>(`/queue/jobs/${jobId}`);
    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404 || error.status === 401 || error.status === 403 || error.status === 429) {
        return null;
      }
    }
    throw error;
  }
};

export const cancelJob = async (jobId: string): Promise<void> => {
  await apiPost(`/queue/jobs/${jobId}/cancel`);
};

export const retryJob = async (jobId: string): Promise<void> => {
  await apiPost(`/queue/jobs/${jobId}/retry`);
};

export const deleteJob = async (jobId: string): Promise<void> => {
  await apiDelete(`/queue/jobs/${jobId}`);
};

// Actions du store
export const loadJobs = async () => {
  queueStore.update(state => ({ ...state, isLoading: true }));
  try {
    const jobs = (await fetchAllJobs()).filter((j) => j?.type !== 'chat_message');
    queueStore.update(state => ({
      ...state,
      jobs,
      isLoading: false,
      lastUpdate: new Date().toISOString()
    }));
  } catch (error) {
    console.error('Failed to load jobs:', error);
    queueStore.update(state => ({ ...state, isLoading: false }));
  }
};

export const addJob = (job: Job) => {
  if (job?.type === 'chat_message') return;
  queueStore.update(state => ({
    ...state,
    jobs: [job, ...state.jobs]
  }));
};

export const updateJob = (jobId: string, updates: Partial<Job>) => {
  if ((updates as any)?.type === 'chat_message') return;
  queueStore.update(state => ({
    ...state,
    jobs: state.jobs.map(job => 
      job.id === jobId ? { ...job, ...updates } : job
    )
  }));
};

export const removeJob = (jobId: string) => {
  queueStore.update(state => ({
    ...state,
    jobs: state.jobs.filter(job => job.id !== jobId)
  }));
};

// Fonctions utilitaires
export const getActiveJobs = (jobs: Job[]): Job[] => {
  return jobs.filter(job => job.status === 'pending' || job.status === 'processing');
};

export const getJobsByType = (jobs: Job[], type: JobType): Job[] => {
  return jobs.filter(job => job.type === type);
};

export const getJobsByStatus = (jobs: Job[], status: JobStatus): Job[] => {
  return jobs.filter(job => job.status === status);
};

export const getJobProgress = (job: Job): number => {
  if (job.status === 'completed') return 100;
  if (job.status === 'failed') return 0;
  if (job.status === 'pending') return 0;
  if (job.status === 'processing') {
    // Estimation basée sur le temps écoulé
    const startTime = new Date(job.startedAt || job.createdAt).getTime();
    const now = Date.now();
    const elapsed = now - startTime;
    // Estimation: 30 secondes pour un job complet
    return Math.min(90, (elapsed / 30000) * 100);
  }
  return 0;
};

export const getJobDuration = (job: Job): string => {
  if (job.status === 'completed' && job.completedAt && job.startedAt) {
    const start = new Date(job.startedAt).getTime();
    const end = new Date(job.completedAt).getTime();
    const duration = Math.round((end - start) / 1000);
    return `${duration}s`;
  }
  if (job.status === 'processing' && job.startedAt) {
    const start = new Date(job.startedAt).getTime();
    const now = Date.now();
    const duration = Math.round((now - start) / 1000);
    return `${duration}s`;
  }
  return '-';
};
