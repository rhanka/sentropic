import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamHub } from '../../src/lib/stores/streamHub';
import { isAuthenticated } from '../../src/lib/stores/session';
import { get } from 'svelte/store';

// Mock EventSource
class MockEventSource {
  url: string;
  withCredentials: boolean;
  listeners: Map<string, Array<(event: MessageEvent) => void>> = new Map();
  readyState: number = 1; // CONNECTING = 0, OPEN = 1, CLOSED = 2
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string, options?: { withCredentials: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  close() {
    this.readyState = 2; // CLOSED
  }

  // Helper pour simuler un événement
  simulateEvent(type: string, data: any) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      const event = new MessageEvent(type, { data: JSON.stringify(data) });
      listeners.forEach(listener => listener(event));
    }
  }
}

// Mock global EventSource
global.EventSource = MockEventSource as any;

// Mock session stores (used indirectly by adminWorkspaceScope)
vi.mock('../../src/lib/stores/session', () => ({
  session: {
    subscribe: vi.fn((fn: (value: any) => void) => {
      fn({
        user: { id: 'test-admin', email: null, displayName: null, role: 'admin_app' },
        loading: false,
      });
      return () => {};
    }),
  },
  isAuthenticated: {
    subscribe: vi.fn((fn: (value: boolean) => void) => {
      fn(true);
      return () => {};
    }),
  },
}));

