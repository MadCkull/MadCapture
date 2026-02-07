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
  naming: { template: 'Pic ({index}).{ext}', startIndex: 1, zeroPad: 3, includeHint: true },
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

function currentSelection(): ExtractedImage[] {
  return state.items.filter((i) => state.selected.has(i.id));
}

function previewNames(): string[] {
  const selected = currentSelection();
  const ext = state.format === 'original' ? 'bin' : extFromMime(state.format);
  return buildFilenames(selected.length, state.naming, selected.map((i) => i.filenameHint || 'Pic'), ext);
}

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
      <button class="primary" id="download">Download (${state.selected.size})</button>
      <button id="caret">▸</button>
    </footer>
    ${state.settingsOpen ? renderSettingsPanel(state.naming, state.format, state.quality, previewNames()) : ''}
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
      render();
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
    render();
  });
  document.querySelector('#startIndex')?.addEventListener('input', (ev) => {
    state.naming.startIndex = Number((ev.target as HTMLInputElement).value);
    render();
  });
  document.querySelector('#zeroPad')?.addEventListener('input', (ev) => {
    state.naming.zeroPad = Number((ev.target as HTMLInputElement).value);
    render();
  });
  document.querySelector('#includeHint')?.addEventListener('change', (ev) => {
    state.naming.includeHint = (ev.target as HTMLInputElement).checked;
    render();
  });
  document.querySelector('#format')?.addEventListener('change', (ev) => {
    state.format = (ev.target as HTMLSelectElement).value as DesiredFormat;
    render();
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
  const selected = currentSelection();
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
      const originalBytes = new Uint8Array(fetched.bytes).buffer;
      if (originalBytes.byteLength > 50 * 1024 * 1024) {
        converted.push({ filename: names[i], bytes: originalBytes });
        continue;
      }
      const out = await convertBytes(item.id, originalBytes);
      converted.push({ filename: names[i], bytes: out });
    } catch {
      await chrome.runtime.sendMessage({ type: 'DOWNLOAD_ORIGINAL', url: item.url, filename: names[i] });
    }
  }

  if (converted.length > 0) {
    await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_ZIP',
      items: converted.map((item) => ({ filename: item.filename, bytes: Array.from(new Uint8Array(item.bytes)) })),
      zipName: `MadCapture-${Date.now()}.zip`
    });
  }
  state.status = `Done (${converted.length} converted / ${selected.length} selected)`;
  render();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SELECTION_LOCKED') {
    state.items = message.images;
    state.selected = new Set(state.items.map((i: ExtractedImage) => i.id));
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
