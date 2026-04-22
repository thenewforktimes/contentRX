// Content standards checker — sandbox thread (v3.0.0)
// Runs in Figma's sandbox. Reads text layers and relays data to the UI iframe.
//
// Architecture note: this thread has ZERO network access. All API calls
// happen in ui.html. Communication is via postMessage() only.
//
// As of v3 the plugin no longer stores an Anthropic key; authentication
// is a ContentRX session token (cx_...) obtained via a sign-in flow
// that the UI opens in the user's default browser.
//
// Message protocol (sandbox → UI):
//   selection-result    — text nodes from current selection
//   page-scan-result    — text nodes from entire current page
//   token-loaded        — stored cx_token on plugin open ("" if none)
//   token-saved         — confirmation after saving a token
//   token-cleared       — confirmation after clearing the token
//   focus-complete      — confirmation after zooming to a node
//
// Message protocol (UI → sandbox):
//   get-selection       — request selected text layers
//   scan-page           — request all text layers on current page
//   scan-selection      — request text layers in selected frames/layers
//   focus-node          — zoom to and select a specific node by ID
//   save-token          — persist cx_token to Figma client storage
//   load-token          — retrieve stored cx_token
//   clear-token         — delete stored cx_token
//   open-external       — open a URL in the user's default browser
//                         (payload: { url })
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
    // cx_token management. Stored in Figma's client storage so the user
    // stays signed in between plugin opens; never leaves the local machine
    // except as the Authorization header on requests to the ContentRX API.
    // -----------------------------------------------------------------------
    case "save-token": {
      await figma.clientStorage.setAsync("cx_token", msg.token);
      figma.ui.postMessage({ type: "token-saved" });
      break;
    }

    case "load-token": {
      const token = await figma.clientStorage.getAsync("cx_token");
      figma.ui.postMessage({ type: "token-loaded", token: token || "" });
      break;
    }

    case "clear-token": {
      await figma.clientStorage.deleteAsync("cx_token");
      figma.ui.postMessage({ type: "token-cleared" });
      break;
    }

    // -----------------------------------------------------------------------
    // Open a URL in the user's default browser. figma.openExternal is
    // sandbox-only; the UI iframe cannot call it directly.
    // -----------------------------------------------------------------------
    case "open-external": {
      if (typeof msg.url === "string") {
        figma.openExternal(msg.url);
      }
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
