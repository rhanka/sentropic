import { get } from 'svelte/store';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toasts, addToast, removeToast, clearToasts, type Toast } from '../../src/lib/stores/toast';

describe('toast store', () => {
  beforeEach(() => {
    // Clear toasts before each test
    clearToasts();
    vi.clearAllTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start with empty toasts array', () => {
    expect(get(toasts)).toEqual([]);
  });

  it('should add a toast with generated id', () => {
    const toastData = {
      type: 'success' as const,
      message: 'Test message'
    };
    
    const id = addToast(toastData);
    
    expect(id).toMatch(/^toast-\d+$/);
    expect(get(toasts)).toHaveLength(1);
    expect(get(toasts)[0]).toEqual({
      id,
      type: 'success',
      message: 'Test message',
      duration: 5000
    });
  });

  it('should add multiple toasts', () => {
    addToast({ type: 'info', message: 'First toast' });
    addToast({ type: 'error', message: 'Second toast' });
    
    expect(get(toasts)).toHaveLength(2);
    expect(get(toasts)[0].message).toBe('First toast');
    expect(get(toasts)[1].message).toBe('Second toast');
  });

  it('should use custom duration when provided', () => {
    const id = addToast({
      type: 'warning',
      message: 'Custom duration',
      duration: 10000
    });
    
    const toast = get(toasts)[0];
    expect(toast.duration).toBe(10000);
  });

  it('should not auto-remove when duration is 0', () => {
    addToast({
      type: 'info',
      message: 'Persistent toast',
      duration: 0
    });
    
    expect(get(toasts)).toHaveLength(1);
    
    // Fast-forward time
    vi.advanceTimersByTime(10000);
    
    expect(get(toasts)).toHaveLength(1);
  });

  it('should auto-remove toast after duration', () => {
    addToast({
      type: 'success',
      message: 'Auto-remove toast',
      duration: 5000
    });
    
    expect(get(toasts)).toHaveLength(1);
    
    // Fast-forward time
    vi.advanceTimersByTime(5000);
    
    expect(get(toasts)).toHaveLength(0);
  });

  it('should remove specific toast by id', () => {
    const id1 = addToast({ type: 'info', message: 'First toast' });
    const id2 = addToast({ type: 'error', message: 'Second toast' });
    
    expect(get(toasts)).toHaveLength(2);
    
    removeToast(id1);
    
    expect(get(toasts)).toHaveLength(1);
    expect(get(toasts)[0].id).toBe(id2);
  });

  it('should handle removing non-existent toast', () => {
    addToast({ type: 'info', message: 'Test toast' });
    
    expect(get(toasts)).toHaveLength(1);
    
    removeToast('non-existent-id');
    
    expect(get(toasts)).toHaveLength(1);
  });

  it('should clear all toasts', () => {
    addToast({ type: 'info', message: 'First toast' });
    addToast({ type: 'error', message: 'Second toast' });
    addToast({ type: 'success', message: 'Third toast' });
    
    expect(get(toasts)).toHaveLength(3);
    
    clearToasts();
    
    expect(get(toasts)).toHaveLength(0);
  });

  it('should generate unique ids for multiple toasts', () => {
    const id1 = addToast({ type: 'info', message: 'First toast' });
    const id2 = addToast({ type: 'error', message: 'Second toast' });
    const id3 = addToast({ type: 'success', message: 'Third toast' });
    
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it('should handle all toast types', () => {
    const types: Toast['type'][] = ['success', 'error', 'warning', 'info'];
    
    types.forEach(type => {
      addToast({ type, message: `${type} message` });
    });
    
    expect(get(toasts)).toHaveLength(4);
    types.forEach((type, index) => {
      expect(get(toasts)[index].type).toBe(type);
    });
  });
});
