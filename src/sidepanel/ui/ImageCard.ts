import { ExtractedImage } from '../../utils/types';

export function renderImageCard(item: ExtractedImage, selected: boolean, highlighted: boolean): string {
  const sizeText = item.bytes ? `${(item.bytes / 1024).toFixed(1)} KB` : '...';
  const dimText = item.width && item.height ? `${item.width}×${item.height}` : '...';

  return `
    <div class="card ${selected ? 'selected' : ''} ${highlighted ? 'highlighted' : ''}" data-id="${item.id}">
      <div class="card-image-wrapper">
        <span class="selection-index"></span>
        <img src="${item.previewUrl || item.url}" alt="${item.filenameHint || 'image'}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      </div>
      <div class="meta">
        <span class="dimensions">${dimText}</span>
        <span class="size">${sizeText}</span>
      </div>
    </div>`;
}
