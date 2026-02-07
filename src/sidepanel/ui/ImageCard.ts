import { ExtractedImage } from '../../utils/types';

export function renderImageCard(item: ExtractedImage, checked: boolean): string {
  return `
    <label class="card">
      <input type="checkbox" data-id="${item.id}" ${checked ? 'checked' : ''}/>
      <img src="${item.url}" alt="${item.filenameHint || 'image'}" loading="lazy" />
      <div class="meta">
        <div>${item.width ?? '?'}×${item.height ?? '?'}</div>
        <div>${item.bytes ? `${Math.round(item.bytes / 1024)} KB` : 'size ?'}</div>
      </div>
    </label>`;
}
