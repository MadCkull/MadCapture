import JSZip from 'jszip';
import { extFromMime } from '../utils/url';

const sizeCache = new Map<string, { bytes?: number; at: number }>();

async function resolveSize(url: string): Promise<{ bytes?: number; unknown?: boolean }> {
  const cached = sizeCache.get(url);
  if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return cached;

  try {
    const head = await fetch(url, { method: 'HEAD' });
    const length = Number(head.headers.get('content-length') || 0);
    if (length > 0) {
      const res = { bytes: length, at: Date.now() };
      sizeCache.set(url, res);
      chrome.storage.local.set({ [`size:${url}`]: res });
      return res;
    }
  } catch {
    // continue
  }

  try {
    const data = await fetch(url).then((r) => r.arrayBuffer());
    const res = { bytes: data.byteLength, at: Date.now() };
    sizeCache.set(url, res);
    chrome.storage.local.set({ [`size:${url}`]: res });
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

async function downloadZip(items: Array<{ filename: string; bytes: ArrayBuffer }>, zipName: string): Promise<number> {
  const zip = new JSZip();
  for (const item of items) {
    zip.file(item.filename, item.bytes);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  return chrome.downloads.download({ url, filename: zipName, saveAs: false });
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
        sendResponse({ ok: true, bytes });
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
      const id = await downloadZip(message.items, message.zipName || `MadCapture.${extFromMime('application/zip')}`);
      sendResponse({ ok: true, id });
      return;
    }
    if (message.type === 'TOGGLE_SELECTOR_FOR_TAB') {
      const tabId = sender.tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (!tabId) throw new Error('No active tab id');
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/selectorOverlay.js'] });
      const result = await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_SELECTOR' });
      sendResponse(result);
      return;
    }
  })().catch((error) => sendResponse({ ok: false, error: (error as Error).message }));
  return true;
});
