// Content standards checker — sandbox thread (v2.0.0)
// Runs in Figma's sandbox. Reads text layers and relays data to the UI iframe.
//
// Architecture note: this thread has ZERO network access. All API calls
// happen in ui.html. Communication is via postMessage() only.
//
// Message protocol (sandbox → UI):
//   selection-result    — text nodes from current selection
//   page-scan-result    — text nodes from entire current page
//   api-key-loaded      — stored API key on plugin open
//   api-key-saved       — confirmation after saving key
//   api-key-cleared     — confirmation after clearing key
//   focus-complete      — confirmation after zooming to a node
//
// Message protocol (UI → sandbox):
//   get-selection       — request selected text layers
//   scan-page           — request all text layers on current page
//   scan-selection      — request text layers in selected frames/layers
//   focus-node          — zoom to and select a specific node by ID
//   save-api-key        — persist API key to Figma client storage
//   load-api-key        — retrieve stored API key
//   clear-api-key       — delete stored API key
//   close               — close the plugin

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract structured data from a single text node.
 * Includes metadata useful for results display and future content type hinting.
 */
function extractNodeData(node) {
  // Walk up the tree to find the nearest named parent frame or group.
  // This gives context like "Hero section" or "Error state" in results.
  let parentName = "";
  let current = node.parent;
  while (current && current.type !== "PAGE") {
    if (current.type === "FRAME" || current.type === "COMPONENT" || current.type === "SECTION") {
      parentName = current.name;
      break;
    }
    current = current.parent;
  }

  return {
    id: node.id,
    name: node.name,
    characters: node.characters,
    parentName: parentName,
  };
}

/**
 * Recursively collect all text nodes under a given root node.
 * Skips hidden layers and empty text nodes to avoid noise.
 */
function collectTextNodes(root) {
  const textNodes = [];

  function walk(node) {
    // Skip hidden layers — they aren't shipped content
    if ("visible" in node && !node.visible) return;

    if (node.type === "TEXT") {
      const text = node.characters;
      // Skip empty or whitespace-only text layers
      if (text && text.trim().length > 0) {
        textNodes.push(extractNodeData(node));
      }
    }

    if ("children" in node) {
      for (const child of node.children) walk(child);
    }
  }

  walk(root);
  return textNodes;
}

// ---------------------------------------------------------------------------
// Message handler — all UI ↔ sandbox communication flows through here
// ---------------------------------------------------------------------------

figma.ui.onmessage = async (msg) => {
  switch (msg.type) {

    // -----------------------------------------------------------------------
    // Scan: all text layers on the current page
    // -----------------------------------------------------------------------
    case "scan-page": {
      const nodes = collectTextNodes(figma.currentPage);
      figma.ui.postMessage({ type: "page-scan-result", nodes });
      break;
    }

    // -----------------------------------------------------------------------
    // Scan: text layers within the current selection
    // Walks into selected frames/groups to find all nested text nodes.
    // -----------------------------------------------------------------------
    case "scan-selection": {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.ui.postMessage({ type: "selection-result", nodes: [] });
        break;
      }

      const allNodes = [];
      for (const node of selection) {
        const found = collectTextNodes(node);
        allNodes.push(...found);
      }

      // Deduplicate by node ID in case of overlapping selections
      const seen = new Set();
      const unique = allNodes.filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      });

      figma.ui.postMessage({ type: "selection-result", nodes: unique });
      break;
    }

    // -----------------------------------------------------------------------
    // Legacy: get-selection (kept for backward compatibility with single check)
    // -----------------------------------------------------------------------
    case "get-selection": {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.ui.postMessage({ type: "selection-result", nodes: [] });
        break;
      }

      const allNodes = [];
      for (const node of selection) {
        const found = collectTextNodes(node);
        allNodes.push(...found);
      }

      const seen = new Set();
      const unique = allNodes.filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      });

      figma.ui.postMessage({ type: "selection-result", nodes: unique });
      break;
    }

    // -----------------------------------------------------------------------
    // Focus: select and zoom to a specific text node
    // Called when the user clicks "Go to layer" in the results panel.
    // -----------------------------------------------------------------------
    case "focus-node": {
      const node = figma.getNodeById(msg.nodeId);
      if (!node) {
        // #24: Layer was deleted since the scan
        figma.ui.postMessage({
          type: "focus-error",
          message: "This layer no longer exists in the file.",
        });
        break;
      }

      // #25: Check if the node is on the current page
      let pageParent = node.parent;
      while (pageParent && pageParent.type !== "PAGE") {
        pageParent = pageParent.parent;
      }
      if (pageParent && pageParent !== figma.currentPage) {
        figma.ui.postMessage({
          type: "focus-error",
          message: "This layer is on a different page.",
        });
        break;
      }

      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
      figma.ui.postMessage({ type: "focus-complete", nodeId: msg.nodeId });
      break;
    }

    // -----------------------------------------------------------------------
    // API key management (unchanged from v1)
    // Keys are stored in Figma's client storage — never leaves the machine.
    // -----------------------------------------------------------------------
    case "save-api-key": {
      await figma.clientStorage.setAsync("anthropic-api-key", msg.key);
      figma.ui.postMessage({ type: "api-key-saved" });
      break;
    }

    case "load-api-key": {
      const key = await figma.clientStorage.getAsync("anthropic-api-key");
      figma.ui.postMessage({ type: "api-key-loaded", key: key || "" });
      break;
    }

    case "clear-api-key": {
      await figma.clientStorage.deleteAsync("anthropic-api-key");
      figma.ui.postMessage({ type: "api-key-cleared" });
      break;
    }

    // -----------------------------------------------------------------------
    // Close the plugin
    // -----------------------------------------------------------------------
    case "close": {
      figma.closePlugin();
      break;
    }
  }
};
