import { DesiredFormat, NamingOptions } from '../../utils/types';

export function renderSettingsPanel(options: NamingOptions, format: DesiredFormat): string {
  return `
    <div class="settings-panel">
      <div class="input-group">
        <label for="prefix">Filename Prefix</label>
        <input type="text" id="prefix" value="${options.prefix}" placeholder="Pic" />
      </div>
      <div class="input-group">
        <label for="folderName">Folder Name</label>
        <input type="text" id="folderName" value="${options.folderName}" placeholder="Captures" />
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
      <div class="row" style="margin-top: 16px; border-top: 1px solid var(--panel-border); padding-top: 16px;">
        <button class="secondary" id="viewLogs" style="width: 100%; border-radius: 4px; font-size: 12px; height: 32px;">📜 View Debug Logs</button>
      </div>
    </div>`;
}

