# UI & Flow Perfection Plan

Refining the app to ensure accurate info display, solid page scanning, and a premium "loading-before-results" experience.

## Proposed Changes

### [Background Service Worker]
- [MODIFY] [service_worker.ts](file:///D:/Other/Chrome%20Extensions/MadCapture/src/background/service_worker.ts)
    - Update `SCAN_PAGE_IMAGES` to check for and execute content script injection if missing.

### [Side Panel]
- [MODIFY] [panel.ts](file:///D:/Other/Chrome%20Extensions/MadCapture/src/sidepanel/panel.ts)
    - **Processing Flow**: Change `onMessage` to hold raw images in a temporary batch.
    - **Metadata Fix**: Update [refreshSizes](file:///D:/Other/Chrome%20Extensions/MadCapture/src/sidepanel/panel.ts#423-449) to load images into an [Image](file:///D:/Other/Chrome%20Extensions/MadCapture/src/utils/types.ts#11-27) object to get `width`/`height` correctly.
    - **Progress Experience**: Ensure `state.processing` is true during capture + metadata phase. Only show images once they are "prepared".
    - **UI Cleanup**: Remove the duplicate download button from the footer.
    - **Info Panel**: Add a stats panel in the footer showing total and selected image counts.
    - **Badges**: Implement the event listeners for badge-based format selection.

- [MODIFY] [styles.css](file:///D:/Other/Chrome%20Extensions/MadCapture/src/sidepanel/styles.css)
    - Add styles for `.format-badges` and `.format-badge` (active/hover states).
    - Style the new `.info-panel` in the footer.

### [Components]
- [MODIFY] [SettingsPanel.ts](file:///D:/Other/Chrome%20Extensions/MadCapture/src/sidepanel/ui/SettingsPanel.ts)
    - Replace the `<select>` dropdown with a sleek selection of format badges.

## Verification Plan
1. **Page Scan**: Test "Scan Page" on a new tab to ensure injection works.
2. **Metadata**: Confirm dimensions and sizes (KB) show up correctly for both selector and page scan.
3. **Flow**: Verify that when images are found, the loading spinner shows *before* the images pop into the grid.
4. **UI**: Check the new badge UI in settings and the stats info in the footer.
