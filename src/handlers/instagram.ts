/**
 * Instagram Handler
 * 
 * Specialized extraction for Instagram posts, stories, and reels.
 * Handles the overlay-heavy modal image viewer.
 */

import { BaseSiteHandler } from './base';
import { ExtractedImage, ExtractOptions } from '../utils/types';

/**
 * Instagram image data structure (simplified)
 */
interface IGImageCandidate {
  url: string;
  width: number;
  height: number;
}

interface IGMediaResource {
  src: string;
  config_width: number;
  config_height: number;
}

export class InstagramHandler extends BaseSiteHandler {
  name = 'instagram';
  hostPatterns = [/instagram\.com$/i, /cdninstagram\.com$/i];
  priority = 10;
  
  // Instagram-specific overlay selectors
  private readonly overlaySelectors = [
    '[role="dialog"] > div:first-child:not(:has(img))',
    'article header',
    '[aria-label="Close"]',
    '[aria-label*="Like"]',
    '[aria-label*="Comment"]',
    '[aria-label*="Share"]',
    '[aria-label*="Save"]',
    '[aria-label*="More options"]',
    'nav',
    'footer',
    '[class*="BottomSheet"]',
    '[class*="ActionBar"]',
  ];
  
  // Keys that contain image URLs in Instagram's JSON data
  private readonly imageKeys = [
    'display_url',
    'display_resources',
    'thumbnail_src',
    'thumbnail_resources',
    'src',
    'url',
    'image_src',
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
    // If we clicked on an image, try to find the parent article/post container
    const article = element.closest('article');
    if (article) {
      return article;
    }
    
    // For modal dialogs, find the main image container
    const dialog = element.closest('[role="dialog"]');
    if (dialog) {
      // Look for the main image area (usually a div with the image)
      const imgContainer = dialog.querySelector('div:has(> img[style*="object-fit"])');
      if (imgContainer) return imgContainer;
      
      // Fallback: find any container with images
      const hasImg = dialog.querySelector('div:has(img)');
      if (hasImg) return hasImg;
    }
    
    return element;
  }
  
  extractImages(root: Element, options?: ExtractOptions): ExtractedImage[] {
    const images: ExtractedImage[] = [];
    const deep = options?.deepScan ?? false;
    
    // 1. Direct img elements
    const imgElements = root.querySelectorAll('img');
    for (const img of imgElements) {
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) continue;
      
      // Skip tiny images (likely icons)
      if (img.naturalWidth && img.naturalWidth < 50) continue;
      
      images.push(this.createImage(src, 'img', {
        width: img.naturalWidth,
        height: img.naturalHeight,
      }));
      
      // Also check srcset for higher res versions
      if (img.srcset) {
        const srcsetUrls = this.parseSrcset(img.srcset);
        for (const urlInfo of srcsetUrls) {
          if (urlInfo.url !== src) {
            images.push(this.createImage(urlInfo.url, 'srcset'));
          }
        }
      }
    }
    
    // 2. Video poster images
    const videos = root.querySelectorAll('video');
    for (const video of videos) {
      if (video.poster) {
        images.push(this.createImage(video.poster, 'video-poster'));
      }
    }
    
    // 3. Background images
    const allElements = root.querySelectorAll<HTMLElement>('*');
    for (const el of allElements) {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none' && bg.includes('url(')) {
        const urls = this.extractCssUrls(bg);
        for (const url of urls) {
          if (this.looksLikeImageUrl(url) && !url.startsWith('data:')) {
            images.push(this.createImage(url, 'css-background'));
          }
        }
      }
    }
    
    // 4. Deep scan: Parse Instagram's embedded JSON data
    if (deep) {
      const jsonImages = this.extractFromJsonData(root);
      images.push(...jsonImages);
    }
    
