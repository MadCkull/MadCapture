"use strict";
(() => {
  // src/sidepanel/ui/ImageCard.ts
  function renderImageCard(item, selected) {
    const sizeText = item.bytes ? `${(item.bytes / 1024).toFixed(1)} KB` : "...";
    const dimText = item.width && item.height ? `${item.width}\xD7${item.height}` : "...";
    return `
    <div class="card ${selected ? "selected" : ""}" data-id="${item.id}">
      <div class="card-image-wrapper">
        <img src="${item.previewUrl || item.url}" alt="${item.filenameHint || "image"}" loading="lazy" />
      </div>
      <div class="meta">
        <span class="dimensions">${dimText}</span>
        <span class="size">${sizeText}</span>
      </div>
    </div>`;
  }

  // src/sidepanel/ui/ImageGrid.ts
  function renderImageGrid(items, selected) {
    if (items.length === 0) {
      return `<div class="loader-container"><div class="spinner"></div><p>Searching for images...</p></div>`;
    }
    return `<div class="main-content"><div class="grid">${items.map((item) => renderImageCard(item, selected.has(item.id))).join("")}</div></div>`;
  }

  // src/sidepanel/ui/SettingsPanel.ts
  function renderSettingsPanel(options, format) {
    return `
    <div class="settings-panel">
      <div class="input-group">
        <label for="prefix">Filename Prefix</label>
        <input type="text" id="prefix" value="${options.prefix}" placeholder="Pic" />
      </div>
      <div class="input-group">
        <label for="folderName">Folder Name</label>
        <input type="text" id="folderName" value="${options.folderName}" placeholder="Captures" />
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
      <div class="row" style="margin-top: 16px; border-top: 1px solid var(--panel-border); padding-top: 16px;">
        <button class="secondary" id="viewLogs" style="width: 100%; border-radius: 4px; font-size: 12px; height: 32px;">\u{1F4DC} View Debug Logs</button>
      </div>
    </div>`;
  }

  // src/utils/sizeCalc.ts
  function estimateBytes(width, height) {
    if (!width || !height) return 0;
    return width * height * 3;
  }

  // src/utils/naming.ts
  function buildFilenames(count, options, ext) {
    const prefix = options.prefix.trim() || "Pic";
    return new Array(count).fill(0).map((_, i) => {
      return `${prefix} (${i + 1}).${ext}`;
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
  var state = {
    items: [],
    selected: /* @__PURE__ */ new Set(),
    settingsOpen: false,
    naming: { prefix: "Pic", folderName: "" },
    format: "original",
    status: "Ready",
    progress: 0,
    searching: false,
    processing: false,
    showLogs: false
  };
  async function loadSettings() {
    const data = await chrome.storage.local.get(["naming", "format"]);
    if (data.naming) state.naming = data.naming;
    if (data.format) state.format = data.format;
  }
  async function saveSettings() {
    await chrome.storage.local.set({ naming: state.naming, format: state.format });
  }
  async function registerDownload(url, filename) {
    await chrome.runtime.sendMessage({ type: "REGISTER_NAME", url, filename });
  }
  var converter = new Worker(chrome.runtime.getURL("workers/converter.worker.js"));
  var pendingConversions = /* @__PURE__ */ new Map();
  converter.onmessage = (ev) => {
    pendingConversions.get(ev.data.id)?.(ev.data);
    pendingConversions.delete(ev.data.id);
  };
  function currentSelection() {
    return state.items.filter((i) => state.selected.has(i.id));
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
      `;
      wireStaticEvents();
    }
    const toolbar = app.querySelector(".toolbar");
    const main = app.querySelector(".main-content");
    const footer = app.querySelector(".footer");
    const settings = app.querySelector("#settings-container");
    const selectedCount = state.selected.size;
    const isBusy = state.searching || state.processing;
    const showProgress = state.progress > 0 && state.progress < 100 || state.processing;
    toolbar.innerHTML = `
    <div class="actions-left">
      <button class="secondary icon-btn" id="scanPage" title="Scan Whole Page">
        <i class="fa-solid fa-expand"></i>
      </button>
      <button class="secondary icon-btn" id="toggleSelector" title="Toggle Selector (S)">
        <i class="fa-solid fa-crosshairs"></i>
      </button>
    </div>
    <div class="actions-right">
      <button class="secondary icon-btn" id="clearAll" title="Clear Grid">
        <i class="fa-solid fa-trash-can"></i>
      </button>
      <button class="primary icon-btn" id="downloadTask" title="Download Selected">
        <i class="fa-solid fa-download"></i>
      </button>
      <button class="secondary icon-btn" id="settingsToggle" title="Settings">
        <i class="fa-solid fa-gear"></i>
      </button>
    </div>
  `;
    let mainHtml = "";
    if (isBusy) {
      mainHtml = `
        <div class="loading-state">
          <div class="spinner"></div>
          <p>${state.searching ? "Searching for images..." : state.status}</p>
          ${state.processing ? `
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
      mainHtml = renderImageGrid(state.items, state.selected);
    }
    const wasGrid = !!main.querySelector(".grid");
    const isGrid = !isBusy && state.items.length > 0;
    if (!isGrid || !wasGrid || main.dataset.itemCount !== state.items.length.toString()) {
      main.innerHTML = mainHtml;
      main.dataset.itemCount = isGrid ? state.items.length.toString() : "0";
    } else if (isGrid) {
      main.querySelectorAll(".card").forEach((card) => {
        const id = card.dataset.id;
        if (id) {
          if (state.selected.has(id)) card.classList.add("selected");
          else card.classList.remove("selected");
        }
        const item = state.items.find((i) => i.id === id);
        if (item) {
          const dimSpan = card.querySelector(".dimensions");
          if (dimSpan) dimSpan.textContent = item.width && item.height ? `${item.width}\xD7${item.height}` : "...";
          const sizeSpan = card.querySelector(".size");
          if (sizeSpan) sizeSpan.textContent = item.bytes ? `${(item.bytes / 1024).toFixed(1)} KB` : "...";
        }
      });
    }
    footer.innerHTML = `
    <div class="info-panel">
      <div class="stats">
        <span class="stat-item"><i class="fa-solid fa-images"></i> <strong>${state.items.length}</strong> Found</span>
        <span class="stat-item"><i class="fa-solid fa-check-double"></i> <strong>${selectedCount}</strong> Selected</span>
      </div>
      <div class="status-text">
        ${state.status}
        ${showProgress && !state.processing ? `(${Math.round(state.progress)}%)` : ""}
      </div>
    </div>
  `;
    settings.innerHTML = state.settingsOpen ? renderSettingsPanel(state.naming, state.format) : "";
    wireDynamicEvents();
  }
  function wireStaticEvents() {
    const main = document.querySelector(".main-content");
    main.addEventListener("click", (e) => {
      const card = e.target.closest(".card");
      if (card) {
        const id = card.dataset.id;
        if (id) {
          if (state.selected.has(id)) state.selected.delete(id);
          else state.selected.add(id);
          render();
        }
      }
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key.toLowerCase() === "s") void chrome.runtime.sendMessage({ type: "TOGGLE_SELECTOR_FOR_TAB" });
      if (ev.key === "Escape" && !state.settingsOpen && !state.showLogs) void chrome.runtime.sendMessage({ type: "TOGGLE_SELECTOR_FOR_TAB" });
      if (ev.key === "Escape" && (state.settingsOpen || state.showLogs)) {
        state.settingsOpen = false;
        state.showLogs = false;
        render();
      }
      if (ev.key === "Enter" && !state.searching && !state.processing) void startDownload();
    });
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
      state.items = [];
      state.selected.clear();
      state.status = "Ready";
      render();
    });
    document.querySelector("#scanPage")?.addEventListener("click", async () => {
      state.searching = true;
      render();
      await chrome.runtime.sendMessage({ type: "SCAN_PAGE_IMAGES" });
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
    document.querySelector("#download")?.addEventListener("click", () => void startDownload());
    const prefixInput = document.querySelector("#prefix");
    if (prefixInput) {
      prefixInput.value = state.naming.prefix;
      prefixInput.oninput = (ev) => {
        state.naming.prefix = ev.target.value;
        void saveSettings();
      };
    }
    const folderInput = document.querySelector("#folderName");
    if (folderInput) {
      folderInput.value = state.naming.folderName;
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
        logList.innerHTML = result.logs.length ? result.logs.map((l) => `<div style="padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-family: monospace; font-size: 10px;">${l}</div>`).reverse().join("") : "No logs found.";
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
    if (!result.ok || !result.bytes) throw new Error(result.error || "conversion failed");
    return result.bytes;
  }
  async function startDownload() {
    const selected = currentSelection();
    if (!selected.length) return;
    state.status = "Preparing...";
    state.progress = 5;
    render();
    const names = buildFilenames(selected.length, state.naming, "bin");
    for (let i = 0; i < selected.length; i += 1) {
      const item = selected[i];
      state.status = `Downloading ${i + 1}/${selected.length}`;
      state.progress = 10 + Math.round(i / selected.length * 85);
      render();
      try {
        let targetExt = "img";
        if (state.format !== "original") {
          targetExt = extFromMime(state.format);
        } else if (item.isDataUrl) {
          const mimeMatch = item.url.match(/^data:(image\/(.*?));/);
          targetExt = mimeMatch?.[2]?.split("+")[0] || "img";
        } else {
          const urlBase = item.url.split(/[?#]/)[0];
          const parts = urlBase.split(".");
          targetExt = parts.length > 1 ? parts.pop() || "img" : "img";
          targetExt = targetExt.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4);
          if (!targetExt || targetExt.length < 2) targetExt = "img";
        }
        let finalName = names[i].replace(".bin", "." + targetExt);
        if (state.naming.folderName.trim()) {
          const folder = state.naming.folderName.trim().replace(/[\\/]$/, "").replace(/[<>:"|?*]/g, "_");
          finalName = `${folder}/${finalName}`.replace(/\\/g, "/").replace(/^\//, "");
        } else {
          finalName = finalName.replace(/\\/g, "/").replace(/^\//, "");
        }
        const downloadOptions = {
          url: "",
          filename: finalName,
          saveAs: false,
          conflictAction: "uniquify"
        };
        if (state.format === "original" && !item.isDataUrl) {
          downloadOptions.url = item.url;
          await registerDownload(item.url, finalName);
          await chrome.downloads.download(downloadOptions);
        } else {
          const fetched = await chrome.runtime.sendMessage({ type: "FETCH_BYTES", url: item.url });
          if (!fetched.ok) throw new Error(fetched.error);
          let bytes = new Uint8Array(fetched.bytes).buffer;
          if (state.format !== "original") {
            bytes = await convertBytes(item.id, bytes);
          }
          const mimeMap = {
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "webp": "image/webp",
            "gif": "image/gif",
            "svg": "image/svg+xml"
          };
          const blobMime = state.format === "original" ? mimeMap[targetExt] || "image/png" : state.format;
          const blob = new Blob([bytes], { type: blobMime });
          const blobUrl = URL.createObjectURL(blob);
          downloadOptions.url = blobUrl;
          await registerDownload(blobUrl, finalName);
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
    state.progress = 0;
    render();
    setTimeout(() => {
      state.status = "Ready";
      render();
    }, 3e3);
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "WAIT_FOR_IMAGES") {
      state.searching = true;
      render();
    }
    if (message.type === "SELECTION_LOCKED" || message.type === "PAGE_IMAGES_FOUND" || message.type === "SELECTION_CANCELLED") {
      state.searching = false;
      if (message.type === "SELECTION_CANCELLED") {
        render();
        return;
      }
      const existingUrls = new Set(state.items.map((i) => i.url));
      const rawNewItems = message.images;
      const newItems = [];
      const seenInBatch = /* @__PURE__ */ new Set();
      for (const img of rawNewItems) {
        if (!existingUrls.has(img.url) && !seenInBatch.has(img.url)) {
          img.id = Date.now() + "-" + Math.random().toString(36).slice(2, 9);
          newItems.push(img);
          seenInBatch.add(img.url);
        }
      }
      if (newItems.length > 0) {
        (async () => {
          state.processing = true;
          state.status = `Processing ${newItems.length} images...`;
          render();
          await refreshSizes_Buffered(newItems);
          state.items.push(...newItems);
          state.processing = false;
          state.status = `Added ${newItems.length} images`;
          render();
          setTimeout(() => {
            if (state.status.startsWith("Added")) {
              state.status = "Ready";
              render();
            }
          }, 2e3);
        })();
      } else {
        state.status = "No new images found";
        render();
        setTimeout(() => {
          state.status = "Ready";
          render();
        }, 2e3);
      }
    }
  });
  async function refreshSizes_Buffered(items) {
    const total = items.length;
    for (let i = 0; i < total; i++) {
      const item = items[i];
      try {
        const sizeResult = await chrome.runtime.sendMessage({ type: "FETCH_SIZE", url: item.url });
        if (sizeResult.ok) item.bytes = sizeResult.bytes;
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            item.width = img.width;
            item.height = img.height;
            item.estimatedBytes = estimateBytes(item.width, item.height, "image/png");
            resolve(null);
          };
          img.onerror = () => resolve(null);
          img.src = item.url;
        });
        const fetched = await chrome.runtime.sendMessage({ type: "FETCH_BYTES", url: item.url });
        if (fetched.ok) {
          const blob = new Blob([new Uint8Array(fetched.bytes)], { type: "image/png" });
          item.previewUrl = URL.createObjectURL(blob);
        }
      } catch (e) {
        console.warn("Metadata fetch error", e);
      }
      state.progress = Math.round((i + 1) / total * 100);
      render();
    }
  }
  void loadSettings().then(() => render());
})();
