/**
 * ContentRX VS Code / Cursor extension.
 *
 * BUILD_PLAN_v2 Session 18. Thin wrapper that:
 *
 *   1. Locates (or launches via `uvx`) the `contentrx-lsp` binary.
 *   2. On first activation, prompts for a CONTENTRX_API_KEY and
 *      stores it in the editor's secret storage (OS keychain
 *      via VS Code's SecretStorage API).
 *   3. Starts the LSP client over stdio with that secret injected
 *      into the server's environment.
 *   4. Renders a status-bar item with the current violation count
 *      for the active editor.
 *   5. Re-exposes LSP commands through the command palette.
 *
 * The extension itself carries no ContentRX logic — everything
 * substantive lives in `contentrx-lsp`. This file is glue.
 */

import { spawnSync } from "node:child_process";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  State as ClientState,
  TransportKind,
} from "vscode-languageclient/node";

const SECRET_KEY = "contentrx.apiKey";
const LSP_BIN_NAME = "contentrx-lsp";
const LOG_NAME = "ContentRX";

let client: LanguageClient | undefined;
let statusBar: vscode.StatusBarItem | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const output = vscode.window.createOutputChannel(LOG_NAME);
  context.subscriptions.push(output);

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.name = "ContentRX";
  statusBar.text = "$(eye) ContentRX";
  statusBar.tooltip = "ContentRX language server — click to view output";
  statusBar.command = "contentrx.showOutput";
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("contentrx.showOutput", () => {
      output.show(true);
    }),
    vscode.commands.registerCommand("contentrx.setApiKey", async () => {
      const key = await promptForApiKey();
      if (key) {
        await context.secrets.store(SECRET_KEY, key);
        vscode.window.showInformationMessage(
          "ContentRX: API key saved. Restarting language server.",
        );
        await restartServer(context, output);
      }
    }),
    vscode.commands.registerCommand("contentrx.clearApiKey", async () => {
      await context.secrets.delete(SECRET_KEY);
      vscode.window.showInformationMessage(
        "ContentRX: API key cleared.",
      );
      if (client) {
        await client.stop();
        client = undefined;
      }
      updateStatus("disconnected");
    }),
    vscode.commands.registerCommand("contentrx.restartServer", async () => {
      await restartServer(context, output);
    }),
  );

  // Refresh the status bar's violation count every time the active
  // editor or its diagnostics change.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(refreshStatusBar),
    vscode.languages.onDidChangeDiagnostics(refreshStatusBar),
  );

  await startServerIfConfigured(context, output);
  refreshStatusBar();
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

async function startServerIfConfigured(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<void> {
  let apiKey = await context.secrets.get(SECRET_KEY);
  if (!apiKey) {
    // Also accept an env-var supplied key so users who prefer shell
    // config don't have to re-enter it via the command palette.
    apiKey = process.env.CONTENTRX_API_KEY;
    if (!apiKey) {
      const choice = await vscode.window.showInformationMessage(
        "ContentRX needs an API key to lint. Generate one at contentrx.io/dashboard.",
        "Set API key",
        "Later",
      );
      if (choice === "Set API key") {
        const key = await promptForApiKey();
        if (key) {
          await context.secrets.store(SECRET_KEY, key);
          apiKey = key;
        }
      }
    }
  }
  if (!apiKey) {
    output.appendLine(
      "No API key configured — ContentRX diagnostics are off.",
    );
    updateStatus("disconnected");
    return;
  }

  const settings = vscode.workspace.getConfiguration("contentrx");
  const serverPath = (settings.get<string>("serverPath") ?? "").trim();
  const apiUrl = (settings.get<string>("apiUrl") ?? "").trim();

  const serverOptions = resolveServerOptions(serverPath, apiKey, apiUrl);
  if (!serverOptions) {
    vscode.window.showErrorMessage(
      "ContentRX: couldn't find the contentrx-lsp binary. Install it with `uv tool install contentrx-lsp` or `pipx install contentrx-lsp`, or set contentrx.serverPath.",
    );
    updateStatus("disconnected");
    return;
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "typescriptreact" },
      { scheme: "file", language: "javascriptreact" },
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "javascript" },
    ],
    outputChannel: output,
  };

  client = new LanguageClient(
    "contentrx",
    "ContentRX Language Server",
    serverOptions,
    clientOptions,
  );

  client.onDidChangeState((event) => {
    if (event.newState === ClientState.Running) {
      updateStatus("connected");
    } else if (event.newState === ClientState.Stopped) {
      updateStatus("disconnected");
    }
  });

  try {
    await client.start();
  } catch (err) {
    output.appendLine(`Failed to start ContentRX language server: ${err}`);
    vscode.window.showErrorMessage(
      "ContentRX language server failed to start — see output channel.",
    );
    updateStatus("disconnected");
  }
}