    return this.deduplicateImages(images);
  }
  
  extractPageImages(options?: ExtractOptions): ExtractedImage[] {
    const images: ExtractedImage[] = [];
    const deep = options?.deepScan ?? false;
    
    // Extract from _sharedData
    const sharedData = this.getSharedData();
    if (sharedData) {
      const urls = this.extractJsonValues(sharedData, this.imageKeys);
      for (const url of urls) {
        if (this.isInstagramCdnUrl(url)) {
          images.push(this.createImage(url, 'link-href'));
        }
      }
    }
    
    // Extract from additionalDataLoaded
    const additionalData = this.getAdditionalData();
    if (additionalData) {
      const urls = this.extractJsonValues(additionalData, this.imageKeys);
      for (const url of urls) {
        if (this.isInstagramCdnUrl(url)) {
          images.push(this.createImage(url, 'link-href'));
        }
      }
    }
    
    // Extract from all script tags with JSON
    if (deep) {
      const scripts = document.querySelectorAll('script[type="application/json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent || '');
          const urls = this.extractJsonValues(data, this.imageKeys);
          for (const url of urls) {
            if (this.isInstagramCdnUrl(url)) {
              images.push(this.createImage(this.decodeEscapedUrl(url), 'data-attr'));
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
      
      // Also scan HTML for escaped CDN URLs
      const html = document.documentElement.innerHTML;
      const cdnPattern = /"(https?:\\u002F\\u002F[^"]*(?:cdninstagram|fbcdn)[^"]*)"/g;
      let match: RegExpExecArray | null;
      while ((match = cdnPattern.exec(html))) {
        if (match[1]) {
          const decoded = this.decodeEscapedUrl(match[1]);
          if (this.looksLikeImageUrl(decoded)) {
            images.push(this.createImage(decoded, 'data-attr'));
          }
        }
      }
    }
    
    // Also run regular extraction on body
    images.push(...this.extractImages(document.body, options));
    
    return this.deduplicateImages(images);
  }
  
  deriveOriginalUrl(thumbUrl: string): string | null {
    // Instagram URLs typically have size parameters we can modify
    // Pattern: s123x456 or p123x456
    const upgraded = thumbUrl
      .replace(/\/s\d+x\d+\//g, '/s1080x1080/')
      .replace(/\/p\d+x\d+\//g, '/p1080x1080/')
      .replace(/\/e\d+\//g, '/e35/')
      .replace(/\?.*$/, ''); // Remove query params that might limit size
    
    if (upgraded !== thumbUrl) {
      return upgraded;
    }
    
    return null;
  }
  
  getAlternativeUrls(element: Element): string[] {
    const urls: string[] = [];
    
    // Check srcset
    if (element instanceof HTMLImageElement && element.srcset) {
      const parsed = this.parseSrcset(element.srcset);
      urls.push(...parsed.map(p => p.url));
    }
    
    // Check data attributes
    const src = element.getAttribute('data-src');
    if (src) urls.push(src);
    
    return urls;
  }
  
  // === Private helpers ===
  
  private isInstagramCdnUrl(url: string): boolean {
    return /cdninstagram\.com|fbcdn\.net|instagram\..*\.fbcdn/i.test(url);
  }
  
  private getSharedData(): unknown {
    // window._sharedData
    try {
      return (window as Record<string, unknown>)._sharedData;
    } catch {
      return null;
    }
  }
  
  private getAdditionalData(): unknown {
    // window.__additionalDataLoaded
    try {
      return (window as Record<string, unknown>).__additionalDataLoaded;
    } catch {
      return null;
    }
  }
  
  private extractFromJsonData(root: Element): ExtractedImage[] {
    const images: ExtractedImage[] = [];
    
    // Find script tags within or near the root
    const scripts = root.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes('cdninstagram') && !text.includes('fbcdn')) continue;
      
      try {
        // Try to find JSON objects in the script
        const jsonMatch = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
        if (jsonMatch) {
          for (const jsonStr of jsonMatch) {
            try {
              const data = JSON.parse(jsonStr);
              const urls = this.extractJsonValues(data, this.imageKeys);
              for (const url of urls) {
                if (this.isInstagramCdnUrl(url)) {
                  images.push(this.createImage(this.decodeEscapedUrl(url), 'data-attr'));
                }
              }
            } catch {
              // Ignore individual parse errors
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }
    
    return images;
  }
  
  private parseSrcset(srcset: string): Array<{ url: string; width?: number; density?: number }> {
    return srcset.split(',').map(part => {
      const [url, descriptor] = part.trim().split(/\s+/);
      const result: { url: string; width?: number; density?: number } = { url };
      if (descriptor) {
        if (descriptor.endsWith('w')) {
          result.width = parseInt(descriptor, 10);
        } else if (descriptor.endsWith('x')) {
          result.density = parseFloat(descriptor);
        }
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

export const instagramHandler = new InstagramHandler();
