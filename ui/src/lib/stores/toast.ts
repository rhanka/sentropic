import { writable } from 'svelte/store';

export type Toast = {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
  actionLabel?: string;
  actionIcon?: 'download';
  onAction?: (() => void | Promise<void>) | null;
};

export const toasts = writable<Toast[]>([]);

let toastId = 0;

export const addToast = (toast: Omit<Toast, 'id'>) => {
  const id = `toast-${++toastId}`;
  const newToast: Toast = {
    id,
    duration: 5000,
    ...toast
  };
  
  toasts.update(toasts => [...toasts, newToast]);
  
  // Auto-remove after duration
  if (newToast.duration && newToast.duration > 0) {
    setTimeout(() => {
      removeToast(id);
    }, newToast.duration);
  }
  
  return id;
};

export const removeToast = (id: string) => {
  toasts.update(toasts => toasts.filter(toast => toast.id !== id));
};

export const clearToasts = () => {
  toasts.set([]);
};

