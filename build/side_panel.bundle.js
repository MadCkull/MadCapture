"use strict";
(() => {
  // src/sidepanel/ui/ImageCard.ts
  function renderImageCard(item, selected, highlighted) {
    const sizeText = item.bytes ? `${(item.bytes / 1024).toFixed(1)} KB` : "...";
    const dimText = item.width && item.height ? `${item.width}\xD7${item.height}` : "...";
    return `
    <div class="card ${selected ? "selected" : ""} ${highlighted ? "highlighted" : ""}" data-id="${item.id}">
      <div class="card-image-wrapper">
        <span class="selection-index"></span>
        <img src="${item.previewUrl || item.url}" alt="${item.filenameHint || "image"}" loading="lazy" />
      </div>
      <div class="meta">
        <span class="dimensions">${dimText}</span>
        <span class="size">${sizeText}</span>
      </div>
    </div>`;
  }

  // src/sidepanel/ui/ImageGrid.ts
  function renderImageGrid(items, selected, highlighted) {
    return `<div class="grid">${items.map((item) => renderImageCard(item, selected.has(item.id), highlighted.has(item.id))).join("")}</div>`;
  }

  // src/sidepanel/ui/SettingsPanel.ts
  function renderSettingsPanel(options, format) {
    return `
    <div class="settings-panel">
      <div class="input-row">
        <div class="input-group">
          <label for="baseName">Filename</label>
          <input type="text" id="baseName" value="${options.baseName}" placeholder="Pic" />
          <div class="field-hint">Example: Name (1), Name (2), Name (3)</div>
        </div>
        <div class="input-group">
          <label for="zeroPad">0 Padding</label>
          <input type="number" id="zeroPad" value="${options.zeroPad ?? 0}" min="0" max="5" />
        </div>
      </div>
      <div class="input-group">
        <label for="folderName">Folder Name</label>
        <input type="text" id="folderName" value="${options.folderName ?? ""}" placeholder="Captures" />
      </div>
      <div class="input-group">
        <label>Export Format</label>
        <div class="format-badges" id="formatBadges">
          <div class="format-badge ${format === "original" ? "active" : ""}" data-value="original">Original</div>
          <div class="format-badge ${format === "image/png" ? "active" : ""}" data-value="image/png">PNG</div>
          <div class="format-badge ${format === "image/jpeg" ? "active" : ""}" data-value="image/jpeg">JPEG</div>
          <div class="format-badge ${format === "image/webp" ? "active" : ""}" data-value="image/webp">WEBP</div>
        </div>
      </div>
    </div>`;
  }

  // src/utils/sizeCalc.ts
  function estimateBytes(width, height) {
    if (!width || !height) return 0;
    return width * height * 3;
  }

  // src/utils/naming.ts
  function safeName(input) {
    return input.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  }
  function buildFilenames(count, options, ext) {
    const base = safeName(options.baseName?.trim() || "Pic");
    const pad = Math.max(0, Math.min(5, options.zeroPad ?? 0));
    return new Array(count).fill(0).map((_, i) => {
      const indexText = pad > 0 ? String(i + 1).padStart(pad, "0") : String(i + 1);
      return `${base} (${indexText}).${ext}`;
    });
  }

  // src/utils/url.ts
  function extFromMime(type) {
    if (type === "image/jpeg") return "jpg";
    if (type === "image/png") return "png";
    if (type === "image/webp") return "webp";
    return "bin";
  }

  // src/sidepanel/panel.ts
  var defaultNaming = {
    baseName: "Pic",
    zeroPad: 0,
    folderName: ""
  };
  var state = {
    items: [],
    selected: /* @__PURE__ */ new Set(),
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
    highlighted: /* @__PURE__ */ new Set(),
    filterSelected: false,
    filterSnapshot: /* @__PURE__ */ new Set()
  };
  var searchToken = 0;
  var searchTimeoutId;
  var pendingBatches = [];
  var converter = new Worker(
    chrome.runtime.getURL("workers/converter.worker.js")
  );
  var pendingConversions = /* @__PURE__ */ new Map();
  converter.onmessage = (ev) => {
    pendingConversions.get(ev.data.id)?.(ev.data);
    pendingConversions.delete(ev.data.id);
  };
  function currentSelection() {
    const map = new Map(state.items.map((i) => [i.id, i]));
    return state.selectionOrder.map((id) => map.get(id)).filter(Boolean);
  }
  function beginSearch(label) {
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
          if (!state.searching && !state.processing && state.status === "Search timed out") {
            state.status = "Ready";
            render();
          }
        }, 2e3);
      }
    }, 2e4);
    render();
  }
  function endSearch() {
    state.searching = false;
    if (searchTimeoutId) window.clearTimeout(searchTimeoutId);
  }
  async function loadSettings() {
    const data = await chrome.storage.local.get(["naming", "format"]);
    if (data.naming) {
      if ("baseName" in data.naming) {
        state.naming = { ...defaultNaming, ...data.naming };
        if (typeof data.naming.zeroPad !== "number") state.naming.zeroPad = 0;
      } else if ("template" in data.naming && typeof data.naming.template === "string") {
        const template = data.naming.template;
        const base = template.split("(")[0]?.trim() || "Pic";
        state.naming = { ...defaultNaming, baseName: base };
      } else if ("prefix" in data.naming) {
        const prefix = typeof data.naming.prefix === "string" ? data.naming.prefix : "Pic";
        state.naming = { ...defaultNaming, baseName: prefix };
      }
      if (typeof data.naming.folderName === "string")
        state.naming.folderName = data.naming.folderName;
    }
    if (data.format) state.format = data.format;
  }
  async function saveSettings() {
    await chrome.storage.local.set({
      naming: state.naming,
      format: state.format
    });
  }
  async function registerDownload(url, filename) {
    await chrome.runtime.sendMessage({ type: "REGISTER_NAME", url, filename });
  }
  function render() {
    const app = document.querySelector("#app");
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
    const toolbar = app.querySelector(".toolbar");
    const main = app.querySelector(".main-content");
    const footer = app.querySelector(".footer");
    const settings = app.querySelector("#settings-container");
    const fab = app.querySelector("#fab-container");
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
      const text = state.searching ? state.status || "Searching for images..." : state.status;
      mainHtml = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>${text}</p>
        ${showProgress ? `
          <div class="progress-bar-container" style="width: 200px; margin-top: 12px; height: 4px; background: var(--panel-border); border-radius: 2px; overflow: hidden;">
            <div class="progress-fill" style="width: ${state.progress}%; height: 100%; background: var(--accent); transition: width 0.3s ease;"></div>
          </div>
        ` : ""}
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
      const orderMap = /* @__PURE__ */ new Map();
      state.selectionOrder.forEach((id, idx) => orderMap.set(id, idx + 1));
      main.querySelectorAll(".card").forEach((card) => {
        const id = card.dataset.id;
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
          const dimSpan = card.querySelector(".dimensions");
          if (dimSpan)
            dimSpan.textContent = item.width && item.height ? `${item.width}\xD7${item.height}` : "...";
          const sizeSpan = card.querySelector(".size");
          if (sizeSpan)
            sizeSpan.textContent = item.bytes ? `${(item.bytes / 1024).toFixed(1)} KB` : "...";
          const indexBadge = card.querySelector(".selection-index");
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
    if (!isGrid || !wasGrid || main.dataset.itemCount !== state.items.length.toString()) {
      main.innerHTML = mainHtml;
      main.dataset.itemCount = isGrid ? state.items.length.toString() : "0";
      if (isGrid) syncGridState();
    } else if (isGrid) {
      syncGridState();
    }
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
    settings.innerHTML = state.settingsOpen ? renderSettingsPanel(state.naming, state.format) : "";
    fab.innerHTML = `
    <button class="secondary icon-btn settings-fab" id="settingsToggle" title="Settings">
      <i class="fa-solid fa-gear"></i>
    </button>
  `;
    wireDynamicEvents();
  }
  function wireStaticEvents() {
    const main = document.querySelector(".main-content");
    let clickTimer;
    let pendingClickId = null;
    main.addEventListener("click", (e) => {
      if (e.detail > 1) return;
      const card = e.target.closest(".card");
      if (!card) return;
      const id = card.dataset.id;
      if (!id) return;
      if (clickTimer) window.clearTimeout(clickTimer);
      pendingClickId = id;
      clickTimer = window.setTimeout(() => {
        if (!pendingClickId) return;
        if (state.selected.has(pendingClickId)) {
          state.selected.delete(pendingClickId);
          state.selectionOrder = state.selectionOrder.filter(
            (x) => x !== pendingClickId
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
      const card = e.target.closest(
        ".card"
      );
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
          void chrome.runtime.sendMessage({ type: "TOGGLE_SELECTOR_FOR_TAB" });
        }
        if (ev.key === "Escape" && !state.settingsOpen && !state.showLogs)
          void chrome.runtime.sendMessage({ type: "TOGGLE_SELECTOR_FOR_TAB" });
        if (ev.key === "Escape" && (state.settingsOpen || state.showLogs)) {
          state.settingsOpen = false;
          state.showLogs = false;
          render();
        }
        if (ev.key === "Enter" && !state.searching && !state.processing)
          void startDownload();
      },
      true
    );
    document.addEventListener("click", (ev) => {
      const target = ev.target;
      const settingsPanel = document.querySelector(".settings-panel");
      const logPanel = document.querySelector(".log-viewer");
      const settingsToggle = document.querySelector("#settingsToggle");
      const viewLogsBtn = document.querySelector("#viewLogs");
      if (state.settingsOpen && settingsPanel && !settingsPanel.contains(target) && !settingsToggle?.contains(target)) {
        state.settingsOpen = false;
        render();
      }
      if (state.showLogs && logPanel && !logPanel.contains(target) && !viewLogsBtn?.contains(target)) {
        state.showLogs = false;
        render();
      }
    });
  }
  function wireDynamicEvents() {
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
      beginSearch("Searching for images...");
      try {
        const result = await chrome.runtime.sendMessage({
          type: "SCAN_PAGE_IMAGES"
        });
        if (!result?.ok) {
          endSearch();
          state.status = result?.error || "Scan failed";
          state.statusLevel = "warn";
          render();
          setTimeout(() => {
            if (!state.searching && !state.processing && state.status === (result?.error || "Scan failed")) {
              state.status = "Ready";
              render();
            }
          }, 2e3);
        }
      } catch (err) {
        endSearch();
        state.status = err.message || "Scan failed";
        state.statusLevel = "error";
        render();
        setTimeout(() => {
          if (!state.searching && !state.processing && state.status === (err.message || "Scan failed")) {
            state.status = "Ready";
            render();
          }
        }, 2e3);
      }
    });
    document.querySelector("#toggleSelector")?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "TOGGLE_SELECTOR_FOR_TAB" });
    });
    document.querySelector("#settingsToggle")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      state.settingsOpen = !state.settingsOpen;
      state.showLogs = false;
      render();
    });
    document.querySelector("#downloadTask")?.addEventListener("click", () => void startDownload());
    document.querySelector("#toggleSelectedFilter")?.addEventListener("click", () => {
      state.filterSelected = !state.filterSelected;
      if (state.filterSelected) {
        state.filterSnapshot = new Set(state.selectionOrder);
      } else {
        state.filterSnapshot.clear();
      }
      render();
    });
    const baseNameInput = document.querySelector(
      "#baseName"
    );
    if (baseNameInput) {
      baseNameInput.value = state.naming.baseName;
      baseNameInput.oninput = (ev) => {
        state.naming.baseName = ev.target.value;
        void saveSettings();
      };
    }
    const zeroPadInput = document.querySelector(
      "#zeroPad"
    );
    if (zeroPadInput) {
      zeroPadInput.value = String(state.naming.zeroPad ?? 0);
      zeroPadInput.oninput = (ev) => {
        const raw = Number(ev.target.value);
        state.naming.zeroPad = Math.max(
          0,
          Math.min(5, Number.isFinite(raw) ? raw : 0)
        );
        void saveSettings();
      };
    }
    const folderInput = document.querySelector(
      "#folderName"
    );
    if (folderInput) {
      folderInput.value = state.naming.folderName ?? "";
      folderInput.oninput = (ev) => {
        state.naming.folderName = ev.target.value;
        void saveSettings();
      };
    }
    document.querySelectorAll(".format-badge").forEach((badge) => {
      badge.addEventListener("click", (ev) => {
        const val = ev.currentTarget.dataset.value;
        state.format = val;
        void saveSettings();
        render();
      });
    });
    document.querySelector("#viewLogs")?.addEventListener("click", async () => {
      state.showLogs = true;
      state.settingsOpen = false;
      render();
      const result = await chrome.runtime.sendMessage({ type: "GET_LOGS" });
      const logList = document.querySelector("#log-list");
      if (logList) {
        logList.innerHTML = result.logs.length ? result.logs.map(
          (l) => `<div style="padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-family: monospace; font-size: 10px;">${l}</div>`
        ).reverse().join("") : "No logs found.";
      }
    });
    document.querySelector("#closeLogsBtn")?.addEventListener("click", () => {
      state.showLogs = false;
      render();
    });
    document.querySelector("#clearLogsBtn")?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "CLEAR_LOGS" });
      const logList = document.querySelector("#log-list");
      if (logList) logList.innerHTML = "Logs cleared.";
    });
  }
  async function convertBytes(id, bytes) {
    if (state.format === "original") return bytes;
    const result = await new Promise((resolve) => {
      pendingConversions.set(id, resolve);
      converter.postMessage({ id, bytes, targetType: state.format }, [bytes]);
    });
    if (!result.ok || !result.bytes)
      throw new Error(result.error || "conversion failed");
    return result.bytes;
  }
  function resolveTargetExt(item) {
    if (state.format !== "original") return extFromMime(state.format);
    if (item.isDataUrl) {
      const mimeMatch = item.url.match(/^data:(image\/(.*?));/);
      const ext2 = mimeMatch?.[2]?.split("+")[0] || "img";
      return ext2.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "img";
    }
    const urlBase = item.url.split(/[?#]/)[0];
    const parts = urlBase.split(".");
    let ext = parts.length > 1 ? parts.pop() || "img" : "img";
    ext = ext.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
    return ext || "img";
  }
  async function startDownload() {
    if (state.processing || state.searching) return;
    const selected = currentSelection();
    if (!selected.length) return;
    state.status = "Preparing downloads...";
    state.statusLevel = "info";
    render();
    const nameCache = {};
    for (let i = 0; i < selected.length; i += 1) {
      const item = selected[i];
      const targetExt = resolveTargetExt(item);
      if (!nameCache[targetExt]) {
        nameCache[targetExt] = buildFilenames(
          selected.length,
          state.naming,
          targetExt
        );
      }
      let filename = nameCache[targetExt][i];
      if (state.naming.folderName?.trim()) {
        const folder = state.naming.folderName.trim().replace(/[\\/]+$/, "").replace(/[<>:"|?*]/g, "_");
        filename = `${folder}/${filename}`.replace(/\\/g, "/").replace(/^\/+/, "");
      }
      state.status = `Downloading ${i + 1}/${selected.length}`;
      state.statusLevel = "info";
      render();
      try {
        const downloadOptions = {
          url: "",
          filename,
          saveAs: false,
          conflictAction: "uniquify"
        };
        if (state.format === "original" && !item.isDataUrl) {
          downloadOptions.url = item.url;
          await registerDownload(item.url, filename);
          await chrome.downloads.download(downloadOptions);
        } else {
          const fetched = await chrome.runtime.sendMessage({
            type: "FETCH_BYTES",
            url: item.url
          });
          if (!fetched.ok) throw new Error(fetched.error);
          let bytes = new Uint8Array(fetched.bytes).buffer;
          if (state.format !== "original") {
            bytes = await convertBytes(item.id, bytes);
          }
          const mimeMap = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            webp: "image/webp",
            gif: "image/gif",
            svg: "image/svg+xml"
          };
          const blobMime = state.format === "original" ? mimeMap[targetExt] || "image/png" : state.format;
          const blob = new Blob([bytes], { type: blobMime });
          const blobUrl = URL.createObjectURL(blob);
          downloadOptions.url = blobUrl;
          await registerDownload(blobUrl, filename);
          try {
            await chrome.downloads.download(downloadOptions);
          } finally {
            setTimeout(() => URL.revokeObjectURL(blobUrl), 15e3);
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
      if (!state.searching && !state.processing && state.status === "All downloads started") {
        state.status = "Ready";
        render();
      }
    }, 2e3);
  }
  async function hydrateItem(item, index, total) {
    state.status = `Processing ${index + 1}/${total}`;
    state.progress = Math.round((index + 1) / total * 100);
    render();
    try {
      const sizeResult = await chrome.runtime.sendMessage({
        type: "FETCH_SIZE",
        url: item.url
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
  async function processNewItemsBatch(items) {
    if (!items.length) return;
    state.processing = true;
    state.progress = 0;
    state.status = `Processing ${items.length} images...`;
    state.statusLevel = "info";
    render();
    for (let i = 0; i < items.length; i++) {
      await hydrateItem(items[i], i, items.length);
    }
    state.items.push(...items);
    state.items.sort(compareByPagePosition);
    state.processing = false;
    state.progress = 0;
    state.status = `Added ${items.length} images`;
    state.statusLevel = "info";
    render();
    setTimeout(() => {
      if (!state.searching && !state.processing && state.status.startsWith("Added")) {
        state.status = "Ready";
        render();
      }
    }, 2e3);
  }
  async function enqueueNewItems(items) {
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
  function normalizeIncomingImages(rawImages) {
    const existingUrls = new Set(state.items.map((i) => i.url));
    const newItems = [];
    const seenInBatch = /* @__PURE__ */ new Set();
    for (const img of rawImages) {
      if (!img?.url) continue;
      if (existingUrls.has(img.url) || seenInBatch.has(img.url)) continue;
      newItems.push({
        ...img,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      });
      seenInBatch.add(img.url);
    }
    return newItems;
  }
  function flashStatus(message, level, timeoutMs = 2e3) {
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
  async function locateImageOnPage(item) {
    state.status = "Locating image on page...";
    state.statusLevel = "info";
    render();
    try {
      const result = await chrome.runtime.sendMessage({
        type: "LOCATE_IMAGE_ON_PAGE",
        url: item.url,
        pageX: item.pageX,
        pageY: item.pageY
      });
      if (!result?.ok) {
        flashStatus(
          result?.error || "Image not found on page",
          result?.level || "warn",
          2500
        );
        return;
      }
      flashStatus("Located on page", "info", 1200);
    } catch (error) {
      flashStatus(
        error.message || "Failed to locate image",
        "error",
        2500
      );
    }
  }
  function compareByPagePosition(a, b) {
    const ay = a.pageY ?? Number.POSITIVE_INFINITY;
    const by = b.pageY ?? Number.POSITIVE_INFINITY;
    if (ay !== by) return ay - by;
    const ax = a.pageX ?? Number.POSITIVE_INFINITY;
    const bx = b.pageX ?? Number.POSITIVE_INFINITY;
    if (ax !== bx) return ax - bx;
    return 0;
  }
  function collectExistingMatchIds(rawImages) {
    const urlToId = new Map(state.items.map((item) => [item.url, item.id]));
    const matches = [];
    for (const img of rawImages) {
      const id = urlToId.get(img.url);
      if (id) matches.push(id);
    }
    return matches;
  }
  function flashHighlightIds(ids) {
    if (!ids.length) return;
    ids.forEach((id) => state.highlighted.add(id));
    render();
    const firstId = ids[0];
    const target = document.querySelector(
      `.card[data-id="${CSS.escape(firstId)}"]`
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
        if (!state.searching && !state.processing && state.status === "Selection cancelled") {
          state.status = "Ready";
          render();
        }
      }, 1500);
    }
    if (message.type === "SELECTION_LOCKED" || message.type === "PAGE_IMAGES_FOUND") {
      endSearch();
      const error = message.error;
      const rawImages = message.images || [];
      const existingMatchIds = message.type === "SELECTION_LOCKED" ? collectExistingMatchIds(rawImages) : [];
      const newItems = normalizeIncomingImages(rawImages);
      if (!newItems.length) {
        state.status = error || "No new images found";
        state.statusLevel = error ? "warn" : "info";
        render();
        if (existingMatchIds.length) {
          flashHighlightIds(existingMatchIds);
        }
        setTimeout(() => {
          if (!state.searching && !state.processing && state.status === (error || "No new images found")) {
            state.status = "Ready";
            render();
          }
        }, 2e3);
        return;
      }
      void (async () => {
        await enqueueNewItems(newItems);
        if (existingMatchIds.length) flashHighlightIds(existingMatchIds);
      })();
    }
  });
  void loadSettings().then(() => render());
})();
