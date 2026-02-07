import { ExtractedImage } from '../../utils/types';
import { renderImageCard } from './ImageCard';

export function renderImageGrid(items: ExtractedImage[], selected: Set<string>): string {
  if (items.length === 0) {
    return `<div class="loader-container"><div class="spinner"></div><p>Searching for images...</p></div>`;
  }
  return `<div class="main-content"><div class="grid">${items.map((item) => renderImageCard(item, selected.has(item.id))).join('')}</div></div>`;
}

