import JSZip from 'jszip';

const TTL = 24 * 60 * 60 * 1000;
const sizeCache = new Map<string, { bytes?: number; at: number }>();
const injectedTabs = new Set<number>();

async function resolveSize(url: string): Promise<{ bytes?: number; unknown?: boolean }> {
  const cachedMem = sizeCache.get(url);
  if (cachedMem && Date.now() - cachedMem.at < TTL) return cachedMem;

  const cachedStorage = (await chrome.storage.local.get(`size:${url}`))[`size:${url}`] as { bytes?: number; at: number } | undefined;
  if (cachedStorage && Date.now() - cachedStorage.at < TTL) {
    sizeCache.set(url, cachedStorage);
    return cachedStorage;
  }

  try {
    const head = await fetch(url, { method: 'HEAD' });
    const length = Number(head.headers.get('content-length') || 0);
    if (length > 0) {
      const res = { bytes: length, at: Date.now() };
      sizeCache.set(url, res);
      await chrome.storage.local.set({ [`size:${url}`]: res });
      return res;
    }
  } catch {
    // continue
  }

  try {
    const data = await fetch(url).then((r) => r.arrayBuffer());
    const res = { bytes: data.byteLength, at: Date.now() };
    sizeCache.set(url, res);
    await chrome.storage.local.set({ [`size:${url}`]: res });
    return res;
  } catch {
    return { unknown: true };
  }
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) {
    const response = await fetch(url);
    return response.arrayBuffer();
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  return response.arrayBuffer();
}

async function downloadZip(items: Array<{ filename: string; bytes: number[] }>, zipName: string): Promise<number> {
  const zip = new JSZip();
  for (const item of items) {
    zip.file(item.filename, new Uint8Array(item.bytes));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const id = await chrome.downloads.download({ url, filename: zipName, saveAs: false });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return id;
}

async function toggleSelector(tabId: number): Promise<{ active: boolean }> {
  if (!injectedTabs.has(tabId)) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/selectorOverlay.js'] });
    injectedTabs.add(tabId);
  }
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_SELECTOR' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/selectorOverlay.js'] });
    injectedTabs.add(tabId);
    return chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_SELECTOR' });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'FETCH_SIZE') {
      sendResponse(await resolveSize(message.url));
      return;
    }
    if (message.type === 'FETCH_BYTES') {
      try {
        const bytes = await fetchBytes(message.url);
        sendResponse({ ok: true, bytes: Array.from(new Uint8Array(bytes)) });
      } catch (error) {
        sendResponse({ ok: false, error: (error as Error).message });
      }
      return;
    }
    if (message.type === 'DOWNLOAD_ORIGINAL') {
      const id = await chrome.downloads.download({ url: message.url, filename: message.filename, saveAs: false });
      sendResponse({ ok: true, id });
      return;
    }
    if (message.type === 'DOWNLOAD_ZIP') {
      const id = await downloadZip(message.items, message.zipName || `MadCapture-${Date.now()}.zip`);
      sendResponse({ ok: true, id });
      return;
    }
    if (message.type === 'TOGGLE_SELECTOR_FOR_TAB') {
      const tabId = sender.tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (!tabId) throw new Error('No active tab id');
      const result = await toggleSelector(tabId);
      sendResponse(result);
      return;
    }
    sendResponse({ ok: false, error: 'Unknown message' });
  })().catch((error) => sendResponse({ ok: false, error: (error as Error).message }));
  return true;
});
