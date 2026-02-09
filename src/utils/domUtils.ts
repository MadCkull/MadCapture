/**
 * DOM Utilities for MadCapture
 * Reusable functions for DOM traversal, element analysis, and overlay detection
 */

/**
 * Common overlay selectors that indicate an element is likely an overlay/modal
 */
const OVERLAY_SELECTORS = [
  '[role="dialog"]',
  '[role="presentation"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '.modal',
  '.overlay',
  '.lightbox',
  '.popup',
  '.dialog',
  '.backdrop',
  '[class*="overlay"]',
  '[class*="modal"]',
  '[class*="lightbox"]',
  '[class*="backdrop"]',
  '[class*="dialog"]',
];

/**
 * Selectors for interactive overlay controls (buttons, navigation, etc.)
 */
const OVERLAY_CONTROL_SELECTORS = [
  '[aria-label*="Close"]',
  '[aria-label*="close"]',
  '[aria-label*="Next"]',
  '[aria-label*="Previous"]',
  '[aria-label*="Like"]',
  '[aria-label*="Share"]',
  '[aria-label*="Comment"]',
  '[aria-label*="Save"]',
  '[aria-label*="More"]',
  'button[class*="close"]',
  'button[class*="nav"]',
  '[class*="close-button"]',
  '[class*="closeButton"]',
  '[class*="nav-arrow"]',
  '[class*="arrow"]',
  '[class*="control"]',
  'svg', // Usually icons on overlays
];

/**
 * Selectors that strongly indicate an element contains images
 */
const IMAGE_CONTAINER_SELECTORS = [
  'img',
  'picture',
  'figure',
  'canvas',
  '[class*="image"]',
  '[class*="photo"]',
  '[class*="picture"]',
  '[class*="media"]',
  '[class*="gallery"]',
  '[class*="carousel"]',
  '[data-testid*="image"]',
  '[data-testid*="photo"]',
];

/**
 * Get all elements at a specific point, excluding specified elements
 */
export function elementsAtPoint(x: number, y: number, exclude: Element[] = []): Element[] {
  const elements = document.elementsFromPoint(x, y);
  const excludeSet = new Set(exclude);
  
  return elements.filter(el => {
    if (excludeSet.has(el)) return false;
    // Also exclude children of excluded elements
    for (const exc of exclude) {
      if (exc && exc.contains(el)) return false;
    }
    return true;
  });
}

/**
 * Get the computed z-index of an element, handling 'auto' values
 */
export function getZIndex(el: Element): number {
  const style = getComputedStyle(el);
  const zIndex = style.zIndex;
  if (zIndex === 'auto') {
    // Walk up to find a positioned ancestor with z-index
    let parent = el.parentElement;
    while (parent) {
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.zIndex !== 'auto') {
        return parseInt(parentStyle.zIndex, 10) || 0;
      }
      parent = parent.parentElement;
    }
    return 0;
  }
  return parseInt(zIndex, 10) || 0;
}

/**
 * Calculate the visual area of an element
 */
export function getVisualArea(el: Element): number {
  const rect = el.getBoundingClientRect();
  return rect.width * rect.height;
}

/**
 * Check if an element has positioning that suggests overlay behavior
 */
