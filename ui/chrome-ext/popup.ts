import {
    getDefaultConfig,
    loadExtensionConfig,
    saveExtensionConfig,
    type ExtensionProfile,
} from './extension-config';

const app = document.getElementById('app');

if (!app) {
    throw new Error('Popup root element not found.');
}

app.innerHTML = `
  <div class="field">
    <label for="profile">Profile</label>
    <select id="profile">
      <option value="uat">UAT</option>
      <option value="prod">PROD</option>
    </select>
  </div>
  <div class="field">
    <label for="apiBaseUrl">API Base URL</label>
    <input id="apiBaseUrl" type="text" placeholder="https://.../api/v1" />
  </div>
  <div class="field">
    <label for="appBaseUrl">App Base URL</label>
    <input id="appBaseUrl" type="text" placeholder="https://..." />
  </div>
  <div class="field">
    <label for="wsBaseUrl">WS Base URL (optional)</label>
    <input id="wsBaseUrl" type="text" placeholder="wss://... (optional)" />
  </div>
  <div class="row">
    <button id="save" class="primary">Save</button>
    <button id="test">Test API</button>
    <button id="defaults">Defaults</button>
  </div>
  <div class="status info" id="status"></div>
`;

const profileEl = document.getElementById('profile') as HTMLSelectElement;
const apiBaseUrlEl = document.getElementById('apiBaseUrl') as HTMLInputElement;
const appBaseUrlEl = document.getElementById('appBaseUrl') as HTMLInputElement;
const wsBaseUrlEl = document.getElementById('wsBaseUrl') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const testBtn = document.getElementById('test') as HTMLButtonElement;
const defaultsBtn = document.getElementById('defaults') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

const setStatus = (message: string, kind: 'ok' | 'error' | 'info' = 'info') => {
    statusEl.className = `status ${kind}`;
    statusEl.textContent = message;
};

const loadIntoForm = async () => {
    const config = await loadExtensionConfig();
    profileEl.value = config.profile;
    apiBaseUrlEl.value = config.apiBaseUrl;
    appBaseUrlEl.value = config.appBaseUrl;
    wsBaseUrlEl.value = config.wsBaseUrl;
};

const saveForm = async () => {
    const profile = (profileEl.value === 'prod' ? 'prod' : 'uat') as ExtensionProfile;
    const config = await saveExtensionConfig({
        profile,
        apiBaseUrl: apiBaseUrlEl.value,
        appBaseUrl: appBaseUrlEl.value,
        wsBaseUrl: wsBaseUrlEl.value,
    });
    profileEl.value = config.profile;
    apiBaseUrlEl.value = config.apiBaseUrl;
    appBaseUrlEl.value = config.appBaseUrl;
    wsBaseUrlEl.value = config.wsBaseUrl;
    setStatus(`Saved ${config.profile.toUpperCase()} config.`, 'ok');
};

const testApi = async () => {
    const healthUrl = `${apiBaseUrlEl.value.replace(/\/$/, '')}/health`;
    setStatus('Testing API connectivity...', 'info');
    try {
        const response = await chrome.runtime.sendMessage({
            type: 'proxy_api_fetch',
            payload: {
                url: healthUrl,
                method: 'GET',
            },
        }) as { ok?: boolean; status?: number; error?: string } | undefined;

        if (response?.ok && response.status && response.status >= 200 && response.status < 300) {
            setStatus(`API reachable (${response.status}).`, 'ok');
            return;
        }

        const reason = response?.error ?? `HTTP ${response?.status ?? 'unknown'}`;
        setStatus(`API test failed: ${reason}`, 'error');
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setStatus(`API test failed: ${reason}`, 'error');
    }
};

profileEl.addEventListener('change', () => {
    const profile = (profileEl.value === 'prod' ? 'prod' : 'uat') as ExtensionProfile;
    const defaults = getDefaultConfig(profile);
    apiBaseUrlEl.value = defaults.apiBaseUrl;
    appBaseUrlEl.value = defaults.appBaseUrl;
    wsBaseUrlEl.value = defaults.wsBaseUrl;
    setStatus(`Loaded ${profile.toUpperCase()} defaults in form.`, 'info');
});

saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
        await saveForm();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setStatus(`Save failed: ${reason}`, 'error');
    } finally {
        saveBtn.disabled = false;
    }
});

testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    try {
        await testApi();
    } finally {
        testBtn.disabled = false;
    }
});

defaultsBtn.addEventListener('click', () => {
    const profile = (profileEl.value === 'prod' ? 'prod' : 'uat') as ExtensionProfile;
    const defaults = getDefaultConfig(profile);
    apiBaseUrlEl.value = defaults.apiBaseUrl;
    appBaseUrlEl.value = defaults.appBaseUrl;
    wsBaseUrlEl.value = defaults.wsBaseUrl;
    setStatus(`Reset form to ${profile.toUpperCase()} defaults.`, 'info');
});

void loadIntoForm()
    .then(() => setStatus('Runtime config loaded.', 'info'))
    .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        setStatus(`Failed to load runtime config: ${reason}`, 'error');
    });
