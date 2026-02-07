import { extractImagesFromRoots } from './imageExtractor';
import { SelectionPayload } from '../utils/types';

declare global {
  interface Window {
    __madcapture_selector_booted__?: boolean;
  }
}

if (!window.__madcapture_selector_booted__) {
  window.__madcapture_selector_booted__ = true;

  type State = {
    active: boolean;
    current?: Element;
    locked: Element[];
    overlay?: HTMLElement;
    box?: HTMLElement;
    tooltip?: HTMLElement;
  };

  const state: State = { active: false, locked: [] };

  function selectorFor(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
      const id = node.id ? `#${CSS.escape(node.id)}` : '';
      const cls = node.classList.length ? `.${[...node.classList].slice(0, 2).map((c) => CSS.escape(c)).join('.')}` : '';
      parts.unshift(`${node.tagName.toLowerCase()}${id || cls}`);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function ensureOverlay(): void {
    if (state.overlay) return;
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
  function onMove(ev: PointerEvent): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      // In pointermove, the overlay host might have pointer-events: auto or we might hit our own box.
      // But we set host to none and box to none.
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      // Skip if we hit the host or any of its children (unlikely if pointer-events: none is working)
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
    const images = await extractImagesFromRoots(state.locked);
    chrome.runtime.sendMessage({ type: 'SELECTION_LOCKED', payload, images });
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
    
    // Consolidate click logic here to ensure it's not blocked by other interceptors
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
    ensureOverlay();
    
    // Capture phase listeners on window to intercept and handle clicks
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
    state.overlay = undefined;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'TOGGLE_SELECTOR') {
      if (state.active) deactivate();
      else activate();
      sendResponse({ active: state.active });
    }
    if (msg.type === 'EXTRACT_PAGE_IMAGES') {
      (async () => {
        chrome.runtime.sendMessage({ type: 'WAIT_FOR_IMAGES' });
        // Scan the whole body
        const images = await extractImagesFromRoots([document.body]);
        chrome.runtime.sendMessage({ type: 'PAGE_IMAGES_FOUND', images });
      })();
      sendResponse({ ok: true });
    }
    return true;
  });
}
