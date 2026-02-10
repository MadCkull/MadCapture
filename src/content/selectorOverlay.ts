import { extractImagesFromRoots } from './imageExtractor';
import { ExtractOptions, SelectionPayload } from '../utils/types';
import { pierceToImage } from './imagePiercer';
import { getActiveHandler } from '../handlers/registry';

declare global {
  interface Window {
    __madcapture_selector_booted__?: boolean;
    __madcapture_extract_images__?: (options?: Partial<ExtractOptions>) => Promise<unknown>;
  }
}

function normalizeExtractOptions(overrides?: Partial<ExtractOptions>): ExtractOptions {
  const basePadding = Math.min(500, Math.round(window.innerHeight * 0.25));
  const padding =
    typeof overrides?.viewportPadding === 'number'
      ? Math.max(0, overrides.viewportPadding)
      : basePadding;
  return {
    deepScan: overrides?.deepScan ?? false,
    visibleOnly: overrides?.visibleOnly ?? true,
    viewportPadding: padding,
    includeDataUrls: overrides?.includeDataUrls ?? true,
    includeBlobUrls: overrides?.includeBlobUrls ?? true
  };
}

window.__madcapture_extract_images__ = async (options?: Partial<ExtractOptions>) => {
  return extractImagesFromRoots([document.body], normalizeExtractOptions(options));
};

