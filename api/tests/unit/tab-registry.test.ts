import { describe, it, expect, beforeEach } from 'vitest';
import {
  register,
  unregister,
  getTab,
  listTabs,
  resolveTarget,
  touchTab,
  evictStaleTabs,
  clearAll,
} from '../../src/services/tab-registry';

describe('TabRegistry', () => {
  beforeEach(() => {
    clearAll();
  });

  describe('register', () => {
    it('should register a tab with a given tab_id', () => {
      const entry = register({
        tab_id: 'chrome_tab_1',
        source: 'chrome_plugin',
        url: 'https://example.com',
        title: 'Example',
        userId: 'user-1',
      });

      expect(entry.tab_id).toBe('chrome_tab_1');
      expect(entry.source).toBe('chrome_plugin');
      expect(entry.url).toBe('https://example.com');
      expect(entry.title).toBe('Example');
      expect(entry.userId).toBe('user-1');
      expect(entry.status).toBe('active');
      expect(entry.connected_at).toBeInstanceOf(Date);
      expect(entry.last_seen).toBeInstanceOf(Date);
    });

    it('should auto-assign a bookmarklet tab_id when tab_id is empty', () => {
      const entry = register({
        tab_id: '',
        source: 'bookmarklet',
        url: 'https://example.com',
        title: 'Page',
        userId: 'user-1',
      });

      expect(entry.tab_id).toMatch(/^bookmarklet_/);
    });

    it('should auto-assign a bookmarklet tab_id when tab_id is undefined', () => {
      const entry = register({
        source: 'bookmarklet',
        url: 'https://example.com',
        title: 'Page',
        userId: 'user-1',
      });

      expect(entry.tab_id).toMatch(/^bookmarklet_/);
    });

    it('should overwrite an existing tab with the same tab_id', () => {
      register({
        tab_id: 'tab-x',
        source: 'chrome_plugin',
        url: 'https://old.com',
        title: 'Old',
        userId: 'user-1',
      });

      const updated = register({
        tab_id: 'tab-x',
        source: 'bookmarklet',
        url: 'https://new.com',
        title: 'New',
        userId: 'user-1',
      });

      expect(updated.url).toBe('https://new.com');
      expect(getTab('tab-x')?.url).toBe('https://new.com');
    });
  });

  describe('unregister', () => {
    it('should remove an existing tab and return true', () => {
      register({
        tab_id: 'tab-1',
        source: 'chrome_plugin',
        url: 'https://example.com',
        title: 'Example',
        userId: 'user-1',
      });

      expect(unregister('tab-1')).toBe(true);
      expect(getTab('tab-1')).toBeUndefined();
    });

    it('should return false for a non-existing tab', () => {
      expect(unregister('nonexistent')).toBe(false);
    });
  });

  describe('getTab', () => {
    it('should return a registered tab', () => {
      register({
        tab_id: 'tab-1',
        source: 'bookmarklet',
        url: 'https://example.com',
        title: 'Example',
        userId: 'user-1',
      });

      const tab = getTab('tab-1');
      expect(tab).toBeDefined();
      expect(tab?.tab_id).toBe('tab-1');
    });

    it('should return undefined for unknown tab_id', () => {
      expect(getTab('unknown')).toBeUndefined();
    });
  });

  describe('listTabs', () => {
    it('should return only tabs for the given userId', () => {
      register({ tab_id: 'a', source: 'chrome_plugin', url: '', title: '', userId: 'user-1' });
      register({ tab_id: 'b', source: 'bookmarklet', url: '', title: '', userId: 'user-2' });
      register({ tab_id: 'c', source: 'chrome_plugin', url: '', title: '', userId: 'user-1' });

      const tabs = listTabs('user-1');
      expect(tabs).toHaveLength(2);
      expect(tabs.map((t) => t.tab_id).sort()).toEqual(['a', 'c']);
    });

    it('should return empty array when no tabs exist for the user', () => {
      expect(listTabs('nobody')).toEqual([]);
    });
  });

  describe('resolveTarget', () => {
    it('should return the most recently active tab for a user', () => {
      const first = register({ tab_id: 'old', source: 'chrome_plugin', url: '', title: '', userId: 'u1' });
      // Manually set last_seen to the past
      first.last_seen = new Date(Date.now() - 10_000);

      register({ tab_id: 'new', source: 'bookmarklet', url: '', title: '', userId: 'u1' });

      const target = resolveTarget('u1');
      expect(target?.tab_id).toBe('new');
    });

    it('should skip disconnected tabs', () => {
      const tab = register({ tab_id: 'disc', source: 'chrome_plugin', url: '', title: '', userId: 'u1' });
      tab.status = 'disconnected';

      register({ tab_id: 'active', source: 'bookmarklet', url: '', title: '', userId: 'u1' });

      const target = resolveTarget('u1');
      expect(target?.tab_id).toBe('active');
    });

    it('should return undefined when no active tabs', () => {
      expect(resolveTarget('no-one')).toBeUndefined();
    });
  });

  describe('touchTab', () => {
    it('should update last_seen and return true', () => {
      const entry = register({ tab_id: 'tab-1', source: 'chrome_plugin', url: '', title: '', userId: 'u1' });
      const originalLastSeen = entry.last_seen.getTime();

      // Small delay to ensure different timestamp
      const result = touchTab('tab-1');
      expect(result).toBe(true);
      expect(getTab('tab-1')!.last_seen.getTime()).toBeGreaterThanOrEqual(originalLastSeen);
    });

    it('should return false for unknown tab', () => {
      expect(touchTab('nonexistent')).toBe(false);
    });

    it('should re-activate a disconnected tab', () => {
      const entry = register({ tab_id: 'tab-1', source: 'chrome_plugin', url: '', title: '', userId: 'u1' });
      entry.status = 'disconnected';

      touchTab('tab-1');
      expect(getTab('tab-1')!.status).toBe('active');
    });
  });

  describe('evictStaleTabs', () => {
    it('should evict tabs older than maxAgeMs', () => {
      const old = register({ tab_id: 'old', source: 'chrome_plugin', url: '', title: '', userId: 'u1' });
      old.last_seen = new Date(Date.now() - 60_000);

      register({ tab_id: 'fresh', source: 'bookmarklet', url: '', title: '', userId: 'u1' });

      const evicted = evictStaleTabs(45_000);
      expect(evicted).toHaveLength(1);
      expect(evicted[0].tab_id).toBe('old');

      expect(getTab('old')).toBeUndefined();
      expect(getTab('fresh')).toBeDefined();
    });

    it('should return empty array when no stale tabs', () => {
      register({ tab_id: 'ok', source: 'chrome_plugin', url: '', title: '', userId: 'u1' });
      const evicted = evictStaleTabs(45_000);
      expect(evicted).toHaveLength(0);
    });
  });
});
