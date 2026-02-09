/**
 * Base Handler Interface
 * 
 * Defines the contract for site-specific image extraction handlers.
 * Each handler can implement custom logic for extracting images from specific sites.
 */

import { ExtractedImage, ExtractOptions } from '../utils/types';

/**
 * A site-specific handler for enhanced image extraction
 */
export interface SiteHandler {
  /** Handler name for debugging/logging */
  name: string;
  
  /** Regex patterns that match the site's hostname */
  hostPatterns: RegExp[];
  
  /** Priority (higher = checked first when multiple handlers match) */
  priority?: number;
  
  /**
   * Enhance element selection - transform clicked element to better target
   * Called after element selection to potentially expand or redirect selection
   */
  enhanceSelection?(element: Element): Element | Element[];
  
  /**
   * Extract images from a selected element/region
   * This is the primary extraction method for user-selected areas
   */
  extractImages(root: Element, options?: ExtractOptions): ExtractedImage[];
  
  /**
   * Extract all images from the page (for full page scan)
   */
  extractPageImages?(options?: ExtractOptions): ExtractedImage[];
  
  /**
   * Derive original/high-resolution URL from a thumbnail URL
   * Site-specific logic to upgrade image quality
   */
  deriveOriginalUrl?(thumbUrl: string): string | null;
  
  /**
   * Check if an element is an overlay/control specific to this site
   */
  isOverlayElement?(element: Element): boolean;
  
  /**
   * Get alternative/additional image URLs from an element
   * For sites that store multiple resolutions in data attributes
   */
  getAlternativeUrls?(element: Element): string[];
}

/**
 * Base implementation with common utilities
 */
export abstract class BaseSiteHandler implements SiteHandler {
  abstract name: string;
  abstract hostPatterns: RegExp[];
  priority = 0;
  
  abstract extractImages(root: Element, options?: ExtractOptions): ExtractedImage[];
  
  /**
   * Utility: Create an ExtractedImage object
   */
  protected createImage(
    url: string,
    originType: ExtractedImage['originType'] = 'img',
    extra: Partial<ExtractedImage> = {}
  ): ExtractedImage {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${url.slice(0, 40)}`;
    return {
      id,
      url,
      originType,
      filenameHint: this.filenameFromUrl(url),
      ...extra,
    };
  }
  
  /**
   * Utility: Extract filename from URL
   */
  protected filenameFromUrl(url: string): string {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/');
      const last = parts[parts.length - 1];
      if (last && last.includes('.')) {
        return decodeURIComponent(last);
      }
      return 'image';
    } catch {
      return 'image';
    }
  }
  
  /**
   * Utility: Canonicalize URL (make absolute, remove hash)
   */
  protected canonicalizeUrl(url: string): string {
    try {
      const u = new URL(url, location.href);
      u.hash = '';
      return u.toString();
    } catch {
      return url;
    }
  }
  
  /**
   * Utility: Parse JSON from script tags
   */
  protected parseScriptJson<T>(selector: string): T | null {
    const script = document.querySelector<HTMLScriptElement>(selector);
    if (!script?.textContent) return null;
    try {
      return JSON.parse(script.textContent) as T;
    } catch {
      return null;
    }
  }
  
  /**
   * Utility: Extract URLs matching a pattern from HTML
   */
  protected extractUrlsFromHtml(html: string, pattern: RegExp): string[] {
    const urls: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      if (match[1]) urls.push(match[1]);
    }
    return urls;
  }
  
  /**
   * Utility: Recursively extract string values from JSON by key
   */
  protected extractJsonValues(obj: unknown, keys: string[], seen = new WeakSet()): string[] {
    const results: string[] = [];
    
    if (obj === null || obj === undefined) return results;
    if (typeof obj !== 'object') return results;
    if (seen.has(obj as object)) return results;
    seen.add(obj as object);
    
    if (Array.isArray(obj)) {
      for (const item of obj) {
        results.push(...this.extractJsonValues(item, keys, seen));
      }
    } else {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (keys.includes(key) && typeof value === 'string') {
          results.push(value);
        }
        if (typeof value === 'object') {
          results.push(...this.extractJsonValues(value, keys, seen));
        }
      }
    }
    
    return results;
  }
  
  /**
   * Utility: Deduplicate images by URL
   */
  protected deduplicateImages(images: ExtractedImage[]): ExtractedImage[] {
    const seen = new Set<string>();
    return images.filter(img => {
      if (seen.has(img.url)) return false;
      seen.add(img.url);
      return true;
    });
  }
  
  /**
   * Utility: Check if URL looks like an image
   */
  protected looksLikeImageUrl(url: string): boolean {
    if (url.startsWith('data:image/')) return true;
    if (url.startsWith('blob:')) return true;
    return /\.(jpg|jpeg|png|webp|avif|gif)(\?|$)/i.test(url);
  }
  
  /**
   * Utility: Decode escaped URL characters
   */
  protected decodeEscapedUrl(url: string): string {
    return url
      .replace(/\\u002F/gi, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/\\u003A/gi, ':')
      .replace(/\\u003D/gi, '=')
      .replace(/\\\//g, '/')
      .replace(/^"+|"+$/g, '');
  }
}