async function restartServer(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
  await startServerIfConfigured(context, output);
}

function resolveServerOptions(
  serverPath: string,
  apiKey: string,
  apiUrl: string,
): ServerOptions | null {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CONTENTRX_API_KEY: apiKey,
  };
  if (apiUrl) {
    env.CONTENTRX_API_URL = apiUrl;
  }

  if (serverPath) {
    return {
      command: serverPath,
      transport: TransportKind.stdio,
      options: { env },
    };
  }

  // Prefer a user-installed `contentrx-lsp` on PATH (via pipx, pip,
  // or uv tool install). Fall back to `uvx contentrx-lsp` which
  // downloads + runs on demand — no install required for first-run
  // trials.
  if (commandExistsOnPath(LSP_BIN_NAME)) {
    return {
      command: LSP_BIN_NAME,
      transport: TransportKind.stdio,
      options: { env },
    };
  }
  if (commandExistsOnPath("uvx")) {
    return {
      command: "uvx",
      args: [LSP_BIN_NAME],
      transport: TransportKind.stdio,
      options: { env },
    };
  }
  return null;
}

function commandExistsOnPath(cmd: string): boolean {
  // `which` on POSIX, `where` on Windows.
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSync(probe, [cmd], { encoding: "utf8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function promptForApiKey(): Promise<string | undefined> {
  const key = await vscode.window.showInputBox({
    prompt: "Paste your ContentRX API key (starts with cx_)",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return "API key is required";
      if (!trimmed.startsWith("cx_")) {
        return "ContentRX keys start with cx_";
      }
      if (trimmed.length < 16) return "Key looks too short";
      return null;
    },
  });
  return key?.trim();
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function updateStatus(state: "connected" | "disconnected"): void {
  if (!statusBar) return;
  if (state === "disconnected") {
    statusBar.text = "$(alert) ContentRX off";
    statusBar.tooltip = "ContentRX language server not running. Click to view output.";
    return;
  }
  refreshStatusBar();
}

function refreshStatusBar(): void {
  if (!statusBar) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    statusBar.text = "$(eye) ContentRX";
    statusBar.tooltip = "ContentRX — open a TSX / JSX file to see diagnostics.";
    return;
  }
  const diagnostics = vscode.languages
    .getDiagnostics(editor.document.uri)
    .filter((d) => d.source === "ContentRX");
  const warnings = diagnostics.filter(
    (d) => d.severity === vscode.DiagnosticSeverity.Warning,
  ).length;
  const infos = diagnostics.filter(
    (d) => d.severity === vscode.DiagnosticSeverity.Information,
  ).length;
  const total = warnings + infos;
  if (total === 0) {
    statusBar.text = "$(check) ContentRX";
    statusBar.tooltip = "ContentRX: no violations in this file.";
  } else {
    statusBar.text = `$(warning) ContentRX ${warnings}/${infos}`;
    statusBar.tooltip = `ContentRX: ${warnings} violation${
      warnings === 1 ? "" : "s"
    }, ${infos} flagged for review.`;
  }
}
