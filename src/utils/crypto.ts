// src/utils/crypto.ts

/**
 * AES-256-GCM encryption/decryption utilities for access tokens.
 *
 * Why AES-256-GCM over AES-256-CBC?
 *   • GCM provides authenticated encryption (AEAD): the ciphertext includes
 *     an authentication tag that detects tampering, making decryption fail
 *     fast if the stored token has been modified.
 *   • CBC requires a separate MAC step; GCM is simpler and equally strong.
 *
 * Key derivation:
 *   • The ENCRYPTION_KEY env var must be a 64-char hex string (32 bytes).
 *   • We use SHA-256 to normalise it to exactly 32 bytes, making the system
 *     tolerant of arbitrary-length keys while remaining deterministic.
 *
 * Output format (base64-encoded single blob):
 *   [ 12-byte IV | 16-byte auth tag | ciphertext ]
 */

import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes
} from "crypto";

import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV — recommended for GCM
const TAG_LENGTH = 16; // 128-bit authentication tag

/**
 * Derive a fixed-length 32-byte key from the env variable.
 * Called once at module load; crashes early if the key is missing.
 */
function deriveKey(): Buffer {
    const raw = env.ENCRYPTION_KEY;
    if (!raw) {
        throw new Error(
            "ENCRYPTION_KEY is not set. " +
            "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
        );
    }
    return createHash("sha256").update(raw).digest();
}

const KEY = deriveKey();

/**
 * Encrypts a plain-text string and returns a base64-encoded blob.
 */
export function encryptToken(plainText: string): string {
    const iv     = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, KEY, iv);

    const encrypted = Buffer.concat([
        cipher.update(plainText, "utf8"),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    // Pack: IV | authTag | encrypted — all fixed-length except the last part
    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/**
 * Decrypts a base64-encoded blob produced by `encryptToken`.
 * Throws if the blob is tampered with or the key is wrong.
 */
export function decryptToken(cipherText: string): string {
    const data      = Buffer.from(cipherText, "base64");
    const iv        = data.subarray(0, IV_LENGTH);
    const authTag   = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]);

    return decrypted.toString("utf8");
}