describe('streamHub', () => {
  let mockEventSource: MockEventSource | null = null;
  
  beforeEach(() => {
    // Reset streamHub state by deleting all subscriptions
    // Note: streamHub doesn't have a reset method, so we'll work around it
    vi.useFakeTimers();
    
    // Mock EventSource constructor to capture instance
    global.EventSource = vi.fn((url: string, options?: any) => {
      mockEventSource = new MockEventSource(url, options);
      return mockEventSource;
    }) as any;
  });

  afterEach(() => {
    // Clean up subscriptions
    streamHub.delete('test-key-1');
    streamHub.delete('test-key-2');
    streamHub.delete('test-key-3');
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  it('should create EventSource connection when subscribed', async () => {
    const callback = vi.fn();
    streamHub.set('test-key-1', callback);
    
    // Wait for reconnect delay (150ms)
    await vi.advanceTimersByTimeAsync(200);
    
    expect(global.EventSource).toHaveBeenCalled();
    expect(mockEventSource).not.toBeNull();
  });

  it('should replay cached events to new subscribers', async () => {
    const callback1 = vi.fn();
    streamHub.set('test-key-1', callback1);
    await vi.advanceTimersByTimeAsync(200);
    
    // Simulate an event
    if (mockEventSource) {
      mockEventSource.simulateEvent('job_update', {
        jobId: 'job-1',
        data: { status: 'running' }
      });
    }
    
    await vi.advanceTimersByTimeAsync(10);
    
    // New subscriber should receive cached event
    const callback2 = vi.fn();
    streamHub.set('test-key-2', callback2);
    await vi.advanceTimersByTimeAsync(10);
    
    expect(callback2).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'job_update',
        jobId: 'job-1'
      })
    );
  });

  it('should aggregate reasoning_delta events in history', async () => {
    const callback1 = vi.fn();
    streamHub.set('test-key-1', callback1);
    await vi.advanceTimersByTimeAsync(200);
    callback1.mockClear();
    
    if (mockEventSource) {
      // First delta
      mockEventSource.simulateEvent('reasoning_delta', {
        streamId: 'stream-1',
        sequence: 1,
        data: { delta: 'Hello ' }
      });
      
      // Second delta (should be aggregated in history)
      mockEventSource.simulateEvent('reasoning_delta', {
        streamId: 'stream-1',
        sequence: 2,
        data: { delta: 'World' }
      });
    }
    
    await vi.advanceTimersByTimeAsync(10);
    
    // Active subscribers receive events individually
    expect(callback1).toHaveBeenCalledTimes(2);
    
    // New subscriber should receive aggregated delta from history
    const callback2 = vi.fn();
    streamHub.setStream('test-key-2', 'stream-1', callback2);
    await vi.advanceTimersByTimeAsync(10);
    
    // Should have received the aggregated event
    const aggregatedCalls = callback2.mock.calls.filter(call => 
      call[0].type === 'reasoning_delta' && call[0].streamId === 'stream-1'
    );
    expect(aggregatedCalls.length).toBeGreaterThan(0);
    // The last aggregated event should contain the merged delta
    const lastAggregated = aggregatedCalls[aggregatedCalls.length - 1][0];
    expect(lastAggregated.data.delta).toBe('Hello World');
  });

  it('should aggregate content_delta events in history', async () => {
    const callback1 = vi.fn();
    streamHub.set('test-key-1', callback1);
    await vi.advanceTimersByTimeAsync(200);
    callback1.mockClear();
    
    if (mockEventSource) {
      mockEventSource.simulateEvent('content_delta', {
        streamId: 'stream-1',
        sequence: 1,
        data: { delta: 'Content ' }
      });
      
      mockEventSource.simulateEvent('content_delta', {
        streamId: 'stream-1',
        sequence: 2,
        data: { delta: 'Part 2' }
      });
    }
    
    await vi.advanceTimersByTimeAsync(10);
    
    // Active subscribers receive events individually
    expect(callback1).toHaveBeenCalledTimes(2);
    
    // New subscriber should receive aggregated delta from history
    const callback2 = vi.fn();
    streamHub.setStream('test-key-2', 'stream-1', callback2);
    await vi.advanceTimersByTimeAsync(10);
    
    const aggregatedCalls = callback2.mock.calls.filter(call => 
      call[0].type === 'content_delta' && call[0].streamId === 'stream-1'
    );
    expect(aggregatedCalls.length).toBeGreaterThan(0);
    const lastAggregated = aggregatedCalls[aggregatedCalls.length - 1][0];
    expect(lastAggregated.data.delta).toBe('Content Part 2');
  });

  it('should filter events by streamId when using setStream', async () => {
    const callback1 = vi.fn();
    streamHub.set('test-key-1', callback1);
    await vi.advanceTimersByTimeAsync(200);
    callback1.mockClear();
    
    const callback2 = vi.fn();
    streamHub.setStream('test-key-2', 'stream-1', callback2);
    await vi.advanceTimersByTimeAsync(200);
    
    if (mockEventSource) {
      // Event for stream-1
      mockEventSource.simulateEvent('content_delta', {
        streamId: 'stream-1',
        sequence: 1,
        data: { delta: 'Stream 1 content' }
      });
      
      // Event for stream-2
      mockEventSource.simulateEvent('content_delta', {
        streamId: 'stream-2',
        sequence: 1,
        data: { delta: 'Stream 2 content' }
      });
    }
    
    await vi.advanceTimersByTimeAsync(10);
    
    // callback1 should receive both events (after clearing)
    expect(callback1).toHaveBeenCalledTimes(2);
    
    // callback2 should only receive stream-1 event (after replay)
    const stream1Calls = callback2.mock.calls.filter(call => call[0].streamId === 'stream-1');
    expect(stream1Calls.length).toBeGreaterThan(0);
    expect(callback2).toHaveBeenCalledWith(
      expect.objectContaining({
        streamId: 'stream-1'
      })
    );
  });

  it('should filter events by type when using setJobUpdates', async () => {
    const callback1 = vi.fn();
    streamHub.set('test-key-1', callback1);
    await vi.advanceTimersByTimeAsync(200);
    callback1.mockClear();
    
    const callback2 = vi.fn();
    streamHub.setJobUpdates('test-key-2', callback2);
    await vi.advanceTimersByTimeAsync(200);
    callback2.mockClear();
    
    if (mockEventSource) {
      // job_update event
      mockEventSource.simulateEvent('job_update', {
        jobId: 'job-1',
        data: { status: 'running' }
      });
      
      // organization_update event
      mockEventSource.simulateEvent('organization_update', {
        organizationId: 'organization-1',
        data: { name: 'Test' }
      });
    }
    
    await vi.advanceTimersByTimeAsync(10);
    
    // callback1 should receive both events
    expect(callback1).toHaveBeenCalledTimes(2);
    
    // callback2 should only receive job_update
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'job_update'
      })
    );
  });

  it('should close EventSource when all subscriptions are removed', async () => {
    const callback = vi.fn();
    streamHub.set('test-key-1', callback);
    await vi.advanceTimersByTimeAsync(200);
    
    expect(mockEventSource).not.toBeNull();
    
    streamHub.delete('test-key-1');
    await vi.advanceTimersByTimeAsync(200);
    
    expect(mockEventSource?.readyState).toBe(2); // CLOSED
  });

  it('should handle usecase_update events', async () => {
    const callback = vi.fn();
    streamHub.set('test-key-1', callback);
    await vi.advanceTimersByTimeAsync(200);
    
    if (mockEventSource) {
      mockEventSource.simulateEvent('usecase_update', {
        useCaseId: 'usecase-1',
        data: { name: 'Test Use Case' }
      });
    }
    
    await vi.advanceTimersByTimeAsync(10);
    
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'usecase_update',
        useCaseId: 'usecase-1'
      })
    );
  });

  it('should handle folder_update events', async () => {
    const callback = vi.fn();
    streamHub.set('test-key-1', callback);
    await vi.advanceTimersByTimeAsync(200);
    
    if (mockEventSource) {
      mockEventSource.simulateEvent('folder_update', {
        folderId: 'folder-1',
        data: { name: 'Test Folder' }
      });
    }
    
    await vi.advanceTimersByTimeAsync(10);
    
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'folder_update',
        folderId: 'folder-1'
      })
    );
  });

  it('should handle tool_call events', async () => {
    const callback = vi.fn();
    streamHub.set('test-key-1', callback);
    await vi.advanceTimersByTimeAsync(200);
    
    // Clear initial replay calls
    callback.mockClear();
    
    if (mockEventSource) {
      mockEventSource.simulateEvent('tool_call_start', {
        streamId: 'stream-1',
        sequence: 1,
        data: { tool_name: 'read_usecase' }
      });
      
      mockEventSource.simulateEvent('tool_call_result', {
        streamId: 'stream-1',
        sequence: 2,
        data: { result: 'success' }
      });
    }
    
    await vi.advanceTimersByTimeAsync(10);
    
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        type: 'tool_call_start',
        streamId: 'stream-1'
      })
    );
    expect(callback).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        type: 'tool_call_result',
        streamId: 'stream-1'
      })
    );
  });

  it('should replay stream history to new stream subscribers', async () => {
    const callback1 = vi.fn();
    streamHub.set('test-key-1', callback1);
    await vi.advanceTimersByTimeAsync(200);
    
    if (mockEventSource) {
      mockEventSource.simulateEvent('content_delta', {
        streamId: 'stream-1',
        sequence: 1,
        data: { delta: 'Hello' }
      });
    }
    
    await vi.advanceTimersByTimeAsync(10);
    
    // New stream subscriber should receive cached events
    const callback2 = vi.fn();
    streamHub.setStream('test-key-2', 'stream-1', callback2);
    await vi.advanceTimersByTimeAsync(10);
    
    expect(callback2).toHaveBeenCalledWith(
      expect.objectContaining({
        streamId: 'stream-1',
        type: 'content_delta'
      })
    );
  });
});

