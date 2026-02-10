/**
 * Image Piercer - Smart overlay detection and image element discovery
 * 
 * This module implements intelligent detection of images behind overlays,
 * modals, and other UI elements that commonly block direct image selection.
 */

import {
  elementsAtPoint,
  getZIndex,
  getVisualArea,
  isOverlayElement,
  isOverlayControl,
  hasDirectImage,
  hasImages,
  hasImageDataAttrs,
  matchesImageContainerSelector,
  getOverlapPercentage,
} from '../utils/domUtils';

/**
 * Result of piercing to find the best image element
 */
export interface PiercedResult {
  /** The best element to extract images from */
  element: Element;
  /** Confidence score 0-1 */
  confidence: number;
  /** Method used to find this element */
  method: 'direct' | 'pierced' | 'proximity' | 'container' | 'fallback';
  /** All image-bearing elements found at/near the point */
  imageElements: Element[];
  /** Debug info about scoring */
  debugInfo?: {
    elementScores: Array<{ element: Element; score: number; reasons: string[] }>;
    overlaysSkipped: number;
  };
}

/**
 * Options for piercing
 */
export interface PierceOptions {
  /** Elements to exclude from consideration (e.g., our own overlay) */
  excludeElements?: Element[];
  /** Whether to include debug info in result */
  debug?: boolean;
  /** Maximum depth to search for image containers */
  maxContainerDepth?: number;
  /** Whether to expand selection to include container */
  expandToContainer?: boolean;
}

/**
 * Scoring weights for different image indicators
 */
const SCORING = {
  // Element type scores
  IS_IMG_ELEMENT: 100,
  IS_PICTURE_ELEMENT: 95,
  IS_CANVAS_ELEMENT: 80,
  IS_VIDEO_WITH_POSTER: 75,
  HAS_CSS_BACKGROUND: 60,
  
  // Attribute scores
  HAS_DATA_SRC: 40,
  HAS_DATA_SRCSET: 45,
  HAS_IMAGE_DATA_ATTRS: 35,
  
  // Container scores
  MATCHES_IMAGE_CONTAINER_SELECTOR: 30,
  HAS_NESTED_IMAGES: 50,
  
  // Area scoring (larger = more likely to be the image, not a control)
  AREA_BONUS_MULTIPLIER: 0.001, // Points per pixel of area
  AREA_BONUS_MAX: 30,
  
  // Z-index penalties (higher z-index = more likely overlay)
  HIGH_ZINDEX_PENALTY: -20, // For z-index > 1000
  VERY_HIGH_ZINDEX_PENALTY: -40, // For z-index > 10000
  
  // Overlay penalties
  IS_OVERLAY_CONTROL: -100,
  IS_OVERLAY_ELEMENT: -80,
  MATCHES_OVERLAY_SELECTOR: -60,
  
  // Position bonuses
  CENTERED_IN_VIEWPORT: 10,
  LARGE_COVERAGE: 15, // Covers significant portion of click area
};

/**
 * Score an element for how likely it is to be the intended image target
 */
