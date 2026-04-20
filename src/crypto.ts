/**
 * crypto.ts - AES-256-CBC encryption/decryption with PBKDF2 key derivation
 * Uses only Node.js built-in crypto module — zero external dependencies.
 *
 * Compatible with openssl:
 *   openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass pass:<password> -base64 -in <ciphertext_file>
 */

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32;      // 256 bits
const IV_LENGTH = 16;       // 128 bits
const SALT_LENGTH = 16;     // 128 bits
const KDF_ITERATIONS = 100000;
const KDF_DIGEST = 'sha256';

export interface EncryptResult {
  salt: string;       // base64
  iv: string;         // base64
  ciphertext: string; // base64
}

/**
 * Derive a 256-bit key from password + salt using PBKDF2.
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, KDF_ITERATIONS, KEY_LENGTH, KDF_DIGEST);
}

/**
 * Encrypt plaintext with AES-256-CBC.
 * Returns salt, iv, and ciphertext all as base64 strings.
 */
export async function encrypt(plaintext: string, password: string): Promise<EncryptResult> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintextBuf = Buffer.from(plaintext, 'utf8');

  const encrypted = Buffer.concat([
    cipher.update(plaintextBuf),
    cipher.final()
  ]);

  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: encrypted.toString('base64')
  };
}

/**
 * Decrypt base64-encoded ciphertext with AES-256-CBC.
 * Throws if the password is wrong or data is corrupted.
 */
export async function decrypt(
  ciphertext: string,
  salt: string,
  iv: string,
  password: string
): Promise<string> {
  const saltBuf = Buffer.from(salt, 'base64');
  const ivBuf = Buffer.from(iv, 'base64');
  const ciphertextBuf = Buffer.from(ciphertext, 'base64');

  const key = deriveKey(password, saltBuf);

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuf);
    const decrypted = Buffer.concat([
      decipher.update(ciphertextBuf),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error('Decryption failed: incorrect password or corrupted data.');
  }
}

/**
 * Verify password by attempting decryption.
 * Returns true if successful, false if password is wrong.
 */
export async function verifyPassword(
  ciphertext: string,
  salt: string,
  iv: string,
  password: string
): Promise<boolean> {
  try {
    await decrypt(ciphertext, salt, iv, password);
    return true;
  } catch {
    return false;
  }
}

export const CRYPTO_ALGORITHM = ALGORITHM;
export const CRYPTO_KDF = 'pbkdf2';
export const CRYPTO_ITERATIONS = KDF_ITERATIONS;
