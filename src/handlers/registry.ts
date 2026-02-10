/**
 * Handler Registry
 * 
 * Auto-detects the current site and provides the appropriate handler.
 * Falls back to generic extraction if no specific handler matches.
 */

import { SiteHandler } from './base';
import { instagramHandler } from './instagram';
import { pinterestHandler } from './pinterest';
import { facebookHandler } from './facebook';
import { twitterHandler } from './twitter';
import { redditHandler } from './reddit';
import { googleHandler } from './google';

/**
 * All registered site handlers, sorted by priority
 */
const handlers: SiteHandler[] = [
  instagramHandler,
  pinterestHandler,
  facebookHandler,
  twitterHandler,
  redditHandler,
  googleHandler,
].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

/**
 * Cache for the active handler (cleared on navigation)
 */
let cachedHandler: SiteHandler | null | undefined = undefined;
let cachedHostname: string | null = null;

/**
 * Get the handler for the current site
 * Returns null if no specific handler matches (use generic extraction)
 */
export function getActiveHandler(): SiteHandler | null {
  const currentHostname = location.hostname.toLowerCase();
  
  // Return cached handler if hostname hasn't changed
  if (cachedHandler !== undefined && cachedHostname === currentHostname) {
    return cachedHandler;
  }
  
  // Find matching handler
  for (const handler of handlers) {
    const matches = handler.hostPatterns.some(pattern => pattern.test(currentHostname));
    if (matches) {
      cachedHandler = handler;
      cachedHostname = currentHostname;
      return handler;
    }
  }
  
  // No handler found
  cachedHandler = null;
  cachedHostname = currentHostname;
  return null;
}

/**
 * Get handler by name (for testing/debugging)
 */
export function getHandlerByName(name: string): SiteHandler | null {
  return handlers.find(h => h.name === name) ?? null;
}

/**
 * Get all registered handlers
 */
export function getAllHandlers(): SiteHandler[] {
  return [...handlers];
}

/**
 * Check if current site has a specific handler
 */
export function hasActiveHandler(): boolean {
  return getActiveHandler() !== null;
}

/**
 * Clear the handler cache (call on navigation)
 */
export function clearHandlerCache(): void {
  cachedHandler = undefined;
  cachedHostname = null;
}

/**
 * Get handler names for debugging
 */
export function getHandlerNames(): string[] {
  return handlers.map(h => h.name);
}

// Re-export handlers for direct access
export {
  instagramHandler,
  pinterestHandler,
  facebookHandler,
  twitterHandler,
  redditHandler,
  googleHandler,
};

// Re-export types
export type { SiteHandler } from './base';
