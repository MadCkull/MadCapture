import { extractCssImageCandidates } from '../utils/cssBackground';
import { parseSrcset, SrcSetCandidate } from '../utils/srcset';
import { canonicalizeUrl, filenameFromUrl } from '../utils/url';
import { ExtractedImage, ExtractOptions, OriginType } from '../utils/types';
import { getActiveHandler } from '../handlers/registry';

const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-srcset'];
const ATTR_HINT_RE = /(src|img|image|photo|poster|thumb|avatar|bg|background|full|orig|large|zoom|raw|hires|highres|media)/i;
const STRONG_ORIG_RE = /(orig|original|full|large|hires|highres|zoom|raw|download)/i;
const LOW_RES_RE = /(thumb|small|low|tiny|preview)/i;
const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const FORMAT_QUERY_KEYS = ['format', 'fm', 'ext', 'type', 'imageformat'];
const IMG_EXT_RE = /\.(avif|webp|png|jpe?g)(?:$|[?#])/i;
const URL_TOKEN_RE = /((?:https?:)?\/\/[^\s"'()]+|data:image\/[^\s"'()]+|blob:[^\s"'()]+)/gi;
const RELATIVE_IMG_RE = /(^|[\s"'(])((?:\.{0,2}\/)?[^\s"'()<>]+?\.(?:avif|webp|png|jpe?g)(?:\?[^\s"'()<>]*)?)/gi;
const URL_FUNC_RE = /url\((['"]?)(.*?)\1\)/gi;
const LINK_QUERY_KEYS = ['url', 'imgurl', 'image', 'media', 'photo', 'src', 'u', 'uri', 'href'];
// ─── SMART URL CLEANING ────────────────────────────────────────────────────────
// Surgically remove CDN resize/format/quality params while preserving auth & IDs.

/** Query params that are SAFE to remove — resize, format, quality, crop */
const REMOVE_PARAM_KEYS = new Set([
  // Size / resize
  'w', 'width', 'h', 'height', 'size', 's', 'sz', 'maxwidth', 'maxheight',
  'resize', 'iw', 'ih', 'cw', 'ch', 'sw', 'sh',
  // Format
  'fm', 'format', 'f', 'ext', 'type', 'output', 'encoding', 'imageformat',
  // Quality
  'q', 'quality', 'ql',
  // Crop / fit
  'fit', 'crop', 'gravity', 'g', 'ar', 'aspect',
  // DPR / scale
  'dpr', 'scale', 'pixel_ratio',
  // CDN processing flags
  'auto', 'blur', 'sharp', 'sharpen', 'strip', 'trim', 'bg',
  'brightness', 'contrast', 'saturation', 'hue',
  // Imgix / Cloudinary specific
  'fl', 'flags', 'e', 'effect',
]);

/** Query params that must NEVER be removed — auth, IDs, content keys */
const PRESERVE_PARAM_KEYS = new Set([
  'token', 'signature', 'sig', 'hash', 'key', 'apikey', 'api_key',
  'id', 'file', 'path', 'name', 'v', 'version', 'cb',
  'nonce', 'expires', 'hmac', 'policy', 'credential',
]);

/**
 * Intelligently clean an image URL:
 * 1. Remove known resize/format/quality query params
 * 2. Clean CDN path patterns (e.g. /300x300/, /w_800,h_600/)
 * 3. Preserve auth tokens and file identifiers
 * Returns cleaned URL or null if nothing changed.
 */
function cleanImageUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl, document.baseURI);
  } catch {
    return null;
  }

  let changed = false;

  // --- Step 1: Filter query parameters ---
  const keysToRemove: string[] = [];
  url.searchParams.forEach((_val, key) => {
    const k = key.toLowerCase();
    if (REMOVE_PARAM_KEYS.has(k) && !PRESERVE_PARAM_KEYS.has(k)) {
      keysToRemove.push(key);
    }
  });
  for (const key of keysToRemove) {
    url.searchParams.delete(key);
    changed = true;
  }

  // --- Step 2: Clean CDN path patterns ---
  let pathname = url.pathname;

  // Pattern: /300x300/ or /800x600/ (pure dimension segments)
  const dimSegmentRe = /\/\d{2,4}x\d{2,4}(?=\/)/g;
  const cleanedPath1 = pathname.replace(dimSegmentRe, '');
  if (cleanedPath1 !== pathname && cleanedPath1.includes('.')) {
    pathname = cleanedPath1;
    changed = true;
  }

  // Pattern: /w_800,h_600,c_fill/ (Cloudinary-style transforms)
  const cloudinaryRe = /\/(?:w_\d+|h_\d+|c_\w+|q_\w+|f_\w+|dpr_[\d.]+|fl_\w+)[,/][^/]*/g;
  const cleanedPath2 = pathname.replace(cloudinaryRe, '');
  if (cleanedPath2 !== pathname && cleanedPath2.includes('.')) {
    pathname = cleanedPath2;
    changed = true;
  }

  // Pattern: /_next/image? (Next.js image optimizer — the actual URL is in the `url` param)
  if (pathname.includes('/_next/image') || pathname.includes('/image?')) {
    const actualUrl = url.searchParams.get('url');
    if (actualUrl) {
      try {
        const resolved = new URL(actualUrl, url.origin);
        return resolved.toString();
      } catch { /* not a valid URL */ }
    }
  }

  // Clean double slashes from path modifications
  pathname = pathname.replace(/\/\/+/g, '/');
  if (pathname !== url.pathname) {
    url.pathname = pathname;
    changed = true;
  }

  if (!changed) return null;

  // Remove empty query string
  if (url.search === '?') url.search = '';

  return url.toString();
}

/**
 * Extract og:image, twitter:image, and link[rel=image_src] — these are
 * usually the full-resolution original images set by the site author.
 */
function extractOgImages(): string[] {
  const urls: string[] = [];
  const selectors = [
    'meta[property="og:image"]',
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'link[rel="image_src"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const content = el.getAttribute('content') || el.getAttribute('href');
    if (content) {
      try {
        const resolved = new URL(content, document.baseURI).href;
        urls.push(resolved);
      } catch { /* ignore */ }
    }
  }
  return [...new Set(urls)];
}

/**
 * Derive the highest-quality version of an image URL.
 * Priority: site-specific patterns → smart param cleaning → original.
 */
function deriveOriginalUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl, document.baseURI);
  } catch {
    return null;
  }

  // --- Site-specific overrides ---

  // Pinterest: swap size prefix to 'originals'
  if (/pinimg\.com$/i.test(url.hostname)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length > 1 && parts[0] !== 'originals') {
      parts[0] = 'originals';
      url.pathname = `/${parts.join('/')}`;
      return url.toString();
    }
  }

  // Cloudinary: remove /upload/transformations/ segment
  if (/\/upload\//i.test(rawUrl) && /\/upload\/[^/]*(w_|h_|c_|q_|f_)/i.test(rawUrl)) {
    const cleaned = rawUrl.replace(
      /(\/upload\/)[^/]+\/(?=[^/]+\.[a-z]{3,5}(?:$|[?#]))/i,
      '$1',
    );
    if (cleaned !== rawUrl && looksLikeImageUrl(cleaned)) return cleaned;
  }

  // Google User Content: strip size params from URL (=w800-h600, =s800)
  const stripped = rawUrl
    .replace(/=w\d+-h\d+[^&?#]*/i, '')
    .replace(/=s\d+[^&?#]*/i, '')
    .replace(/=w\d+[^&?#]*/i, '')
    .replace(/=h\d+[^&?#]*/i, '');
  if (stripped !== rawUrl && looksLikeImageUrl(stripped)) return stripped;

  // --- Generic smart cleaning ---
  // (Removed from here. We now do this asynchronously at the very end of the
  // pipeline so we can validate the cleaned URL before adopting it.)
  return null;
}

type ViewportBounds = { left: number; right: number; top: number; bottom: number };
type SelectionRect = { x: number; y: number; width: number; height: number };

/** Known image-CDN hostname fragments — used to trust extensionless URLs from <img> tags. */
const IMAGE_CDN_HINTS = [
  'cdn', 'img', 'image', 'images', 'media', 'static', 'assets', 'photos',
  'cloudinary', 'imgix', 'cloudfront', 'amazonaws', 'akamai', 'fastly',
  'twimg', 'fbcdn', 'pinimg', 'pbs.twimg', 'googleusercontent', 'ggpht',
  'shopify', 'squarespace', 'wp.com', 'imgur', 'flickr', 'unsplash',
];
function looksLikeImageCdn(url: string): boolean {
  try {
    const hostname = new URL(url, location.href).hostname.toLowerCase();
    return IMAGE_CDN_HINTS.some(h => hostname.includes(h));
  } catch {
    return false;
  }
}

/**
 * Compute a tight bounding box (in page coordinates) from an array of root
 * elements. Returns null if no roots have a meaningful rect.
 */
function computeSelectionBounds(roots: Element[]): SelectionRect | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const root of roots) {
    const r = root.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const px = r.left + window.scrollX;
    const py = r.top + window.scrollY;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px + r.width);
    maxY = Math.max(maxY, py + r.height);
  }
  if (!Number.isFinite(minX)) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Page‑coordinate rect of an element. */
function getElementPageRect(el: Element): SelectionRect {
  const r = el.getBoundingClientRect();
  return {
    x: r.left + window.scrollX,
    y: r.top + window.scrollY,
    width: r.width,
    height: r.height,
  };
}

/**
 * Fraction of `inner` that overlaps `outer` (0‥1).
 * Used to decide whether an element is "inside" the user selection.
 */
function getOverlapRatio(outer: SelectionRect, inner: SelectionRect): number {
  const ix1 = inner.x, iy1 = inner.y;
  const ix2 = inner.x + inner.width, iy2 = inner.y + inner.height;
  const ox1 = outer.x, oy1 = outer.y;
  const ox2 = outer.x + outer.width, oy2 = outer.y + outer.height;
  const overlapX = Math.max(0, Math.min(ix2, ox2) - Math.max(ix1, ox1));
  const overlapY = Math.max(0, Math.min(iy2, oy2) - Math.max(iy1, oy1));
  const innerArea = inner.width * inner.height;
  if (innerArea <= 0) return 0;
  return (overlapX * overlapY) / innerArea;
}

// ─── GRID SEARCH ───────────────────────────────────────────────────────────────
/**
 * Scan a coordinate grid inside `bounds` using `elementsFromPoint`.
 * Returns unique image-bearing elements found visually inside the selection
 * that DOM-tree walking may have missed (absolutely positioned, stacked, etc.).
 */
function gridSearchImages(
  bounds: SelectionRect,
  excludeElements: Element[],
): Element[] {
  // Convert page coords to viewport coords for elementsFromPoint
  const vpLeft = bounds.x - window.scrollX;
  const vpTop  = bounds.y - window.scrollY;
  const vpW    = bounds.width;
  const vpH    = bounds.height;

  // Determine grid density based on selection size — bigger = more points,
  // but cap at 20×20 = 400 probes max
  const stepsX = Math.min(20, Math.max(4, Math.ceil(vpW / 30)));
  const stepsY = Math.min(20, Math.max(4, Math.ceil(vpH / 30)));
  const stepW  = vpW / stepsX;
  const stepH  = vpH / stepsY;

  const excludeSet = new Set(excludeElements);
  const seen = new Set<Element>();
  const results: Element[] = [];

  for (let gx = 0; gx <= stepsX; gx++) {
    for (let gy = 0; gy <= stepsY; gy++) {
      const cx = vpLeft + gx * stepW;
      const cy = vpTop  + gy * stepH;
      // Skip points outside the visible viewport
      if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) continue;

      const stack = document.elementsFromPoint(cx, cy);
      for (const el of stack) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (excludeSet.has(el)) continue;
        // Only collect elements that bear images
        if (isImageBearingElement(el)) {
          results.push(el);
        }
      }
    }
  }
  return results;
}

/** Quick check: does this element directly produce an image? */
function isImageBearingElement(el: Element): boolean {
  if (el instanceof HTMLImageElement) return true;
  if (el instanceof HTMLCanvasElement) return true;
  if (el instanceof HTMLVideoElement && el.poster) return true;
  if (el instanceof HTMLInputElement && el.type.toLowerCase() === 'image') return true;
  if (el instanceof HTMLPictureElement) return true;
  if (el.tagName === 'SOURCE') return true;
  if (el instanceof HTMLElement) {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url(')) return true;
  }
  // Check for lazy-load data attributes
  for (const attr of ['data-src', 'data-lazy-src', 'data-original', 'data-srcset']) {
    if (el.hasAttribute(attr)) return true;
  }
  return false;
}

// ─── SEMANTIC SCORING ──────────────────────────────────────────────────────────
/**
 * Compute a 0–100 relevance score for a candidate image.
 *  - Geometry (0–30): overlap with selection bounds
 *  - Semantics (0–50): tag type — <img> is strongest, data-attr weakest
 *  - Depth (0–20): visible z-position — top-level elements score highest
 */
function computeSemanticScore(
  item: ExtractedImage,
  selBounds: SelectionRect | undefined,
): number {
  let score = 0;

  // --- Geometry (max 30) ---
  if (selBounds && item.pageX !== undefined && item.pageY !== undefined) {
    const w = item.width || 100;
    const h = item.height || 100;
    const imgRect: SelectionRect = { x: item.pageX, y: item.pageY, width: w, height: h };
    const overlap = getOverlapRatio(selBounds, imgRect);
    score += Math.round(overlap * 30);
  } else {
    // If no position info, give partial credit
    score += 10;
  }

  // --- Semantics (max 50) ---
  const SEMANTIC_SCORES: Partial<Record<OriginType, number>> = {
    'img': 50,
    'picture': 48,
    'srcset': 45,
    'canvas': 44,
    'video-poster': 42,
    'css-background': 35,
    'image-set': 34,
    'css-content': 30,
    'css-mask': 25,
    'lazy-attr': 28,
    'data-attr': 15,
    'link-href': 10,
  };
  score += SEMANTIC_SCORES[item.originType] ?? 10;

  // --- Depth (max 20) ---
  // Items from direct <img> tags at known positions get full depth score;
  // items from data attributes or meta tags get minimal depth.
  if (item.originType === 'img' || item.originType === 'picture' || item.originType === 'canvas') {
    score += 20;
  } else if (item.originType === 'css-background' || item.originType === 'srcset') {
    score += 15;
  } else if (item.originType === 'lazy-attr' || item.originType === 'video-poster') {
    score += 12;
  } else {
    score += 5;
  }

  return score;
}

// ─── STATE MINING ──────────────────────────────────────────────────────────────
/** Common global state variable names used by popular frameworks */
const STATE_GLOBALS = [
  '__NEXT_DATA__',
  '__INITIAL_STATE__',
  '__PRELOADED_STATE__',
  '__APP_DATA__',
  '__NUXT__',
  '__APOLLO_STATE__',
  '__RELAY_STORE__',
];

/**
 * Deep-scan framework state objects for image URLs.
 * Returns an array of candidate URLs (not yet canonicalized).
 */
function extractFromPageStates(): string[] {
  const urls: string[] = [];
  const imgUrlRe = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|avif|gif)(?:\?[^\s"'<>]*)?/gi;

  for (const key of STATE_GLOBALS) {
    try {
      const state = (window as unknown as Record<string, unknown>)[key];
      if (!state || typeof state !== 'object') continue;
      // Stringify and regex-extract — fast and framework-agnostic
      const json = JSON.stringify(state);
      const matches = json.match(imgUrlRe);
      if (matches) {
        for (const m of matches) {
          // Unescape JSON-encoded forward slashes
          urls.push(m.replace(/\\\/|\\u002F/gi, '/'));
        }
      }
    } catch {
      // Circular refs, security errors — skip
    }
  }

  // Also scan <script type="application/ld+json"> blocks
  const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(ldScripts)) {
    try {
      const text = script.textContent;
      if (!text) continue;
      const matches = text.match(imgUrlRe);
      if (matches) urls.push(...matches);
    } catch { /* ignore */ }
  }

  // Dedupe before returning
  return [...new Set(urls)];
}

// ─── MUTATION OBSERVER (Deep Mode) ─────────────────────────────────────────────
/**
 * Watch roots for dynamically injected images (lazy frameworks, infinite scroll).
 * Returns newly discovered image-bearing elements after `durationMs`.
 */
function observeDynamicImages(
  roots: Element[],
  durationMs = 400,
): Promise<Element[]> {
  return new Promise((resolve) => {
    const found: Element[] = [];
    const seen = new Set<Element>();

    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of Array.from(mut.addedNodes)) {
          if (!(node instanceof Element)) continue;
          // Check the node itself
          if (!seen.has(node) && isImageBearingElement(node)) {
            seen.add(node);
            found.push(node);
          }
          // Check descendants
          const descendants = node.querySelectorAll?.('img, canvas, video, picture, [data-src]') ?? [];
          for (const desc of Array.from(descendants)) {
            if (!seen.has(desc) && isImageBearingElement(desc)) {
              seen.add(desc);
              found.push(desc);
            }
          }
        }
        // Also check attribute changes (data-src → src swaps)
        if (mut.type === 'attributes' && mut.target instanceof Element) {
          const el = mut.target;
          if (!seen.has(el) && isImageBearingElement(el)) {
            seen.add(el);
            found.push(el);
          }
        }
      }
    });

    for (const root of roots) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset', 'data-src', 'data-lazy-src', 'data-original', 'style'],
      });
    }

    setTimeout(() => {
      observer.disconnect();
      resolve(found);
    }, durationMs);
  });
}

