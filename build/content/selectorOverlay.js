"use strict";
(() => {
  // src/utils/cssBackground.ts
  var URL_RE = /url\((['"]?)(.*?)\1\)/g;
  function extractBackgroundImageUrls(backgroundImage) {
    const results = [];
    for (const match of backgroundImage.matchAll(URL_RE)) {
      const raw = match[2]?.trim();
      if (!raw || raw.startsWith("data:image/svg+xml;base64,") && raw.includes("gradient")) continue;
      if (/gradient\(/i.test(raw)) continue;
      results.push(raw);
    }
    return results;
  }

  // src/utils/srcset.ts
  function parseSrcset(srcset) {
    return srcset.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const [url, descriptor] = entry.split(/\s+/, 2);
      if (!descriptor) return { url };
      if (descriptor.endsWith("w")) return { url, descriptor, width: Number(descriptor.slice(0, -1)) };
      if (descriptor.endsWith("x")) return { url, descriptor, density: Number(descriptor.slice(0, -1)) };
      return { url, descriptor };
    });
  }
  function pickHighestResCandidate(srcset) {
    const parsed = parseSrcset(srcset);
    return parsed.sort((a, b) => (b.width ?? b.density ?? 0) - (a.width ?? a.density ?? 0))[0]?.url;
  }

  // src/utils/url.ts
  function canonicalizeUrl(input, base = location.href) {
    try {
      const u = new URL(input, base);
      u.hash = "";
      return u.toString();
    } catch {
      return input;
    }
  }
  function filenameFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const file = pathname.split("/").pop();
      return file || void 0;
    } catch {
      return void 0;
    }
  }

  // src/content/imageExtractor.ts
  var LAZY_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-srcset"];
  function idFor(url, idx) {
    return `${idx}-${url.slice(0, 80)}`;
  }
  function posFor(el) {
    const rect = el.getBoundingClientRect();
    return { pageX: rect.left + window.scrollX, pageY: rect.top + window.scrollY };
  }
  function fromImg(el, idx, pos) {
    const urls = /* @__PURE__ */ new Set();
    if (el.src) urls.add(canonicalizeUrl(el.src));
    if (el.currentSrc) urls.add(canonicalizeUrl(el.currentSrc));
    const highest = el.srcset ? pickHighestResCandidate(el.srcset) : void 0;
    if (highest) urls.add(canonicalizeUrl(highest));
    return [...urls].map((url) => ({
      id: idFor(url, idx),
      url,
      originType: "img",
      width: el.naturalWidth,
      height: el.naturalHeight,
      filenameHint: filenameFromUrl(url),
      srcsetCandidates: el.srcset ? parseSrcset(el.srcset).map((c) => c.url) : void 0,
      pageX: pos?.pageX,
      pageY: pos?.pageY
    }));
  }
  function extractDataUrlMime(dataUrl) {
    const match = dataUrl.match(/^data:(.*?);/);
    return match?.[1] ?? "application/octet-stream";
  }
  async function maybeNudgeLazyLoad(root) {
    if (!(root instanceof HTMLElement)) return;
    root.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  async function extractImagesFromRoots(roots) {
    const items = [];
    let idx = 0;
    for (const root of roots) {
      try {
        await maybeNudgeLazyLoad(root);
      } catch {
      }
      const all = [root, ...root.querySelectorAll("*")];
      for (const el of all) {
        try {
          const pos = posFor(el);
          if (el instanceof HTMLImageElement) items.push(...fromImg(el, idx++, pos));
          if (el instanceof HTMLPictureElement) {
            for (const source of el.querySelectorAll("source")) {
              const srcset = source.srcset || source.getAttribute("srcset") || "";
              parseSrcset(srcset).forEach(
                (c) => items.push({
                  id: idFor(c.url, idx++),
                  url: canonicalizeUrl(c.url),
                  originType: "picture",
                  filenameHint: filenameFromUrl(c.url),
                  pageX: pos.pageX,
                  pageY: pos.pageY
                })
              );
            }
          }
          if (el instanceof SVGElement) {
            try {
              const clone = el.cloneNode(true);
              if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
              const payload = new XMLSerializer().serializeToString(clone);
              const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(payload)))}`;
              items.push({
                id: idFor(dataUrl, idx++),
                url: dataUrl,
                originType: "inline-svg",
                isInlineSVG: true,
                isDataUrl: true,
                filenameHint: "vector.svg",
                pageX: pos.pageX,
                pageY: pos.pageY
              });
            } catch (e) {
              console.warn("SVG extraction failed", e);
            }
          }
          if (el instanceof HTMLCanvasElement) {
            try {
              const dataUrl = el.toDataURL("image/png");
              items.push({
                id: idFor(dataUrl, idx++),
                url: dataUrl,
                originType: "canvas",
                isCanvas: true,
                isDataUrl: true,
                width: el.width,
                height: el.height,
                filenameHint: "canvas.png",
                pageX: pos.pageX,
                pageY: pos.pageY
              });
            } catch (e) {
              console.warn("Canvas extraction failed", e);
            }
          }
          if (el instanceof HTMLVideoElement && el.poster) {
            const url = canonicalizeUrl(el.poster);
            items.push({
              id: idFor(url, idx++),
              url,
              originType: "video-poster",
              filenameHint: filenameFromUrl(url),
              pageX: pos.pageX,
              pageY: pos.pageY
            });
          }
          if (el instanceof HTMLElement) {
            const bg = getComputedStyle(el).getPropertyValue("background-image");
            if (bg && bg !== "none") {
              extractBackgroundImageUrls(bg).forEach((url) => {
                const abs = canonicalizeUrl(url);
                items.push({
                  id: idFor(abs, idx++),
                  url: abs,
                  originType: "css-background",
                  filenameHint: filenameFromUrl(abs),
                  pageX: pos.pageX,
                  pageY: pos.pageY
                });
              });
            }
          }
          for (const attr of LAZY_ATTRS) {
            const value = el.getAttribute(attr);
            if (!value) continue;
            if (attr.includes("srcset")) {
              parseSrcset(value).forEach(
                (candidate) => items.push({
                  id: idFor(candidate.url, idx++),
                  url: canonicalizeUrl(candidate.url),
                  originType: "lazy-attr",
                  lazyHint: true,
                  filenameHint: filenameFromUrl(candidate.url),
                  pageX: pos.pageX,
                  pageY: pos.pageY
                })
              );
            } else {
              const u = canonicalizeUrl(value);
              items.push({
                id: idFor(u, idx++),
                url: u,
                originType: "lazy-attr",
                lazyHint: true,
                filenameHint: filenameFromUrl(u),
                pageX: pos.pageX,
                pageY: pos.pageY
              });
            }
          }
        } catch (e) {
          console.warn("Element extraction failed", e);
        }
      }
    }
    return items.filter((item) => {
      const url = item.url.toLowerCase();
      if (url.endsWith(".svg") || url.includes("svg+xml")) return false;
      return true;
    }).map((item) => {
      if (item.url.startsWith("data:")) {
        const mime = extractDataUrlMime(item.url);
        const ext = mime.split("/")[1]?.split("+")[0] || "bin";
        return { ...item, isDataUrl: true, filenameHint: item.filenameHint ?? `data.${ext}` };
      }
      return item;
    }).filter((item, i, arr) => arr.findIndex((x) => x.url === item.url) === i);
  }

  // src/content/selectorOverlay.ts
  if (!window.__madcapture_selector_booted__) {
    let selectorFor = function(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        const id = node.id ? `#${CSS.escape(node.id)}` : "";
        const cls = node.classList.length ? `.${[...node.classList].slice(0, 2).map((c) => CSS.escape(c)).join(".")}` : "";
        parts.unshift(`${node.tagName.toLowerCase()}${id || cls}`);
        node = node.parentElement;
      }
      return parts.join(" > ");
    }, ensureOverlay = function() {
      if (state.overlay) return;
      const shield = document.createElement("div");
      shield.style.position = "fixed";
      shield.style.inset = "0";
      shield.style.pointerEvents = "auto";
      shield.style.background = "transparent";
      shield.style.zIndex = "2147483646";
      shield.style.cursor = "crosshair";
      document.documentElement.append(shield);
      const host = document.createElement("div");
      host.style.position = "fixed";
      host.style.inset = "0";
      host.style.pointerEvents = "none";
      host.style.zIndex = "2147483647";
      const shadow = host.attachShadow({ mode: "open" });
      const box = document.createElement("div");
      box.style.position = "fixed";
      box.style.border = "2px solid #7c4dff";
      box.style.background = "rgba(124,77,255,0.15)";
      box.style.opacity = "0";
      box.style.pointerEvents = "none";
      const tooltip = document.createElement("div");
      tooltip.style.position = "fixed";
      tooltip.style.background = "#111";
      tooltip.style.color = "#fff";
      tooltip.style.padding = "4px 6px";
      tooltip.style.font = "12px sans-serif";
      tooltip.style.opacity = "0";
      tooltip.style.pointerEvents = "none";
      shadow.append(box, tooltip);
      document.documentElement.append(host);
      state.shield = shield;
      state.overlay = host;
      state.box = box;
      state.tooltip = tooltip;
    }, renderCurrent = function(el) {
      const rect = el.getBoundingClientRect();
      if (!state.box || !state.tooltip) return;
      state.box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      state.box.style.width = `${rect.width}px`;
      state.box.style.height = `${rect.height}px`;
      state.box.style.opacity = "1";
      state.tooltip.textContent = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      state.tooltip.style.transform = `translate(${rect.left}px, ${Math.max(0, rect.top - 22)}px)`;
      state.tooltip.style.opacity = "1";
    }, elementUnderPoint = function(x, y) {
      const list = document.elementsFromPoint(x, y);
      for (const el of list) {
        if (state.shield && el === state.shield) continue;
        if (state.overlay && (el === state.overlay || state.overlay.contains(el))) continue;
        return el;
      }
      return null;
    }, onMove = function(ev) {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = elementUnderPoint(ev.clientX, ev.clientY);
        if (!el || state.overlay && (el === state.overlay || state.overlay.contains(el))) return;
        state.current = el;
        renderCurrent(el);
      });
    }, onKey = function(ev) {
      if (ev.key === "Escape") {
        deactivate();
        chrome.runtime.sendMessage({ type: "SELECTION_CANCELLED" });
      }
      if (ev.key === "[" && state.current?.parentElement) {
        state.current = state.current.parentElement;
        renderCurrent(state.current);
      }
      if (ev.key === "]" && state.current?.children[0]) {
        state.current = state.current.children[0];
        renderCurrent(state.current);
      }
    }, stopEvents = function(ev) {
      if (!state.active) return;
      if (ev.type === "click" && ev instanceof MouseEvent) {
        if (state.current) {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          if (!ev.shiftKey) {
            state.locked = [];
            deactivate();
          }
          if (!state.locked.includes(state.current)) state.locked.push(state.current);
          chrome.runtime.sendMessage({ type: "WAIT_FOR_IMAGES" });
          void reportSelection();
          return;
        }
      }
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    }, activate = function() {
      if (state.active) return;
      state.active = true;
      state.locked = [];
      state.current = void 0;
      ensureOverlay();
      window.addEventListener("click", stopEvents, true);
      window.addEventListener("mousedown", stopEvents, true);
      window.addEventListener("mouseup", stopEvents, true);
      window.addEventListener("pointerdown", stopEvents, true);
      window.addEventListener("pointerup", stopEvents, true);
      window.addEventListener("dblclick", stopEvents, true);
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("keydown", onKey, true);
      document.body.style.cursor = "crosshair";
    }, deactivate = function() {
      if (!state.active) return;
      state.active = false;
      window.removeEventListener("click", stopEvents, true);
      window.removeEventListener("mousedown", stopEvents, true);
      window.removeEventListener("mouseup", stopEvents, true);
      window.removeEventListener("pointerdown", stopEvents, true);
      window.removeEventListener("pointerup", stopEvents, true);
      window.removeEventListener("dblclick", stopEvents, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.cursor = "";
      state.overlay?.remove();
      state.shield?.remove();
      state.overlay = void 0;
      state.shield = void 0;
    };
    selectorFor2 = selectorFor, ensureOverlay2 = ensureOverlay, renderCurrent2 = renderCurrent, elementUnderPoint2 = elementUnderPoint, onMove2 = onMove, onKey2 = onKey, stopEvents2 = stopEvents, activate2 = activate, deactivate2 = deactivate;
    window.__madcapture_selector_booted__ = true;
    const state = { active: false, locked: [] };
    let raf = 0;
    async function reportSelection() {
      const payload = {
        selectors: state.locked.map(selectorFor),
        rects: state.locked.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })
      };
      try {
        const images = await extractImagesFromRoots(state.locked);
        chrome.runtime.sendMessage({ type: "SELECTION_LOCKED", payload, images });
      } catch (error) {
        chrome.runtime.sendMessage({
          type: "SELECTION_LOCKED",
          payload,
          images: [],
          error: error.message
        });
      }
    }
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === "TOGGLE_SELECTOR") {
        if (state.active) deactivate();
        else activate();
        sendResponse({ active: state.active });
      }
      if (msg.type === "EXTRACT_PAGE_IMAGES") {
        (async () => {
          chrome.runtime.sendMessage({ type: "WAIT_FOR_IMAGES" });
          try {
            const images = await extractImagesFromRoots([document.body]);
            chrome.runtime.sendMessage({ type: "PAGE_IMAGES_FOUND", images });
          } catch (error) {
            chrome.runtime.sendMessage({
              type: "PAGE_IMAGES_FOUND",
              images: [],
              error: error.message
            });
          }
        })();
        sendResponse({ ok: true });
      }
      if (msg.type === "LOCATE_IMAGE_ON_PAGE") {
        (async () => {
          try {
            const result = await locateAndHighlight(msg.url, msg.pageX, msg.pageY);
            sendResponse(result);
          } catch (error) {
            sendResponse({ ok: false, error: error.message });
          }
        })();
        return true;
      }
      return true;
    });
  }
  var selectorFor2;
  var ensureOverlay2;
  var renderCurrent2;
  var elementUnderPoint2;
  var onMove2;
  var onKey2;
  var stopEvents2;
  var activate2;
  var deactivate2;
  function normalizeUrl(input, base = location.href) {
    try {
      const u = new URL(input, base);
      u.hash = "";
      return u.toString();
    } catch {
      return input;
    }
  }
  function srcsetUrls(srcset) {
    return srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
  }
  function extractCssUrls(value) {
    const urls = [];
    const re = /url\((['"]?)(.*?)\1\)/g;
    let match;
    while (match = re.exec(value)) {
      if (match[2]) urls.push(match[2]);
    }
    return urls;
  }
  function findCandidates(targetUrl) {
    const targetNorm = normalizeUrl(targetUrl);
    const candidates = [];
    for (const img of Array.from(document.images)) {
      const srcs = [img.currentSrc, img.src].filter(Boolean).map((u) => normalizeUrl(u));
      if (srcs.includes(targetNorm)) {
        candidates.push(img);
        continue;
      }
      if (img.srcset) {
        const urls = srcsetUrls(img.srcset).map((u) => normalizeUrl(u));
        if (urls.includes(targetNorm)) candidates.push(img);
      }
    }
    for (const source of Array.from(document.querySelectorAll("source"))) {
      const srcset = source.srcset || source.getAttribute("srcset") || "";
      if (!srcset) continue;
      const urls = srcsetUrls(srcset).map((u) => normalizeUrl(u));
      if (urls.includes(targetNorm)) {
        candidates.push(source.parentElement ?? source);
      }
    }
    for (const video of Array.from(document.querySelectorAll("video"))) {
      const poster = video.poster;
      if (poster && normalizeUrl(poster) === targetNorm) candidates.push(video);
    }
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === "none") continue;
      const urls = extractCssUrls(bg).map((u) => normalizeUrl(u));
      if (urls.includes(targetNorm)) candidates.push(el);
    }
    return candidates;
  }
  function pickClosest(candidates, pageX, pageY) {
    if (!candidates.length) return null;
    if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) return candidates[0];
    let best = candidates[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + window.scrollX + rect.width / 2;
      const cy = rect.top + window.scrollY + rect.height / 2;
      const dx = cx - pageX;
      const dy = cy - pageY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    }
    return best;
  }
  async function highlightElement(el) {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    await waitForScrollStop();
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.border = "2px solid #f2c94c";
    overlay.style.boxShadow = "0 0 0 2px rgba(242, 201, 76, 0.6), 0 0 20px rgba(242, 201, 76, 0.45)";
    overlay.style.borderRadius = "6px";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2147483647";
    overlay.style.transition = "opacity 0.6s ease";
    document.documentElement.appendChild(overlay);
    setTimeout(() => {
      overlay.style.opacity = "0";
    }, 800);
    setTimeout(() => {
      overlay.remove();
    }, 1400);
  }
  async function waitForScrollStop(timeoutMs = 2500, idleMs = 200) {
    return new Promise((resolve) => {
      let settled = false;
      let idleTimer;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (idleTimer) window.clearTimeout(idleTimer);
        window.removeEventListener("scroll", onScroll, true);
        resolve();
      };
      const onScroll = () => {
        if (idleTimer) window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(finish, idleMs);
      };
      window.addEventListener("scroll", onScroll, true);
      idleTimer = window.setTimeout(finish, idleMs);
      window.setTimeout(finish, timeoutMs);
    });
  }
  async function locateAndHighlight(url, pageX, pageY) {
    if (!url) return { ok: false, error: "Missing image url", level: "error" };
    const candidates = findCandidates(url);
    let target = pickClosest(candidates, pageX, pageY);
    if (!target && Number.isFinite(pageY)) {
      window.scrollTo({ top: Math.max(0, pageY - window.innerHeight / 2), behavior: "smooth" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (Number.isFinite(pageX)) {
        const x = Math.min(window.innerWidth - 1, Math.max(0, pageX - window.scrollX));
        const y = Math.min(window.innerHeight - 1, Math.max(0, pageY - window.scrollY));
        target = document.elementFromPoint(x, y) || null;
      }
    }
    if (!target) return { ok: false, error: "Could not locate image on page", level: "warn" };
    await highlightElement(target);
    return { ok: true };
  }
})();
