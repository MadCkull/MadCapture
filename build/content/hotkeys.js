"use strict";
(() => {
  // src/content/hotkeys.ts
  var lastTrigger = 0;
  window.addEventListener(
    "keydown",
    (ev) => {
      if (!ev.altKey || ev.code !== "KeyS" || ev.repeat) return;
      const now = Date.now();
      if (now - lastTrigger < 200) return;
      lastTrigger = now;
      ev.preventDefault();
      ev.stopPropagation();
      try {
        chrome.runtime.sendMessage({ type: "TOGGLE_SELECTOR_FOR_TAB" });
      } catch {
      }
    },
    true
  );
})();
