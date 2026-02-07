import { ExtractedImage } from '../../utils/types';
import { renderImageCard } from './ImageCard';

export function renderImageGrid(items: ExtractedImage[], selected: Set<string>): string {
  return `<div class="grid">${items.map((item) => renderImageCard(item, selected.has(item.id))).join('')}</div>`;
}
