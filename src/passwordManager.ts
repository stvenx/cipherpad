/**
 * passwordManager.ts - In-memory password store.
 * Passwords are keyed by file URI string and never persisted to disk.
 * Cleared automatically when a document is closed.
 */

export class PasswordManager {
  private passwords: Map<string, string> = new Map();

  /**
   * Store a password for a file URI.
   */
  set(uri: string, password: string): void {
    this.passwords.set(uri, password);
  }

  /**
   * Retrieve the stored password for a file URI.
   * Returns undefined if no password is stored.
   */
  get(uri: string): string | undefined {
    return this.passwords.get(uri);
  }

  /**
   * Check whether a password is stored for the given URI.
   */
  has(uri: string): boolean {
    return this.passwords.has(uri);
  }

  /**
   * Remove the password for a file URI (called on document close).
   */
  delete(uri: string): void {
    this.passwords.delete(uri);
  }

  /**
   * Remove all stored passwords (called on extension deactivation).
   */
  clear(): void {
    this.passwords.clear();
  }
}

// Singleton instance shared across the extension.
export const passwordManager = new PasswordManager();
