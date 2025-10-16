import { writable } from 'svelte/store';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type JobType = 'company_enrich' | 'usecase_list' | 'usecase_detail';

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

import { apiGet, apiGetAuth, apiPost, apiPut, apiDelete } from '$lib/utils/api';

// Fonctions API pour la queue
export const fetchAllJobs = async (): Promise<Job[]> => {
  const result = await apiGetAuth<Job[]>('/queue/jobs');
  
  if (result.status === 'success') {
    return result.data;
  } else {
    // Return empty array if not authenticated or rate limited
    return [];
  }
};

export const fetchJobStatus = async (jobId: string): Promise<Job | null> => {
  try {
    const result = await apiGetAuth<Job>(`/queue/jobs/${jobId}`);
    
    if (result.status === 'success') {
      return result.data;
    } else {
      return null;
    }
  } catch (error: any) {
    if (error.message?.includes('404')) return null;
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
  await apiDelete(`/queue/jobs/${jobId}/delete`);
};

// Actions du store
export const loadJobs = async () => {
  queueStore.update(state => ({ ...state, isLoading: true }));
  try {
    const jobs = await fetchAllJobs();
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
  queueStore.update(state => ({
    ...state,
    jobs: [job, ...state.jobs]
  }));
};

export const updateJob = (jobId: string, updates: Partial<Job>) => {
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