function scoreElement(el: Element, clickX: number, clickY: number): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  
  // === POSITIVE SIGNALS ===
  
  // Direct image elements get high scores
  if (el instanceof HTMLImageElement) {
    score += SCORING.IS_IMG_ELEMENT;
    reasons.push('img element');
  } else if (el instanceof HTMLPictureElement) {
    score += SCORING.IS_PICTURE_ELEMENT;
    reasons.push('picture element');
  } else if (el instanceof HTMLCanvasElement) {
    score += SCORING.IS_CANVAS_ELEMENT;
    reasons.push('canvas element');
  } else if (el instanceof HTMLVideoElement && el.poster) {
    score += SCORING.IS_VIDEO_WITH_POSTER;
    reasons.push('video with poster');
  }
  
  // CSS background images
  if (el instanceof HTMLElement) {
    const style = getComputedStyle(el);
    if (style.backgroundImage && style.backgroundImage !== 'none' && style.backgroundImage.includes('url(')) {
      score += SCORING.HAS_CSS_BACKGROUND;
      reasons.push('CSS background-image');
    }
  }
  
  // Data attributes for lazy loading
  if (el.hasAttribute('data-src')) {
    score += SCORING.HAS_DATA_SRC;
    reasons.push('has data-src');
  }
  if (el.hasAttribute('data-srcset')) {
    score += SCORING.HAS_DATA_SRCSET;
    reasons.push('has data-srcset');
  }
  if (hasImageDataAttrs(el)) {
    score += SCORING.HAS_IMAGE_DATA_ATTRS;
    reasons.push('has image data attrs');
  }
  
  // Container patterns
  if (matchesImageContainerSelector(el)) {
    score += SCORING.MATCHES_IMAGE_CONTAINER_SELECTOR;
    reasons.push('matches image container selector');
  }
  
  // Nested images (for containers)
  if (hasImages(el, true) && !hasDirectImage(el)) {
    score += SCORING.HAS_NESTED_IMAGES;
    reasons.push('contains nested images');
  }
  
  // Area bonus (larger elements are more likely the main image)
  const area = getVisualArea(el);
  const areaBonus = Math.min(SCORING.AREA_BONUS_MAX, area * SCORING.AREA_BONUS_MULTIPLIER);
  if (areaBonus > 0) {
    score += areaBonus;
    reasons.push(`area bonus: +${areaBonus.toFixed(1)}`);
  }
  
  // Check if element is well-centered on the click point
  const rect = el.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const distanceFromClick = Math.sqrt(Math.pow(centerX - clickX, 2) + Math.pow(centerY - clickY, 2));
  if (distanceFromClick < 50) {
    score += SCORING.CENTERED_IN_VIEWPORT;
    reasons.push('centered on click');
  }
  
  // === NEGATIVE SIGNALS ===
  
  // Z-index penalties (high z-index suggests overlay)
  const zIndex = getZIndex(el);
  if (zIndex > 10000) {
    score += SCORING.VERY_HIGH_ZINDEX_PENALTY;
    reasons.push(`very high z-index: ${zIndex}`);
  } else if (zIndex > 1000) {
    score += SCORING.HIGH_ZINDEX_PENALTY;
    reasons.push(`high z-index: ${zIndex}`);
  }
  
  // Overlay control detection
  if (isOverlayControl(el)) {
    score += SCORING.IS_OVERLAY_CONTROL;
    reasons.push('overlay control');
  }
  
  // General overlay detection
  if (isOverlayElement(el) && !hasDirectImage(el)) {
    score += SCORING.IS_OVERLAY_ELEMENT;
    reasons.push('overlay element');
  }
  
  return { score, reasons };
}

/**
 * Find all image-bearing elements in a list
 */
function findImageElements(elements: Element[]): Element[] {
  const result: Element[] = [];
  const seen = new Set<Element>();
  
  for (const el of elements) {
    if (seen.has(el)) continue;
    
    // Direct image elements
    if (hasDirectImage(el)) {
      seen.add(el);
      result.push(el);
      continue;
    }
    
    // Elements containing images
    if (hasImages(el, true)) {
      // Find the actual image elements inside
      const imgs = el.querySelectorAll('img, picture, canvas, video[poster]');
      Array.from(imgs).forEach(img => {
        if (!seen.has(img)) {
          seen.add(img);
          result.push(img);
        }
      });
      
      // Also check for elements with background images
      const bgElements = el.querySelectorAll<HTMLElement>('*');
      Array.from(bgElements).forEach(bgEl => {
        if (seen.has(bgEl)) return;
        const style = getComputedStyle(bgEl);
        if (style.backgroundImage && style.backgroundImage !== 'none' && style.backgroundImage.includes('url(')) {
          seen.add(bgEl);
          result.push(bgEl);
        }
      });
    }
  }
  
  return result;
}

/**
 * Expand selection to find the best container for the image
 */
function findBestContainer(imageElement: Element, maxDepth = 6): Element {
  let current: Element | null = imageElement;
  let best = imageElement;
  let bestScore = 0;
  let depth = 0;
  
  while (current && depth < maxDepth) {
    // Score this container
    let score = 0;
    
    // Prefer elements that are article/figure/div with image classes
    if (current.matches('article, figure, [class*="image"], [class*="photo"], [class*="media"]')) {
      score += 20;
    }
    
    // Prefer elements that don't have too many non-image children
    const childCount = current.childElementCount;
    const imgCount = current.querySelectorAll('img, picture, canvas').length;
    if (childCount <= 3 || imgCount / childCount > 0.3) {
      score += 10;
    }
    
    // Area should be reasonable (not too big, covering entire page)
    const area = getVisualArea(current);
    const viewportArea = window.innerWidth * window.innerHeight;
    if (area < viewportArea * 0.9 && area > getVisualArea(imageElement) * 0.9) {
      score += 15;
    }
    
    if (score > bestScore) {
      bestScore = score;
      best = current;
    }
    
    // Stop at body
    if (current === document.body || current === document.documentElement) break;
    
    current = current.parentElement;
    depth++;
  }
  
  return best;
}

