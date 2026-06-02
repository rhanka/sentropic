import { mount } from 'svelte';
// Published design surface (D4): theme CSS variables + tokens.
import '@sentropic/design-system-themes/css/sent-tech.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Missing #app mount target');
}

export default mount(App, { target });
