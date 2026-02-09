import { renderImageGrid } from "./ui/ImageGrid";
import { renderSettingsPanel } from "./ui/SettingsPanel";
import { ExtractedImage, DesiredFormat, NamingOptions } from "../utils/types";
import { estimateBytes } from "../utils/sizeCalc";
import { buildFilenames } from "../utils/naming";
import { extFromMime } from "../utils/url";

type AppState = {
  items: ExtractedImage[];
  selected: Set<string>;
  selectionOrder: string[];
  settingsOpen: boolean;
  naming: NamingOptions;
  format: DesiredFormat;
  status: string;
  statusLevel: "info" | "warn" | "error";
  progress: number;
  searching: boolean;
  processing: boolean;
  showLogs: boolean;
  highlighted: Set<string>;
  filterSelected: boolean;
  filterSnapshot: Set<string>;
  deepScan: boolean;
  smartFilter: boolean;
};

const defaultNaming: NamingOptions = {
  baseName: "Pic",
  zeroPad: 0,
  folderName: "",
};

const state: AppState = {
  items: [],
  selected: new Set<string>(),
  selectionOrder: [],
  settingsOpen: false,
  naming: { ...defaultNaming },
  format: "original",
  status: "Ready",
  statusLevel: "info",
  progress: 0,
  searching: false,
  processing: false,
  showLogs: false,
  highlighted: new Set<string>(),
  filterSelected: false,
  filterSnapshot: new Set<string>(),
  deepScan: false,
  smartFilter: false,
};

let searchToken = 0;
let searchTimeoutId: number | undefined;
const pendingBatches: ExtractedImage[][] = [];

const converter = new Worker(
  chrome.runtime.getURL("workers/converter.worker.js"),
);
const pendingConversions = new Map<
  string,
  (data: { ok: boolean; bytes?: ArrayBuffer; error?: string }) => void
>();
converter.onmessage = (
  ev: MessageEvent<{
    id: string;
    ok: boolean;
    bytes?: ArrayBuffer;
    error?: string;
  }>,
) => {
  pendingConversions.get(ev.data.id)?.(ev.data);
  pendingConversions.delete(ev.data.id);
};
const previewRequests = new Set<string>();
const previewLogged = new Set<string>();

async function addLog(msg: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "ADD_LOG", msg });
  } catch {
    // ignore
  }
}

function selectorExtractOptions() {
  return state.deepScan
    ? { deepScan: true, visibleOnly: false }
    : { deepScan: false, visibleOnly: true };
}

function pageScanOptions() {
  return state.deepScan
    ? { deepScan: true, visibleOnly: false }
    : { deepScan: false, visibleOnly: false };
}

async function syncExtractOptionsToTab(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "SET_EXTRACT_OPTIONS_FOR_TAB",
      options: selectorExtractOptions(),
    });
  } catch {
    // ignore
  }
}

function currentSelection(): ExtractedImage[] {
  const map = new Map(state.items.map((i) => [i.id, i]));
  return state.selectionOrder
    .map((id) => map.get(id))
    .filter(Boolean) as ExtractedImage[];
}

function beginSearch(label: string) {
  if (state.processing) return;
  state.searching = true;
  state.status = label;
  state.statusLevel = "info";
  state.progress = 0;
  const token = ++searchToken;
  if (searchTimeoutId) window.clearTimeout(searchTimeoutId);
  searchTimeoutId = window.setTimeout(() => {
    if (state.searching && searchToken === token) {
      state.searching = false;
      state.status = "Search timed out";
      state.statusLevel = "warn";
      render();
      setTimeout(() => {
        if (
          !state.searching &&
          !state.processing &&
          state.status === "Search timed out"
        ) {
          state.status = "Ready";
          render();
        }
      }, 2000);
    }
  }, 20000);
  render();
}

function endSearch() {
  state.searching = false;
  if (searchTimeoutId) window.clearTimeout(searchTimeoutId);
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    "naming",
    "format",
    "deepScan",
    "smartFilter",
  ]);
  if (data.naming) {
    if ("baseName" in data.naming) {
      state.naming = { ...defaultNaming, ...data.naming };
      if (typeof data.naming.zeroPad !== "number") state.naming.zeroPad = 0;
    } else if (
      "template" in data.naming &&
      typeof data.naming.template === "string"
    ) {
      const template = data.naming.template;
      const base = template.split("(")[0]?.trim() || "Pic";
      state.naming = { ...defaultNaming, baseName: base };
    } else if ("prefix" in data.naming) {
      const prefix =
        typeof data.naming.prefix === "string" ? data.naming.prefix : "Pic";
      state.naming = { ...defaultNaming, baseName: prefix };
    }
    if (typeof data.naming.folderName === "string")
      state.naming.folderName = data.naming.folderName;
  }
  if (data.format) state.format = data.format;
  if (typeof data.deepScan === "boolean") state.deepScan = data.deepScan;
  if (typeof data.smartFilter === "boolean")
    state.smartFilter = data.smartFilter;
}