if (!window.__madcapture_selector_booted__) {
  window.__madcapture_selector_booted__ = true;

  type State = {
    active: boolean;
    current?: Element;
    locked: Element[];
    overlay?: HTMLElement;
    shield?: HTMLElement;
    box?: HTMLElement;
    tooltip?: HTMLElement;
    extractOptions?: ExtractOptions;
  };

  const state: State = { active: false, locked: [] };

  function selectorFor(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
      const id = node.id ? `#${CSS.escape(node.id)}` : '';
      const cls = node.classList.length ? `.${Array.from(node.classList).slice(0, 2).map((c) => CSS.escape(c)).join('.')}` : '';
      parts.unshift(`${node.tagName.toLowerCase()}${id || cls}`);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  const IMAGE_HINT_SELECTOR = [
    'img',
    'picture',
    'source[srcset]',
    'source[src]',
    'video[poster]',
    'canvas',
    'svg',
    'input[type="image"]',
    '[style*="background"]',
    '[style*="url("]',
    '[data-src]',
    '[data-srcset]',
    '[data-lazy-src]',
    '[data-original]',
  ].join(',');

  function hasImageHints(el: Element): boolean {
    if (el instanceof HTMLImageElement) return true;
    if (el instanceof HTMLVideoElement && el.poster) return true;
    if (el instanceof HTMLCanvasElement) return true;
    if (el instanceof SVGElement) return true;
    if (el instanceof HTMLInputElement && el.type.toLowerCase() === 'image') return true;

    if (el instanceof HTMLElement) {
      const style = getComputedStyle(el);
      if (style.backgroundImage && style.backgroundImage !== 'none') return true;
      if (style.content && style.content !== 'none' && style.content.includes('url(')) return true;
    }

    return !!el.querySelector(IMAGE_HINT_SELECTOR);
  }

  function findCaptureRoot(el: Element): Element {
    let node: Element | null = el;
    let depth = 0;
    while (node && depth < 6) {
      if (
        node !== document.body &&
        node !== document.documentElement &&
        hasImageHints(node)
      ) {
        return node;
      }
      const parent: Element | null = node.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      node = parent;
      depth += 1;
    }
    return el;
  }

  function expandSelectionRoots(elements: Element[]): Element[] {
    const roots: Element[] = [];
    const seen = new Set<Element>();
    const handler = getActiveHandler();
    
    for (const el of elements) {
      // Let site handler enhance selection first
      let enhanced: Element | Element[] = el;
      if (handler?.enhanceSelection) {
        try {
          enhanced = handler.enhanceSelection(el);
        } catch {
          enhanced = el;
        }
      }
      
      // Handle both single element and array results
      const toProcess = Array.isArray(enhanced) ? enhanced : [enhanced];
      
      for (const item of toProcess) {
        const root = findCaptureRoot(item);
        if (!seen.has(root)) {
          seen.add(root);
          roots.push(root);
        }
      }
    }
    return roots;
  }

  function ensureOverlay(): void {
    if (state.overlay) return;
    const shield = document.createElement('div');
    shield.style.position = 'fixed';
    shield.style.inset = '0';
    shield.style.pointerEvents = 'auto';
    shield.style.background = 'transparent';
    shield.style.zIndex = '2147483646';
    shield.style.cursor = 'crosshair';
    document.documentElement.append(shield);

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '2147483647';
    const shadow = host.attachShadow({ mode: 'open' });

    const box = document.createElement('div');
    box.style.position = 'fixed';
    box.style.border = '2px solid #7c4dff';
    box.style.background = 'rgba(124,77,255,0.15)';
    box.style.opacity = '0';
    box.style.pointerEvents = 'none';

    const tooltip = document.createElement('div');
    tooltip.style.position = 'fixed';
    tooltip.style.background = '#111';
    tooltip.style.color = '#fff';
    tooltip.style.padding = '4px 6px';
    tooltip.style.font = '12px sans-serif';
    tooltip.style.opacity = '0';
    tooltip.style.pointerEvents = 'none';

    shadow.append(box, tooltip);
    document.documentElement.append(host);
    state.shield = shield;
    state.overlay = host;
    state.box = box;
    state.tooltip = tooltip;
  }

  function renderCurrent(el: Element): void {
    const rect = el.getBoundingClientRect();
    if (!state.box || !state.tooltip) return;
    state.box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    state.box.style.width = `${rect.width}px`;
    state.box.style.height = `${rect.height}px`;
    state.box.style.opacity = '1';
    state.tooltip.textContent = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    state.tooltip.style.transform = `translate(${rect.left}px, ${Math.max(0, rect.top - 22)}px)`;
    state.tooltip.style.opacity = '1';
  }

  let raf = 0;
  
  /**
   * Smart element detection - pierces through overlays to find actual images
   */
  function elementUnderPoint(x: number, y: number): Element | null {
    // Build exclusion list
    const excludeElements: Element[] = [];
    if (state.shield) excludeElements.push(state.shield);
    if (state.overlay) excludeElements.push(state.overlay);
    
    // Use smart piercing to find best image element
    const result = pierceToImage(x, y, {
      excludeElements,
      expandToContainer: false,
    });
    
    if (!result) {
      // Fallback: return first non-excluded element
      const list = document.elementsFromPoint(x, y);
      for (const el of list) {
        if (state.shield && el === state.shield) continue;
        if (state.overlay && (el === state.overlay || state.overlay.contains(el))) continue;
        return el;
      }
      return null;
    }
    
    // Skip logic that expands selection (like Google enhanceSelection)
    // as it conflicts with precise user intent
    /*
    // Let site handler enhance the result
    const handler = getActiveHandler();
    if (handler?.enhanceSelection) {
      try {
        const enhanced = handler.enhanceSelection(result.element);
        return Array.isArray(enhanced) ? enhanced[0] : enhanced;
      } catch {
        // Ignore errors, use original result
      }
    }
    */
    
    return result.element;
  }

  function onMove(ev: PointerEvent): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const el = elementUnderPoint(ev.clientX, ev.clientY);
      if (!el || (state.overlay && (el === state.overlay || state.overlay.contains(el)))) return;
      state.current = el;
      renderCurrent(el);
    });
  }

  async function reportSelection(): Promise<void> {
    const payload: SelectionPayload = {
      selectors: state.locked.map(selectorFor),
      rects: state.locked.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })
    };
    try {
      const options = state.extractOptions ?? normalizeExtractOptions();
      const roots = expandSelectionRoots(state.locked);
      const images = await extractImagesFromRoots(roots, options);
      chrome.runtime.sendMessage({ type: 'SELECTION_LOCKED', payload, images });
    } catch (error) {
      chrome.runtime.sendMessage({
        type: 'SELECTION_LOCKED',
        payload,
        images: [],
        error: (error as Error).message
      });
    }
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      deactivate();
      chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED' });
    }
    if (ev.key === '[' && state.current?.parentElement) {
      state.current = state.current.parentElement;
      renderCurrent(state.current);
    }
    if (ev.key === ']' && state.current?.children[0]) {
      state.current = state.current.children[0];
      renderCurrent(state.current);
    }
  }

  function stopEvents(ev: Event): void {
    if (!state.active) return;

    if (ev.type === 'click' && ev instanceof MouseEvent) {
      if (state.current) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        if (!ev.shiftKey) {
          state.locked = [];
          deactivate();
        }
        if (!state.locked.includes(state.current)) state.locked.push(state.current);
        chrome.runtime.sendMessage({ type: 'WAIT_FOR_IMAGES' });
        void reportSelection();
        return;
      }
    }

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
  }

  function activate(): void {
    if (state.active) return;
    state.active = true;
    state.locked = [];
    state.current = undefined;
    ensureOverlay();

    window.addEventListener('click', stopEvents, true);
    window.addEventListener('mousedown', stopEvents, true);
    window.addEventListener('mouseup', stopEvents, true);
    window.addEventListener('pointerdown', stopEvents, true);
    window.addEventListener('pointerup', stopEvents, true);
    window.addEventListener('dblclick', stopEvents, true);

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('keydown', onKey, true);

    document.body.style.cursor = 'crosshair';
  }

  function deactivate(): void {
    if (!state.active) return;
    state.active = false;

    window.removeEventListener('click', stopEvents, true);
    window.removeEventListener('mousedown', stopEvents, true);
    window.removeEventListener('mouseup', stopEvents, true);
    window.removeEventListener('pointerdown', stopEvents, true);
    window.removeEventListener('pointerup', stopEvents, true);
    window.removeEventListener('dblclick', stopEvents, true);

    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('keydown', onKey, true);
    document.body.style.cursor = '';

    state.overlay?.remove();
    state.shield?.remove();
    state.overlay = undefined;
    state.shield = undefined;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'TOGGLE_SELECTOR') {
      if (state.active) deactivate();
      else activate();
      state.extractOptions = normalizeExtractOptions(msg.options as Partial<ExtractOptions> | undefined);
      sendResponse({ active: state.active });
    }
    if (msg.type === 'EXTRACT_PAGE_IMAGES') {
      (async () => {
        chrome.runtime.sendMessage({ type: 'WAIT_FOR_IMAGES' });
        try {
          const images = await extractImagesFromRoots(
            [document.body],
            normalizeExtractOptions(msg.options as Partial<ExtractOptions> | undefined)
          );
          chrome.runtime.sendMessage({ type: 'PAGE_IMAGES_FOUND', images });
        } catch (error) {
          chrome.runtime.sendMessage({
            type: 'PAGE_IMAGES_FOUND',
            images: [],
            error: (error as Error).message
          });
        }
      })();
      sendResponse({ ok: true });
    }
    if (msg.type === 'SET_EXTRACT_OPTIONS') {
      state.extractOptions = normalizeExtractOptions(msg.options as Partial<ExtractOptions> | undefined);
      sendResponse({ ok: true });
    }
    if (msg.type === 'LOCATE_IMAGE_ON_PAGE') {
      (async () => {
        try {
          const result = await locateAndHighlight(msg.url as string, msg.pageX as number | undefined, msg.pageY as number | undefined);
          sendResponse(result);
        } catch (error) {
          sendResponse({ ok: false, error: (error as Error).message });
        }
      })();
      return true;
    }
    return true;
  });
}

