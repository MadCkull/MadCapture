import { extractBackgroundImageUrls } from '../utils/cssBackground';
import { pickHighestResCandidate, parseSrcset } from '../utils/srcset';
import { canonicalizeUrl, filenameFromUrl } from '../utils/url';
import { ExtractedImage } from '../utils/types';

const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-srcset'];

function idFor(url: string, idx: number): string {
  return `${idx}-${url.slice(0, 80)}`;
}

function posFor(el: Element): { pageX: number; pageY: number } {
  const rect = el.getBoundingClientRect();
  return { pageX: rect.left + window.scrollX, pageY: rect.top + window.scrollY };
}

function fromImg(el: HTMLImageElement, idx: number, pos?: { pageX: number; pageY: number }): ExtractedImage[] {
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
    srcsetCandidates: el.srcset ? parseSrcset(el.srcset).map((c) => c.url) : undefined,
    pageX: pos?.pageX,
    pageY: pos?.pageY
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
    try {
      await maybeNudgeLazyLoad(root);
    } catch {
      // ignore
    }

    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
      try {
        const pos = posFor(el);
        if (el instanceof HTMLImageElement) items.push(...fromImg(el, idx++, pos));

        if (el instanceof HTMLPictureElement) {
          for (const source of el.querySelectorAll('source')) {
            const srcset = source.srcset || source.getAttribute('srcset') || '';
            parseSrcset(srcset).forEach((c) =>
              items.push({
                id: idFor(c.url, idx++),
                url: canonicalizeUrl(c.url),
                originType: 'picture',
                filenameHint: filenameFromUrl(c.url),
                pageX: pos.pageX,
                pageY: pos.pageY
              })
            );
          }
        }

        if (el instanceof SVGElement) {
          try {
            const clone = el.cloneNode(true) as SVGElement;
            if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            const payload = new XMLSerializer().serializeToString(clone);
            const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(payload)))}`;
            items.push({
              id: idFor(dataUrl, idx++),
              url: dataUrl,
              originType: 'inline-svg',
              isInlineSVG: true,
              isDataUrl: true,
              filenameHint: 'vector.svg',
              pageX: pos.pageX,
              pageY: pos.pageY
            });
          } catch (e) {
            console.warn('SVG extraction failed', e);
          }
        }

        if (el instanceof HTMLCanvasElement) {
          try {
            const dataUrl = el.toDataURL('image/png');
            items.push({
              id: idFor(dataUrl, idx++),
              url: dataUrl,
              originType: 'canvas',
              isCanvas: true,
              isDataUrl: true,
              width: el.width,
              height: el.height,
              filenameHint: 'canvas.png',
              pageX: pos.pageX,
              pageY: pos.pageY
            });
          } catch (e) {
            console.warn('Canvas extraction failed', e);
          }
        }

        if (el instanceof HTMLVideoElement && el.poster) {
          const url = canonicalizeUrl(el.poster);
          items.push({
            id: idFor(url, idx++),
            url,
            originType: 'video-poster',
            filenameHint: filenameFromUrl(url),
            pageX: pos.pageX,
            pageY: pos.pageY
          });
        }

        if (el instanceof HTMLElement) {
          const bg = getComputedStyle(el).getPropertyValue('background-image');
          if (bg && bg !== 'none') {
            extractBackgroundImageUrls(bg).forEach((url) => {
              const abs = canonicalizeUrl(url);
            items.push({
              id: idFor(abs, idx++),
              url: abs,
              originType: 'css-background',
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
          if (attr.includes('srcset')) {
            parseSrcset(value).forEach((candidate) =>
              items.push({
                id: idFor(candidate.url, idx++),
                url: canonicalizeUrl(candidate.url),
                originType: 'lazy-attr',
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
              originType: 'lazy-attr',
              lazyHint: true,
              filenameHint: filenameFromUrl(u),
              pageX: pos.pageX,
              pageY: pos.pageY
            });
          }
        }
      } catch (e) {
        console.warn('Element extraction failed', e);
      }
    }
  }

  return items
    .filter((item) => {
      const url = item.url.toLowerCase();
      if (url.endsWith('.svg') || url.includes('svg+xml')) return false;
      return true;
    })
    .map((item) => {
      if (item.url.startsWith('data:')) {
        const mime = extractDataUrlMime(item.url);
        const ext = mime.split('/')[1]?.split('+')[0] || 'bin';
        return { ...item, isDataUrl: true, filenameHint: item.filenameHint ?? `data.${ext}` };
      }
      return item;
    })
    .filter((item, i, arr) => arr.findIndex((x) => x.url === item.url) === i);
}
