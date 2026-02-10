/**
 * Pinterest Handler
 * 
 * Specialized extraction for Pinterest pins and boards.
 * Handles pin viewer overlays and extracts high-resolution originals.
 */

import { BaseSiteHandler } from './base';
import { ExtractedImage, ExtractOptions } from '../utils/types';

/**
 * Pinterest pin image structure
 */
interface PinterestImage {
  url: string;
  width: number;
  height: number;
}

export class PinterestHandler extends BaseSiteHandler {
  name = 'pinterest';
  hostPatterns = [/pinterest\.(com|co\.\w+|[\w]+)$/i, /pinimg\.com$/i];
  priority = 10;
  
  // Pinterest overlay selectors
  private readonly overlaySelectors = [
    '[data-test-id="closeup-closebutton"]',
    '[data-test-id="pin-action-bar"]',
    '[data-test-id="related-pins-header"]',
    '[aria-label="Close"]',
    '[class*="closeup"] header',
    '[class*="CloseButton"]',
    '[class*="ActionBar"]',
    'nav',
    'footer',
  ];
  
  // Size variants in Pinterest URLs (smallest to largest)
  private readonly sizeVariants = [
    { pattern: /\/\d+x\d*\//, replacement: '/originals/' },
    { pattern: /\/\d+x\//, replacement: '/originals/' },
    { pattern: /\/thumb\//, replacement: '/originals/' },
    { pattern: /\/small\//, replacement: '/originals/' },
    { pattern: /\/medium\//, replacement: '/originals/' },
    { pattern: /\/236x\//, replacement: '/originals/' },
    { pattern: /\/474x\//, replacement: '/originals/' },
    { pattern: /\/564x\//, replacement: '/originals/' },
    { pattern: /\/736x\//, replacement: '/originals/' },
  ];
  
  isOverlayElement(element: Element): boolean {
    return this.overlaySelectors.some(selector => {
      try {
        return element.matches(selector) || element.closest(selector) !== null;
      } catch {
        return false;
      }
    });
  }
  
  enhanceSelection(element: Element): Element | Element[] {
    // For pin closeup, find the main image container
    const closeup = element.closest('[data-test-id="closeup-container"]');
    if (closeup) {
      const imgContainer = closeup.querySelector('[data-test-id="pin-closeup-image"], [class*="PinImage"]');
      if (imgContainer) return imgContainer;
    }
    
    // For pin cards on the grid
    const pinCard = element.closest('[data-test-id="pin"], [data-grid-item]');
    if (pinCard) {
      return pinCard;
    }
    
    return element;
  }
  
  extractImages(root: Element, options?: ExtractOptions): ExtractedImage[] {
    const images: ExtractedImage[] = [];
    const deep = options?.deepScan ?? false;
    
    // 1. Direct img elements
    const imgElements = root.querySelectorAll('img');
    Array.from(imgElements).forEach(img => {
      const src = img.currentSrc || img.src;
      if (!src) return;
      
      // Skip non-Pinterest CDN images (likely UI elements)
      if (!this.isPinterestCdnUrl(src) && src.includes('pinterest')) return;
      
      images.push(this.createImage(src, 'img', {
        width: img.naturalWidth,
        height: img.naturalHeight,
      }));
      
      // Try to derive original
      if (deep) {
        const original = this.deriveOriginalUrl(src);
        if (original && original !== src) {
          images.push(this.createImage(original, 'link-href'));
        }
      }
      
      // Check srcset
      if (img.srcset) {
        const srcsetUrls = this.parseSrcset(img.srcset);
        for (const urlInfo of srcsetUrls) {
          images.push(this.createImage(urlInfo.url, 'srcset'));
          
          if (deep) {
            const original = this.deriveOriginalUrl(urlInfo.url);
            if (original) {
              images.push(this.createImage(original, 'link-href'));
            }
          }
        }
      }
    });
    
    // 2. Background images
    const allElements = root.querySelectorAll<HTMLElement>('*');
    Array.from(allElements).forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none' && bg.includes('url(')) {
        const urls = this.extractCssUrls(bg);
        for (const url of urls) {
          if (this.isPinterestCdnUrl(url)) {
            images.push(this.createImage(url, 'css-background'));
            
            if (deep) {
              const original = this.deriveOriginalUrl(url);
              if (original) {
                images.push(this.createImage(original, 'link-href'));
              }
            }
          }
        }
      }
    });
    
    // 3. Deep scan: Parse Pinterest's __PWS_DATA__
    if (deep) {
      const pwsImages = this.extractFromPwsData(root);
      images.push(...pwsImages);
    }
    
    return this.deduplicateImages(images);
  }
  
  extractPageImages(options?: ExtractOptions): ExtractedImage[] {
    const images: ExtractedImage[] = [];
    const deep = options?.deepScan ?? false;
    
    // Extract from __PWS_DATA__
    const pwsData = this.getPwsData();
    if (pwsData) {
      const urls = this.extractPinterestUrls(pwsData);
      for (const url of urls) {
        images.push(this.createImage(url, 'link-href'));
        
        if (deep) {
          const original = this.deriveOriginalUrl(url);
          if (original && original !== url) {
            images.push(this.createImage(original, 'link-href'));
          }
        }
      }
    }
    
    // Extract from Redux store
    const reduxData = this.getReduxData();
    if (reduxData) {
      const urls = this.extractPinterestUrls(reduxData);
      for (const url of urls) {
        images.push(this.createImage(url, 'data-attr'));
        
        if (deep) {
          const original = this.deriveOriginalUrl(url);
          if (original && original !== url) {
            images.push(this.createImage(original, 'link-href'));
          }
        }
      }
    }
    
    // Scan all JSON script tags
    if (deep) {
      const scripts = document.querySelectorAll('script[type="application/json"]');
      Array.from(scripts).forEach(script => {
        const text = script.textContent || '';
        if (!text.includes('pinimg')) return;
        
        try {
          const data = JSON.parse(text);
          const urls = this.extractPinterestUrls(data);
          for (const url of urls) {
            images.push(this.createImage(url, 'data-attr'));
            
            const original = this.deriveOriginalUrl(url);
            if (original && original !== url) {
              images.push(this.createImage(original, 'link-href'));
            }
          }
        } catch {
          // Ignore parse errors
        }
      });
    }
    
    // Also run regular extraction on body
    images.push(...this.extractImages(document.body, options));
    
    return this.deduplicateImages(images);
  }
  
  deriveOriginalUrl(thumbUrl: string): string | null {
    if (!this.isPinterestCdnUrl(thumbUrl)) return null;
    
    let result = thumbUrl;
    
    // Apply all size transformations
    for (const variant of this.sizeVariants) {
      if (variant.pattern.test(result)) {
        result = result.replace(variant.pattern, variant.replacement);
        break; // Only apply first matching transformation
      }
    }
    
    return result !== thumbUrl ? result : null;
  }
  
  // === Private helpers ===
  
  private isPinterestCdnUrl(url: string): boolean {
    return /pinimg\.com/i.test(url);
  }
  
  private getPwsData(): unknown {
    // Pinterest stores data in __PWS_DATA__ script
    try {
      const script = document.querySelector('#__PWS_DATA__');
      if (script?.textContent) {
        return JSON.parse(script.textContent);
      }
    } catch {
      // Ignore
    }
    
    // Also check for data-test-id variant
    try {
      const script = document.querySelector('script[data-test-id="__PWS_DATA__"]');
      if (script?.textContent) {
        return JSON.parse(script.textContent);
      }
    } catch {
      // Ignore
    }
    
    return null;
  }
  
  private getReduxData(): unknown {
    // Check for Redux/initial state
    try {
      const script = document.querySelector('#initial-state');
      if (script?.textContent) {
        return JSON.parse(script.textContent);
      }
    } catch {
      // Ignore
    }
    
    // Also try window.__PRELOADED_STATE__
    try {
      return (window as any).__PRELOADED_STATE__;
    } catch {
      return null;
    }
  }
  
  private extractFromPwsData(root: Element): ExtractedImage[] {
    const images: ExtractedImage[] = [];
    
    // Find data attributes that might contain pin data
    const elementsWithData = root.querySelectorAll('[data-pin-id], [data-test-id*="pin"]');
    Array.from(elementsWithData).forEach(el => {
      // Check for various data attributes
      for (const attr of el.getAttributeNames()) {
        if (!attr.startsWith('data-')) continue;
        const value = el.getAttribute(attr);
        if (!value) continue;
        
        // Look for URLs in the value
        if (value.includes('pinimg')) {
          images.push(this.createImage(value, 'data-attr'));
        }
        
        // Try to parse as JSON
        if (value.startsWith('{') || value.startsWith('[')) {
          try {
            const data = JSON.parse(value);
            const urls = this.extractPinterestUrls(data);
            for (const url of urls) {
              images.push(this.createImage(url, 'data-attr'));
            }
          } catch {
            // Not JSON
          }
        }
      }
    });
    
    return images;
  }
  
  private extractPinterestUrls(data: unknown, seen = new WeakSet()): string[] {
    const urls: string[] = [];
    
    if (data === null || data === undefined) return urls;
    if (typeof data !== 'object') {
      if (typeof data === 'string' && this.isPinterestCdnUrl(data)) {
        urls.push(data);
      }
      return urls;
    }
    if (seen.has(data as object)) return urls;
    seen.add(data as object);
    
    if (Array.isArray(data)) {
      for (const item of data) {
        urls.push(...this.extractPinterestUrls(item, seen));
      }
    } else {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        // Prioritize known image keys
        if (['url', 'src', 'original', 'originals', '736x', '474x', '564x'].includes(key)) {
          if (typeof value === 'string' && this.isPinterestCdnUrl(value)) {
            urls.push(value);
          }
        }
        if (typeof value === 'object') {
          urls.push(...this.extractPinterestUrls(value, seen));
        }
      }
    }
    
    return urls;
  }
  
  private parseSrcset(srcset: string): Array<{ url: string; width?: number }> {
    return srcset.split(',').map(part => {
      const [url, descriptor] = part.trim().split(/\s+/);
      const result: { url: string; width?: number } = { url };
      if (descriptor?.endsWith('w')) {
        result.width = parseInt(descriptor, 10);
      }
      return result;
    }).filter(r => r.url);
  }
  
  private extractCssUrls(value: string): string[] {
    const urls: string[] = [];
    const re = /url\((['"]?)(.*?)\1\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value))) {
      if (match[2]) urls.push(match[2]);
    }
    return urls;
  }
}

export const pinterestHandler = new PinterestHandler();
