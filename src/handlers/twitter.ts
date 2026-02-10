/**
 * Twitter/X Handler
 * 
 * Specialized extraction for Twitter/X images.
 * Handles the image viewer modal and extracts highest quality versions.
 */

import { BaseSiteHandler } from './base';
import { ExtractedImage, ExtractOptions } from '../utils/types';

export class TwitterHandler extends BaseSiteHandler {
  name = 'twitter';
  hostPatterns = [/twitter\.com$/i, /x\.com$/i, /twimg\.com$/i];
  priority = 10;
  
  // Twitter overlay selectors
  private readonly overlaySelectors = [
    '[aria-label="Close"]',
    '[aria-label*="close"]',
    '[aria-label*="Like"]',
    '[aria-label*="Reply"]',
    '[aria-label*="Repost"]',
    '[aria-label*="Share"]',
    '[aria-label*="Bookmark"]',
    '[aria-label*="More"]',
    '[data-testid="app-bar-close"]',
    '[data-testid="tweet-photo-close"]',
    'nav',
    'header',
    '[role="navigation"]',
  ];
  
  // Quality variants (name parameter values)
  private readonly qualityVariants = [
    '4096x4096',
    'large',
    'medium',
    'small',
    'thumb',
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
    // For photo viewer modal
    const photoView = element.closest('[aria-label="Image"], [data-testid="swipe-to-dismiss"]');
    if (photoView) {
      const img = photoView.querySelector('img[src*="pbs.twimg.com"]');
      if (img) return img.parentElement || img;
    }
    
    // For tweets
    const tweet = element.closest('[data-testid="tweet"], article');
    if (tweet) {
      return tweet;
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
      
      // Only process Twitter CDN images
      if (!this.isTwitterCdnUrl(src)) return;
      
      // Skip profile images in extraction unless they're the target
      if (src.includes('profile_images') && !root.matches('[data-testid="UserAvatar"]')) {
        return;
      }
      
      images.push(this.createImage(src, 'img', {
        width: img.naturalWidth,
        height: img.naturalHeight,
      }));
      
      // Always try to get highest res version
      const highRes = this.deriveOriginalUrl(src);
      if (highRes && highRes !== src) {
        images.push(this.createImage(highRes, 'link-href'));
      }
    });
    
    // 2. Background images (for cards, etc.)
    if (deep) {
      const allElements = root.querySelectorAll<HTMLElement>('*');
      Array.from(allElements).forEach(el => {
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none' && bg.includes('url(')) {
          const urls = this.extractCssUrls(bg);
          for (const url of urls) {
            if (this.isTwitterCdnUrl(url)) {
              images.push(this.createImage(url, 'css-background'));
              
              const highRes = this.deriveOriginalUrl(url);
              if (highRes) {
                images.push(this.createImage(highRes, 'link-href'));
              }
            }
          }
        }
      });
    }
    
    // 3. Video poster images
    const videos = root.querySelectorAll('video');
    Array.from(videos).forEach(video => {
      if (video.poster && this.isTwitterCdnUrl(video.poster)) {
        images.push(this.createImage(video.poster, 'video-poster'));
      }
    });
    
    return this.deduplicateImages(images);
  }
  
  extractPageImages(options?: ExtractOptions): ExtractedImage[] {
    const images: ExtractedImage[] = [];
    const deep = options?.deepScan ?? false;
    
    // Scan for Twitter image URLs in HTML
    if (deep) {
      const html = document.documentElement.innerHTML;
      
      // pbs.twimg.com URLs
      const twimgPattern = /"(https?:\/\/pbs\.twimg\.com\/media\/[^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = twimgPattern.exec(html))) {
        if (match[1]) {
          const decoded = this.decodeEscapedUrl(match[1]);
          images.push(this.createImage(decoded, 'data-attr'));
          
          const highRes = this.deriveOriginalUrl(decoded);
          if (highRes) {
            images.push(this.createImage(highRes, 'link-href'));
          }
        }
      }
    }
    
    // Regular extraction
    images.push(...this.extractImages(document.body, options));
    
    return this.deduplicateImages(images);
  }
  
  deriveOriginalUrl(thumbUrl: string): string | null {
    if (!this.isTwitterCdnUrl(thumbUrl)) return null;
    
    try {
      const url = new URL(thumbUrl);
      
      // Twitter uses ?format=jpg&name=SIZE pattern
      // Or /media/ID?format=jpg&name=SIZE
      
      // Set to highest quality
      url.searchParams.set('name', '4096x4096');
      
      // Ensure we have a format (default to jpg for quality)
      if (!url.searchParams.has('format')) {
        // Check if the URL has format in path
        if (!url.pathname.includes('.')) {
          url.searchParams.set('format', 'jpg');
        }
      }
      
      const result = url.toString();
      return result !== thumbUrl ? result : null;
    } catch {
      // URL parsing failed, try simple string replacement
      const upgraded = thumbUrl
        .replace(/[?&]name=\w+/, '?name=4096x4096')
        .replace(/&name=\w+/, '&name=4096x4096');
      
      // Add format if missing
      if (!upgraded.includes('format=') && !upgraded.match(/\.\w{3,4}(\?|$)/)) {
        return upgraded + (upgraded.includes('?') ? '&' : '?') + 'format=jpg&name=4096x4096';
      }
      
      return upgraded !== thumbUrl ? upgraded : null;
    }
  }
  
  getAlternativeUrls(element: Element): string[] {
    const urls: string[] = [];
    
    if (element instanceof HTMLImageElement) {
      const src = element.src;
      if (this.isTwitterCdnUrl(src)) {
        // Generate all quality variants
        for (const variant of this.qualityVariants) {
          try {
            const url = new URL(src);
            url.searchParams.set('name', variant);
            urls.push(url.toString());
          } catch {
            // Ignore
          }
        }
      }
    }
    
    return urls;
  }
  
  // === Private helpers ===
  
  private isTwitterCdnUrl(url: string): boolean {
    return /twimg\.com/i.test(url);
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

export const twitterHandler = new TwitterHandler();
