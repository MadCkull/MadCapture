/**
 * Google Images Handler
 * 
 * Specialized extraction for Google Images.
 * In Deep Mode, it simulates a click on thumbnails to trigger the side panel,
 * waits for the high-res image to load, extracts it, and then closes the panel.
 */

import { BaseSiteHandler } from './base';
import { ExtractedImage, ExtractOptions } from '../utils/types';

export class GoogleHandler extends BaseSiteHandler {
  name = 'google';
  hostPatterns = [/google\.(com|co\.\w+|[\w]+)$/i];
  priority = 10;
  
  // Selectors for Google Images
  private readonly thumbnailSelector = '[data-id] img';
  private readonly sidePanelSelector = '#Sva75c'; // Main side panel container
  private readonly sidePanelCloseBtnSelector = '[jsaction*="close"]';
  private readonly highResImageSelector = '#Sva75c img[src^="http"]:not([src*="gstatic.com"]):not([src^="data:"])';
  
  isOverlayElement(element: Element): boolean {
    // Google's side panel and its overlays
    return !!element.closest(this.sidePanelSelector);
  }
  
  enhanceSelection(element: Element): Element | Element[] {
    // If clicking a thumbnail, return the container that has the data-id
    const thumbnail = element.closest('[data-id]');
    if (thumbnail) {
      return thumbnail;
    }
    return element;
  }
  
  async extractImages(root: Element, options?: ExtractOptions): Promise<ExtractedImage[]> {
    const images: ExtractedImage[] = [];
    
    // Check if we selected a thumbnail (or multiple in a grid)
    const thumbnails = root.querySelectorAll ? Array.from(root.querySelectorAll('[data-id]')) : [];
    if (root.matches && root.matches('[data-id]')) thumbnails.push(root);
    
    // If no thumbnails found but we selected an image inside one, bubble up
    if (thumbnails.length === 0) {
      const parentThumb = root.closest('[data-id]');
      if (parentThumb) {
        thumbnails.push(parentThumb);
      }
    }
    
    // If thumbnails found
    if (thumbnails.length > 0) {
      // 1. Always grab low-res thumbnails heavily
      for (const thumb of thumbnails) {
         const img = thumb.querySelector('img');
         if (img && img.src) {
           images.push(this.createImage(img.src, 'img', {
             width: img.naturalWidth,
             height: img.naturalHeight,
             filenameHint: 'google-thumb.jpg'
           }));
         }
      }

      // 2. High-res Deep Scan (Single Selection Only for now)
      if (options?.deepScan && thumbnails.length === 1) {
        const thumb = thumbnails[0] as HTMLElement;
        try {
          const highResUrl = await this.fetchHighResFromThumbnail(thumb);
          if (highResUrl) {
            images.push(this.createImage(highResUrl, 'link-href', {
                filenameHint: 'google-highres.jpg',
                width: 0, // Unknown until loaded
                height: 0
            }));
          }
        } catch (e) {
            console.warn('Failed to fetch high-res Google image', e);
        }
      }
    }
    
    // Fallback: standard extraction
    // Since BaseSiteHandler is abstract, we implement basic fallback here
    const imgs = root.querySelectorAll ? Array.from(root.querySelectorAll('img')) : [];
    if (root.tagName === 'IMG') imgs.push(root as HTMLImageElement);
    
    for (const img of imgs) {
      if (img.src) {
        images.push(this.createImage(img.src, 'img', {
             width: img.naturalWidth,
             height: img.naturalHeight
        }));
      }
    }
    
    return this.deduplicateImages(images);
  }
  
  /**
   * Simulates a click on the thumbnail, waits for the side panel image to load, 
   * grabs the URL, and closes the panel.
   */
  /**
   * Simulates a click on the thumbnail, waits for the side panel image to load, 
   * grabs the URL, and closes the panel.
   */
  private async fetchHighResFromThumbnail(thumbnail: HTMLElement): Promise<string | null> {
    // 1. Get identifier for validation (alt text)
    const thumbImg = thumbnail.querySelector('img');
    const thumbAlt = thumbImg?.alt || '';
    
    // 2. Simulate click
    thumbnail.click();
    
    // 3. Wait for side panel image to appear and load
    const sidePanel = document.querySelector(this.sidePanelSelector);
    if (!sidePanel) return null;
    
    // Wait up to 3 seconds for the high-res image
    // Google usually sends a low-res preview first, then swaps src to http...
    const maxWait = 3000; 
    const start = Date.now();
    
    let bestUrl: string | null = null;
    
    while (Date.now() - start < maxWait) {
      const candidates = Array.from(sidePanel.querySelectorAll<HTMLImageElement>('img[src^="http"]'));
      
      for (const img of candidates) {
         const src = img.src;
         
         // Strict filters: exclude gstatic (thumbnails) and tiny icons
         if (src.includes('gstatic.com') || src.includes('favicon')) continue;
         
         // Relaxed filters: allow googleusercontent (Photos/Drive) if valid image
         // Check dimensions if available (skip tiny icons)
         if (img.naturalWidth > 0 && img.naturalWidth < 200) continue;

         // Validation: if we have alt text, prioritize matching it
         // Use includes() for fuzzy match as Google sometimes appends text
         if (thumbAlt && img.alt && (img.alt.includes(thumbAlt) || thumbAlt.includes(img.alt))) {
             bestUrl = src;
             break;
         }
         
         // Fallback: if no alt match yet, take the largest image found so far
         // (assuming the main image is the largest one in the side panel)
         if (!bestUrl || (img.naturalWidth * img.naturalHeight > 100000)) {
            bestUrl = src;
         }
      }
      
      if (bestUrl) break;
      await new Promise(r => requestAnimationFrame(r));
    }
    
    // 4. Close side panel to restore state
    // Attempt to find close button
    const closeBtn = sidePanel.querySelector<HTMLElement>(this.sidePanelCloseBtnSelector);
    if (closeBtn) {
        try {
            closeBtn.click();
        } catch {
            // Ignore close errors
        }
    }
    
    return bestUrl;
  }
}

export const googleHandler = new GoogleHandler();
