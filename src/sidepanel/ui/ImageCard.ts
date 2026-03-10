import { ExtractedImage } from '../../utils/types';

function getExtBadge(url: string): string {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:image\/(\w+)/);
    return match ? match[1].toUpperCase() : 'DATA';
  }
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const extMatch = pathname.match(/\.(\w{2,5})$/);
    if (extMatch) return extMatch[1].toUpperCase();
    // Check query params for format hints (fm=webp, format=jpg, etc.)
    const params = new URL(url).searchParams;
    for (const key of ['fm', 'format', 'ext', 'type', 'imageformat']) {
      const val = params.get(key);
      if (val) return val.toUpperCase();
    }
  } catch { /* ignore */ }
  return '';
}

export function renderImageCard(item: ExtractedImage, selected: boolean, highlighted: boolean): string {
  const sizeText = item.bytes ? `${(item.bytes / 1024).toFixed(1)} KB` : '...';
  const dimText = item.width && item.height ? `${item.width}×${item.height}` : '...';
  const ext = getExtBadge(item.url);

  return `
    <div class="card ${selected ? 'selected' : ''} ${highlighted ? 'highlighted' : ''}" data-id="${item.id}" data-url="${item.url.startsWith('data:') ? '' : item.url}">
      <div class="card-image-wrapper">
        <span class="selection-index"></span>
        ${ext ? `<span class="ext-badge">${ext}</span>` : ''}
        <img src="${item.previewUrl || item.url}" alt="${item.filenameHint || 'image'}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      </div>
      <div class="meta">
        <span class="dimensions">${dimText}</span>
        <span class="size">${sizeText}</span>
      </div>
    </div>`;
}
