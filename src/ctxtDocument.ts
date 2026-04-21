/**
 * ctxtDocument.ts - Read/write .ctxt file format.
 *
 * Disk format (JSON):
 * {
 *   "version": 1,
 *   "algorithm": "aes-256-cbc",
 *   "kdf": "pbkdf2",
 *   "iterations": 100000,
 *   "history": [
 *     {
 *       "salt": "<base64>",
 *       "iv": "<base64>",
 *       "ciphertext": "<base64>",
 *       "savedAt": "2024-01-01T00:00:00.000Z",
 *       "hint": ""
 *     }
 *   ]
 * }
 * history[0] is the most recent version. Maximum 3 entries.
 */

import * as vscode from 'vscode';
import { CRYPTO_ALGORITHM, CRYPTO_ITERATIONS, CRYPTO_KDF } from './crypto';

export const MAX_HISTORY = 4;
export const CTXT_VERSION = 1;

export interface HistoryEntry {
  salt: string;
  iv: string;
  ciphertext: string;
  savedAt: string;
  hint: string;
}

export interface CtxtFileData {
  version: number;
  algorithm: string;
  kdf: string;
  iterations: number;
  history: HistoryEntry[];
}

/**
 * Create a brand-new (empty) CtxtFileData with no history entries.
 */
export function createEmptyCtxtData(): CtxtFileData {
  return {
    version: CTXT_VERSION,
    algorithm: CRYPTO_ALGORITHM,
    kdf: CRYPTO_KDF,
    iterations: CRYPTO_ITERATIONS,
    history: []
  };
}

/**
 * Parse raw file bytes into CtxtFileData.
 * Throws if the data is not valid JSON or has no history.
 */
export function parseCtxtData(raw: Uint8Array): CtxtFileData {
  const text = Buffer.from(raw).toString('utf8').trim();

  if (!text) {
    // Empty file — treat as new file with no history
    return createEmptyCtxtData();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON. It may be corrupted.');
  }

  const data = parsed as Partial<CtxtFileData>;

  if (!Array.isArray(data.history)) {
    throw new Error('Invalid .ctxt file: missing "history" array.');
  }

  // Fill defaults for older or missing fields
  return {
    version: typeof data.version === 'number' ? data.version : CTXT_VERSION,
    algorithm: typeof data.algorithm === 'string' ? data.algorithm : CRYPTO_ALGORITHM,
    kdf: typeof data.kdf === 'string' ? data.kdf : CRYPTO_KDF,
    iterations: typeof data.iterations === 'number' ? data.iterations : CRYPTO_ITERATIONS,
    history: data.history.map((e: Partial<HistoryEntry>) => ({
      salt: e.salt ?? '',
      iv: e.iv ?? '',
      ciphertext: e.ciphertext ?? '',
      savedAt: e.savedAt ?? new Date().toISOString(),
      hint: e.hint ?? ''
    }))
  };
}

/**
 * Serialize CtxtFileData back to a UTF-8 Buffer ready to write to disk.
 */
export function serializeCtxtData(data: CtxtFileData): Buffer {
  return Buffer.from(JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Read and parse a .ctxt file from disk.
 * Returns createEmptyCtxtData() for empty or non-existent files.
 */
export async function readCtxtFile(uri: vscode.Uri): Promise<CtxtFileData> {
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    return parseCtxtData(raw);
  } catch (err: unknown) {
    // FileNotFound — new file
    if (
      err instanceof vscode.FileSystemError &&
      err.code === 'FileNotFound'
    ) {
      return createEmptyCtxtData();
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read file: ${msg}`);
  }
}

/**
 * Write CtxtFileData to disk.
 */
export async function writeCtxtFile(uri: vscode.Uri, data: CtxtFileData): Promise<void> {
  const bytes = serializeCtxtData(data);
  await vscode.workspace.fs.writeFile(uri, bytes);
}

/**
 * Check whether a .ctxt file exists and has at least one history entry.
 */
export function isExistingFile(data: CtxtFileData): boolean {
  return data.history.length > 0;
}

/**
 * Get the latest (most recent) history entry, or undefined for new files.
 */
export function getLatestEntry(data: CtxtFileData): HistoryEntry | undefined {
  return data.history[0];
}

/**
 * Prepend a new history entry, keeping at most MAX_HISTORY entries.
 */
export function prependHistoryEntry(
  data: CtxtFileData,
  entry: HistoryEntry
): CtxtFileData {
  const history = [entry, ...data.history].slice(0, MAX_HISTORY);
  return { ...data, history };
}
