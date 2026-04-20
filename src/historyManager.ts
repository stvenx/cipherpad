/**
 * historyManager.ts - Commands for viewing and restoring history snapshots.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { readCtxtFile, writeCtxtFile, HistoryEntry, prependHistoryEntry } from './ctxtDocument';
import { decrypt, encrypt } from './crypto';
import { passwordManager } from './passwordManager';

/**
 * Show history snapshots for the active .ctxt document.
 * Displays a QuickPick list with metadata for each snapshot.
 */
export async function showHistory(uri: vscode.Uri): Promise<void> {
  const data = await readCtxtFile(uri);

  if (data.history.length === 0) {
    vscode.window.showInformationMessage('No history snapshots available for this file.');
    return;
  }

  const items = data.history.map((entry, index) => {
    const date = new Date(entry.savedAt);
    const label = index === 0 ? `$(check) Current — ${formatDate(date)}` : `$(history) Snapshot ${index} — ${formatDate(date)}`;
    const description = `${data.algorithm} · PBKDF2 ${entry.hint ? `· Hint: ${entry.hint}` : ''}`;
    return {
      label,
      description,
      detail: `Saved: ${date.toLocaleString()}`,
      entry,
      index
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a snapshot to view details (use Restore command to restore)',
    title: `CipherPad History — ${path.basename(uri.fsPath)}`
  });

  if (selected) {
    const detail = [
      `Snapshot ${selected.index}`,
      `Saved: ${new Date(selected.entry.savedAt).toLocaleString()}`,
      `Algorithm: ${data.algorithm}`,
      selected.entry.hint ? `Hint: ${selected.entry.hint}` : ''
    ].filter(Boolean).join(' | ');

    vscode.window.showInformationMessage(detail);
  }
}

/**
 * Restore a history snapshot for the active .ctxt document.
 * Prompts the user to pick a snapshot, then re-encrypts with the current password.
 */
export async function restoreFromHistory(uri: vscode.Uri): Promise<void> {
  const data = await readCtxtFile(uri);

  if (data.history.length <= 1) {
    vscode.window.showInformationMessage('No older snapshots available to restore.');
    return;
  }

  // Offer all snapshots except index 0 (current)
  const items = data.history.slice(1).map((entry, index) => {
    const date = new Date(entry.savedAt);
    return {
      label: `Snapshot ${index + 1} — ${formatDate(date)}`,
      description: entry.hint || '',
      detail: `Saved: ${date.toLocaleString()}`,
      entry
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a snapshot to restore',
    title: `Restore History — ${path.basename(uri.fsPath)}`
  });

  if (!selected) {
    return;
  }

  // Get the current password
  let password = passwordManager.get(uri.toString());
  if (!password) {
    password = await promptPassword('Enter your current password to restore snapshot:');
    if (!password) {
      return;
    }
  }

  // Decrypt the selected snapshot
  let plaintext: string;
  try {
    plaintext = await decrypt(
      selected.entry.ciphertext,
      selected.entry.salt,
      selected.entry.iv,
      password
    );
  } catch {
    vscode.window.showErrorMessage(
      'Failed to decrypt the snapshot. The password may be different from the one used when the snapshot was saved.'
    );
    return;
  }

  // Re-encrypt with the current password and save as new latest entry
  const encResult = await encrypt(plaintext, password);
  const newEntry: HistoryEntry = {
    salt: encResult.salt,
    iv: encResult.iv,
    ciphertext: encResult.ciphertext,
    savedAt: new Date().toISOString(),
    hint: ''
  };

  const updatedData = prependHistoryEntry(data, newEntry);
  await writeCtxtFile(uri, updatedData);

  vscode.window.showInformationMessage(
    `Snapshot restored successfully. The editor will reload the file.`
  );
}

/**
 * Export the decrypted plaintext of the active .ctxt document to a temp file.
 */
export async function exportPlaintext(uri: vscode.Uri): Promise<void> {
  const data = await readCtxtFile(uri);

  if (data.history.length === 0) {
    vscode.window.showInformationMessage('This file is empty — nothing to export.');
    return;
  }

  let password = passwordManager.get(uri.toString());
  if (!password) {
    password = await promptPassword('Enter password to export plaintext:');
    if (!password) {
      return;
    }
  }

  const latest = data.history[0];
  let plaintext: string;
  try {
    plaintext = await decrypt(latest.ciphertext, latest.salt, latest.iv, password);
  } catch {
    vscode.window.showErrorMessage('Decryption failed. Please check your password.');
    return;
  }

  // Write to a temp file
  const tmpDir = os.tmpdir();
  const baseName = path.basename(uri.fsPath, '.ctxt');
  const tmpPath = path.join(tmpDir, `${baseName}-plaintext-${Date.now()}.txt`);
  const tmpUri = vscode.Uri.file(tmpPath);

  await vscode.workspace.fs.writeFile(tmpUri, Buffer.from(plaintext, 'utf8'));

  const action = await vscode.window.showInformationMessage(
    `Plaintext exported to: ${tmpPath}`,
    'Open File',
    'Reveal in Explorer'
  );

  if (action === 'Open File') {
    await vscode.commands.executeCommand('vscode.open', tmpUri);
  } else if (action === 'Reveal in Explorer') {
    await vscode.commands.executeCommand('revealFileInOS', tmpUri);
  }
}

/**
 * Change the password for the active .ctxt document.
 * Re-encrypts all history entries with the new password.
 */
export async function changePassword(uri: vscode.Uri): Promise<void> {
  const data = await readCtxtFile(uri);

  if (data.history.length === 0) {
    vscode.window.showInformationMessage('This file is empty. Set a password when you first save content.');
    return;
  }

  // Verify old password
  let oldPassword = passwordManager.get(uri.toString());
  if (!oldPassword) {
    oldPassword = await promptPassword('Enter your CURRENT password:');
    if (!oldPassword) {
      return;
    }
  }

  const latest = data.history[0];
  try {
    await decrypt(latest.ciphertext, latest.salt, latest.iv, oldPassword);
  } catch {
    vscode.window.showErrorMessage('Current password is incorrect.');
    return;
  }

  // Prompt for new password (with confirmation)
  const newPassword = await promptNewPassword();
  if (!newPassword) {
    return;
  }

  // Re-encrypt all history entries
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'CipherPad: Re-encrypting file...',
      cancellable: false
    },
    async (progress) => {
      const total = data.history.length;
      const newHistory = [];

      for (let i = 0; i < total; i++) {
        progress.report({ increment: (100 / total), message: `Entry ${i + 1}/${total}` });
        const entry = data.history[i];

        // Decrypt with old password
        const plain = await decrypt(entry.ciphertext, entry.salt, entry.iv, oldPassword!);

        // Re-encrypt with new password
        const enc = await encrypt(plain, newPassword);
        newHistory.push({
          salt: enc.salt,
          iv: enc.iv,
          ciphertext: enc.ciphertext,
          savedAt: entry.savedAt,
          hint: entry.hint
        });
      }

      const updatedData = { ...data, history: newHistory };
      await writeCtxtFile(uri, updatedData);

      // Update in-memory password
      passwordManager.set(uri.toString(), newPassword);

      vscode.window.showInformationMessage('Password changed successfully!');
    }
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export async function promptPassword(prompt: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt,
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.length === 0 ? 'Password cannot be empty' : undefined)
  });
}

export async function promptNewPassword(): Promise<string | undefined> {
  const pass1 = await vscode.window.showInputBox({
    prompt: 'Enter NEW password:',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.length < 1 ? 'Password cannot be empty' : undefined)
  });

  if (!pass1) {
    return undefined;
  }

  const pass2 = await vscode.window.showInputBox({
    prompt: 'Confirm NEW password:',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v !== pass1 ? 'Passwords do not match' : undefined)
  });

  if (!pass2) {
    return undefined;
  }

  if (pass1 !== pass2) {
    vscode.window.showErrorMessage('Passwords do not match. Please try again.');
    return undefined;
  }

  return pass1;
}