// ─── FORCE LAZY-LOAD TRIGGER (Deep Mode) ───────────────────────────────────────
/**
 * Find lazy-loaded images inside roots and trigger their load by scrolling
 * them into IntersectionObserver range. Waits for src swap to complete.
 */
async function forceLazyLoad(roots: Element[]): Promise<void> {
  const lazyImgs: HTMLImageElement[] = [];

  for (const root of roots) {
    const imgs = root.querySelectorAll('img');
    for (const img of Array.from(imgs) as HTMLImageElement[]) {
      // Identify lazy images: have data-src but no real src, or src is a placeholder
      const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
      if (!dataSrc) continue;
      const currentSrc = img.getAttribute('src') || '';
      const isPlaceholder = !currentSrc || currentSrc.includes('data:') ||
        currentSrc.includes('placeholder') || currentSrc.includes('blank') ||
        currentSrc.includes('spacer') || currentSrc.includes('1x1');
      if (isPlaceholder) {
        lazyImgs.push(img);
      }
    }
  }

  if (lazyImgs.length === 0) return;

  // Trigger IntersectionObserver by scrolling images into view
  for (const img of lazyImgs) {
    try {
      img.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
    } catch { /* ignore */ }
  }

  // Wait for lazy framework to swap src
  await new Promise(r => setTimeout(r, 300));

  // Force manual swap if framework didn't do it
  for (const img of lazyImgs) {
    const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
    const currentSrc = img.getAttribute('src') || '';
    if (dataSrc && (currentSrc.includes('data:') || currentSrc.includes('placeholder') || !currentSrc)) {
      img.src = dataSrc;
    }
    // Also handle data-srcset
    const dataSrcset = img.getAttribute('data-srcset');
    if (dataSrcset && !img.srcset) {
      img.srcset = dataSrcset;
    }
  }

  // Brief wait for images to start loading
  await new Promise(r => setTimeout(r, 100));
}

