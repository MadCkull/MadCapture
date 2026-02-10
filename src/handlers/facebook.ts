/**
 * Facebook Handler
 * 
 * Specialized extraction for Facebook photos and posts.
 * Handles Theater/Lightbox mode and Facebook's CDN URLs.
 */

import { BaseSiteHandler } from './base';
import { ExtractedImage, ExtractOptions } from '../utils/types';

export class FacebookHandler extends BaseSiteHandler {
  name = 'facebook';
  hostPatterns = [/facebook\.com$/i, /fb\.com$/i, /fbcdn\.net$/i];
  priority = 10;
  
  // Facebook overlay selectors
  private readonly overlaySelectors = [
    '[role="dialog"] [aria-label*="Close"]',
    '[role="dialog"] [aria-label*="close"]',
    '[aria-label*="Like"]',
    '[aria-label*="Comment"]',
    '[aria-label*="Share"]',
    '[aria-label*="React"]',
    '[aria-label*="Previous"]',
    '[aria-label*="Next"]',
    '[class*="closeButton"]',
    '[class*="navButton"]',
    'nav',
    '[role="navigation"]',
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
    // For photo theater/lightbox
    const dialog = element.closest('[role="dialog"]');
    if (dialog) {
      // Find the main image container
      const imgContainer = dialog.querySelector('img[data-visualcompletion="media-vc-image"]');
      if (imgContainer) return imgContainer.parentElement || imgContainer;
      
      // Fallback: any large image
      const images = dialog.querySelectorAll('img');
      const largeImage = Array.from(images).find(img => img.naturalWidth > 200);
      if (largeImage) return largeImage.parentElement || largeImage;
    }
    
    // For posts
    const post = element.closest('[data-pagelet*="FeedUnit"], [role="article"]');
    if (post) {
      return post;
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
      if (!src || src.startsWith('data:')) return;
      
      // Skip tiny images
      if (img.width < 50 && img.height < 50) return;
      
      // Skip emoji/reaction images
      if (img.alt?.match(/^(like|love|haha|wow|sad|angry)$/i)) return;
      
      images.push(this.createImage(src, 'img', {
        width: img.naturalWidth,
        height: img.naturalHeight,
      }));
      
      // Try to get higher res version
      if (deep) {
        const highRes = this.deriveOriginalUrl(src);
        if (highRes && highRes !== src) {
          images.push(this.createImage(highRes, 'link-href'));
        }
      }
    });
    
    // 2. Background images
    if (deep) {
      const allElements = root.querySelectorAll<HTMLElement>('*');
      Array.from(allElements).forEach(el => {
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none' && bg.includes('url(')) {
          const urls = this.extractCssUrls(bg);
          for (const url of urls) {
            if (this.isFacebookCdnUrl(url)) {
              images.push(this.createImage(url, 'css-background'));
            }
          }
        }
      });
    }
    
    // 3. Data attributes
    const elementsWithData = root.querySelectorAll('[data-src], [data-ploi], [data-store]');
    Array.from(elementsWithData).forEach(el => {
      const dataSrc = el.getAttribute('data-src');
      if (dataSrc && this.isFacebookCdnUrl(dataSrc)) {
        images.push(this.createImage(dataSrc, 'data-attr'));
      }
      
      const dataPloi = el.getAttribute('data-ploi');
      if (dataPloi && this.isFacebookCdnUrl(dataPloi)) {
        images.push(this.createImage(dataPloi, 'data-attr'));
      }
      
      // Try to parse data-store as JSON
      const dataStore = el.getAttribute('data-store');
      if (dataStore) {
        try {
          const store = JSON.parse(dataStore);
          const urls = this.extractJsonValues(store, ['src', 'url', 'uri', 'image']);
          for (const url of urls) {
            if (this.isFacebookCdnUrl(url)) {
              images.push(this.createImage(url, 'data-attr'));
            }
          }
        } catch {
          // Not JSON
        }
      }
    });
    
    return this.deduplicateImages(images);
  }
  
  extractPageImages(options?: ExtractOptions): ExtractedImage[] {
    const images: ExtractedImage[] = [];
    const deep = options?.deepScan ?? false;
    
    // Scan HTML for CDN URLs
    if (deep) {
      const html = document.documentElement.innerHTML;
      
      // Scontent URLs
      const scontentPattern = /"(https?:\/\/scontent[^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = scontentPattern.exec(html))) {
        if (match[1] && this.looksLikeImageUrl(match[1])) {
          const decoded = this.decodeEscapedUrl(match[1]);
          images.push(this.createImage(decoded, 'data-attr'));
        }
      }
      
      // FBcdn URLs
      const fbcdnPattern = /"(https?:\/\/[^"]*fbcdn[^"]+)"/g;
      while ((match = fbcdnPattern.exec(html))) {
        if (match[1] && this.looksLikeImageUrl(match[1])) {
          const decoded = this.decodeEscapedUrl(match[1]);
          images.push(this.createImage(decoded, 'data-attr'));
        }
      }
    }
    
    // Regular extraction
    images.push(...this.extractImages(document.body, options));
    
    return this.deduplicateImages(images);
  }
  
  deriveOriginalUrl(thumbUrl: string): string | null {
    if (!this.isFacebookCdnUrl(thumbUrl)) return null;
    
    try {
      const url = new URL(thumbUrl);
      
      // Remove size limiting parameters
      const limitingParams = ['_nc_cat', '_nc_ohc', '_nc_ht', '_nc_sid', 'oh', 'oe', 'dl'];
      for (const param of limitingParams) {
        // Keep these, they're for auth
      }
      
      // Try to increase dimensions in path
      const newPath = url.pathname
        .replace(/\/s\d+x\d+\//, '/s2048x2048/')
        .replace(/\/p\d+x\d+\//, '/p2048x2048/')
        .replace(/\/c\d+\.\d+\.\d+\.\d+\//, '/'); // Remove crop
      
      if (newPath !== url.pathname) {
        url.pathname = newPath;
        return url.toString();
      }
    } catch {
      // URL parsing failed
    }
    
    return null;
  }
  
  // === Private helpers ===
  
  private isFacebookCdnUrl(url: string): boolean {
    return /scontent|fbcdn/i.test(url);
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

export const facebookHandler = new FacebookHandler();
