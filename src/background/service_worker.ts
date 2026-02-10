import JSZip from 'jszip';
import type { ExtractOptions, ExtractedImage } from '../utils/types';

const TTL = 24 * 60 * 60 * 1000;
const sizeCache = new Map<string, { bytes?: number; at: number }>();
const injectedTabs = new Set<number>();
let lastExtractOptions: ExtractOptions | undefined;

async function resolveSize(url: string): Promise<{ bytes?: number; unknown?: boolean }> {
  const cachedMem = sizeCache.get(url);
  if (cachedMem && Date.now() - cachedMem.at < TTL) return cachedMem;

  const cachedStorage = (await chrome.storage.local.get(`size:${url}`))[`size:${url}`] as
    | { bytes?: number; at: number }
    | undefined;
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
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  return response.arrayBuffer();
}

async function downloadZip(items: Array<{ filename: string; bytes: number[] }>, zipName: string): Promise<number> {
  const zip = new JSZip();
  for (const item of items) {
    if (item.bytes && item.bytes.length > 0) {
      zip.file(item.filename, new Uint8Array(item.bytes));
    }
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  const url = URL.createObjectURL(blob);
  const id = await chrome.downloads.download({
    url,
    filename: zipName,
    saveAs: false,
    conflictAction: 'uniquify'
  });

  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return id;
}

async function toggleSelector(
  tabId: number,
  options?: ExtractOptions
): Promise<{ active: boolean }> {
  if (!injectedTabs.has(tabId)) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/selectorOverlay.js'] });
    injectedTabs.add(tabId);
  }
  
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_SELECTOR', options });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/selectorOverlay.js'] });
    injectedTabs.add(tabId);
    return chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_SELECTOR', options });
  }
}

async function ensureSelectorInjected(tabId: number, allFrames = false): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames },
    files: ['content/selectorOverlay.js']
  });
  injectedTabs.add(tabId);
}

async function scanAllFrames(tabId: number, options?: ExtractOptions): Promise<ExtractedImage[]> {
  await ensureSelectorInjected(tabId, true);
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    args: [options],
    func: async (opts?: ExtractOptions) => {
      const extractor = (window as typeof window & {
        __madcapture_extract_images__?: (options?: Partial<ExtractOptions>) => Promise<unknown>;
      }).__madcapture_extract_images__;
      if (typeof extractor !== 'function') return [];
      try {
        return await extractor(opts);
      } catch {
        return [];
      }
    }
  });
  const images: ExtractedImage[] = [];
  for (const frame of results) {
    const result = frame.result as ExtractedImage[] | undefined;
    if (Array.isArray(result)) images.push(...result);
  }
  return images;
}

async function resolveDeepScanOptions(
  provided?: ExtractOptions
): Promise<ExtractOptions | undefined> {
  if (provided) return provided;
  if (lastExtractOptions) return lastExtractOptions;
  const data = await chrome.storage.local.get('deepScan');
  if (data.deepScan) {
    return { deepScan: true, visibleOnly: false };
  }
  return undefined;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));
});

const pendingNames = new Map<string, string>();

