"use strict";
(() => {
  // src/workers/converter.worker.ts
  self.onmessage = async (event) => {
    const { id, bytes, targetType, quality } = event.data;
    try {
      if (targetType === "original") {
        self.postMessage({ id, ok: true, bytes });
        return;
      }
      const blob = new Blob([bytes]);
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context unavailable");
      ctx.drawImage(bitmap, 0, 0);
      const out = await canvas.convertToBlob({ type: targetType, quality });
      const arr = await out.arrayBuffer();
      self.postMessage({ id, ok: true, bytes: arr, mime: targetType }, [arr]);
    } catch (error) {
      self.postMessage({ id, ok: false, error: error.message });
    }
  };
})();
