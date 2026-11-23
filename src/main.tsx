import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/app';
import { SearchPage } from './features/search/search-page';
import { createMemoryIpc, setIpc } from './lib/ipc';
import { createTauriIpc, isTauri } from './lib/tauri-ipc';
import { sampleSeed } from './lib/sample-data';
import { applyPlatform, isMac } from './lib/platform';
import { useThemeStore } from './lib/stores/theme-store';
import { installNoAutocorrect } from './lib/no-autocorrect';
import '@fontsource-variable/figtree';
import './app/styles.css';

// No macOS autocorrect bubbles on names, amounts and searches (they swallowed the first click).
installNoAutocorrect(document);

// Outside Tauri (plain browser) the app runs on sample data so every screen has content.
setIpc(isTauri() ? createTauriIpc() : createMemoryIpc(sampleSeed()));
applyPlatform(document.documentElement, { tauri: isTauri(), mac: isMac() });

// Secondary windows load the same bundle with ?view=… and render a single view.
const view = new URLSearchParams(location.search).get('view');
const Root = view === 'search' ? SearchPage : App;
if (view) void useThemeStore.getState().load();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