type Candidate = {
  url: string;
  originType: OriginType;
  priority: number;
  quality?: number;
  lazyHint?: boolean;
  srcsetCandidates?: string[];
};

function idFor(url: string, idx: number): string {
  return `${idx}-${url.slice(0, 80)}`;
}

function posForRect(rect: DOMRect): { pageX: number; pageY: number } {
  return { pageX: rect.left + window.scrollX, pageY: rect.top + window.scrollY };
}

function getViewportBounds(padding: number): ViewportBounds {
  return {
    left: 0 - padding,
    top: 0 - padding,
    right: window.innerWidth + padding,
    bottom: window.innerHeight + padding,
  };
}

function isVisibleInBounds(el: Element, bounds: ViewportBounds): boolean {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  if (rect.right < bounds.left || rect.left > bounds.right) return false;
  if (rect.bottom < bounds.top || rect.top > bounds.bottom) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const opacity = Number(style.opacity);
  if (Number.isFinite(opacity) && opacity <= 0.01) return false;
  return true;
}

function looksLikeImageUrl(url: string, originType?: OriginType): boolean {
  if (url.startsWith('data:image/')) return true;
  if (url.startsWith('blob:')) return true;
  
  // Check for common image extensions
  if (getAllowedExtFromUrl(url) !== null) return true;
  
  // For img/picture origins: instead of blindly accepting everything,
  // require either a known CDN hostname or a multi-segment path.
  // This blocks tracking pixels like "https://example.com/pixel" while
  // still accepting "https://cdn.example.com/photo/12345".
  if (originType === 'img' || originType === 'picture') {
    if (looksLikeImageCdn(url)) return true;
    try {
      const pathname = new URL(url, location.href).pathname;
      // URLs with at least 2 path segments often are real images
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length >= 2) return true;
    } catch { /* ignore */ }
    return false;
  }
  
  return false;
}

function isUrlLike(url: string): boolean {
  if (/^(https?:|data:image|blob:)/i.test(url)) return true;
  if (/^(\/|\.\/|\.\.\/)/.test(url)) return true;
  if (IMG_EXT_RE.test(url)) return true;
  return false;
}

function extractDataUrlMime(dataUrl: string): string {
  const match = dataUrl.match(/^data:(.*?);/);
  return match?.[1] ?? 'application/octet-stream';
}

function normalizeExt(raw: string): string {
  return raw.toLowerCase().replace(/^\.+/, '').replace(/[^a-z0-9]/g, '');
}

function isAllowedExt(ext: string | null): boolean {
  if (!ext) return false;
  return ALLOWED_EXTS.has(normalizeExt(ext));
}

function isAllowedMime(mime: string | null): boolean {
  if (!mime) return false;
  return ALLOWED_MIMES.has(mime.toLowerCase());
}

function allowedExtFromQuery(url: URL): string | null {
  for (const key of FORMAT_QUERY_KEYS) {
    const raw = url.searchParams.get(key);
    if (!raw) continue;
    let value = raw.toLowerCase();
    value = value.split(/[;,]/)[0] || value;
    if (value.includes('/')) value = value.split('/').pop() || value;
    if (value.startsWith('.')) value = value.slice(1);
    if (isAllowedExt(value)) return normalizeExt(value);
  }
  return null;
}

function allowedExtFromPathname(pathname: string): string | null {
  const file = pathname.split('/').pop() || '';
  if (!file.includes('.')) return null;
  const ext = file.split('.').pop();
  return isAllowedExt(ext ?? null) ? normalizeExt(ext || '') : null;
}

function getAllowedExtFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, location.href);
    return allowedExtFromPathname(url.pathname) ?? allowedExtFromQuery(url);
  } catch {
    const cleaned = rawUrl.split(/[?#]/)[0];
    const match = cleaned.match(/\.([a-z0-9]{2,5})$/i);
    if (!match) return null;
    return isAllowedExt(match[1]) ? normalizeExt(match[1]) : null;
  }
}

function extractUrlsFromValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.includes(',') && /\d+w|\d+x/i.test(trimmed)) {
    return parseSrcset(trimmed).map((c) => c.url);
  }

  const urls: string[] = [];
  for (const match of trimmed.matchAll(URL_FUNC_RE)) {
    const raw = match[2]?.trim();
    if (raw) urls.push(raw);
  }
  for (const match of trimmed.matchAll(URL_TOKEN_RE)) {
    urls.push(match[0]);
  }

  if (!urls.length) urls.push(trimmed);
  return urls;
}

function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const urls: string[] = [];
  for (const match of text.matchAll(URL_TOKEN_RE)) {
    urls.push(decodeEscapedUrl(match[0]));
  }
  return urls;
}

function extractRelativeImageUrls(text: string): string[] {
  if (!text) return [];
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = RELATIVE_IMG_RE.exec(text))) {
    if (match[2]) urls.push(match[2]);
  }
  return urls;
}

function extractUrlsFromJsonValue(value: unknown): string[] {
  const results: string[] = [];
  const seen = new Set<unknown>();

  const visit = (node: unknown) => {
    if (node === null || node === undefined) return;
    if (seen.has(node)) return;
    if (typeof node === 'string') {
      if (looksLikeImageUrl(node)) results.push(node);
      else extractLinkedImageUrls(node).forEach((u) => results.push(u));
      return;
    }
    if (typeof node === 'number' || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      seen.add(node);
      node.forEach(visit);
      return;
    }
    if (typeof node === 'object') {
      seen.add(node);
      Object.values(node as Record<string, unknown>).forEach(visit);
    }
  };

  visit(value);
  return results;
}

function extractUrlsFromCssText(text: string): string[] {
  if (!text) return [];
  const results: string[] = [];
  for (const match of text.matchAll(URL_FUNC_RE)) {
    const raw = match[2]?.trim();
    if (raw) results.push(raw);
  }
  return results;
}

function decodeEscapedUrl(value: string): string {
  return value
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003A/gi, ':')
    .replace(/\\u003D/gi, '=')
    .replace(/\\\//g, '/')
    .replace(/^"+|"+$/g, '');
}

function collectStyleSheetUrls(): string[] {
  const urls = new Set<string>();
  const sheets = Array.from(document.styleSheets || []);
  for (const sheet of sheets) {
    let rules: CSSRuleList | undefined;
    try {
      rules = (sheet as CSSStyleSheet).cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      const cssText = rule.cssText || '';
      const found = extractUrlsFromCssText(cssText);
      for (const raw of found) {
        if (looksLikeImageUrl(raw) || isUrlLike(raw)) urls.add(raw);
      }
    }
  }
  return Array.from(urls);
}