function normalizeUrl(input: string, base = location.href): string {
  try {
    const u = new URL(input, base);
    u.hash = '';
    return u.toString();
  } catch {
    return input;
  }
}

function srcsetUrls(srcset: string): string[] {
  return srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function extractCssUrls(value: string): string[] {
  const urls: string[] = [];
  const re = /url\((['"]?)(.*?)\1\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    if (match[2]) urls.push(match[2]);
  }
  return urls;
}

function findCandidates(targetUrl: string): Element[] {
  const targetNorm = normalizeUrl(targetUrl);
  const candidates: Element[] = [];

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

  for (const source of Array.from(document.querySelectorAll('source'))) {
    const srcset = (source as HTMLSourceElement).srcset || source.getAttribute('srcset') || '';
    if (!srcset) continue;
    const urls = srcsetUrls(srcset).map((u) => normalizeUrl(u));
    if (urls.includes(targetNorm)) {
      candidates.push(source.parentElement ?? source);
    }
  }

  for (const video of Array.from(document.querySelectorAll('video'))) {
    const poster = (video as HTMLVideoElement).poster;
    if (poster && normalizeUrl(poster) === targetNorm) candidates.push(video);
  }

  for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') continue;
    const urls = extractCssUrls(bg).map((u) => normalizeUrl(u));
    if (urls.includes(targetNorm)) candidates.push(el);
  }

  return candidates;
}

function pickClosest(candidates: Element[], pageX?: number, pageY?: number): Element | null {
  if (!candidates.length) return null;
  if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) return candidates[0];
  let best = candidates[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + window.scrollX + rect.width / 2;
    const cy = rect.top + window.scrollY + rect.height / 2;
    const dx = cx - (pageX as number);
    const dy = cy - (pageY as number);
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }
  return best;
}

async function highlightElement(el: Element): Promise<void> {
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  await waitForScrollStop();

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.border = '2px solid #f2c94c';
  overlay.style.boxShadow = '0 0 0 2px rgba(242, 201, 76, 0.6), 0 0 20px rgba(242, 201, 76, 0.45)';
  overlay.style.borderRadius = '6px';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '2147483647';
  overlay.style.transition = 'opacity 0.6s ease';
  document.documentElement.appendChild(overlay);

  setTimeout(() => {
    overlay.style.opacity = '0';
  }, 800);
  setTimeout(() => {
    overlay.remove();
  }, 1400);
}

async function waitForScrollStop(timeoutMs = 2500, idleMs = 200): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let idleTimer: number | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (idleTimer) window.clearTimeout(idleTimer);
      window.removeEventListener('scroll', onScroll, true);
      resolve();
    };

    const onScroll = () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(finish, idleMs);
    };

    window.addEventListener('scroll', onScroll, true);
    idleTimer = window.setTimeout(finish, idleMs);
    window.setTimeout(finish, timeoutMs);
  });
}

async function locateAndHighlight(url: string, pageX?: number, pageY?: number): Promise<{ ok: boolean; error?: string; level?: 'warn' | 'error' }> {
  if (!url) return { ok: false, error: 'Missing image url', level: 'error' };
  const candidates = findCandidates(url);
  let target = pickClosest(candidates, pageX, pageY);

  if (!target && Number.isFinite(pageY)) {
    window.scrollTo({ top: Math.max(0, (pageY as number) - window.innerHeight / 2), behavior: 'smooth' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (Number.isFinite(pageX)) {
      const x = Math.min(window.innerWidth - 1, Math.max(0, (pageX as number) - window.scrollX));
      const y = Math.min(window.innerHeight - 1, Math.max(0, (pageY as number) - window.scrollY));
      target = document.elementFromPoint(x, y) || null;
    }
  }

  if (!target) return { ok: false, error: 'Could not locate image on page', level: 'warn' };
  await highlightElement(target);
  return { ok: true };
}
