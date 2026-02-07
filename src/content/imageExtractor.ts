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
    await maybeNudgeLazyLoad(root);
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) {
      if (el instanceof HTMLImageElement) items.push(...fromImg(el, idx++));
      if (el instanceof HTMLPictureElement) {
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
        const payload = new XMLSerializer().serializeToString(el);
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(payload)}`;
        items.push({ id: idFor(dataUrl, idx++), url: dataUrl, originType: 'inline-svg', isInlineSVG: true, isDataUrl: true, filenameHint: 'inline.svg' });
      }
      if (el instanceof HTMLCanvasElement) {
        const dataUrl = el.toDataURL('image/png');
        items.push({ id: idFor(dataUrl, idx++), url: dataUrl, originType: 'canvas', isCanvas: true, isDataUrl: true, width: el.width, height: el.height, filenameHint: 'canvas.png' });
      }
      if (el instanceof HTMLVideoElement && el.poster) {
        const url = canonicalizeUrl(el.poster);
        items.push({ id: idFor(url, idx++), url, originType: 'video-poster', filenameHint: filenameFromUrl(url) });
      }
      if (el instanceof HTMLElement) {
        const bg = getComputedStyle(el).getPropertyValue('background-image');
        extractBackgroundImageUrls(bg).forEach((url) => {
          const abs = canonicalizeUrl(url);
          items.push({ id: idFor(abs, idx++), url: abs, originType: 'css-background', filenameHint: filenameFromUrl(abs) });
        });
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
    .map((item) => {
      if (item.url.startsWith('data:')) {
        return { ...item, isDataUrl: true, originType: 'data-url', filenameHint: item.filenameHint ?? `data.${extractDataUrlMime(item.url).split('/')[1] || 'bin'}` };
      }
      return item;
    })
    .filter((item, i, arr) => arr.findIndex((x) => x.url === item.url) === i);
}
