import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  openGoogleDrivePickerWith,
  resetGoogleDrivePickerApiForTests,
} from '../../src/lib/utils/google-drive-picker';

describe('google drive picker utils', () => {
  beforeEach(() => {
    resetGoogleDrivePickerApiForTests();
  });

  it('returns selected file ids from the picker callback', async () => {
    const setMimeTypes = vi.fn();
    const setIncludeFolders = vi.fn();
    const setSelectFolderEnabled = vi.fn();
    const setMode = vi.fn();
    const docsView = {
      setMimeTypes,
      setIncludeFolders,
      setSelectFolderEnabled,
      setMode,
    };

    let callback: ((data: { action: string; docs?: Array<{ id?: string }> }) => void) | null = null;
    const builder = {
      setDeveloperKey: vi.fn().mockReturnThis(),
      setAppId: vi.fn().mockReturnThis(),
      setOAuthToken: vi.fn().mockReturnThis(),
      setLocale: vi.fn().mockReturnThis(),
      setOrigin: vi.fn().mockReturnThis(),
      setRelayUrl: vi.fn().mockReturnThis(),
      addView: vi.fn().mockReturnThis(),
      enableFeature: vi.fn().mockReturnThis(),
      setCallback: vi.fn().mockImplementation((next) => {
        callback = next;
        return builder;
      }),
      build: vi.fn().mockReturnValue({
        setVisible: vi.fn().mockImplementation(() => {
          callback?.({
            action: 'picked',
            docs: [{ id: 'file_1' }, { id: 'file_2' }, { id: '' }],
          });
        }),
      }),
    };

    const result = await openGoogleDrivePickerWith(
      {
        clientId: 'client-id-1',
        developerKey: 'picker-key-1',
        appId: '924600787940',
        oauthToken: 'oauth-token-1',
        locale: 'en',
      },
      {
        ensureApiLoaded: vi.fn().mockResolvedValue(undefined),
        googlePicker: {
          DocsView: vi.fn().mockImplementation(() => docsView),
          DocsViewMode: { LIST: 'LIST' },
          Feature: {
            MULTISELECT_ENABLED: 'MULTISELECT_ENABLED',
            SUPPORT_DRIVES: 'SUPPORT_DRIVES',
          },
          Action: {
            PICKED: 'picked',
            CANCEL: 'cancel',
          },
          ViewId: {
            DOCS: 'DOCS',
          },
          PickerBuilder: vi.fn().mockImplementation(() => builder),
        },
      },
    );

    expect(result).toEqual(['file_1', 'file_2']);
    expect(setMimeTypes).toHaveBeenCalledOnce();
    expect(setIncludeFolders).toHaveBeenCalledWith(false);
    expect(setSelectFolderEnabled).toHaveBeenCalledWith(false);
    expect(setMode).toHaveBeenCalledWith('LIST');
    expect(builder.setDeveloperKey).toHaveBeenCalledWith('picker-key-1');
    expect(builder.setAppId).toHaveBeenCalledWith('924600787940');
    expect(builder.setOAuthToken).toHaveBeenCalledWith('oauth-token-1');
    expect(builder.setLocale).toHaveBeenCalledWith('en');
    expect(builder.setOrigin).toHaveBeenCalledWith(window.location.origin);
    expect(builder.setRelayUrl).toHaveBeenCalledWith(`${window.location.origin}/`);
    expect(builder.enableFeature).toHaveBeenCalledWith('MULTISELECT_ENABLED');
    expect(builder.enableFeature).toHaveBeenCalledWith('SUPPORT_DRIVES');
  });

  it('returns an empty selection when the picker is cancelled', async () => {
    let callback: ((data: { action: string }) => void) | null = null;
    const builder = {
      setDeveloperKey: vi.fn().mockReturnThis(),
      setAppId: vi.fn().mockReturnThis(),
      setOAuthToken: vi.fn().mockReturnThis(),
      setLocale: vi.fn().mockReturnThis(),
      setOrigin: vi.fn().mockReturnThis(),
      setRelayUrl: vi.fn().mockReturnThis(),
      addView: vi.fn().mockReturnThis(),
      enableFeature: vi.fn().mockReturnThis(),
      setCallback: vi.fn().mockImplementation((next) => {
        callback = next;
        return builder;
      }),
      build: vi.fn().mockReturnValue({
        setVisible: vi.fn().mockImplementation(() => {
          callback?.({ action: 'cancel' });
        }),
      }),
    };

    const result = await openGoogleDrivePickerWith(
      {
        clientId: 'client-id-1',
        developerKey: 'picker-key-1',
        appId: null,
        oauthToken: 'oauth-token-1',
      },
      {
        ensureApiLoaded: vi.fn().mockResolvedValue(undefined),
        googlePicker: {
          DocsView: vi.fn().mockImplementation(() => ({
            setMimeTypes: vi.fn(),
            setIncludeFolders: vi.fn(),
            setSelectFolderEnabled: vi.fn(),
            setMode: vi.fn(),
          })),
          DocsViewMode: { LIST: 'LIST' },
          Feature: {
            MULTISELECT_ENABLED: 'MULTISELECT_ENABLED',
            SUPPORT_DRIVES: 'SUPPORT_DRIVES',
          },
          Action: {
            PICKED: 'picked',
            CANCEL: 'cancel',
          },
          ViewId: {
            DOCS: 'DOCS',
          },
          PickerBuilder: vi.fn().mockImplementation(() => builder),
        },
      },
    );

    expect(result).toEqual([]);
    expect(builder.setAppId).not.toHaveBeenCalled();
    expect(builder.setOrigin).toHaveBeenCalledWith(window.location.origin);
    expect(builder.setRelayUrl).toHaveBeenCalledWith(`${window.location.origin}/`);
  });
});
