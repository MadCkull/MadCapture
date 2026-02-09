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
const SIZE_QUERY_KEYS = ['w', 'width', 'h', 'height', 'size', 's', 'sz'];
const QUALITY_QUERY_KEYS = ['q', 'quality'];
const DPR_QUERY_KEYS = ['dpr'];

type ViewportBounds = { left: number; right: number; top: number; bottom: number };

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

function looksLikeImageUrl(url: string): boolean {
  if (url.startsWith('data:image/')) return true;
  if (url.startsWith('blob:')) return true;
  return getAllowedExtFromUrl(url) !== null;
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
  return isAllowedExt(ext) ? normalizeExt(ext || '') : null;
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

function deriveOriginalUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl, location.href);
  } catch {
    return null;
  }

  if (/pinimg\.com$/i.test(url.hostname)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length > 1 && parts[0] !== 'originals') {
      parts[0] = 'originals';
      url.pathname = `/${parts.join('/')}`;
      return url.toString();
    }
  }

  let changed = false;
  SIZE_QUERY_KEYS.forEach((key) => {
    if (!url.searchParams.has(key)) return;
    const current = Number(url.searchParams.get(key));
    const next = Number.isFinite(current) ? Math.max(current, 2048) : 2048;
    url.searchParams.set(key, String(next));
    changed = true;
  });
  QUALITY_QUERY_KEYS.forEach((key) => {
    if (!url.searchParams.has(key)) return;
    url.searchParams.set(key, '95');
    changed = true;
  });
  DPR_QUERY_KEYS.forEach((key) => {
    if (!url.searchParams.has(key)) return;
    url.searchParams.set(key, '2');
    changed = true;
  });

  if (changed) return url.toString();

  const stripped = rawUrl
    .replace(/=w\d+-h\d+[^&?#]*/i, '')
    .replace(/=s\d+[^&?#]*/i, '')
    .replace(/=w\d+[^&?#]*/i, '')
    .replace(/=h\d+[^&?#]*/i, '');
  if (stripped !== rawUrl && looksLikeImageUrl(stripped)) return stripped;

  if (/\/upload\//i.test(rawUrl) && /\/upload\/[^/]*(w_|h_|c_|q_|f_)/i.test(rawUrl)) {
    const cleaned = rawUrl.replace(
      /(\/upload\/)[^/]+\/(?=[^/]+\.[a-z]{3,5}(?:$|[?#]))/i,
      '$1',
    );
    if (cleaned !== rawUrl && looksLikeImageUrl(cleaned)) return cleaned;
  }

  return null;
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
  displayWidth: number | undefined,
): SrcSetCandidate | undefined {
  if (!candidates.length) return undefined;
  if (!displayWidth || !Number.isFinite(displayWidth)) {
    return candidates.sort((a, b) => (b.width ?? b.density ?? 0) - (a.width ?? a.density ?? 0))[0];
  }
  const target = displayWidth * (window.devicePixelRatio || 1);
  const withWidth = candidates.filter((c) => Number.isFinite(c.width));
  if (withWidth.length) {
    const above = withWidth
      .filter((c) => (c.width as number) >= target)
      .sort((a, b) => (a.width as number) - (b.width as number))[0];
    return above ?? withWidth.sort((a, b) => (b.width as number) - (a.width as number))[0];
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
  const opts: Required<ExtractOptions> = {
    deepScan: options.deepScan ?? false,
    visibleOnly: options.visibleOnly ?? false,
    viewportPadding:
      options.viewportPadding ??
      Math.min(500, Math.round(window.innerHeight * 0.25)),
    includeDataUrls: options.includeDataUrls ?? true,
    includeBlobUrls: options.includeBlobUrls ?? true,
  };

  const bounds = opts.visibleOnly ? getViewportBounds(opts.viewportPadding) : null;
  const items: ExtractedImage[] = [];
  let idx = 0;
  const includeGlobal = roots.some(
    (root) => root === document.body || root === document.documentElement,
  );

  // === Site-specific handler extraction ===
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
          const handlerImages = handler.extractImages(root, opts);
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

  // === Generic extraction (always run to catch anything handler missed) ===
  if (opts.deepScan && includeGlobal) {
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

  for (const root of roots) {
    const elements = collectElements(root, opts.deepScan);
    for (const el of elements) {
      try {
        if (bounds && !isVisibleInBounds(el, bounds)) continue;
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
            items.push({
              id: idFor(url, idx++),
              url,
              originType: cand.originType,
              width: el.naturalWidth || undefined,
              height: el.naturalHeight || undefined,
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

  return items
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
      if (url.endsWith('.svg') || url.includes('svg+xml')) return false;
      return getAllowedExtFromUrl(item.url) !== null;
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
