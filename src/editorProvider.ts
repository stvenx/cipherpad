/**
 * editorProvider.ts - CustomTextEditorProvider for .ctxt files.
 *
 * Lifecycle:
 *   1. resolveCustomTextEditor() is called by VS Code when a .ctxt file is opened.
 *   2. We read the file from disk, prompt for a password, decrypt, and send
 *      the plaintext to the WebView.
 *   3. When the user saves (Ctrl+S), the WebView posts a message; we encrypt
 *      the new plaintext and write the ciphertext back to disk.
 *   4. On close, the password is cleared from memory.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  readCtxtFile,
  writeCtxtFile,
  isExistingFile,
  getLatestEntry,
  prependHistoryEntry,
  HistoryEntry
} from './ctxtDocument';
import { encrypt, decrypt } from './crypto';
import { passwordManager } from './passwordManager';
import { promptPassword, promptNewPassword } from './historyManager';

export class CipherPadEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'cipherpad.editor';

  private readonly _extensionUri: vscode.Uri;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._extensionUri = context.extensionUri;
  }

  /**
   * Called by VS Code when a .ctxt file is opened with this editor.
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const uri = document.uri;
    const uriStr = uri.toString();

    // Configure the webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')]
    };

    // Load HTML from media/editor.html
    webviewPanel.webview.html = this.getWebviewContent(webviewPanel.webview);

    // Read the file from disk
    let ctxtData = await readCtxtFile(uri);
    let plaintext = '';

    if (isExistingFile(ctxtData)) {
      // Existing file — prompt for password and decrypt
      plaintext = await this.openExistingFile(uri, ctxtData);
      if (plaintext === null) {
        // User cancelled — close the panel
        webviewPanel.dispose();
        return;
      }
    } else {
      // New file — prompt for new password
      const password = await this.setupNewFile(uri);
      if (!password) {
        webviewPanel.dispose();
        return;
      }
      plaintext = '';
    }

    // Send plaintext to the WebView
    webviewPanel.webview.postMessage({
      type: 'init',
      content: plaintext,
      fileName: path.basename(uri.fsPath),
      algorithm: 'AES-256-CBC'
    });

    // Guard flag: skip fileWatcher events triggered by our own save
    let isSelfWrite = false;

    // Handle messages from WebView
    const messageDisposable = webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'save':
          isSelfWrite = true;
          await this.saveDocument(uri, document, message.content, webviewPanel);
          plaintext = message.content;
          setTimeout(() => { isSelfWrite = false; }, 1000);
          break;

        case 'contentChanged':
          // Mark the document as dirty via a no-op workspace edit
          // (we track dirty state in the WebView itself)
          break;

        case 'requestContent':
          // Re-send current content (e.g., after a restore)
          webviewPanel.webview.postMessage({
            type: 'init',
            content: plaintext,
            fileName: path.basename(uri.fsPath),
            algorithm: 'AES-256-CBC'
          });
          break;
      }
    });

    // Clean up on panel close
    webviewPanel.onDidDispose(() => {
      passwordManager.delete(uriStr);
      messageDisposable.dispose();
    });

    // Listen for file changes on disk (e.g., after history restore)
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(uri, '*')
    );
    fileWatcher.onDidChange(async () => {
      // Skip reload when the change was triggered by our own save
      if (isSelfWrite) {
        return;
      }
      // Reload if someone else changed the file
      const refreshed = await readCtxtFile(uri);
      const pw = passwordManager.get(uriStr);
      if (!pw || !isExistingFile(refreshed)) {
        return;
      }
      const latest = getLatestEntry(refreshed);
      if (!latest) {
        return;
      }
      try {
        const newPlaintext = await decrypt(latest.ciphertext, latest.salt, latest.iv, pw);
        plaintext = newPlaintext;
        webviewPanel.webview.postMessage({
          type: 'init',
          content: plaintext,
          fileName: path.basename(uri.fsPath),
          algorithm: 'AES-256-CBC'
        });
      } catch {
        // Ignore if decryption fails on external change
      }
    });

    webviewPanel.onDidDispose(() => {
      fileWatcher.dispose();
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Prompt for password and decrypt an existing file.
   * Returns the plaintext, or null if the user cancelled.
   */
  private async openExistingFile(
    uri: vscode.Uri,
    ctxtData: Awaited<ReturnType<typeof readCtxtFile>>
  ): Promise<string> {
    const latest = getLatestEntry(ctxtData)!;

    // Check if we already have the password in memory
    let password = passwordManager.get(uri.toString());

    if (!password) {
      // Prompt until correct or cancelled
      for (let attempt = 0; attempt < 5; attempt++) {
        const input = await promptPassword(
          attempt === 0
            ? `Enter password for ${path.basename(uri.fsPath)}:`
            : `Incorrect password. Try again (attempt ${attempt + 1}/5):`
        );

        if (!input) {
          return null as unknown as string; // user cancelled
        }

        try {
          const plaintext = await decrypt(latest.ciphertext, latest.salt, latest.iv, input);
          passwordManager.set(uri.toString(), input);
          return plaintext;
        } catch {
          if (attempt === 4) {
            vscode.window.showErrorMessage('CipherPad: Too many failed attempts. The file was not opened.');
            return null as unknown as string;
          }
          // Loop — prompt again
        }
      }
    }

    // Password already in memory — just decrypt
    try {
      return await decrypt(latest.ciphertext, latest.salt, latest.iv, password!);
    } catch {
      // Password in memory is wrong (shouldn't happen) — clear and recurse
      passwordManager.delete(uri.toString());
      return this.openExistingFile(uri, ctxtData);
    }
  }

  /**
   * Prompt for a new password (with confirmation) for a brand-new file.
   * Returns the password or undefined if cancelled.
   */
  private async setupNewFile(uri: vscode.Uri): Promise<string | undefined> {
    const password = await promptNewPassword();
    if (!password) {
      return undefined;
    }
    passwordManager.set(uri.toString(), password);
    return password;
  }

  /**
   * Encrypt the given plaintext and write it to the .ctxt file on disk.
   */
  private async saveDocument(
    uri: vscode.Uri,
    document: vscode.TextDocument,
    content: string,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const password = passwordManager.get(uri.toString());
    if (!password) {
      vscode.window.showErrorMessage('CipherPad: No password found. Cannot save.');
      return;
    }

    try {
      const encResult = await encrypt(content, password);
      const ctxtData = await readCtxtFile(uri);

      const newEntry: HistoryEntry = {
        salt: encResult.salt,
        iv: encResult.iv,
        ciphertext: encResult.ciphertext,
        savedAt: new Date().toISOString(),
        hint: ''
      };

      const updatedData = prependHistoryEntry(ctxtData, newEntry);
      await writeCtxtFile(uri, updatedData);

      // Sync VS Code's TextDocument with disk content so that
      // VS Code's native Cmd+S won't overwrite with stale data
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      const wsEdit = new vscode.WorkspaceEdit();
      wsEdit.replace(document.uri, fullRange, JSON.stringify(updatedData, null, 2));
      await vscode.workspace.applyEdit(wsEdit);
      await document.save();

      // Notify WebView that save was successful
      webviewPanel.webview.postMessage({
        type: 'saveSuccess',
        savedAt: newEntry.savedAt
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`CipherPad: Save failed — ${msg}`);
      webviewPanel.webview.postMessage({ type: 'saveError', message: msg });
    }
  }

  /**
   * Load and return the WebView HTML, injecting the correct CSP and resource URIs.
   */
  private getWebviewContent(webview: vscode.Webview): string {
    const mediaPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'editor.html');

    try {
      const html = fs.readFileSync(mediaPath.fsPath, 'utf8');
      return html;
    } catch {
      // Fallback inline HTML if media/editor.html is missing
      return this.getFallbackHtml();
    }
  }

  private getFallbackHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CipherPad</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { display: flex; flex-direction: column; height: 100vh; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-editor-font-family, monospace); }
  #editor { flex: 1; width: 100%; padding: 16px; border: none; resize: none; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: inherit; font-size: var(--vscode-editor-font-size, 14px); line-height: 1.5; outline: none; }
  #statusbar { display: flex; gap: 16px; padding: 4px 12px; font-size: 11px; background: var(--vscode-statusBar-background, #007acc); color: var(--vscode-statusBar-foreground, #fff); }
</style>
</head>
<body>
<textarea id="editor" spellcheck="false" placeholder="Start typing your secret notes here..."></textarea>
<div id="statusbar">
  <span id="charCount">0 chars</span>
  <span id="lastSaved">Not saved</span>
  <span id="algo">AES-256-CBC</span>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const editor = document.getElementById('editor');
  const charCount = document.getElementById('charCount');
  const lastSaved = document.getElementById('lastSaved');

  editor.addEventListener('input', () => {
    charCount.textContent = editor.value.length + ' chars';
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      vscode.postMessage({ type: 'save', content: editor.value });
      lastSaved.textContent = 'Saving...';
    }
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'init') {
      editor.value = msg.content || '';
      charCount.textContent = editor.value.length + ' chars';
      document.getElementById('algo').textContent = msg.algorithm || 'AES-256-CBC';
    } else if (msg.type === 'saveSuccess') {
      lastSaved.textContent = 'Saved ' + new Date(msg.savedAt).toLocaleTimeString();
    } else if (msg.type === 'saveError') {
      lastSaved.textContent = 'Save FAILED';
    }
  });
</script>
</body>
</html>`;
  }
}