function collectHtmlEmbeddedUrls(): string[] {
  const html = document.documentElement?.innerHTML || '';
  if (!html) return [];
  const urls = new Set<string>();
  const matches = [
    ...extractUrlsFromText(html),
    ...extractRelativeImageUrls(html),
    ...extractUrlsFromCssText(html),
  ];
  for (const raw of matches) {
    if (looksLikeImageUrl(raw)) {
      urls.add(raw);
      continue;
    }
    extractLinkedImageUrls(raw).forEach((u) => urls.add(u));
  }
  return Array.from(urls);
}

function collectHtmlFragmentImageUrls(html: string): string[] {
  if (!html) return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return [];
  }
  const urls = new Set<string>();
  const addValue = (value?: string | null) => {
    if (!value) return;
    extractUrlsFromValue(value).forEach((raw) => {
      if (raw) urls.add(raw);
    });
  };

  doc.querySelectorAll('img').forEach((node) => {
    addValue(node.getAttribute('src'));
    addValue(node.getAttribute('srcset'));
    LAZY_ATTRS.forEach((attr) => addValue(node.getAttribute(attr)));
  });
  doc.querySelectorAll('source').forEach((node) => {
    addValue(node.getAttribute('srcset'));
    addValue(node.getAttribute('src'));
  });
  doc.querySelectorAll('video').forEach((node) => {
    addValue(node.getAttribute('poster'));
  });
  doc.querySelectorAll('input[type="image"]').forEach((node) => {
    addValue((node as HTMLInputElement).getAttribute('src'));
  });
  doc.querySelectorAll<HTMLElement>('[style]').forEach((node) => {
    const style = node.getAttribute('style');
    if (!style) return;
    extractUrlsFromCssText(style).forEach((raw) => urls.add(raw));
  });

  return Array.from(urls);
}

function collectEmbeddedFragmentUrls(): string[] {
  const urls = new Set<string>();
  const blocks: string[] = [];
  document.querySelectorAll('noscript').forEach((node) => {
    const html = node.textContent || node.innerHTML || '';
    if (html) blocks.push(html);
  });
  document.querySelectorAll('template').forEach((node) => {
    const html = node.innerHTML || '';
    if (html) blocks.push(html);
  });
  document
    .querySelectorAll('script[type="text/template"], script[type="text/x-template"], script[type="text/html"]')
    .forEach((node) => {
      const html = node.textContent || '';
      if (html) blocks.push(html);
    });

  for (const html of blocks) {
    collectHtmlFragmentImageUrls(html).forEach((raw) => urls.add(raw));
  }
  return Array.from(urls);
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function extractLinkedImageUrls(href: string): string[] {
  const results: string[] = [];
  if (!href) return results;
  if (looksLikeImageUrl(href)) return [href];
  try {
    const u = new URL(href, location.href);
    for (const key of LINK_QUERY_KEYS) {
      const value = u.searchParams.get(key);
      if (!value) continue;
      const decoded = safeDecodeURIComponent(value);
      const candidate = decoded || value;
      if (looksLikeImageUrl(candidate)) results.push(candidate);
    }
  } catch {
    // ignore
  }
  return results;
}


function collectDocumentLinkedImages(): string[] {
  const urls = new Set<string>();

  const metaSelectors = [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'meta[property="twitter:image"]',
    'meta[property$=":image"]',
    'meta[name$="image"]',
  ];
  for (const selector of metaSelectors) {
    document.querySelectorAll<HTMLMetaElement>(selector).forEach((meta) => {
      const content = meta.content?.trim();
      if (!content) return;
      if (looksLikeImageUrl(content)) {
        urls.add(content);
        return;
      }
      if (isUrlLike(content)) {
        extractLinkedImageUrls(content).forEach((u) => urls.add(u));
      }
    });
  }

  const linkSelectors = [
    'link[rel~="preload"][as="image"]',
    'link[rel~="image_src"]',
    'link[rel~="icon"]',
    'link[rel~="apple-touch-icon"]',
    'link[rel~="thumbnail"]',
  ];
  for (const selector of linkSelectors) {
    document.querySelectorAll<HTMLLinkElement>(selector).forEach((link) => {
      const href = link.href?.trim();
      if (!href) return;
      if (looksLikeImageUrl(href)) {
        urls.add(href);
        return;
      }
      if (isUrlLike(href)) {
        extractLinkedImageUrls(href).forEach((u) => urls.add(u));
      }
    });
  }

  return Array.from(urls);
}

function extractUrlsByKey(text: string, keys: string[]): string[] {
  if (!text) return [];
  const escaped = keys.map((k) => k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
  const re = new RegExp(`"(?:${escaped.join('|')})"\\s*:\\s*"([^"]+)"`, 'gi');
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match[1]) results.push(decodeEscapedUrl(match[1]));
  }
  return results;
}

function collectPinterestUrls(): string[] {
  const urls = new Set<string>();
  const script =
    document.querySelector<HTMLScriptElement>('#__PWS_DATA__') ||
    document.querySelector<HTMLScriptElement>('script[data-test-id="__PWS_DATA__"]');
  if (script?.textContent) {
    try {
      const data = JSON.parse(script.textContent);
      extractUrlsFromJsonValue(data).forEach((u) => urls.add(u));
    } catch {
      // ignore
    }
  }
  document.querySelectorAll<HTMLScriptElement>('script[type="application/json"]').forEach((node) => {
    const text = node.textContent || '';
    if (!text.includes('pinimg') && !text.includes('"pins"')) return;
    try {
      const parsed = JSON.parse(text);
      extractUrlsFromJsonValue(parsed).forEach((u) => urls.add(u));
    } catch {
      // ignore
    }
  });
  const html = document.documentElement?.innerHTML || '';
  extractUrlsFromText(html)
    .filter((u) => u.includes('pinimg') || u.includes('pinterest'))
    .forEach((u) => urls.add(u));
  return Array.from(urls);
}

function collectInstagramUrls(): string[] {
  const urls = new Set<string>();
  const html = document.documentElement?.innerHTML || '';
  extractUrlsByKey(html, [
    'display_url',
    'thumbnail_src',
    'profile_pic_url',
    'profile_pic_url_hd',
    'video_url',
    'url',
  ]).forEach((u) => urls.add(u));
  extractUrlsFromText(html)
    .filter((u) => u.includes('cdninstagram') || u.includes('fbcdn') || u.includes('instagram'))
    .forEach((u) => urls.add(u));
  return Array.from(urls);
}

function collectFacebookUrls(): string[] {
  const urls = new Set<string>();
  const html = document.documentElement?.innerHTML || '';
  extractUrlsFromText(html)
    .filter((u) => u.includes('scontent') || u.includes('fbcdn') || u.includes('facebook'))
    .forEach((u) => urls.add(u));
  extractUrlsByKey(html, ['uri', 'url', 'image']).forEach((u) => urls.add(u));
  return Array.from(urls);
}

function collectSiteSpecificUrls(): string[] {
  const host = location.hostname.toLowerCase();
  const urls = new Set<string>();
  if (host.includes('pinterest')) {
    collectPinterestUrls().forEach((u) => urls.add(u));
  }
  if (host.includes('instagram')) {
    collectInstagramUrls().forEach((u) => urls.add(u));
  }
  if (host.includes('facebook') || host.includes('fb.com')) {
    collectFacebookUrls().forEach((u) => urls.add(u));
  }
  return Array.from(urls);
}

function attributePriority(name: string, url: string): number {
  let priority = 2;
  if (STRONG_ORIG_RE.test(name)) priority = 5;
  else if (/srcset/.test(name)) priority = 4;
  else if (/src|image|img|photo|poster/.test(name)) priority = 3;
  if (LOW_RES_RE.test(name)) priority = Math.min(priority, 1);
  if (LOW_RES_RE.test(url)) priority = Math.min(priority, 1);
  return priority;
}

