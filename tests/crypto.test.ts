import { describe, it, expect, beforeAll } from "vitest";

// crypto.ts derives its key from ENCRYPTION_KEY at module load and throws if
// it's missing, so the variable has to exist before the import is evaluated.
// A fixed test key keeps these tests independent of the developer's .env.
process.env.ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let encryptToken: (plain: string) => string;
let decryptToken: (cipher: string) => string;

beforeAll(async () => {
    ({ encryptToken, decryptToken } = await import("../src/utils/crypto.js"));
});

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** Flips one bit at `offset` inside the decoded blob and re-encodes it. */
function corruptAt(blob: string, offset: number): string {
    const bytes = Buffer.from(blob, "base64");
    bytes[offset] ^= 0x01;
    return bytes.toString("base64");
}

describe("encryptToken / decryptToken", () => {

    it("round-trips a token unchanged", () => {
        const token = "gho_16C7e42F292c6912E7710c838347Ae178B4a";
        expect(decryptToken(encryptToken(token))).toBe(token);
    });

    it("does not store the plaintext anywhere in the output", () => {
        const token = "gho_supersecrettokenvalue";
        const blob = encryptToken(token);

        expect(blob).not.toContain(token);
        expect(Buffer.from(blob, "base64").toString("utf8")).not.toContain(token);
    });

    it("produces a different ciphertext every time for the same input", () => {
        // A fresh random IV per call is what stops an observer learning that
        // two users hold the same token, or that a token was re-saved
        // unchanged. A static IV would make those identical.
        const token = "identical-input";
        const blobs = new Set(Array.from({ length: 20 }, () => encryptToken(token)));

        expect(blobs.size).toBe(20);
    });

    it("still decrypts correctly despite the random IV", () => {
        const token = "identical-input";
        const first = encryptToken(token);
        const second = encryptToken(token);

        expect(first).not.toBe(second);
        expect(decryptToken(first)).toBe(token);
        expect(decryptToken(second)).toBe(token);
    });

    it("emits base64 laid out as [IV | auth tag | ciphertext]", () => {
        const blob = encryptToken("x");
        const bytes = Buffer.from(blob, "base64");

        expect(blob).toMatch(/^[A-Za-z0-9+/]+={0,2}$/u);
        // 12-byte IV + 16-byte tag + at least one byte of ciphertext.
        expect(bytes.length).toBeGreaterThan(IV_LENGTH + TAG_LENGTH);
    });

    // -----------------------------------------------------------------------
    // Tamper detection — the entire reason GCM was chosen over CBC. If these
    // pass silently, a modified token in the database would decrypt into
    // garbage and be sent to GitHub as if it were genuine.
    // -----------------------------------------------------------------------

    it("rejects a tampered ciphertext", () => {
        const blob = encryptToken("gho_realtoken");
        const tampered = corruptAt(blob, IV_LENGTH + TAG_LENGTH);

        expect(() => decryptToken(tampered)).toThrow();
    });

    it("rejects a tampered authentication tag", () => {
        const blob = encryptToken("gho_realtoken");
        const tampered = corruptAt(blob, IV_LENGTH);

        expect(() => decryptToken(tampered)).toThrow();
    });

    it("rejects a tampered IV", () => {
        const blob = encryptToken("gho_realtoken");
        const tampered = corruptAt(blob, 0);

        expect(() => decryptToken(tampered)).toThrow();
    });

    it("rejects a truncated blob", () => {
        const blob = encryptToken("gho_realtoken");
        const truncated = Buffer.from(blob, "base64")
            .subarray(0, IV_LENGTH + TAG_LENGTH)
            .toString("base64");

        expect(() => decryptToken(truncated)).toThrow();
    });

    it("rejects a value that was never a ciphertext", () => {
        expect(() => decryptToken("not-encrypted-at-all")).toThrow();
    });

    // -----------------------------------------------------------------------
    // Input shapes the token column can actually hold
    // -----------------------------------------------------------------------

    it("round-trips an empty string", () => {
        // `activateIntegration` writes whatever the provider returned; an
        // empty refresh token must not blow up the encrypt path.
        expect(decryptToken(encryptToken(""))).toBe("");
    });

    it("round-trips non-ASCII characters", () => {
        const token = "tökèn-日本語-🔐";
        expect(decryptToken(encryptToken(token))).toBe(token);
    });

    it("round-trips a long token", () => {
        const token = "g".repeat(10_000);
        expect(decryptToken(encryptToken(token))).toBe(token);
    });

    it("round-trips the __PENDING__ sentinel used for placeholder rows", () => {
        expect(decryptToken(encryptToken("__PENDING__"))).toBe("__PENDING__");
    });
});
