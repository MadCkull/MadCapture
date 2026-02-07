import { extractBackgroundImageUrls } from '../utils/cssBackground';
import { pickHighestResCandidate, parseSrcset } from '../utils/srcset';
import { canonicalizeUrl, filenameFromUrl } from '../utils/url';
import { ExtractedImage } from '../utils/types';

const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-srcset'];

function idFor(url: string, idx: number): string {
  return `${idx}-${url.slice(0, 80)}`;
}

function fromImg(el: HTMLImageElement, idx: number): ExtractedImage[] {
  const urls = new Set<string>();
  if (el.src) urls.add(canonicalizeUrl(el.src));
  if (el.currentSrc) urls.add(canonicalizeUrl(el.currentSrc));
  const highest = el.srcset ? pickHighestResCandidate(el.srcset) : undefined;
  if (highest) urls.add(canonicalizeUrl(highest));
  return [...urls].map((url) => ({
    id: idFor(url, idx),
    url,
    originType: 'img',
    width: el.naturalWidth,
    height: el.naturalHeight,
    filenameHint: filenameFromUrl(url),
    srcsetCandidates: el.srcset ? parseSrcset(el.srcset).map((c) => c.url) : undefined
  }));
}

function extractDataUrlMime(dataUrl: string): string {
  const match = dataUrl.match(/^data:(.*?);/);
  return match?.[1] ?? 'application/octet-stream';
}

async function maybeNudgeLazyLoad(root: Element): Promise<void> {
  if (!(root instanceof HTMLElement)) return;
  root.scrollIntoView({ block: 'center', inline: 'nearest' });
  await new Promise((resolve) => setTimeout(resolve, 100));
}

export async function extractImagesFromRoots(roots: Element[]): Promise<ExtractedImage[]> {
  const items: ExtractedImage[] = [];
  let idx = 0;

  for (const root of roots) {
    if (root.tagName.toLowerCase() === 'img') {
        items.push(...fromImg(root as HTMLImageElement, idx++));
    }
    
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
      if (el instanceof HTMLImageElement) items.push(...fromImg(el, idx++));
      if (el instanceof HTMLPictureElement) {
        const img = el.querySelector('img');
        if (img) items.push(...fromImg(img, idx++));
        
        for (const source of el.querySelectorAll('source')) {
          const srcset = source.srcset || source.getAttribute('srcset') || '';
          parseSrcset(srcset).forEach((c) => items.push({
            id: idFor(c.url, idx++),
            url: canonicalizeUrl(c.url),
            originType: 'picture',
            filenameHint: filenameFromUrl(c.url)
          }));
        }
      }
      if (el instanceof SVGElement) {
        try {
          // Clone to avoid modifying the original if we need to do anything
          const clone = el.cloneNode(true) as SVGElement;
          if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          const payload = new XMLSerializer().serializeToString(clone);
          const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(payload)))}`;
          items.push({ id: idFor(dataUrl, idx++), url: dataUrl, originType: 'inline-svg', isInlineSVG: true, isDataUrl: true, filenameHint: 'vector.svg' });
        } catch (e) {
          console.warn('SVG extraction failed', e);
        }
      }
      if (el instanceof HTMLCanvasElement) {
        try {
          const dataUrl = el.toDataURL('image/png');
          items.push({ id: idFor(dataUrl, idx++), url: dataUrl, originType: 'canvas', isCanvas: true, isDataUrl: true, width: el.width, height: el.height, filenameHint: 'canvas.png' });
        } catch (e) {
            console.warn('Canvas extraction failed', e);
        }
      }
      // CSS Backgrounds - check parents too if they have bg
      let curr: Element | null = el;
      while (curr && curr !== root.parentElement) {
          const bg = getComputedStyle(curr).getPropertyValue('background-image');
          if (bg && bg !== 'none') {
            extractBackgroundImageUrls(bg).forEach((url) => {
                const abs = canonicalizeUrl(url);
                items.push({ id: idFor(abs, idx++), url: abs, originType: 'css-background', filenameHint: filenameFromUrl(abs) });
            });
          }
          if (curr === root) break;
          curr = curr.parentElement;
      }

      for (const attr of LAZY_ATTRS) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        if (attr.includes('srcset')) {
          parseSrcset(value).forEach((candidate) => items.push({
            id: idFor(candidate.url, idx++),
            url: canonicalizeUrl(candidate.url),
            originType: 'lazy-attr',
            lazyHint: true,
            filenameHint: filenameFromUrl(candidate.url)
          }));
        } else {
          const u = canonicalizeUrl(value);
          items.push({ id: idFor(u, idx++), url: u, originType: 'lazy-attr', lazyHint: true, filenameHint: filenameFromUrl(u) });
        }
      }
    }
  }

  return items
    .filter((item) => {
      // Exclude SVGs (user said exclude .svg and similar things)
      if (item.url.toLowerCase().endsWith('.svg') || item.url.includes('svg+xml')) return false;
      
      // Filter out invalid/empty data URLs or very small icons
      if (item.url.startsWith('data:')) {
          if (item.url.length < 100) return false;
          const mime = extractDataUrlMime(item.url);
          if (mime.includes('svg')) return false;
      }
      return true;
    })
    .map((item) => {
      if (item.url.startsWith('data:')) {
        const mime = extractDataUrlMime(item.url);
        const ext = mime.split('/')[1]?.split('+')[0] || 'bin';
        return { ...item, isDataUrl: true, originType: 'data-url', filenameHint: item.filenameHint ?? `data.${ext}` };
      }
      return item;
    })
    .filter((item, i, arr) => arr.findIndex((x) => x.url === item.url) === i);
}
