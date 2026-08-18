/**
 * StateSigner
 * -----------------------------------------------------------------------------
 * OAuth's `state` parameter exists to defeat cross-site request forgery on
 * the callback. It has to be:
 *   1. Unpredictable to an attacker (they can't guess/forge one).
 *   2. Bound to the initiating user session, so if Mallory tricks Alice's
 *      browser into hitting our callback with Mallory's `code`, we notice.
 *   3. Time-limited, so a stale state can't be replayed.
 *
 * We satisfy all three with a HMAC-SHA256 signed, JSON-encoded state token:
 *     base64url(JSON({ u: userId, p: platform, n: nonce, e: expiresAtMs }))
 *     + "." + base64url(HMAC_SHA256(secret, payload))
 *
 * This is stateless — we do NOT need to store issued states in a database.
 * If the HMAC verifies AND the payload's user id matches the current session
 * AND expiresAt is in the future, the state is valid.
 *
 * SOLID: SRP — this class knows about state tokens and NOTHING else.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuthStateInvalidError } from "../domain/errors/index.js";
import type { ScmPlatform } from "../domain/interfaces/IScmProvider.js";

export interface StatePayload {
  /** Internal user id whose browser initiated the OAuth dance. */
  userId: string;
  platform: ScmPlatform;
  /** URL-encoded string; where to return the user in the frontend afterwards. */
  returnTo?: string;
  /** ms since epoch. */
  expiresAt: number;
  /** Random bytes to make each state unique even for same user + same time. */
  nonce: string;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export class StateSigner {
  constructor(private readonly secret: string, private readonly ttlMs = 10 * 60 * 1000) {
    if (!secret || secret.length < 32) {
      throw new Error("OAUTH_STATE_SECRET must be at least 32 characters");
    }
  }

  sign(input: Omit<StatePayload, "expiresAt" | "nonce">): string {
    const payload: StatePayload = {
      ...input,
      expiresAt: Date.now() + this.ttlMs,
      nonce: randomBytes(16).toString("hex"),
    };
    const bodyB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
    const sig = createHmac("sha256", this.secret).update(bodyB64).digest();
    return `${bodyB64}.${b64urlEncode(sig)}`;
  }

  verify(state: string, expectedUserId: string, expectedPlatform: ScmPlatform): StatePayload {
    const parts = state.split(".");
    if (parts.length !== 2) throw new OAuthStateInvalidError("Malformed state");
    const [bodyB64, sigB64] = parts;

    const expectedSig = createHmac("sha256", this.secret).update(bodyB64).digest();
    const givenSig = b64urlDecode(sigB64);

    // Timing-safe compare (avoids leaking secret via response-time attacks).
    if (expectedSig.length !== givenSig.length || !timingSafeEqual(expectedSig, givenSig)) {
      throw new OAuthStateInvalidError("State signature does not match");
    }

    let payload: StatePayload;
    try {
      payload = JSON.parse(b64urlDecode(bodyB64).toString("utf8")) as StatePayload;
    } catch {
      throw new OAuthStateInvalidError("State body is not valid JSON");
    }

    if (payload.userId !== expectedUserId) {
      throw new OAuthStateInvalidError("State user id does not match session");
    }
    if (payload.platform !== expectedPlatform) {
      throw new OAuthStateInvalidError("State platform does not match callback");
    }
    if (Date.now() > payload.expiresAt) {
      throw new OAuthStateInvalidError("State has expired");
    }
    return payload;
  }
}