function pickBestCandidate(candidates: Candidate[]): Candidate | undefined {
  if (!candidates.length) return undefined;
  let best = candidates[0];
  let bestScore = (best.priority ?? 0) * 1_000_000 + (best.quality ?? 0);
  for (const candidate of candidates.slice(1)) {
    const score = (candidate.priority ?? 0) * 1_000_000 + (candidate.quality ?? 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function pickSrcsetCandidate(
  candidates: SrcSetCandidate[],
  _displayWidth: number | undefined,
): SrcSetCandidate | undefined {
  if (!candidates.length) return undefined;
  // ALWAYS pick the LARGEST available resolution — we want the original,
  // not a downscaled version matching the rendered size.
  const withWidth = candidates.filter((c) => Number.isFinite(c.width));
  if (withWidth.length) {
    return withWidth.sort((a, b) => (b.width as number) - (a.width as number))[0];
  }
  const withDensity = candidates
    .filter((c) => Number.isFinite(c.density))
    .sort((a, b) => (b.density as number) - (a.density as number));
  return withDensity[0] ?? candidates[0];
}

function collectAttributeCandidates(el: Element, deepScan = false): Candidate[] {
  const results: Candidate[] = [];
  for (const name of el.getAttributeNames()) {
    if (name === 'src' || name === 'srcset' || name === 'href') continue;
    const value = el.getAttribute(name);
    if (!value) continue;
    const lower = name.toLowerCase();
    const hasHint = ATTR_HINT_RE.test(lower);
    const urls = extractUrlsFromValue(value);
    if (!urls.length) continue;
    for (const raw of urls) {
      if (!raw) continue;
      const candidateOk = looksLikeImageUrl(raw) || (hasHint && isUrlLike(raw));
      if (candidateOk) {
        results.push({
          url: raw,
          originType: 'data-attr',
          priority: attributePriority(lower, raw),
          lazyHint: LAZY_ATTRS.includes(lower),
        });
        continue;
      }

      if (deepScan && isUrlLike(raw)) {
        const linked = extractLinkedImageUrls(raw);
        for (const url of linked) {
          results.push({
            url,
            originType: 'data-attr',
            priority: 2,
            lazyHint: LAZY_ATTRS.includes(lower),
          });
        }
      }
    }

    if (deepScan && (value.trim().startsWith("{") || value.trim().startsWith("["))) {
      try {
        const parsed = JSON.parse(value);
        const jsonUrls = extractUrlsFromJsonValue(parsed);
        for (const url of jsonUrls) {
          results.push({
            url,
            originType: 'data-attr',
            priority: 2,
            lazyHint: LAZY_ATTRS.includes(lower),
          });
        }
      } catch {
        // ignore
      }
    }
  }
  return results;
}

function collectLazyAttributeCandidates(el: Element): Candidate[] {
  const results: Candidate[] = [];
  for (const attr of LAZY_ATTRS) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const urls = extractUrlsFromValue(value);
    for (const raw of urls) {
      if (!raw) continue;
      if (!looksLikeImageUrl(raw) && !isUrlLike(raw)) continue;
      results.push({
        url: raw,
        originType: 'lazy-attr',
        priority: 3,
        lazyHint: true,
      });
    }
  }
  return results;
}

function collectImgCandidates(
  el: HTMLImageElement,
  rect: DOMRect,
  includeAttrs: boolean,
  deepScan: boolean,
): Candidate[] {
  const candidates: Candidate[] = [];
  const displayWidth = rect.width || el.clientWidth || el.naturalWidth || undefined;

  if (el.srcset) {
    const parsed = parseSrcset(el.srcset);
    const best = pickSrcsetCandidate(parsed, displayWidth);
    if (best?.url) {
      candidates.push({
        url: best.url,
        originType: 'srcset',
        priority: 3,
        quality: best.width ?? (best.density ?? 1) * (displayWidth ?? 100),
        srcsetCandidates: parsed.map((c) => c.url),
      });
    }
    if (deepScan) {
      parsed.forEach((cand) => {
        if (!cand.url || cand.url === best?.url) return;
        candidates.push({
          url: cand.url,
          originType: 'srcset',
          priority: 2,
          quality: cand.width ?? (cand.density ?? 1) * (displayWidth ?? 100),
        });
      });
    }
  }

  const picture = el.parentElement instanceof HTMLPictureElement ? el.parentElement : null;
  if (picture) {
    for (const source of Array.from(picture.querySelectorAll('source'))) {
      const srcset = (source as HTMLSourceElement).srcset || source.getAttribute('srcset') || '';
      if (!srcset) continue;
      const parsed = parseSrcset(srcset);
      const best = pickSrcsetCandidate(parsed, displayWidth);
      if (best?.url) {
        candidates.push({
          url: best.url,
          originType: 'picture',
          priority: 3,
          quality: best.width ?? (best.density ?? 1) * (displayWidth ?? 100),
        });
      }
      if (deepScan) {
        parsed.forEach((cand) => {
          if (!cand.url || cand.url === best?.url) return;
          candidates.push({
            url: cand.url,
            originType: 'picture',
            priority: 2,
            quality: cand.width ?? (cand.density ?? 1) * (displayWidth ?? 100),
          });
        });
      }
    }
  }

  if (el.currentSrc) {
    candidates.push({
      url: el.currentSrc,
      originType: 'img',
      priority: 2,
      quality: el.naturalWidth || displayWidth || 0,
    });
  }
  if (el.src) {
    candidates.push({
      url: el.src,
      originType: 'img',
      priority: 1,
      quality: el.naturalWidth || displayWidth || 0,
    });
  }

  const anchor = el.closest('a[href]') as HTMLAnchorElement | null;
  if (anchor?.href) {
    const linked = extractLinkedImageUrls(anchor.href);
    for (const url of linked) {
      candidates.push({
        url,
        originType: 'link-href',
        priority: 4,
        quality: el.naturalWidth || displayWidth || 0,
      });
    }
  }

  if (includeAttrs) candidates.push(...collectAttributeCandidates(el, deepScan));
  else candidates.push(...collectLazyAttributeCandidates(el));

  if (deepScan) {
    const extra: Candidate[] = [];
    for (const cand of candidates) {
      const derived = deriveOriginalUrl(cand.url);
      if (derived && derived !== cand.url) {
        extra.push({
          url: derived,
          originType: cand.originType,
          priority: cand.priority + 1,
          quality: (cand.quality ?? 0) + 500,
        });
      }
    }
    candidates.push(...extra);
  }
  return candidates;
}

function collectCssCandidates(el: HTMLElement): Candidate[] {
  const results: Candidate[] = [];
  const style = getComputedStyle(el);
  const values = [
    { value: style.backgroundImage, originType: 'css-background' as OriginType },
    { value: (style as CSSStyleDeclaration).maskImage, originType: 'css-mask' as OriginType },
    { value: (style as CSSStyleDeclaration).webkitMaskImage, originType: 'css-mask' as OriginType },
    { value: style.content, originType: 'css-content' as OriginType },
  ];

  for (const entry of values) {
    if (!entry.value || entry.value === 'none') continue;
    const candidates = extractCssImageCandidates(entry.value);
    for (const cand of candidates) {
      results.push({
        url: cand.url,
        originType: cand.fromImageSet ? 'image-set' : entry.originType,
        priority: cand.fromImageSet ? 3 : 2,
        quality: (cand.density ?? 1) * 1000,
      });
    }
  }

  const pseudoSelectors = ['::before', '::after'] as const;
  for (const pseudo of pseudoSelectors) {
    const pseudoStyle = getComputedStyle(el, pseudo);
    if (!pseudoStyle) continue;
    const pseudoValues = [
      { value: pseudoStyle.backgroundImage, originType: 'css-background' as OriginType },
      { value: (pseudoStyle as CSSStyleDeclaration).maskImage, originType: 'css-mask' as OriginType },
      { value: (pseudoStyle as CSSStyleDeclaration).webkitMaskImage, originType: 'css-mask' as OriginType },
      { value: pseudoStyle.content, originType: 'css-content' as OriginType },
    ];
    for (const entry of pseudoValues) {
      if (!entry.value || entry.value === 'none') continue;
      const candidates = extractCssImageCandidates(entry.value);
      for (const cand of candidates) {
        results.push({
          url: cand.url,
          originType: cand.fromImageSet ? 'image-set' : entry.originType,
          priority: cand.fromImageSet ? 3 : 2,
          quality: (cand.density ?? 1) * 1000,
        });
      }
    }
  }

  return results;
}

async function maybeDecodeImage(el: HTMLImageElement): Promise<void> {
  if (el.complete && el.naturalWidth) return;
  try {
    await el.decode();
  } catch {
    // ignore
  }
}

function collectElements(root: ParentNode, includeIframes: boolean): Element[] {
  const results: Element[] = [];
  const seen = new Set<Element>();
  const queue: ParentNode[] = [root];

  while (queue.length) {
    const node = queue.pop()!;
    const elements: Element[] = [];
    if (node instanceof Element) elements.push(node);
    if ('querySelectorAll' in node) {
      elements.push(...Array.from((node as ParentNode).querySelectorAll?.('*') ?? []));
    }
    for (const el of elements) {
      if (seen.has(el)) continue;
      seen.add(el);
      results.push(el);
      const shadow = (el as HTMLElement).shadowRoot;
      if (shadow) queue.push(shadow);
      if (includeIframes && el instanceof HTMLIFrameElement) {
        try {
          const doc = el.contentDocument;
          if (doc) queue.push(doc);
        } catch {
          // cross-origin
        }
      }
    }
  }

  return results;
}

export async function extractImagesFromRoots(
  roots: Element[],
  options: ExtractOptions = {},
): Promise<ExtractedImage[]> {
  const opts = {
    deepScan: options.deepScan ?? false,
    visibleOnly: options.visibleOnly ?? false,
    viewportPadding:
      options.viewportPadding ??
      Math.min(500, Math.round(window.innerHeight * 0.25)),
    includeDataUrls: options.includeDataUrls ?? true,
    includeBlobUrls: options.includeBlobUrls ?? true,
    selectionBounds: options.selectionBounds ?? undefined,
  };

  // If we have explicit selection bounds, use them. Otherwise, for non-global
  // scans compute bounds from the roots so we can spatially filter.
  const isGlobalScan = roots.some(
    (root) => root === document.body || root === document.documentElement,
  );
  let selBounds = opts.selectionBounds;
  if (!selBounds && !isGlobalScan) {
    selBounds = computeSelectionBounds(roots);
  }
  // Overlap threshold: Normal = 50% (strict), Deep = 20% (catch edge images)
  const overlapThreshold = opts.deepScan ? 0.20 : 0.50;

  const bounds = opts.visibleOnly ? getViewportBounds(opts.viewportPadding) : null;
  const items: ExtractedImage[] = [];
  let idx = 0;
  const includeGlobal = isGlobalScan;

  // === Site-specific & OG image extraction ===
  const handler = getActiveHandler();
  if (handler) {
    try {
      // For page-wide scans, use extractPageImages if available
      if (includeGlobal && handler.extractPageImages) {
        const handlerImages = handler.extractPageImages(opts);
        for (const img of handlerImages) {
          items.push({
            ...img,
            id: img.id || idFor(img.url, idx++),
          });
          
          // Try to derive original URL using handler
          if (opts.deepScan && handler.deriveOriginalUrl) {
            const original = handler.deriveOriginalUrl(img.url);
            if (original && original !== img.url) {
              items.push({
                id: idFor(original, idx++),
                url: canonicalizeUrl(original),
                originType: img.originType,
                filenameHint: filenameFromUrl(original),
              });
            }
          }
        }
      } else {
        // For selection-based extraction
        for (const root of roots) {
          // Check if method exists
          if (typeof handler.extractImages !== 'function') {
            console.warn(`Handler ${handler.name || 'unknown'} missing extractImages method`);
            continue;
          }
          
          // Execute extraction (potentially async)
          const result = handler.extractImages(root, opts);
          
          // Handle promise or array
          let handlerImages: ExtractedImage[] = [];
          if (result instanceof Promise) {
            handlerImages = await result;
          } else if (Array.isArray(result)) {
            handlerImages = result;
          }
          
          for (const img of handlerImages) {
            items.push({
              ...img,
              id: img.id || idFor(img.url, idx++),
            });
            
            // Try to derive original URL using handler
            if (opts.deepScan && handler.deriveOriginalUrl) {
              const original = handler.deriveOriginalUrl(img.url);
              if (original && original !== img.url) {
                items.push({
                  id: idFor(original, idx++),
                  url: canonicalizeUrl(original),
                  originType: img.originType,
                  filenameHint: filenameFromUrl(original),
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn('Site handler extraction failed, falling back to generic:', error);
    }
  }

  // Include high-priority OG images for global scans
  if (includeGlobal) {
    const ogUrls = extractOgImages();
    for (const raw of ogUrls) {
      const url = canonicalizeUrl(raw);
      items.push({
        id: idFor(url, idx++),
        url,
        originType: 'link-href',
        filenameHint: filenameFromUrl(url),
      });
      // (OG images will naturally score high due to originType)
    }
  }

  // === Generic extraction (only for full-page scans, never block selections) ===
  if (opts.deepScan && includeGlobal && !selBounds) {
    const linked = collectDocumentLinkedImages();
    linked.forEach((raw) => {
      const url = canonicalizeUrl(raw);
      items.push({
        id: idFor(url, idx++),
        url,
        originType: 'link-href',
        filenameHint: filenameFromUrl(url),
      });
      const derived = deriveOriginalUrl(url);
      if (derived && derived !== url) {
        const absDerived = canonicalizeUrl(derived);
        items.push({
          id: idFor(absDerived, idx++),
          url: absDerived,
          originType: 'link-href',
          filenameHint: filenameFromUrl(absDerived),
        });
      }
    });

    const cssUrls = collectStyleSheetUrls();
    cssUrls.forEach((raw) => {
      const url = canonicalizeUrl(raw);
      items.push({
        id: idFor(url, idx++),
        url,
        originType: 'css-background',
        filenameHint: filenameFromUrl(url),
      });
      const derived = deriveOriginalUrl(url);
      if (derived && derived !== url) {
        const absDerived = canonicalizeUrl(derived);
        items.push({
          id: idFor(absDerived, idx++),
          url: absDerived,
          originType: 'css-background',
          filenameHint: filenameFromUrl(absDerived),
        });
      }
    });

    const embedded = collectHtmlEmbeddedUrls();
    embedded.forEach((raw) => {
      const url = canonicalizeUrl(raw);
      items.push({
        id: idFor(url, idx++),
        url,
        originType: 'data-attr',
        filenameHint: filenameFromUrl(url),
      });
    });

    const fragments = collectEmbeddedFragmentUrls();
    fragments.forEach((raw) => {
      const url = canonicalizeUrl(raw);
      items.push({
        id: idFor(url, idx++),
        url,
        originType: 'data-attr',
        filenameHint: filenameFromUrl(url),
      });
    });

    const siteUrls = collectSiteSpecificUrls();
    siteUrls.forEach((raw) => {
      const url = canonicalizeUrl(raw);
      items.push({
        id: idFor(url, idx++),
        url,
        originType: 'link-href',
        filenameHint: filenameFromUrl(url),
      });
      const derived = deriveOriginalUrl(url);
      if (derived && derived !== url) {
        const absDerived = canonicalizeUrl(derived);
        items.push({
          id: idFor(absDerived, idx++),
          url: absDerived,
          originType: 'link-href',
          filenameHint: filenameFromUrl(absDerived),
        });
      }
    });
  }

  // ─── DEEP MODE: Force lazy-load + MutationObserver ─────────────────────────
  if (opts.deepScan && !isGlobalScan) {
    // Force lazy images in selection to load before we enumerate
    await forceLazyLoad(roots);
    // Also start a MutationObserver to catch async-injected images
    // (observer runs concurrently with our enumeration below)
    void observeDynamicImages(roots, 400).then((dynamicEls) => {
      // These will be processed by the grid search pass below
      // since they'll now be in the DOM when grid search runs
    });
  }

  for (const root of roots) {
    const elements = collectElements(root, opts.deepScan);
    for (const el of elements) {
      try {
        if (bounds && !isVisibleInBounds(el, bounds)) continue;

        // === SPATIAL CONTAINMENT CHECK ===
        // If we have selection bounds, skip elements that don't overlap
        // sufficiently with the user's selected area.
        if (selBounds) {
          const elPageRect = getElementPageRect(el);
          // Skip zero-size elements
          if (elPageRect.width <= 0 || elPageRect.height <= 0) continue;
          const overlap = getOverlapRatio(selBounds, elPageRect);
          if (overlap < overlapThreshold) continue;
        }

        const rect = el.getBoundingClientRect();
        const pos = posForRect(rect);

        if (el instanceof HTMLImageElement) {
          if (opts.deepScan) await maybeDecodeImage(el);
          const candidates = collectImgCandidates(el, rect, opts.deepScan, opts.deepScan);
          const best = pickBestCandidate(candidates);
          const selected = opts.deepScan ? candidates : best ? [best] : [];
          const seen = new Set<string>();
          for (const cand of selected) {
            if (!cand?.url) continue;
            const url = canonicalizeUrl(cand.url);
            if (seen.has(url)) continue;
            seen.add(url);
            // Use the highest known dimension: HTML attrs > srcset w descriptor > naturalWidth
            const htmlW = el.getAttribute('width') ? parseInt(el.getAttribute('width')!, 10) : 0;
            const htmlH = el.getAttribute('height') ? parseInt(el.getAttribute('height')!, 10) : 0;
            const bestW = Math.max(htmlW, cand.quality || 0, el.naturalWidth || 0) || undefined;
            const bestH = Math.max(htmlH, el.naturalHeight || 0) || undefined;
            items.push({
              id: idFor(url, idx++),
              url,
              originType: cand.originType,
              width: bestW,
              height: bestH,
              filenameHint: filenameFromUrl(url),
              srcsetCandidates: cand.srcsetCandidates,
              lazyHint: cand.lazyHint,
              pageX: pos.pageX,
              pageY: pos.pageY,
            });
          }
          continue;
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
              pageY: pos.pageY,
            });
          } catch {
            // ignore
          }
          continue;
        }

        if (el instanceof SVGElement) {
          if (!opts.includeDataUrls) continue;
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
              pageY: pos.pageY,
            });
          } catch {
            // ignore
          }
          continue;
        }

        if (el instanceof HTMLVideoElement && el.poster) {
          const url = canonicalizeUrl(el.poster);
          items.push({
            id: idFor(url, idx++),
            url,
            originType: 'video-poster',
            filenameHint: filenameFromUrl(url),
            pageX: pos.pageX,
            pageY: pos.pageY,
          });
        }

        // Video frame capture (Deep mode only, same-origin)
        if (opts.deepScan && el instanceof HTMLVideoElement && !el.paused && el.readyState >= 2) {
          try {
            const vCanvas = document.createElement('canvas');
            vCanvas.width = el.videoWidth;
            vCanvas.height = el.videoHeight;
            const vCtx = vCanvas.getContext('2d');
            if (vCtx) {
              vCtx.drawImage(el, 0, 0);
              const frameUrl = vCanvas.toDataURL('image/jpeg', 0.92);
              items.push({
                id: idFor(frameUrl, idx++),
                url: frameUrl,
                originType: 'canvas',
                isCanvas: true,
                isDataUrl: true,
                width: el.videoWidth,
                height: el.videoHeight,
                filenameHint: 'video-frame.jpg',
                pageX: pos.pageX,
                pageY: pos.pageY,
              });
            }
          } catch { /* tainted — cross-origin video */ }
        }

        if (el instanceof HTMLInputElement && el.type.toLowerCase() === 'image' && el.src) {
          const url = canonicalizeUrl(el.src);
          items.push({
            id: idFor(url, idx++),
            url,
            originType: 'img',
            filenameHint: filenameFromUrl(url),
            pageX: pos.pageX,
            pageY: pos.pageY,
          });
        }

        if (opts.deepScan && el instanceof HTMLSourceElement) {
          const srcset = el.srcset || el.getAttribute('srcset') || '';
          if (srcset) {
            const parsed = parseSrcset(srcset);
            parsed.forEach((cand) => {
              if (!cand.url) return;
              const url = canonicalizeUrl(cand.url);
              items.push({
                id: idFor(url, idx++),
                url,
                originType: 'picture',
                filenameHint: filenameFromUrl(url),
                pageX: pos.pageX,
                pageY: pos.pageY,
              });
            });
          }
        }

        if (opts.deepScan && el instanceof HTMLScriptElement) {
          const type = (el.type || '').toLowerCase();
          if (type.includes('json')) {
            const text = el.textContent || '';
            let urls = extractUrlsFromText(text);
            if (!urls.length) {
              try {
                const parsed = JSON.parse(text);
                urls = extractUrlsFromJsonValue(parsed);
              } catch {
                // ignore
              }
            }
            for (const raw of urls) {
              if (!looksLikeImageUrl(raw)) continue;
              const url = canonicalizeUrl(raw);
              items.push({
                id: idFor(url, idx++),
                url,
                originType: 'data-attr',
                filenameHint: filenameFromUrl(url),
                pageX: pos.pageX,
                pageY: pos.pageY,
              });
            }
          }
        }

        if (el instanceof HTMLElement) {
          const cssCandidates = collectCssCandidates(el);
          for (const cand of cssCandidates) {
            if (!cand.url) continue;
            const url = canonicalizeUrl(cand.url);
            items.push({
              id: idFor(url, idx++),
              url,
              originType: cand.originType,
              filenameHint: filenameFromUrl(url),
              pageX: pos.pageX,
              pageY: pos.pageY,
            });
            if (opts.deepScan) {
              const derived = deriveOriginalUrl(url);
              if (derived && derived !== url) {
                const absDerived = canonicalizeUrl(derived);
                items.push({
                  id: idFor(absDerived, idx++),
                  url: absDerived,
                  originType: cand.originType,
                  filenameHint: filenameFromUrl(absDerived),
                  pageX: pos.pageX,
                  pageY: pos.pageY,
                });
              }
            }
          }
        }

        if (!opts.deepScan) {
          const lazyCandidates = collectLazyAttributeCandidates(el);
          for (const cand of lazyCandidates) {
            if (!cand?.url) continue;
            const url = canonicalizeUrl(cand.url);
            items.push({
              id: idFor(url, idx++),
              url,
              originType: cand.originType,
              filenameHint: filenameFromUrl(url),
              lazyHint: cand.lazyHint,
              pageX: pos.pageX,
              pageY: pos.pageY,
            });
          }
        }

        if (opts.deepScan) {
          if (el instanceof HTMLAnchorElement && el.href) {
            const linked = extractLinkedImageUrls(el.href);
            for (const url of linked) {
              const abs = canonicalizeUrl(url);
              items.push({
                id: idFor(abs, idx++),
                url: abs,
                originType: 'link-href',
                filenameHint: filenameFromUrl(abs),
                pageX: pos.pageX,
                pageY: pos.pageY,
              });
              const derived = deriveOriginalUrl(abs);
              if (derived && derived !== abs) {
                const absDerived = canonicalizeUrl(derived);
                items.push({
                  id: idFor(absDerived, idx++),
                  url: absDerived,
                  originType: 'link-href',
                  filenameHint: filenameFromUrl(absDerived),
                  pageX: pos.pageX,
                  pageY: pos.pageY,
                });
              }
            }
          }

          const attrCandidates = collectAttributeCandidates(el, true);
          for (const cand of attrCandidates) {
            if (!cand?.url) continue;
            const url = canonicalizeUrl(cand.url);
            items.push({
              id: idFor(url, idx++),
              url,
              originType: cand.originType,
              filenameHint: filenameFromUrl(url),
              lazyHint: cand.lazyHint,
              pageX: pos.pageX,
              pageY: pos.pageY,
            });
            const derived = deriveOriginalUrl(url);
            if (derived && derived !== url) {
              const absDerived = canonicalizeUrl(derived);
              items.push({
                id: idFor(absDerived, idx++),
                url: absDerived,
                originType: cand.originType,
                filenameHint: filenameFromUrl(absDerived),
                lazyHint: cand.lazyHint,
                pageX: pos.pageX,
                pageY: pos.pageY,
              });
            }
          }
        }
      } catch (error) {
        console.warn('Element extraction failed', error);
      }
    }
  }

  // ─── GRID-SEARCH: coordinate-based visual scan ─────────────────────────────
  // For block selections, scan a grid of points inside the selection box to
  // discover images that DOM-tree walking may have missed.
  if (selBounds && !isGlobalScan) {
    const excludeEls: Element[] = [];
    const gridElements = gridSearchImages(selBounds, excludeEls);
    const existingUrls = new Set(items.map(i => i.url));

    for (const el of gridElements) {
      try {
        // Enforce spatial containment on grid-discovered elements too
        const elPageRect = getElementPageRect(el);
        if (elPageRect.width <= 0 || elPageRect.height <= 0) continue;
        const overlap = getOverlapRatio(selBounds, elPageRect);
        if (overlap < overlapThreshold) continue;

        const rect = el.getBoundingClientRect();
        const pos = posForRect(rect);

        if (el instanceof HTMLImageElement) {
          const rawUrl = el.currentSrc || el.src;
          if (!rawUrl) continue;
          const url = canonicalizeUrl(rawUrl);
          if (existingUrls.has(url)) continue;
          existingUrls.add(url);
          // Skip tracking pixels
          if (el.naturalWidth <= 1 && el.naturalHeight <= 1) continue;
          items.push({
            id: idFor(url, idx++),
            url,
            originType: 'img',
            width: el.naturalWidth || undefined,
            height: el.naturalHeight || undefined,
            filenameHint: filenameFromUrl(url),
            pageX: pos.pageX,
            pageY: pos.pageY,
          });
        } else if (el instanceof HTMLCanvasElement) {
          try {
            const dataUrl = el.toDataURL('image/png');
            if (!existingUrls.has(dataUrl)) {
              existingUrls.add(dataUrl);
              items.push({
                id: idFor(dataUrl, idx++),
                url: dataUrl,
                originType: 'canvas',
                isCanvas: true,
                isDataUrl: true,
                width: el.width,
                height: el.height,
                pageX: pos.pageX,
                pageY: pos.pageY,
              });
            }
          } catch { /* tainted canvas */ }
        } else if (el instanceof HTMLVideoElement && el.poster) {
          const url = canonicalizeUrl(el.poster);
          if (!existingUrls.has(url)) {
            existingUrls.add(url);
            items.push({
              id: idFor(url, idx++),
              url,
              originType: 'video-poster',
              filenameHint: filenameFromUrl(url),
              pageX: pos.pageX,
              pageY: pos.pageY,
            });
          }
        } else if (el instanceof HTMLElement) {
          // CSS background image
          const bg = getComputedStyle(el).backgroundImage;
          if (bg && bg !== 'none' && bg.includes('url(')) {
            const bgCandidates = extractCssImageCandidates(bg);
            for (const cand of bgCandidates) {
              const url = canonicalizeUrl(cand.url);
              if (existingUrls.has(url)) continue;
              existingUrls.add(url);
              items.push({
                id: idFor(url, idx++),
                url,
                originType: 'css-background',
                filenameHint: filenameFromUrl(url),
                pageX: pos.pageX,
                pageY: pos.pageY,
              });
            }
          }
          // Check lazy-load attrs
          for (const attr of LAZY_ATTRS) {
            const val = el.getAttribute(attr);
            if (!val) continue;
            const url = canonicalizeUrl(val);
            if (existingUrls.has(url)) continue;
            if (!looksLikeImageUrl(url, 'lazy-attr')) continue;
            existingUrls.add(url);
            items.push({
              id: idFor(url, idx++),
              url,
              originType: 'lazy-attr',
              filenameHint: filenameFromUrl(url),
              lazyHint: true,
              pageX: pos.pageX,
              pageY: pos.pageY,
            });
          }
        }
      } catch {
        // Element extraction from grid search failed — skip
      }
    }
  }

  // ─── STATE MINING (Deep Mode only, block selections) ───────────────────────
  // Search framework state globals for image URLs.
  // Only add URLs that pass spatial containment if we can map them to an element.
  if (opts.deepScan && !isGlobalScan) {
    try {
      const stateUrls = extractFromPageStates();
      const existingUrls = new Set(items.map(i => i.url));

      for (const rawUrl of stateUrls) {
        const url = canonicalizeUrl(rawUrl);
        if (existingUrls.has(url)) continue;
        if (!looksLikeImageUrl(url, 'data-attr')) continue;

        // Try to find this URL rendered somewhere in the DOM to verify its position
        let matched = false;
        if (selBounds) {
          const allImgs = document.querySelectorAll('img');
          for (const img of Array.from(allImgs) as HTMLImageElement[]) {
            const imgUrl = canonicalizeUrl(img.currentSrc || img.src || '');
            if (imgUrl !== url) continue;
            // Found a match — check spatial containment
            const imgRect = getElementPageRect(img);
            if (imgRect.width <= 0 || imgRect.height <= 0) continue;
            const overlap = getOverlapRatio(selBounds, imgRect);
            if (overlap >= overlapThreshold) {
              matched = true;
              existingUrls.add(url);
              items.push({
                id: idFor(url, idx++),
                url,
                originType: 'img',
                width: img.naturalWidth || undefined,
                height: img.naturalHeight || undefined,
                filenameHint: filenameFromUrl(url),
                pageX: imgRect.x,
                pageY: imgRect.y,
              });
              break;
            }
          }
        }

        // If we couldn't map to a DOM element but deepScan is on and we
        // have very few results, include it as a data-attr fallback
        if (!matched && items.length < 3) {
          existingUrls.add(url);
          items.push({
            id: idFor(url, idx++),
            url,
            originType: 'data-attr',
            filenameHint: filenameFromUrl(url),
          });
        }
      }
    } catch {
      // State mining failed — non-fatal
    }
  }

  // ─── FILTER & DEDUPLICATE ─────────────────────────────────────────────────
  let result = items
    .filter((item) => {
      const url = item.url.toLowerCase();
      if (url.startsWith('data:')) {
        if (!opts.includeDataUrls) return false;
        const mime = extractDataUrlMime(item.url);
        return isAllowedMime(mime) && !mime.toLowerCase().includes('svg');
      }
      if (url.startsWith('blob:')) {
        if (!opts.includeBlobUrls) return false;
        const allowedOrigins: OriginType[] = [
          'img',
          'srcset',
          'picture',
          'css-background',
          'css-mask',
          'css-content',
          'image-set',
          'video-poster',
          'lazy-attr',
          'canvas',
        ];
        return allowedOrigins.includes(item.originType);
      }
      
      // Explicitly block SVG/ICO
      if (url.endsWith('.svg') || url.includes('svg+xml')) return false;
      if (url.endsWith('.ico')) return false;
      
      // Trust direct image elements with real dimensions (>1px to block pixels)
      if (item.originType === 'img' || item.originType === 'picture') {
        if ((item.width && item.width > 1) || (item.height && item.height > 1)) {
          return true;
        }
      }
      
      // For others, require a valid extension or strong hint
      return looksLikeImageUrl(item.url, item.originType);
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

  // ─── DIMENSION-BASED DEDUP ─────────────────────────────────────────────────
  // Group by (width×height + hostname). Keep the highest-scored candidate
  // from each group. This removes visual duplicates served from the same CDN
  // at slightly different query params.
  if (selBounds && result.length > 1) {
    const dimGroups = new Map<string, ExtractedImage[]>();
    for (const item of result) {
      if (!item.width || !item.height) continue;
      let host = '';
      try { host = new URL(item.url).hostname; } catch { /* data: urls */ }
      const key = `${item.width}x${item.height}@${host}`;
      const group = dimGroups.get(key) || [];
      group.push(item);
      dimGroups.set(key, group);
    }
    const toRemove = new Set<string>();
    for (const [, group] of dimGroups) {
      if (group.length <= 1) continue;
      // Score each and keep the best
      group.sort((a, b) => computeSemanticScore(b, selBounds) - computeSemanticScore(a, selBounds));
      for (let i = 1; i < group.length; i++) {
        toRemove.add(group[i].id);
      }
    }
    if (toRemove.size > 0) {
      result = result.filter(item => !toRemove.has(item.id));
    }
  }

  // ─── ASYNC URL VALIDATION & CLEANING (DEEP MODE) ───────────────────────────
  // We surgically clean CDN URLs (removing resize/format params), but we must
  // TEST them before adopting them to ensure they don't 404. We run validation
  // concurrently using fast HEAD requests via the background worker.
  if (opts.deepScan) {
    await Promise.all(result.map(async (item) => {
      if (item.url.startsWith('data:') || item.url.startsWith('blob:')) return;
      
      const cleaned = cleanImageUrl(item.url);
      if (!cleaned || cleaned === item.url) return;
      
      try {
        const fetchRes = await new Promise<{bytes?: number}>((resolve) => {
          chrome.runtime.sendMessage({ type: 'FETCH_SIZE', url: cleaned }, resolve);
        });
        if (fetchRes && fetchRes.bytes && fetchRes.bytes > 0) {
          // Clean URL is valid! Update the extraction item.
          item.url = cleaned;
          item.filenameHint = filenameFromUrl(cleaned) || item.filenameHint;
        }
      } catch {
        // Validation failed, transparently fallback to original URL (item.url is unchanged)
      }
    }));
  }

  // ─── ROBUST <img> FALLBACK ─────────────────────────────────────────────────
  // If the full pipeline returned 0 images for a block selection,
  // do an emergency sweep of the roots for plain <img> tags.
  if (result.length === 0 && !isGlobalScan) {
    const fallbackSeen = new Set<string>();
    for (const root of roots) {
      const imgs = root.querySelectorAll('img');
      for (const img of Array.from(imgs) as HTMLImageElement[]) {
        const rawUrl = img.currentSrc || img.src;
        if (!rawUrl) continue;
        const url = canonicalizeUrl(rawUrl);
        if (fallbackSeen.has(url)) continue;
        fallbackSeen.add(url);
        // Skip tiny tracking pixels
        if (img.naturalWidth <= 1 && img.naturalHeight <= 1) continue;
        result.push({
          id: idFor(url, idx++),
          url,
          originType: 'img',
          width: img.naturalWidth || undefined,
          height: img.naturalHeight || undefined,
          filenameHint: filenameFromUrl(url),
          pageX: img.getBoundingClientRect().left + window.scrollX,
          pageY: img.getBoundingClientRect().top + window.scrollY,
        });
      }
      // Also check for CSS background images on the root itself
      if (root instanceof HTMLElement) {
        const style = getComputedStyle(root);
        if (style.backgroundImage && style.backgroundImage !== 'none' && style.backgroundImage.includes('url(')) {
          const bgCandidates = extractCssImageCandidates(style.backgroundImage);
          for (const cand of bgCandidates) {
            const url = canonicalizeUrl(cand.url);
            if (fallbackSeen.has(url)) continue;
            fallbackSeen.add(url);
            result.push({
              id: idFor(url, idx++),
              url,
              originType: 'css-background',
              filenameHint: filenameFromUrl(url),
            });
          }
        }
      }
    }
  }

  // ─── SEMANTIC SCORING & SORT ────────────────────────────────────────────────
  // Sort results by relevance so the most likely intended images come first.
  result.sort((a, b) => {
    const scoreA = computeSemanticScore(a, selBounds);
    const scoreB = computeSemanticScore(b, selBounds);
    return scoreB - scoreA;
  });

  return result;
}
