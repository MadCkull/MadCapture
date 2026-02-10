/**
 * Reddit Handler
 * 
 * Specialized extraction for Reddit images and galleries.
 * Handles lightbox mode and Reddit's various image hosting options.
 */

import { BaseSiteHandler } from './base';
import { ExtractedImage, ExtractOptions } from '../utils/types';

export class RedditHandler extends BaseSiteHandler {
  name = 'reddit';
  hostPatterns = [
    /reddit\.com$/i,
    /redd\.it$/i,
    /redditmedia\.com$/i,
    /redditstatic\.com$/i,
  ];
  priority = 10;
  
  // Reddit overlay selectors
  private readonly overlaySelectors = [
    '[aria-label="Close"]',
    '[aria-label*="close"]',
    '[data-click-id="close"]',
    '[class*="CloseButton"]',
    '[class*="NavArrow"]',
    '[class*="GalleryNav"]',
    'header',
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
    // For lightbox/overlay
    const lightbox = element.closest('[class*="lightbox"], [class*="Lightbox"], [data-testid="lightbox"]');
    if (lightbox) {
      const img = lightbox.querySelector('img[src*="redd.it"], img[src*="reddit"]');
      if (img) return img.parentElement || img;
    }
    
    // For posts
    const post = element.closest('[data-testid="post-container"], [data-post-id], article');
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
      
      // Process Reddit CDN images
      if (this.isRedditCdnUrl(src)) {
        images.push(this.createImage(src, 'img', {
          width: img.naturalWidth,
          height: img.naturalHeight,
        }));
        
        // Try to get higher res
        if (deep) {
          const highRes = this.deriveOriginalUrl(src);
          if (highRes && highRes !== src) {
            images.push(this.createImage(highRes, 'link-href'));
          }
        }
      }
      
      // Also check for external image hosts commonly used on Reddit
      if (this.isCommonImageHost(src)) {
        images.push(this.createImage(src, 'img', {
          width: img.naturalWidth,
          height: img.naturalHeight,
        }));
      }
    });
    
    // 2. Video poster images
    const videos = root.querySelectorAll('video');
    Array.from(videos).forEach(video => {
      if (video.poster) {
        images.push(this.createImage(video.poster, 'video-poster'));
      }
    });
    
    // 3. Gallery data (Reddit galleries)
    const galleryImages = this.extractGalleryImages(root);
    images.push(...galleryImages);
    
    // 4. Background images
    if (deep) {
      const allElements = root.querySelectorAll<HTMLElement>('*');
      Array.from(allElements).forEach(el => {
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none' && bg.includes('url(')) {
          const urls = this.extractCssUrls(bg);
          for (const url of urls) {
            if (this.isRedditCdnUrl(url) || this.isCommonImageHost(url)) {
              images.push(this.createImage(url, 'css-background'));
            }
          }
        }
      });
    }
    
    return this.deduplicateImages(images);
  }
  
  extractPageImages(options?: ExtractOptions): ExtractedImage[] {
    const images: ExtractedImage[] = [];
    const deep = options?.deepScan ?? false;
    
    // Look for Reddit gallery data in script
    const galleryData = this.getGalleryData();
    if (galleryData) {
      for (const item of galleryData) {
        if (item.url) {
          images.push(this.createImage(item.url, 'data-attr', {
            width: item.width,
            height: item.height,
          }));
        }
      }
    }
    
    // Scan HTML for Reddit CDN URLs
    if (deep) {
      const html = document.documentElement.innerHTML;
      
      // i.redd.it URLs
      const reddItPattern = /"(https?:\/\/i\.redd\.it\/[^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = reddItPattern.exec(html))) {
        if (match[1] && this.looksLikeImageUrl(match[1])) {
          images.push(this.createImage(match[1], 'data-attr'));
        }
      }
      
      // preview.redd.it URLs
      const previewPattern = /"(https?:\/\/preview\.redd\.it\/[^"]+)"/g;
      while ((match = previewPattern.exec(html))) {
        if (match[1]) {
          const decoded = this.decodeEscapedUrl(match[1]);
          images.push(this.createImage(decoded, 'data-attr'));
          
          const highRes = this.deriveOriginalUrl(decoded);
          if (highRes) {
            images.push(this.createImage(highRes, 'link-href'));
          }
        }
      }
      
      // External host URLs
      const externalPattern = /"(https?:\/\/(?:i\.)?imgur\.com\/[^"]+|https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp))"/gi;
      while ((match = externalPattern.exec(html))) {
        if (match[1] && this.looksLikeImageUrl(match[1])) {
          images.push(this.createImage(match[1], 'data-attr'));
        }
      }
    }
    
    // Regular extraction
    images.push(...this.extractImages(document.body, options));
    
    return this.deduplicateImages(images);
  }
  
  deriveOriginalUrl(thumbUrl: string): string | null {
    // preview.redd.it URLs can be converted to i.redd.it for original
    if (thumbUrl.includes('preview.redd.it')) {
      try {
        const url = new URL(thumbUrl);
        
        // Extract the image ID from path
        // Pattern: /ID.ext?width=XXX&...
        const pathMatch = url.pathname.match(/^\/([^.]+\.\w+)/);
        if (pathMatch) {
          return `https://i.redd.it/${pathMatch[1]}`;
        }
      } catch {
        // URL parsing failed
      }
    }
    
    // For Imgur, get full size
    if (thumbUrl.includes('imgur.com')) {
      // Remove size suffix: abc123s.jpg -> abc123.jpg
      const upgraded = thumbUrl.replace(/(\w+)[stbmlh]\.(\w+)$/, '$1.$2');
      if (upgraded !== thumbUrl) return upgraded;
    }
    
    return null;
  }
  
  // === Private helpers ===
  
  private isRedditCdnUrl(url: string): boolean {
    return /redd\.it|reddit|redditmedia/i.test(url);
  }
  
  private isCommonImageHost(url: string): boolean {
    return /imgur\.com|giphy\.com|gfycat\.com/i.test(url);
  }
  
  private extractGalleryImages(root: Element): ExtractedImage[] {
    const images: ExtractedImage[] = [];
    
    // Look for gallery containers
    const galleries = root.querySelectorAll('[class*="gallery"], [data-gallery-id]');
    
    Array.from(galleries).forEach(gallery => {
      // Check for gallery data attributes
      const dataAttr = gallery.getAttribute('data-gallery-items');
      if (dataAttr) {
        try {
          const items = JSON.parse(dataAttr);
          for (const item of items) {
            if (item.url || item.src) {
              images.push(this.createImage(item.url || item.src, 'data-attr'));
            }
          }
        } catch {
          // Not JSON
        }
      }
      
      // Also get visible images in gallery
      const galleryImages = gallery.querySelectorAll('img');
      Array.from(galleryImages).forEach(img => {
        const src = img.currentSrc || img.src;
        if (src && !src.startsWith('data:')) {
          images.push(this.createImage(src, 'img'));
        }
      });
    });
    
    return images;
  }
  
  private getGalleryData(): Array<{ url: string; width?: number; height?: number }> | null {
    // Reddit stores gallery data in window
    try {
      const redditData = (window as any).__REDDIT_MEDIA__;
      if (redditData) {
        return this.extractJsonValues(redditData, ['url', 's']) as unknown as Array<{ url: string; width?: number; height?: number }>;
      }
    } catch {
      // Ignore
    }
    
    // Check for gallery JSON in scripts
    const scripts = document.querySelectorAll('script');
    for (const script of Array.from(scripts)) {
      const text = script.textContent || '';
      if (!text.includes('galleryOrder') && !text.includes('gallery_data')) continue;
      
      try {
        const match = text.match(/\{[^{}]*"gallery(?:Order|_data)"[^{}]*\}/);
        if (match) {
          const data = JSON.parse(match[0]);
          // Extract image URLs from gallery data
          const urls = this.extractJsonValues(data, ['u', 'url', 'src']);
          return urls.map(url => ({ url }));
        }
      } catch {
        // Ignore parse errors
      }
    }
    
    return null;
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

export const redditHandler = new RedditHandler();
