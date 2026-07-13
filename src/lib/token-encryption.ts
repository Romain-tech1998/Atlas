import "server-only";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * RFC-0003 §8c: OAuth tokens are secrets — encrypted at rest, never logged,
 * never returned to the browser. AES-256-GCM via Node's built-in
 * `node:crypto`, no other dependency. `server-only` is a build-time guard:
 * importing this module from a Client Component is a build error, not a
 * runtime surprise.
 *
 * Output format: `base64(iv(12 bytes) || authTag(16 bytes) || ciphertext)`
 * — a single self-contained string that carries everything decryption
 * needs except the key. A fresh random IV is generated per call; reusing
 * an IV under GCM would break the authenticated-encryption guarantee.
 *
 * Both functions fail closed: a missing/malformed key, or a tampered/
 * malformed ciphertext (auth tag mismatch), throws rather than returning
 * garbage or silently degrading. Error messages never include the
 * plaintext, the key, or the ciphertext value itself.
 */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function loadKey(): Buffer {
  const encoded = process.env.ATLAS_TOKEN_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("ATLAS_TOKEN_ENCRYPTION_KEY is not set.");
  }

  let key: Buffer;
  try {
    key = Buffer.from(encoded, "base64");
  } catch {
    throw new Error("ATLAS_TOKEN_ENCRYPTION_KEY is not valid base64.");
  }

  if (key.length !== KEY_LENGTH) {
    throw new Error(`ATLAS_TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes.`);
  }

  return key;
}

export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptToken(ciphertext: string): string {
  const key = loadKey();

  let combined: Buffer;
  try {
    combined = Buffer.from(ciphertext, "base64");
  } catch {
    throw new Error("Stored token payload is not valid base64.");
  }

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Stored token payload is malformed.");
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored token payload failed authentication.");
  }
}

/** Used by the connect route to fail fast — before ever redirecting to
 * Google — rather than starting an OAuth flow that can't complete. */
export function hasValidEncryptionKey(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}