async function saveSettings() {
  await chrome.storage.local.set({
    naming: state.naming,
    format: state.format,
    deepScan: state.deepScan,
    smartFilter: state.smartFilter,
  });
}

async function registerDownload(url: string, filename: string) {
  await chrome.runtime.sendMessage({ type: "REGISTER_NAME", url, filename });
}

function render(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  if (!app.querySelector(".toolbar")) {
    app.innerHTML = `
      <header class="toolbar"></header>
      <div class="main-content"></div>
      <footer class="footer"></footer>
      <div id="settings-container"></div>
      <div id="fab-container"></div>
    `;
    wireStaticEvents();
  }

  const toolbar = app.querySelector(".toolbar")!;
  const main = app.querySelector(".main-content")!;
  const footer = app.querySelector(".footer")!;
  const settings = app.querySelector("#settings-container")!;
  const fab = app.querySelector("#fab-container")!;

  const selectedCount = state.selected.size;
  const isBusy = state.searching || state.processing;
  const showProgress = state.processing;

  toolbar.innerHTML = `
    <div class="actions-left">
      <button class="secondary icon-btn" id="scanPage" title="Scan Whole Page">
        <i class="fa-solid fa-expand"></i>
      </button>
      <button class="secondary icon-btn" id="toggleSelector" title="Toggle Selector (Alt+S)">
        <i class="fa-solid fa-crosshairs"></i>
      </button>
      <button class="stat-toggle toolbar-toggle ${state.deepScan ? "active" : ""}" id="toggleDeepScan" title="Deep Scan Mode">
        <i class="fa-solid fa-bolt"></i>
        Deep
      </button>
    </div>
    <div class="actions-right">
      <button class="secondary icon-btn" id="clearAll" title="Clear Grid">
        <i class="fa-solid fa-rotate-left"></i>
      </button>
      <button class="secondary icon-btn" id="downloadTask" title="Download Selected">
        <i class="fa-solid fa-download"></i>
      </button>
    </div>
  `;

  let mainHtml = "";
  if (isBusy) {
    const text = state.searching
      ? state.status || "Searching for images..."
      : state.status;
    mainHtml = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>${text}</p>
        ${
          showProgress
            ? `
          <div class="progress-bar-container" style="width: 200px; margin-top: 12px; height: 4px; background: var(--panel-border); border-radius: 2px; overflow: hidden;">
            <div class="progress-fill" style="width: ${state.progress}%; height: 100%; background: var(--accent); transition: width 0.3s ease;"></div>
          </div>
        `
            : ""
        }
      </div>
    `;
  } else if (state.showLogs) {
    mainHtml = `
      <div class="log-viewer">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h3 style="margin: 0; font-size: 14px;">Debug Logs</h3>
          <div style="display: flex; gap: 8px;">
            <button class="secondary" id="clearLogsBtn" style="padding: 2px 8px; font-size: 11px;">Clear</button>
            <button class="secondary" id="closeLogsBtn" style="padding: 2px 8px; font-size: 11px;">Close</button>
          </div>
        </div>
        <div class="log-content" id="log-list">Loading logs...</div>
      </div>
    `;
  } else if (state.items.length === 0) {
    mainHtml = `
      <div class="loading-state">
        <p style="opacity: 0.6;">Select an element to capture images</p>
      </div>
    `;
  } else {
    mainHtml = renderImageGrid(state.items, state.selected, state.highlighted);
  }

  const wasGrid = !!main.querySelector(".grid");
  const isGrid = !isBusy && state.items.length > 0;
  const syncGridState = () => {
    const grid = main.querySelector(".grid");
    if (!grid) return;
    grid.classList.toggle("filter-selected", state.filterSelected);
    const orderMap = new Map<string, number>();
    state.selectionOrder.forEach((id, idx) => orderMap.set(id, idx + 1));
    main.querySelectorAll(".card").forEach((card) => {
      const id = (card as HTMLElement).dataset.id;
      if (id) {
        if (state.selected.has(id)) card.classList.add("selected");
        else card.classList.remove("selected");
        if (state.highlighted.has(id)) card.classList.add("highlighted");
        else card.classList.remove("highlighted");
        if (state.filterSelected) {
          if (state.filterSnapshot.has(id)) card.classList.remove("filter-out");
          else card.classList.add("filter-out");
        } else {
          card.classList.remove("filter-out");
        }
      }
      const item = state.items.find((i) => i.id === id);
      if (item) {
        const imgEl = card.querySelector("img") as HTMLImageElement | null;
        const desiredSrc = item.previewUrl || item.url;
        if (imgEl && imgEl.src !== desiredSrc) {
          imgEl.src = desiredSrc;
        }
        const dimSpan = card.querySelector(".dimensions");
        if (dimSpan)
          dimSpan.textContent =
            item.width && item.height ? `${item.width}×${item.height}` : "...";
        const sizeSpan = card.querySelector(".size");
        if (sizeSpan)
          sizeSpan.textContent = item.bytes
            ? `${(item.bytes / 1024).toFixed(1)} KB`
            : "...";
        const indexBadge = card.querySelector(
          ".selection-index",
        ) as HTMLElement | null;
        if (indexBadge) {
          const idx = orderMap.get(id);
          if (state.filterSelected && idx && state.selected.has(id)) {
            indexBadge.textContent = String(idx);
            indexBadge.classList.add("show");
          } else {
            indexBadge.textContent = "";
            indexBadge.classList.remove("show");
          }
        }
      }
    });
  };

  if (
    !isGrid ||
    !wasGrid ||
    main.dataset.itemCount !== state.items.length.toString()
  ) {
    main.innerHTML = mainHtml;
    main.dataset.itemCount = isGrid ? state.items.length.toString() : "0";
    if (isGrid) syncGridState();
  } else if (isGrid) {
    syncGridState();
  }
  if (isGrid) wirePreviewFallbacks();

  footer.innerHTML = `
    <div class="info-panel">
      <div class="stats">
        <span class="stat-item"><i class="fa-solid fa-images"></i> <strong>${state.items.length}</strong> Found</span>
        <button class="stat-toggle ${state.filterSelected ? "active" : ""}" id="toggleSelectedFilter" title="Show only selected">
          <i class="fa-solid fa-check-double"></i>
          <strong>${selectedCount}</strong> Selected
        </button>
      </div>
      <div class="status-text ${state.statusLevel}">
        ${state.status}
        ${showProgress ? `(${Math.round(state.progress)}%)` : ""}
      </div>
    </div>
  `;

  settings.innerHTML = state.settingsOpen
    ? renderSettingsPanel(state.naming, state.format, state.smartFilter)
    : "";
  fab.innerHTML = `
    <button class="secondary icon-btn settings-fab" id="settingsToggle" title="Settings">
      <i class="fa-solid fa-gear"></i>
    </button>
  `;

  wireDynamicEvents();
}

function wireStaticEvents(): void {
  const main = document.querySelector(".main-content")!;
  let clickTimer: number | undefined;
  let pendingClickId: string | null = null;
  main.addEventListener("click", (e) => {
    if (e.detail > 1) return;
    const card = (e.target as HTMLElement).closest(".card");
    if (!card) return;
    const id = (card as HTMLElement).dataset.id;
    if (!id) return;
    if (clickTimer) window.clearTimeout(clickTimer);
    pendingClickId = id;
    clickTimer = window.setTimeout(() => {
      if (!pendingClickId) return;
      if (state.selected.has(pendingClickId)) {
        state.selected.delete(pendingClickId);
        state.selectionOrder = state.selectionOrder.filter(
          (x) => x !== pendingClickId,
        );
      } else {
        state.selected.add(pendingClickId);
        state.selectionOrder.push(pendingClickId);
      }
      pendingClickId = null;
      render();
    }, 180);
  });

  main.addEventListener("dblclick", (e) => {
    if (clickTimer) window.clearTimeout(clickTimer);
    pendingClickId = null;
    const card = (e.target as HTMLElement).closest(
      ".card",
    ) as HTMLElement | null;
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    const id = card.dataset.id;
    if (!id) return;
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    void locateImageOnPage(item);
  });

  window.addEventListener(
    "keydown",
    (ev) => {
      if (ev.altKey && ev.code === "KeyS") {
        ev.preventDefault();
        ev.stopPropagation();
        void chrome.runtime.sendMessage({
          type: "TOGGLE_SELECTOR_FOR_TAB",
          options: selectorExtractOptions(),
        });
      }
      if (ev.key === "Escape" && !state.settingsOpen && !state.showLogs)
        void chrome.runtime.sendMessage({
          type: "TOGGLE_SELECTOR_FOR_TAB",
          options: selectorExtractOptions(),
        });
      if (ev.key === "Escape" && (state.settingsOpen || state.showLogs)) {
        state.settingsOpen = false;
        state.showLogs = false;
        render();
      }
      if (ev.key === "Enter" && !state.searching && !state.processing)
        void startDownload();
    },
    true,
  );

  document.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const settingsPanel = document.querySelector(".settings-panel");
    const logPanel = document.querySelector(".log-viewer");
    const settingsToggle = document.querySelector("#settingsToggle");
    const viewLogsBtn = document.querySelector("#viewLogs");

    if (
      state.settingsOpen &&
      settingsPanel &&
      !settingsPanel.contains(target) &&
      !settingsToggle?.contains(target)
    ) {
      state.settingsOpen = false;
      render();
    }
    if (
      state.showLogs &&
      logPanel &&
      !logPanel.contains(target) &&
      !viewLogsBtn?.contains(target)
    ) {
      state.showLogs = false;
      render();
    }
  });
}

function wireDynamicEvents(): void {
  document.querySelector("#clearAll")?.addEventListener("click", () => {
    state.items.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    state.items = [];
    state.selected.clear();
    state.selectionOrder = [];
    state.highlighted.clear();
    state.filterSnapshot.clear();
    state.status = "Ready";
    state.statusLevel = "info";
    render();
  });

  document.querySelector("#scanPage")?.addEventListener("click", async () => {
    if (state.processing) return;
    beginSearch(
      state.deepScan ? "Deep scanning page..." : "Scanning whole page...",
    );
    try {
      const result = await chrome.runtime.sendMessage({
        type: "SCAN_PAGE_IMAGES",
        options: pageScanOptions(),
      });
      if (!result?.ok) {
        endSearch();
        state.status = result?.error || "Scan failed";
        state.statusLevel = "warn";
        render();
        setTimeout(() => {
          if (
            !state.searching &&
            !state.processing &&
            state.status === (result?.error || "Scan failed")
          ) {
            state.status = "Ready";
            render();
          }
        }, 2000);
      }
    } catch (err) {
      endSearch();
      state.status = (err as Error).message || "Scan failed";
      state.statusLevel = "error";
      render();
      setTimeout(() => {
        if (
          !state.searching &&
          !state.processing &&
          state.status === ((err as Error).message || "Scan failed")
        ) {
          state.status = "Ready";
          render();
        }
      }, 2000);
    }
  });

  document
    .querySelector("#toggleDeepScan")
    ?.addEventListener("click", async () => {
      state.deepScan = !state.deepScan;
      void saveSettings();
      void syncExtractOptionsToTab();
      render();
    });

  document
    .querySelector("#toggleSmartFilter")
    ?.addEventListener("click", () => {
      state.smartFilter = !state.smartFilter;
      void saveSettings();
      render();
    });

  document
    .querySelector("#toggleSelector")
    ?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        type: "TOGGLE_SELECTOR_FOR_TAB",
        options: selectorExtractOptions(),
      });
    });

  document.querySelector("#settingsToggle")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    state.settingsOpen = !state.settingsOpen;
    state.showLogs = false;
    render();
  });

  document
    .querySelector("#downloadTask")
    ?.addEventListener("click", () => void startDownload());

  document
    .querySelector("#toggleSelectedFilter")
    ?.addEventListener("click", () => {
      state.filterSelected = !state.filterSelected;
      if (state.filterSelected) {
        state.filterSnapshot = new Set(state.selectionOrder);
      } else {
        state.filterSnapshot.clear();
      }
      render();
    });

  const baseNameInput = document.querySelector(
    "#baseName",
  ) as HTMLInputElement | null;
  if (baseNameInput) {
    baseNameInput.value = state.naming.baseName;
    baseNameInput.oninput = (ev) => {
      state.naming.baseName = (ev.target as HTMLInputElement).value;
      void saveSettings();
    };
  }

  const zeroPadInput = document.querySelector(
    "#zeroPad",
  ) as HTMLInputElement | null;
  if (zeroPadInput) {
    zeroPadInput.value = String(state.naming.zeroPad ?? 0);
    zeroPadInput.oninput = (ev) => {
      const raw = Number((ev.target as HTMLInputElement).value);
      state.naming.zeroPad = Math.max(
        0,
        Math.min(5, Number.isFinite(raw) ? raw : 0),
      );
      void saveSettings();
    };
  }

  const folderInput = document.querySelector(
    "#folderName",
  ) as HTMLInputElement | null;
  if (folderInput) {
    folderInput.value = state.naming.folderName ?? "";
    folderInput.oninput = (ev) => {
      state.naming.folderName = (ev.target as HTMLInputElement).value;
      void saveSettings();
    };
  }

  document.querySelectorAll(".format-badge").forEach((badge) => {
    badge.addEventListener("click", (ev) => {
      const val = (ev.currentTarget as HTMLElement).dataset
        .value as DesiredFormat;
      state.format = val;
      void saveSettings();
      render();
    });
  });

  document.querySelector("#viewLogs")?.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    state.showLogs = true;
    state.settingsOpen = false;
    render();
    const result = await chrome.runtime.sendMessage({ type: "GET_LOGS" });
    const logList = document.querySelector("#log-list");
    if (logList) {
      logList.innerHTML = result.logs.length
        ? result.logs
            .map(
              (l: string) =>
                `<div style="padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-family: monospace; font-size: 10px;">${l}</div>`,
            )
            .reverse()
            .join("")
        : "No logs found.";
    }
  });

  document.querySelector("#closeLogsBtn")?.addEventListener("click", () => {
    state.showLogs = false;
    render();
  });

  document
    .querySelector("#clearLogsBtn")
    ?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "CLEAR_LOGS" });
      const logList = document.querySelector("#log-list");
      if (logList) logList.innerHTML = "Logs cleared.";
    });
}

function guessMimeFromUrl(url: string): string {
  const cleaned = url.split(/[?#]/)[0].toLowerCase();
  if (cleaned.endsWith(".png")) return "image/png";
  if (cleaned.endsWith(".webp")) return "image/webp";
  if (cleaned.endsWith(".avif")) return "image/avif";
  if (cleaned.endsWith(".jpg") || cleaned.endsWith(".jpeg"))
    return "image/jpeg";
  return "image/jpeg";
}

async function ensurePreview(item: ExtractedImage): Promise<void> {
  if (item.previewUrl?.startsWith("blob:")) return;
  if (previewRequests.has(item.id)) return;
  if (item.url.startsWith("data:")) return;
  previewRequests.add(item.id);
  try {
    await addLog(`Preview fallback: fetching bytes for ${item.url}`);
    const fetched = await chrome.runtime.sendMessage({
      type: "FETCH_BYTES",
      url: item.url,
    });
    if (!fetched?.ok || !fetched.bytes) {
      await addLog(
        `Preview fallback failed for ${item.url}: ${fetched?.error || "no bytes"}`,
      );
      return;
    }
    const bytes = new Uint8Array(fetched.bytes);
    const mime = guessMimeFromUrl(item.url);
    const blob = new Blob([bytes], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    if (item.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(item.previewUrl);
    }
    item.previewUrl = blobUrl;
    await addLog(`Preview fallback ok for ${item.url} (bytes: ${bytes.length})`);
    render();
  } finally {
    previewRequests.delete(item.id);
  }
}

function wirePreviewFallbacks(): void {
  const main = document.querySelector(".main-content");
  if (!main) return;
  main.querySelectorAll<HTMLImageElement>(".card img").forEach((img) => {
    if (img.dataset.previewBound === "1") return;
    img.dataset.previewBound = "1";
    const handleError = () => {
      const card = img.closest(".card") as HTMLElement | null;
      const id = card?.dataset.id;
      if (!id) return;
      const item = state.items.find((i) => i.id === id);
      if (!item) return;
      if (!previewLogged.has(item.id)) {
        previewLogged.add(item.id);
        void addLog(`Preview error: ${item.url}`);
      }
      void ensurePreview(item);
    };
    img.addEventListener("error", handleError);
    if (img.complete && img.naturalWidth === 0) {
      handleError();
    }
  });
}

async function convertBytes(
  id: string,
  bytes: ArrayBuffer,
): Promise<ArrayBuffer> {
  if (state.format === "original") return bytes;
  const result = await new Promise<{
    ok: boolean;
    bytes?: ArrayBuffer;
    error?: string;
  }>((resolve) => {
    pendingConversions.set(id, resolve);
    converter.postMessage({ id, bytes, targetType: state.format }, [bytes]);
  });
  if (!result.ok || !result.bytes)
    throw new Error(result.error || "conversion failed");
  return result.bytes;
}

function resolveTargetExt(item: ExtractedImage): string {
  if (state.format !== "original") return extFromMime(state.format);
  if (item.isDataUrl) {
    const mimeMatch = item.url.match(/^data:(image\/(.*?));/);
    const ext = mimeMatch?.[2]?.split("+")[0] || "img";
    return (
      ext
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 5) || "img"
    );
  }
  const urlBase = item.url.split(/[?#]/)[0];
  const parts = urlBase.split(".");
  let ext = parts.length > 1 ? parts.pop() || "img" : "img";
  ext = ext
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 5);
  return ext || "img";
}

async function startDownload(): Promise<void> {
  if (state.processing || state.searching) return;
  const selected = currentSelection();
  if (!selected.length) return;
  state.status = "Preparing downloads...";
  state.statusLevel = "info";
  render();

  const nameCache: Record<string, string[]> = {};
  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i];
    const targetExt = resolveTargetExt(item);
    if (!nameCache[targetExt]) {
      nameCache[targetExt] = buildFilenames(
        selected.length,
        state.naming,
        targetExt,
      );
    }
    let filename = nameCache[targetExt][i];
    if (state.naming.folderName?.trim()) {
      const folder = state.naming.folderName
        .trim()
        .replace(/[\\/]+$/, "")
        .replace(/[<>:"|?*]/g, "_");
      filename = `${folder}/${filename}`
        .replace(/\\/g, "/")
        .replace(/^\/+/, "");
    }

    state.status = `Downloading ${i + 1}/${selected.length}`;
    state.statusLevel = "info";
    render();

    try {
      const downloadOptions: chrome.downloads.DownloadOptions = {
        url: "",
        filename,
        saveAs: false,
        conflictAction: "uniquify",
      };

      if (state.format === "original" && !item.isDataUrl) {
        downloadOptions.url = item.url;
        await registerDownload(item.url, filename);
        await chrome.downloads.download(downloadOptions);
      } else {
        const fetched = await chrome.runtime.sendMessage({
          type: "FETCH_BYTES",
          url: item.url,
        });
        if (!fetched.ok) throw new Error(fetched.error);
        let bytes = new Uint8Array(fetched.bytes).buffer;
        if (state.format !== "original") {
          bytes = await convertBytes(item.id, bytes);
        }

        const mimeMap: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          gif: "image/gif",
          svg: "image/svg+xml",
        };
        const blobMime =
          state.format === "original"
            ? mimeMap[targetExt] || "image/png"
            : state.format;
        const blob = new Blob([bytes], { type: blobMime });
        const blobUrl = URL.createObjectURL(blob);
        downloadOptions.url = blobUrl;
        await registerDownload(blobUrl, filename);

        try {
          await chrome.downloads.download(downloadOptions);
        } finally {
          setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
        }
      }
    } catch (err) {
      console.error("Download iteration failed:", err);
    }
  }

  state.status = "All downloads started";
  state.statusLevel = "info";
  render();
  setTimeout(() => {
    if (
      !state.searching &&
      !state.processing &&
      state.status === "All downloads started"
    ) {
      state.status = "Ready";
      render();
    }
  }, 2000);
}

async function hydrateItem(
  item: ExtractedImage,
  index: number,
  total: number,
): Promise<void> {
  state.status = `Processing ${index + 1}/${total}`;
  state.progress = Math.round(((index + 1) / total) * 100);
  render();

  try {
    const sizeResult = await chrome.runtime.sendMessage({
      type: "FETCH_SIZE",
      url: item.url,
    });
    if (sizeResult?.bytes) item.bytes = sizeResult.bytes;

    if (!item.width || !item.height) {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          item.width = img.width;
          item.height = img.height;
          resolve(null);
        };
        img.onerror = () => resolve(null);
        img.src = item.url;
      });
    }

    if (item.width && item.height) {
      item.estimatedBytes = estimateBytes(item.width, item.height);
    }
  } catch (e) {
    console.warn("Metadata fetch error", e);
  }
}

async function processNewItemsBatch(items: ExtractedImage[]): Promise<void> {
  if (!items.length) return;
  state.processing = true;
  state.progress = 0;
  state.status = `Processing ${items.length} images...`;
  state.statusLevel = "info";
  render();

  for (let i = 0; i < items.length; i++) {
    await hydrateItem(items[i], i, items.length);
  }

  const filtered = state.smartFilter
    ? applySmartFilter(items)
    : { items, removed: 0 };
  const deduped = await dedupeIncomingItems(filtered.items);
  const kept = deduped.items;
  const removedDupes = deduped.removed;
  const removedJunk = filtered.removed;
  if (!kept.length) {
    state.processing = false;
    state.progress = 0;
    state.status =
      removedDupes || removedJunk
        ? buildRemovalSummary(removedDupes, removedJunk)
        : "No new images found";
    state.statusLevel = "info";
    render();
    setTimeout(() => {
      if (
        !state.searching &&
        !state.processing &&
        state.status ===
          (removedDupes || removedJunk
            ? buildRemovalSummary(removedDupes, removedJunk)
            : "No new images found")
      ) {
        state.status = "Ready";
        render();
      }
    }, 2000);
    return;
  }

  state.items.push(...kept);
  state.items.sort(compareByPagePosition);
  // By default, do not pre-select newly added images.

  state.processing = false;
  state.progress = 0;
  if (removedDupes || removedJunk) {
    state.status = `Added ${kept.length} images (${buildRemovalSummary(
      removedDupes,
      removedJunk,
    ).toLowerCase()})`;
  } else {
    state.status = `Added ${kept.length} images`;
  }
  state.statusLevel = "info";
  render();
  setTimeout(() => {
    if (
      !state.searching &&
      !state.processing &&
      state.status.startsWith("Added")
    ) {
      state.status = "Ready";
      render();
    }
  }, 2000);
}

async function enqueueNewItems(items: ExtractedImage[]) {
  if (state.processing) {
    pendingBatches.push(items);
    return;
  }
  await processNewItemsBatch(items);
  while (pendingBatches.length) {
    const next = pendingBatches.shift();
    if (next) await processNewItemsBatch(next);
  }
}

function normalizeIncomingImages(
  rawImages: ExtractedImage[],
): ExtractedImage[] {
  const existingUrls = new Set(state.items.map((i) => i.url));
  const newItems: ExtractedImage[] = [];
  const seenInBatch = new Set<string>();

  for (const img of rawImages) {
    if (!img?.url) continue;
    if (existingUrls.has(img.url) || seenInBatch.has(img.url)) continue;
    newItems.push({
      ...img,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    });
    seenInBatch.add(img.url);
  }

  return newItems;
}

function flashStatus(
  message: string,
  level: "info" | "warn" | "error",
  timeoutMs = 2000,
): void {
  state.status = message;
  state.statusLevel = level;
  render();
  window.setTimeout(() => {
    if (!state.searching && !state.processing && state.status === message) {
      state.status = "Ready";
      state.statusLevel = "info";
      render();
    }
  }, timeoutMs);
}

function signatureForItem(item: ExtractedImage): string | null {
  if (!item.width || !item.height || !item.bytes) return null;
  return `${item.width}x${item.height}-${item.bytes}`;
}

const SMART_ICON_MAX = 256;
const SMART_MIN_SIDE = 64;
const SMART_MIN_AREA = 64 * 64;
const SMART_TINY_BYTES = 2048;
const SMART_MAX_SIDE_FOR_TINY_BYTES = 256;

function isSmartJunk(item: ExtractedImage): boolean {
  const w = item.width ?? 0;
  const h = item.height ?? 0;
  if (!w || !h) return true;
  const minSide = Math.min(w, h);
  const maxSide = Math.max(w, h);
  const area = w * h;
  const sizeBytes = item.bytes ?? item.estimatedBytes;
  if (!sizeBytes || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return true;

  if (maxSide <= SMART_ICON_MAX) return true;
  if (area < SMART_MIN_AREA) return true;
  if (minSide < SMART_MIN_SIDE && maxSide < SMART_MIN_SIDE * 2) return true;
  if (
    item.bytes &&
    item.bytes < SMART_TINY_BYTES &&
    maxSide < SMART_MAX_SIDE_FOR_TINY_BYTES
  ) {
    return true;
  }
  return false;
}

function applySmartFilter(items: ExtractedImage[]): {
  items: ExtractedImage[];
  removed: number;
} {
  const kept: ExtractedImage[] = [];
  let removed = 0;
  for (const item of items) {
    if (isSmartJunk(item)) removed += 1;
    else kept.push(item);
  }
  return { items: kept, removed };
}

function buildRemovalSummary(dupes: number, junk: number): string {
  if (dupes && junk) return `Removed ${dupes} duplicates, ${junk} junk`;
  if (dupes) return `Removed ${dupes} duplicates`;
  if (junk) return `Filtered ${junk} junk`;
  return "No new images found";
}

function bytesFromDataUrl(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const meta = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    try {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch {
      return null;
    }
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(data));
  } catch {
    return null;
  }
}

async function hashBytes(bytes: Uint8Array): Promise<string | null> {
  if (!crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-1", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

async function ensureItemHash(item: ExtractedImage): Promise<string | null> {
  if (item.hash) return item.hash;
  let bytes: Uint8Array | null = null;
  if (item.url.startsWith("data:")) {
    bytes = bytesFromDataUrl(item.url);
  }
  if (!bytes) {
    try {
      const fetched = await chrome.runtime.sendMessage({
        type: "FETCH_BYTES",
        url: item.url,
      });
      if (fetched?.ok && fetched.bytes) {
        bytes = new Uint8Array(fetched.bytes);
      }
    } catch {
      bytes = null;
    }
  }
  if (!bytes) return null;
  const digest = await hashBytes(bytes);
  if (digest) item.hash = digest;
  return digest;
}

async function isDuplicateItem(
  existing: ExtractedImage,
  incoming: ExtractedImage,
): Promise<boolean> {
  const hashExisting = await ensureItemHash(existing);
  const hashIncoming = await ensureItemHash(incoming);
  if (hashExisting && hashIncoming) return hashExisting === hashIncoming;
  return false;
}

async function dedupeIncomingItems(
  items: ExtractedImage[],
): Promise<{ items: ExtractedImage[]; removed: number }> {
  const signatureMap = new Map<string, ExtractedImage[]>();
  for (const item of state.items) {
    const sig = signatureForItem(item);
    if (!sig) continue;
    if (!signatureMap.has(sig)) signatureMap.set(sig, []);
    signatureMap.get(sig)!.push(item);
  }

  const kept: ExtractedImage[] = [];
  let removed = 0;

  for (const item of items) {
    const sig = signatureForItem(item);
    if (!sig) {
      kept.push(item);
      continue;
    }

    const existingList = signatureMap.get(sig);
    if (!existingList) {
      signatureMap.set(sig, [item]);
      kept.push(item);
      continue;
    }

    let duplicate = false;
    for (const existing of existingList) {
      if (await isDuplicateItem(existing, item)) {
        duplicate = true;
        break;
      }
    }

    if (duplicate) {
      removed += 1;
      continue;
    }

    existingList.push(item);
    kept.push(item);
  }

  return { items: kept, removed };
}

async function locateImageOnPage(item: ExtractedImage): Promise<void> {
  state.status = "Locating image on page...";
  state.statusLevel = "info";
  render();
  try {
    const result = await chrome.runtime.sendMessage({
      type: "LOCATE_IMAGE_ON_PAGE",
      url: item.url,
      pageX: item.pageX,
      pageY: item.pageY,
    });
    if (!result?.ok) {
      flashStatus(
        result?.error || "Image not found on page",
        result?.level || "warn",
        2500,
      );
      return;
    }
    flashStatus("Located on page", "info", 1200);
  } catch (error) {
    flashStatus(
      (error as Error).message || "Failed to locate image",
      "error",
      2500,
    );
  }
}

function compareByPagePosition(a: ExtractedImage, b: ExtractedImage): number {
  const ay = a.pageY ?? Number.POSITIVE_INFINITY;
  const by = b.pageY ?? Number.POSITIVE_INFINITY;
  if (ay !== by) return ay - by;
  const ax = a.pageX ?? Number.POSITIVE_INFINITY;
  const bx = b.pageX ?? Number.POSITIVE_INFINITY;
  if (ax !== bx) return ax - bx;
  return 0;
}

function collectExistingMatchIds(rawImages: ExtractedImage[]): string[] {
  const urlToId = new Map(state.items.map((item) => [item.url, item.id]));
  const matches: string[] = [];
  for (const img of rawImages) {
    const id = urlToId.get(img.url);
    if (id) matches.push(id);
  }
  return matches;
}

function flashHighlightIds(ids: string[]): void {
  if (!ids.length) return;

  ids.forEach((id) => state.highlighted.add(id));
  render();

  const firstId = ids[0];
  const target = document.querySelector<HTMLElement>(
    `.card[data-id="${CSS.escape(firstId)}"]`,
  );
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });

  window.setTimeout(() => {
    ids.forEach((id) => state.highlighted.delete(id));
    render();
  }, 1500);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "WAIT_FOR_IMAGES") {
    beginSearch("Searching for images...");
  }
  if (message.type === "SELECTION_CANCELLED") {
    endSearch();
    state.status = "Selection cancelled";
    state.statusLevel = "info";
    render();
    setTimeout(() => {
      if (
        !state.searching &&
        !state.processing &&
        state.status === "Selection cancelled"
      ) {
        state.status = "Ready";
        render();
      }
    }, 1500);
  }
  if (
    message.type === "SELECTION_LOCKED" ||
    message.type === "PAGE_IMAGES_FOUND"
  ) {
    endSearch();
    const error = message.error as string | undefined;
    const rawImages = (message.images || []) as ExtractedImage[];
    const existingMatchIds =
      message.type === "SELECTION_LOCKED"
        ? collectExistingMatchIds(rawImages)
        : [];
    const newItems = normalizeIncomingImages(rawImages);

    if (!newItems.length) {
      state.status = error || "No new images found";
      state.statusLevel = error ? "warn" : "info";
      render();
      if (existingMatchIds.length) {
        flashHighlightIds(existingMatchIds);
      }
      setTimeout(() => {
        if (
          !state.searching &&
          !state.processing &&
          state.status === (error || "No new images found")
        ) {
          state.status = "Ready";
          render();
        }
      }, 2000);
      return;
    }

    void (async () => {
      await enqueueNewItems(newItems);
      if (existingMatchIds.length) flashHighlightIds(existingMatchIds);
    })();
  }
});

void loadSettings().then(() => {
  render();
  void syncExtractOptionsToTab();
});
