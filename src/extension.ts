/**
 * extension.ts - Entry point for the CipherPad VS Code extension.
 *
 * Registers:
 *  - CustomTextEditorProvider for .ctxt files
 *  - Commands: changePassword, showHistory, restoreHistory, exportPlaintext
 */

import * as vscode from 'vscode';
import { CipherPadEditorProvider } from './editorProvider';
import { passwordManager } from './passwordManager';
import {
  showHistory,
  restoreFromHistory,
  exportPlaintext,
  changePassword
} from './historyManager';

export function activate(context: vscode.ExtensionContext): void {
  // Register the custom editor provider
  const provider = new CipherPadEditorProvider(context);

  const editorRegistration = vscode.window.registerCustomEditorProvider(
    CipherPadEditorProvider.viewType,
    provider,
    {
      webviewOptions: {
        retainContextWhenHidden: true // Keep WebView alive when tab is not focused
      },
      supportsMultipleEditorsPerDocument: false
    }
  );

  context.subscriptions.push(editorRegistration);

  // ── Commands ────────────────────────────────────────────────────────────────

  /**
   * CipherPad: Change Password
   * Re-encrypts the active .ctxt file with a new password.
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('cipherpad.changePassword', async () => {
      const uri = getActiveCtxtUri();
      if (!uri) {
        return;
      }
      await changePassword(uri);
    })
  );

  /**
   * CipherPad: Show History
   * Displays all history snapshots for the active .ctxt file.
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('cipherpad.showHistory', async () => {
      const uri = getActiveCtxtUri();
      if (!uri) {
        return;
      }
      await showHistory(uri);
    })
  );

  /**
   * CipherPad: Restore from History
   * Lets the user pick a snapshot and restores it as the latest version.
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('cipherpad.restoreHistory', async () => {
      const uri = getActiveCtxtUri();
      if (!uri) {
        return;
      }
      await restoreFromHistory(uri);
    })
  );

  /**
   * CipherPad: Export Plaintext
   * Decrypts the active .ctxt file and exports plaintext to a temp file.
   */
  context.subscriptions.push(
    vscode.commands.registerCommand('cipherpad.exportPlaintext', async () => {
      const uri = getActiveCtxtUri();
      if (!uri) {
        return;
      }
      await exportPlaintext(uri);
    })
  );

  // ── Output channel ──────────────────────────────────────────────────────────
  const outputChannel = vscode.window.createOutputChannel('CipherPad');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('CipherPad activated.');
}

export function deactivate(): void {
  // Clear all in-memory passwords on extension deactivation
  passwordManager.clear();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get the URI of the currently active .ctxt document.
 * Shows a warning if no suitable document is active.
 */
function getActiveCtxtUri(): vscode.Uri | undefined {
  // Try to find an active custom editor
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

  if (activeTab?.input instanceof vscode.TabInputCustom) {
    const uri = activeTab.input.uri;
    if (uri.fsPath.endsWith('.ctxt')) {
      return uri;
    }
  }

  // Fallback: check active text editor (shouldn't happen with custom editor)
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && activeEditor.document.uri.fsPath.endsWith('.ctxt')) {
    return activeEditor.document.uri;
  }

  // Try to find any visible .ctxt tab
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputCustom) {
        if (tab.input.uri.fsPath.endsWith('.ctxt')) {
          return tab.input.uri;
        }
      }
    }
  }

  vscode.window.showWarningMessage(
    'CipherPad: No .ctxt file is currently open. Please open a .ctxt file first.'
  );
  return undefined;
}
