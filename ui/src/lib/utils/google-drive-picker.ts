const GOOGLE_PICKER_SCRIPT_SRC = 'https://apis.google.com/js/api.js';

const GOOGLE_DRIVE_PICKER_SUPPORTED_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/json',
  'application/xml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/xml',
].join(',');

type PickerCallbackData = {
  action: string;
  docs?: Array<{ id?: string | null }>;
};

type GooglePickerDocsView = {
  setMimeTypes: (mimeTypes: string) => void;
  setIncludeFolders: (includeFolders: boolean) => void;
  setSelectFolderEnabled: (enabled: boolean) => void;
  setMode: (mode: string) => void;
};

type GooglePickerBuilder = {
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (appId: string) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setLocale: (locale: string) => GooglePickerBuilder;
  addView: (view: GooglePickerDocsView) => GooglePickerBuilder;
  enableFeature: (feature: string) => GooglePickerBuilder;
  setCallback: (callback: (data: PickerCallbackData) => void) => GooglePickerBuilder;
  build: () => {
    setVisible: (visible: boolean) => void;
  };
};

type GooglePickerNamespace = {
  DocsView: new (viewId: string) => GooglePickerDocsView;
  DocsViewMode: {
    LIST: string;
  };
  Feature: {
    MULTISELECT_ENABLED: string;
    SUPPORT_DRIVES: string;
  };
  Action: {
    PICKED: string;
    CANCEL: string;
  };
  ViewId: {
    DOCS: string;
  };
  PickerBuilder: new () => GooglePickerBuilder;
};

type GapiNamespace = {
  load: (
    name: string,
    options:
      | (() => void)
      | {
          callback?: () => void;
          onerror?: () => void;
        },
  ) => void;
};

type PickerWindow = Window & {
  gapi?: GapiNamespace;
  google?: {
    picker?: GooglePickerNamespace;
  };
};

export type GoogleDrivePickerLaunchConfig = {
  clientId: string;
  developerKey: string;
  appId: string | null;
  oauthToken: string;
  locale?: string | null;
};

let pickerApiPromise: Promise<void> | null = null;

const normalizeLocale = (value: string | null | undefined): string => {
  if (!value) return 'en';
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('fr') ? 'fr' : 'en';
};

const getBrowserWindow = (): PickerWindow => {
  if (typeof window === 'undefined') {
    throw new Error('Google Drive Picker requires a browser environment.');
  }
  return window as PickerWindow;
};

const getBrowserDocument = (): Document => {
  if (typeof document === 'undefined') {
    throw new Error('Google Drive Picker requires a browser environment.');
  }
  return document;
};

async function loadGooglePickerApiScript(windowLike: PickerWindow, documentLike: Document): Promise<void> {
  if (windowLike.gapi?.load && windowLike.google?.picker) return;

  await new Promise<void>((resolve, reject) => {
    const existing = documentLike.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_PICKER_SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Picker script failed to load.')), {
        once: true,
      });
      return;
    }

    const script = documentLike.createElement('script');
    script.src = GOOGLE_PICKER_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Picker script failed to load.'));
    documentLike.head.appendChild(script);
  });
}

export async function loadGooglePickerApi(): Promise<void> {
  if (pickerApiPromise) return pickerApiPromise;

  pickerApiPromise = (async () => {
    const windowLike = getBrowserWindow();
    const documentLike = getBrowserDocument();

    await loadGooglePickerApiScript(windowLike, documentLike);
    await new Promise<void>((resolve, reject) => {
      const gapi = windowLike.gapi;
      if (!gapi?.load) {
        reject(new Error('Google Picker API is unavailable.'));
        return;
      }
      gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => reject(new Error('Google Picker API failed to initialize.')),
      });
    });

    if (!windowLike.google?.picker) {
      throw new Error('Google Picker API is unavailable.');
    }
  })();

  return pickerApiPromise;
}

export function resetGoogleDrivePickerApiForTests(): void {
  pickerApiPromise = null;
}

export async function openGoogleDrivePicker(input: GoogleDrivePickerLaunchConfig): Promise<string[]> {
  return openGoogleDrivePickerWith(input, {
    ensureApiLoaded: () => loadGooglePickerApi(),
  });
}

export async function openGoogleDrivePickerWith(
  input: GoogleDrivePickerLaunchConfig,
  deps: {
    ensureApiLoaded: () => Promise<void>;
    googlePicker?: GooglePickerNamespace;
  },
): Promise<string[]> {
  await deps.ensureApiLoaded();

  const googlePicker = deps.googlePicker ?? getBrowserWindow().google?.picker;
  if (!googlePicker) {
    throw new Error('Google Picker API is unavailable.');
  }

  return new Promise<string[]>((resolve) => {
    const view = new googlePicker.DocsView(googlePicker.ViewId.DOCS);
    view.setMimeTypes(GOOGLE_DRIVE_PICKER_SUPPORTED_MIME_TYPES);
    view.setIncludeFolders(false);
    view.setSelectFolderEnabled(false);
    view.setMode(googlePicker.DocsViewMode.LIST);

    const builder = new googlePicker.PickerBuilder()
      .setDeveloperKey(input.developerKey)
      .setOAuthToken(input.oauthToken)
      .setLocale(normalizeLocale(input.locale))
      .addView(view)
      .enableFeature(googlePicker.Feature.MULTISELECT_ENABLED)
      .enableFeature(googlePicker.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        if (data.action === googlePicker.Action.PICKED) {
          const fileIds = (data.docs ?? [])
            .map((doc) => (typeof doc.id === 'string' ? doc.id.trim() : ''))
            .filter((id) => id.length > 0);
          resolve(fileIds);
          return;
        }
        if (data.action === googlePicker.Action.CANCEL) {
          resolve([]);
        }
      });

    if (input.appId) {
      builder.setAppId(input.appId);
    }

    builder.build().setVisible(true);
  });
}