/**
 * Main function: Pierce through overlays to find the best image element
 */
export function pierceToImage(x: number, y: number, options: PierceOptions = {}): PiercedResult | null {
  const {
    excludeElements = [],
    debug = false,
    maxContainerDepth = 6,
    expandToContainer = true,
  } = options;
  
  // Get all elements at the click point
  const allElements = elementsAtPoint(x, y, excludeElements);
  
  if (allElements.length === 0) {
    return null;
  }
  
  // Score all elements
  const scored: Array<{ element: Element; score: number; reasons: string[] }> = [];
  let overlaysSkipped = 0;
  
  for (const el of allElements) {
    const { score, reasons } = scoreElement(el, x, y);
    scored.push({ element: el, score, reasons });
    
    if (reasons.some(r => r.includes('overlay'))) {
      overlaysSkipped++;
    }
  }
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  // Find all image elements
  const imageElements = findImageElements(allElements);
  
  // Determine the best element
  let bestElement: Element | null = null;
  let method: PiercedResult['method'] = 'fallback';
  let confidence = 0;
  
  if (scored.length > 0 && scored[0].score > 0) {
    // We have a good candidate from scoring
    bestElement = scored[0].element;
    
    // Determine method based on position in original list
    const originalIndex = allElements.indexOf(bestElement);
    if (originalIndex === 0) {
      method = 'direct';
    } else if (originalIndex > 0 && overlaysSkipped > 0) {
      method = 'pierced';
    } else {
      method = 'container';
    }
    
    // Calculate confidence based on score differential
    const topScore = scored[0].score;
    const secondScore = scored[1]?.score ?? 0;
    confidence = Math.min(1, Math.max(0, (topScore - secondScore) / 100 + 0.5));
    
  } else if (imageElements.length > 0) {
    // Fallback: use the first image element found
    bestElement = imageElements[0];
    method = 'proximity';
    confidence = 0.3;
    
  } else if (allElements.length > 0) {
    // Ultimate fallback: first non-overlay element
    for (const el of allElements) {
      if (!isOverlayElement(el) && !isOverlayControl(el)) {
        bestElement = el;
        break;
      }
    }
    if (!bestElement) {
      bestElement = allElements[0];
    }
    method = 'fallback';
    confidence = 0.1;
  }
  
  if (!bestElement) {
    return null;
  }
  
  // Optionally expand to container
  if (expandToContainer && hasDirectImage(bestElement)) {
    const container = findBestContainer(bestElement, maxContainerDepth);
    if (container !== bestElement) {
      // Check if container is a better choice
      const containerImages = container.querySelectorAll('img, picture, canvas, video[poster]');
      if (containerImages.length <= 3) {
        // Container doesn't have too many images, use it
        bestElement = container;
        method = 'container';
      }
    }
  }
  
  const result: PiercedResult = {
    element: bestElement,
    confidence,
    method,
    imageElements,
  };
  
  if (debug) {
    result.debugInfo = {
      elementScores: scored.slice(0, 10), // Top 10 for debugging
      overlaysSkipped,
    };
  }
  
  return result;
}

/**
 * Get multiple candidate elements at a point (for multi-selection UI)
 */
export function getCandidatesAtPoint(x: number, y: number, options: PierceOptions = {}): PiercedResult[] {
  const { excludeElements = [] } = options;
  
  const allElements = elementsAtPoint(x, y, excludeElements);
  const results: PiercedResult[] = [];
  const seen = new Set<Element>();
  
  for (const el of allElements) {
    if (seen.has(el)) continue;
    if (isOverlayControl(el)) continue;
    
    const { score, reasons } = scoreElement(el, x, y);
    if (score <= 0) continue;
    
    seen.add(el);
    
    results.push({
      element: el,
      confidence: Math.min(1, score / 100),
      method: 'direct',
      imageElements: hasImages(el, true) ? [el] : [],
      debugInfo: {
        elementScores: [{ element: el, score, reasons }],
        overlaysSkipped: 0,
      },
    });
  }
  
  // Sort by confidence
  results.sort((a, b) => b.confidence - a.confidence);
  
  return results.slice(0, 5); // Return top 5 candidates
}