async function addLog(msg: string) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${msg}`;
  console.log(entry);
  const data = await chrome.storage.local.get('logs');
  const logs = data.logs || [];
  logs.push(entry);
  if (logs.length > 100) logs.shift();
  await chrome.storage.local.set({ logs });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'GET_LOGS') {
      const data = await chrome.storage.local.get('logs');
      sendResponse({ logs: data.logs || [] });
      return;
    }
    if (message.type === 'ADD_LOG') {
      if (typeof message.msg === 'string' && message.msg.trim()) {
        await addLog(message.msg.trim());
      }
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'CLEAR_LOGS') {
      await chrome.storage.local.set({ logs: [] });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'REGISTER_NAME') {
      await addLog(`Registering name: "${message.filename}" for URL: ${message.url.slice(0, 50)}...`);
      pendingNames.set(message.url, message.filename);
      const data = await chrome.storage.local.get('downloadRegistry');
      const reg = data.downloadRegistry || {};
      reg[message.url] = message.filename;
      await chrome.storage.local.set({ downloadRegistry: reg });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'FETCH_SIZE') {
      sendResponse(await resolveSize(message.url));
      return;
    }
    if (message.type === 'FETCH_BYTES') {
      try {
        const bytes = await fetchBytes(message.url);
        sendResponse({ ok: true, bytes: Array.from(new Uint8Array(bytes)) });
      } catch (error) {
        await addLog(`Fetch bytes failed for ${message.url.slice(0, 30)}: ${(error as Error).message}`);
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
      const resolved = await resolveDeepScanOptions(message.options as ExtractOptions | undefined);
      const result = await toggleSelector(tabId, resolved);
      sendResponse(result);
      return;
    }
    if (message.type === 'SET_EXTRACT_OPTIONS_FOR_TAB') {
      const tabId = sender.tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: 'No active tab id' });
        return;
      }
      if (!injectedTabs.has(tabId)) {
        try {
          await ensureSelectorInjected(tabId);
        } catch (error) {
          const messageText = (error as Error).message || 'Unable to inject content script';
          sendResponse({ ok: false, error: messageText });
          return;
        }
      }
      try {
        lastExtractOptions = message.options as ExtractOptions | undefined;
        await chrome.tabs.sendMessage(tabId, {
          type: 'SET_EXTRACT_OPTIONS',
          options: message.options
        });
        sendResponse({ ok: true });
      } catch (error) {
        const messageText = (error as Error).message || 'Unable to update options';
        sendResponse({ ok: false, error: messageText });
      }
      return;
    }
    if (message.type === 'SCAN_PAGE_IMAGES') {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      const options = message.options as ExtractOptions | undefined;
      if (options?.deepScan) {
        void (async () => {
          try {
            const images = await scanAllFrames(tabId, options);
            chrome.runtime.sendMessage({ type: 'PAGE_IMAGES_FOUND', images });
          } catch (error) {
            const raw = (error as Error).message || 'Deep scan failed';
            try {
              await ensureSelectorInjected(tabId);
              await chrome.tabs.sendMessage(tabId, {
                type: 'EXTRACT_PAGE_IMAGES',
                options
              });
            } catch {
              chrome.runtime.sendMessage({ type: 'PAGE_IMAGES_FOUND', images: [], error: raw });
            }
          }
        })();
        sendResponse({ ok: true });
        return;
      }

      if (!injectedTabs.has(tabId)) {
        await ensureSelectorInjected(tabId);
      }
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'EXTRACT_PAGE_IMAGES',
          options
        });
      } catch {
        await ensureSelectorInjected(tabId);
        await chrome.tabs.sendMessage(tabId, {
          type: 'EXTRACT_PAGE_IMAGES',
          options
        });
      }
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'LOCATE_IMAGE_ON_PAGE') {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      if (!injectedTabs.has(tabId)) {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content/selectorOverlay.js'] });
          injectedTabs.add(tabId);
        } catch (error) {
          const messageText = (error as Error).message || 'Unable to inject content script';
          sendResponse({ ok: false, error: messageText, level: 'error' });
          return;
        }
      }
      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: 'LOCATE_IMAGE_ON_PAGE',
          url: message.url,
          pageX: message.pageX,
          pageY: message.pageY
        });
        if (!result || typeof result.ok !== 'boolean') {
          sendResponse({ ok: false, error: 'No response from page. Reload the tab and try again.', level: 'warn' });
          return;
        }
        sendResponse(result);
      } catch (error) {
        const raw = (error as Error).message || 'Unable to contact page';
        let friendly = raw;
        if (/Receiving end does not exist|Could not establish connection/i.test(raw)) {
          friendly = 'Content script not ready. Reload the page and try again.';
        }
        if (/Cannot access a chrome|Extension cannot access|Cannot access contents of the page/i.test(raw)) {
          friendly = 'This page is restricted by Chrome and cannot be inspected.';
        }
        sendResponse({ ok: false, error: friendly, level: 'warn' });
      }
      return;
    }
    sendResponse({ ok: false, error: 'Unknown message' });
  })().catch((error) => sendResponse({ ok: false, error: (error as Error).message }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-selector') return;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) return;
    const resolved = await resolveDeepScanOptions();
    await toggleSelector(tabId, resolved);
  } catch {
    // ignore
  }
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  (async () => {
    await addLog(`Intercepting Download #${item.id}. URL: ${item.url.slice(0, 50)}...`);

    let suggestedName = pendingNames.get(item.finalUrl) || pendingNames.get(item.url);

    if (suggestedName) {
      const finalFilename = suggestedName.replace(/\\/g, '/').replace(/^\//, '');
      await addLog(`Sync Map Hit! Forcing name: "${finalFilename}"`);
      suggest({
        filename: finalFilename,
        conflictAction: 'uniquify'
      });
      pendingNames.delete(item.finalUrl);
      pendingNames.delete(item.url);
      return;
    }

    const data = await chrome.storage.local.get('downloadRegistry');
    const registry = data.downloadRegistry || {};
    suggestedName = registry[item.finalUrl] || registry[item.url];

    if (suggestedName) {
      const finalFilename = suggestedName.replace(/\\/g, '/').replace(/^\//, '');
      await addLog(`Async Storage Hit! Forcing name: "${finalFilename}"`);
      suggest({
        filename: finalFilename,
        conflictAction: 'uniquify'
      });
      delete registry[item.finalUrl];
      delete registry[item.url];
      await chrome.storage.local.set({ downloadRegistry: registry });
    } else {
      await addLog(`No suggested name found in Map or Registry. Letting Chrome decide.`);
      suggest();
    }
  })();
  return true;
});