export function hasOverlayPositioning(el: Element): boolean {
  const style = getComputedStyle(el);
  const position = style.position;
  
  // Fixed/absolute positioned elements covering most of viewport are likely overlays
  if (position === 'fixed' || position === 'absolute') {
    const rect = el.getBoundingClientRect();
    const viewportArea = window.innerWidth * window.innerHeight;
    const coverageRatio = (rect.width * rect.height) / viewportArea;
    
    // If it covers more than 50% of viewport with semi-transparent bg, likely overlay
    if (coverageRatio > 0.5) {
      const bg = style.backgroundColor;
      if (bg.includes('rgba') || bg.includes('transparent') || parseFloat(style.opacity) < 1) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if an element matches any overlay selector pattern
 */
export function matchesOverlaySelector(el: Element): boolean {
  return OVERLAY_SELECTORS.some(selector => {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  });
}

/**
 * Check if an element is an overlay control (button, navigation, etc.)
 */
export function isOverlayControl(el: Element): boolean {
  return OVERLAY_CONTROL_SELECTORS.some(selector => {
    try {
      return el.matches(selector) || el.closest(selector) !== null;
    } catch {
      return false;
    }
  });
}

/**
 * Check if an element is visually an overlay (modal, lightbox, etc.)
 */
export function isOverlayElement(el: Element): boolean {
  // Check direct overlay patterns
  if (matchesOverlaySelector(el)) return true;
  
  // Check if it's an overlay control
  if (isOverlayControl(el)) return true;
  
  // Check positioning characteristics
  if (hasOverlayPositioning(el)) return true;
  
  // Check if it's a small element with high z-index (likely a control)
  const area = getVisualArea(el);
  const zIndex = getZIndex(el);
  if (area < 10000 && zIndex > 100) return true; // Small element, high z-index
  
  return false;
}

/**
 * Check if an element directly contains an image
 */
export function hasDirectImage(el: Element): boolean {
  if (el instanceof HTMLImageElement) return true;
  if (el instanceof HTMLCanvasElement) return true;
  if (el instanceof HTMLVideoElement && el.poster) return true;
  if (el instanceof HTMLPictureElement) return true;
  
  // Check for CSS background image
  if (el instanceof HTMLElement) {
    const style = getComputedStyle(el);
    const bg = style.backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url(')) return true;
  }
  
  return false;
}

/**
 * Check if an element contains any images (direct or nested)
 */
export function hasImages(el: Element, deep = true): boolean {
  if (hasDirectImage(el)) return true;
  
  if (deep) {
    // Check for nested image elements
    if (el.querySelector('img, picture, canvas, video[poster]')) return true;
    
    // Check for elements with background images
    const children = el.querySelectorAll<HTMLElement>('*');
    for (const child of children) {
      const style = getComputedStyle(child);
      if (style.backgroundImage && style.backgroundImage !== 'none' && style.backgroundImage.includes('url(')) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if element has image-related data attributes
 */
export function hasImageDataAttrs(el: Element): boolean {
  const attrs = el.getAttributeNames();
  const imageAttrPatterns = [
    /^data-.*src/i,
    /^data-.*image/i,
    /^data-.*photo/i,
    /^data-.*url/i,
    /^data-.*poster/i,
    /^data-original/i,
    /^data-lazy/i,
  ];
  
  return attrs.some(attr => imageAttrPatterns.some(pattern => pattern.test(attr)));
}

/**
 * Check if an element matches image container selectors
 */
export function matchesImageContainerSelector(el: Element): boolean {
  return IMAGE_CONTAINER_SELECTORS.some(selector => {
    try {
      return el.matches(selector) || el.querySelector(selector) !== null;
    } catch {
      return false;
    }
  });
}

/**
 * Find the closest ancestor that matches a selector
 */
export function closestMatch(el: Element, selector: string): Element | null {
  try {
    return el.closest(selector);
  } catch {
    return null;
  }
}

/**
 * Find the best image-containing ancestor of an element
 */
export function findImageContainer(el: Element, maxDepth = 10): Element | null {
  let current: Element | null = el;
  let depth = 0;
  let bestContainer: Element | null = null;
  
  while (current && depth < maxDepth) {
    if (hasImages(current, false)) {
      bestContainer = current;
    }
    
    // Stop at document body
    if (current === document.body) break;
    
    current = current.parentElement;
    depth++;
  }
  
  return bestContainer;
}

/**
 * Get the bounding rect of an element relative to the page (not viewport)
 */
export function getPageRect(el: Element): { x: number; y: number; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Check if two elements overlap visually
 */
export function elementsOverlap(el1: Element, el2: Element): boolean {
  const r1 = el1.getBoundingClientRect();
  const r2 = el2.getBoundingClientRect();
  
  return !(r1.right < r2.left || 
           r1.left > r2.right || 
           r1.bottom < r2.top || 
           r1.top > r2.bottom);
}

/**
 * Calculate overlap percentage between two elements
 */
export function getOverlapPercentage(container: Element, inner: Element): number {
  const c = container.getBoundingClientRect();
  const i = inner.getBoundingClientRect();
  
  const overlapX = Math.max(0, Math.min(c.right, i.right) - Math.max(c.left, i.left));
  const overlapY = Math.max(0, Math.min(c.bottom, i.bottom) - Math.max(c.top, i.top));
  const overlapArea = overlapX * overlapY;
  
  const innerArea = i.width * i.height;
  if (innerArea === 0) return 0;
  
  return overlapArea / innerArea;
}
