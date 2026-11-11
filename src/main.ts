import '@fontsource/dela-gothic-one/latin-400.css';
import '@fontsource/zen-kaku-gothic-new/latin-400.css';
import '@fontsource/zen-kaku-gothic-new/latin-500.css';
import '@fontsource/zen-kaku-gothic-new/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, {
	target: document.getElementById('app')!
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('/sw.js').catch((error) => {
			console.warn('Service worker registration failed', error);
		});
	});
}

export default app;
