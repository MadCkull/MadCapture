import { renderImageGrid } from './ui/ImageGrid';
import { renderSettingsPanel } from './ui/SettingsPanel';
import { ExtractedImage, DesiredFormat, NamingOptions } from '../utils/types';
import { compareBySizeDesc, estimateBytes } from '../utils/sizeCalc';
import { buildFilenames } from '../utils/naming';
import { extFromMime } from '../utils/url';

type AppState = {
  items: ExtractedImage[];
  selected: Set<string>;
  settingsOpen: boolean;
  naming: NamingOptions;
  format: DesiredFormat;
  quality: number;
  status: string;
};

const state: AppState = {
  items: [],
  selected: new Set<string>(),
  settingsOpen: false,
  naming: { template: 'Pic ({index}).{ext}', startIndex: 1, zeroPad: 3 },
  format: 'original',
  quality: 0.92,
  status: 'Idle'
};

const converter = new Worker(chrome.runtime.getURL('workers/converter.worker.js'));
const pendingConversions = new Map<string, (data: { ok: boolean; bytes?: ArrayBuffer; error?: string }) => void>();
converter.onmessage = (ev: MessageEvent<{ id: string; ok: boolean; bytes?: ArrayBuffer; error?: string }>) => {
  pendingConversions.get(ev.data.id)?.(ev.data);
  pendingConversions.delete(ev.data.id);
};

function render(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;

  app.innerHTML = `
    <header class="toolbar">
      <strong>MadCapture</strong>
      <button id="toggleSelector">Selector (S)</button>
      <button id="settingsToggle">⚙</button>
      <span class="status">${state.status}</span>
    </header>
    <main>${renderImageGrid(state.items, state.selected)}</main>
    <footer class="footer">
      <button class="primary" id="download">Download</button>
      <button id="caret">▸</button>
    </footer>
    ${state.settingsOpen ? renderSettingsPanel(state.naming, state.format, state.quality) : ''}
  `;

  wireEvents();
}

async function refreshSizes(): Promise<void> {
  await Promise.all(state.items.map(async (item) => {
    const result = await chrome.runtime.sendMessage({ type: 'FETCH_SIZE', url: item.url });
    item.bytes = result.bytes;
    item.estimatedBytes = estimateBytes(item.width, item.height);
  }));
  state.items.sort(compareBySizeDesc);
  render();
}

function wireEvents(): void {
  document.querySelectorAll<HTMLInputElement>('input[type=checkbox][data-id]').forEach((input) => {
    input.onchange = () => {
      if (input.checked) state.selected.add(input.dataset.id!);
      else state.selected.delete(input.dataset.id!);
    };
  });

  document.querySelector('#toggleSelector')?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'TOGGLE_SELECTOR_FOR_TAB' });
  });

  document.querySelector('#settingsToggle')?.addEventListener('click', () => {
    state.settingsOpen = !state.settingsOpen;
    render();
  });
  document.querySelector('#caret')?.addEventListener('click', () => {
    state.settingsOpen = !state.settingsOpen;
    render();
  });

  document.querySelector('#download')?.addEventListener('click', () => void startDownload());
  document.querySelector('#template')?.addEventListener('input', (ev) => {
    state.naming.template = (ev.target as HTMLInputElement).value;
  });
  document.querySelector('#startIndex')?.addEventListener('input', (ev) => {
    state.naming.startIndex = Number((ev.target as HTMLInputElement).value);
  });
  document.querySelector('#zeroPad')?.addEventListener('input', (ev) => {
    state.naming.zeroPad = Number((ev.target as HTMLInputElement).value);
  });
  document.querySelector('#format')?.addEventListener('change', (ev) => {
    state.format = (ev.target as HTMLSelectElement).value as DesiredFormat;
  });
  document.querySelector('#quality')?.addEventListener('input', (ev) => {
    state.quality = Number((ev.target as HTMLInputElement).value);
  });
}

async function convertBytes(id: string, bytes: ArrayBuffer): Promise<ArrayBuffer> {
  if (state.format === 'original') return bytes;
  const result = await new Promise<{ ok: boolean; bytes?: ArrayBuffer; error?: string }>((resolve) => {
    pendingConversions.set(id, resolve);
    converter.postMessage({ id, bytes, targetType: state.format, quality: state.quality }, [bytes]);
  });
  if (!result.ok || !result.bytes) throw new Error(result.error || 'conversion failed');
  return result.bytes;
}

async function startDownload(): Promise<void> {
  const selected = state.items.filter((i) => state.selected.has(i.id));
  if (!selected.length) return;
  state.status = 'Preparing downloads...';
  render();

  const ext = state.format === 'original' ? 'bin' : extFromMime(state.format);
  const names = buildFilenames(selected.length, state.naming, selected.map((i) => i.filenameHint || 'Pic'), ext);

  const converted: Array<{ filename: string; bytes: ArrayBuffer }> = [];

  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i];
    state.status = `Processing ${i + 1}/${selected.length}`;
    render();
    try {
      const fetched = await chrome.runtime.sendMessage({ type: 'FETCH_BYTES', url: item.url });
      if (!fetched.ok) throw new Error(fetched.error);
      if (fetched.bytes.byteLength > 50 * 1024 * 1024) {
        state.status = `Large image detected (${Math.round(fetched.bytes.byteLength / 1024 / 1024)}MB), skipping conversion.`;
      }
      const out = fetched.bytes.byteLength > 50 * 1024 * 1024 ? fetched.bytes : await convertBytes(item.id, fetched.bytes);
      converted.push({ filename: names[i], bytes: out });
    } catch {
      await chrome.runtime.sendMessage({ type: 'DOWNLOAD_ORIGINAL', url: item.url, filename: names[i] });
    }
  }

  await chrome.runtime.sendMessage({ type: 'DOWNLOAD_ZIP', items: converted, zipName: `MadCapture-${Date.now()}.zip` });
  state.status = `Done (${converted.length} files)`;
  render();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SELECTION_LOCKED') {
    state.items = message.images;
    state.selected = new Set(state.items.map((i) => i.id));
    state.status = `Found ${state.items.length} images`;
    render();
    void refreshSizes();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key.toLowerCase() === 's') void chrome.runtime.sendMessage({ type: 'TOGGLE_SELECTOR_FOR_TAB' });
  if (ev.key === 'Escape') void chrome.runtime.sendMessage({ type: 'TOGGLE_SELECTOR_FOR_TAB' });
  if (ev.key === 'Enter') void startDownload();
});

render();
