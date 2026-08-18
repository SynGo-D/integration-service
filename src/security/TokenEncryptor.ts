/**
 * TokenEncryptor
 * -----------------------------------------------------------------------------
 * Encrypts OAuth access tokens and webhook secrets at rest with AES-256-GCM,
 * an AEAD (Authenticated Encryption with Associated Data) construction.
 *
 * Why AES-256-GCM and not AES-256-CBC or a fernet-style library:
 *   - GCM provides both confidentiality AND integrity in a single primitive.
 *     If the ciphertext is tampered with in the database, decryption FAILS
 *     loudly instead of silently returning garbage.
 *   - Ships with Node's built-in `crypto`, so no dependency.
 *   - 12-byte IV per encryption is standard, and we generate it fresh every
 *     time (CRITICAL: reusing an IV with the same key destroys the security
 *     of GCM).
 *
 * Why NOT store tokens plaintext:
 *   - FR-02.8 requires "securely store the access credentials".
 *   - Anyone with SELECT on the integrations table would otherwise be able
 *     to act as every connected GitHub/GitLab user.
 *
 * Key management:
 *   - The key is a 32-byte value provided via env var TOKEN_ENC_KEY_BASE64.
 *   - Generate it locally with:
 *       node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   - In production, mount it from a secret manager (AWS SM / GCP Secret
 *     Manager / Vault) — NEVER commit it. The .env.example ships with a
 *     placeholder.
 *   - Rotating keys: store the key ID as a prefix so we can decrypt with old
 *     keys during rollout. For simplicity we don't implement rotation here,
 *     but the ciphertext format ("v1:<iv>:<tag>:<ct>") leaves room to add
 *     "v2:..." later without breaking existing rows.
 *
 * SOLID: Single Responsibility — this class does ONE thing (encrypt/decrypt
 * a string) and knows nothing about integrations, DB, or HTTP.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;   // 96-bit IV is the GCM standard
const KEY_BYTES = 32;  // 256-bit key
const VERSION = "v1";

export class TokenEncryptor {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `TOKEN_ENC_KEY_BASE64 must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
          `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Compact string form: v1:<iv_b64>:<tag_b64>:<ct_b64>
    return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split(":");
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error("Ciphertext has unknown format or version");
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ct = Buffer.from(ctB64, "base64");
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  }
}
