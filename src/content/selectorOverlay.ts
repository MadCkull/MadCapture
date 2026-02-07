import { extractImagesFromRoots } from './imageExtractor';
import { SelectionPayload } from '../utils/types';

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
  while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
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

  const tooltip = document.createElement('div');
  tooltip.style.position = 'fixed';
  tooltip.style.background = '#111';
  tooltip.style.color = '#fff';
  tooltip.style.padding = '4px 6px';
  tooltip.style.font = '12px sans-serif';

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
  state.tooltip.textContent = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
  state.tooltip.style.transform = `translate(${rect.left}px, ${Math.max(0, rect.top - 22)}px)`;
}

let raf = 0;
function onMove(ev: PointerEvent): void {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || el === state.overlay) return;
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

function onClick(ev: MouseEvent): void {
  if (!state.current) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (!ev.shiftKey) state.locked = [];
  state.locked.push(state.current);
  reportSelection();
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

function activate(): void {
  if (state.active) return;
  state.active = true;
  ensureOverlay();
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

function deactivate(): void {
  state.active = false;
  document.removeEventListener('pointermove', onMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKey, true);
  state.overlay?.remove();
  state.overlay = undefined;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'TOGGLE_SELECTOR') {
    if (state.active) deactivate(); else activate();
    sendResponse({ active: state.active });
  }
});
