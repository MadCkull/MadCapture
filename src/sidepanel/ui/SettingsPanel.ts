import { DesiredFormat, NamingOptions } from '../../utils/types';

export function renderSettingsPanel(options: NamingOptions, format: DesiredFormat): string {
  return `
    <div class="settings-panel">
      <div class="input-row">
        <div class="input-group">
          <label for="baseName">Filename</label>
          <input type="text" id="baseName" value="${options.baseName}" placeholder="Pic" />
          <div class="field-hint">Example: Name (1), Name (2), Name (3)</div>
        </div>
        <div class="input-group">
          <label for="zeroPad">0 Padding</label>
          <input type="number" id="zeroPad" value="${options.zeroPad ?? 0}" min="0" max="5" />
        </div>
      </div>
      <div class="input-group">
        <label for="folderName">Folder Name</label>
        <input type="text" id="folderName" value="${options.folderName ?? ''}" placeholder="Captures" />
      </div>
      <div class="input-group">
        <label>Export Format</label>
        <div class="format-badges" id="formatBadges">
          <div class="format-badge ${format === 'original' ? 'active' : ''}" data-value="original">Original</div>
          <div class="format-badge ${format === 'image/png' ? 'active' : ''}" data-value="image/png">PNG</div>
          <div class="format-badge ${format === 'image/jpeg' ? 'active' : ''}" data-value="image/jpeg">JPEG</div>
          <div class="format-badge ${format === 'image/webp' ? 'active' : ''}" data-value="image/webp">WEBP</div>
        </div>
      </div>
    </div>`;
}
