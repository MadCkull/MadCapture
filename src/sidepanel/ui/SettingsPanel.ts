import { DesiredFormat, NamingOptions } from '../../utils/types';

export function renderSettingsPanel(options: NamingOptions, format: DesiredFormat, quality: number, preview: string[]): string {
  return `<aside class="settings">
    <label>Template <input id="template" value="${options.template}" /></label>
    <label>Start index <input id="startIndex" type="number" value="${options.startIndex}" /></label>
    <label>Zero pad <input id="zeroPad" type="number" value="${options.zeroPad}" /></label>
    <label><input id="includeHint" type="checkbox" ${options.includeHint ? 'checked' : ''} /> Include original filename hint</label>
    <label>Format
      <select id="format">
        <option value="original" ${format === 'original' ? 'selected' : ''}>Original</option>
        <option value="image/png" ${format === 'image/png' ? 'selected' : ''}>PNG</option>
        <option value="image/jpeg" ${format === 'image/jpeg' ? 'selected' : ''}>JPEG</option>
        <option value="image/webp" ${format === 'image/webp' ? 'selected' : ''}>WEBP</option>
      </select>
    </label>
    <label>Quality <input id="quality" type="range" min="0.4" max="1" step="0.05" value="${quality}" /></label>
    <div class="preview"><strong>Preview</strong>${preview.slice(0, 5).map((n) => `<div>${n}</div>`).join('')}</div>
  </aside>`;
}
