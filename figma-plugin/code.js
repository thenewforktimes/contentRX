// Content standards checker — sandbox thread
// Runs in Figma's sandbox. Reads text layers and relays data to the UI iframe.

figma.showUI(__html__, { width: 400, height: 520, themeColors: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract text content from the current selection. */
function getSelectedText() {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) return [];

  const textNodes = [];

  function walk(node) {
    if (node.type === "TEXT") {
      textNodes.push({
        id: node.id,
        name: node.name,
        characters: node.characters,
      });
    }
    if ("children" in node) {
      for (const child of node.children) walk(child);
    }
  }

  for (const node of selection) walk(node);
  return textNodes;
}

// ---------------------------------------------------------------------------
// Message handler — all UI ↔ sandbox communication flows through here
// ---------------------------------------------------------------------------

figma.ui.onmessage = async (msg) => {
  switch (msg.type) {

    // UI requests the currently selected text layers
    case "get-selection": {
      const nodes = getSelectedText();
      figma.ui.postMessage({ type: "selection-result", nodes });
      break;
    }

    // Persist API key in Figma's local storage (never leaves the machine)
    case "save-api-key": {
      await figma.clientStorage.setAsync("anthropic-api-key", msg.key);
      figma.ui.postMessage({ type: "api-key-saved" });
      break;
    }

    // Retrieve stored API key on plugin open
    case "load-api-key": {
      const key = await figma.clientStorage.getAsync("anthropic-api-key");
      figma.ui.postMessage({ type: "api-key-loaded", key: key || "" });
      break;
    }

    // Clear stored key
    case "clear-api-key": {
      await figma.clientStorage.deleteAsync("anthropic-api-key");
      figma.ui.postMessage({ type: "api-key-cleared" });
      break;
    }

    // Close the plugin
    case "close": {
      figma.closePlugin();
      break;
    }
  }
};
