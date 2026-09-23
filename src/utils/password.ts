// src/utils/password.ts

/**
 * Password hashing for sign-in.
 *
 * Why scrypt from node:crypto rather than bcrypt or argon2?
 *   • It is a memory-hard KDF designed for exactly this, and it ships with
 *     Node — no native build step, and no third-party package in the path
 *     of every login.
 *   • bcrypt silently truncates anything past 72 bytes; scrypt does not, so
 *     a long passphrase is hashed in full.
 *
 * Cost parameters (N = 2^15, r = 8, p = 1) need about 32 MB and ~100 ms per
 * hash on a normal machine. That is deliberately slow: it is what makes
 * guessing a stolen hash expensive. It is also why `maxmem` is raised —
 * Node's 32 MB default would reject this N.
 *
 * Stored format, so the cost can be raised later without invalidating
 * hashes already in the database:
 *
 *   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 *
 * A hash written with older parameters still verifies, because the
 * parameters are read from the string rather than assumed.
 */

import { randomBytes, scrypt, timingSafeEqual } from "crypto";

const COST = { N: 32_768, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** 128 MB: comfortably above what the parameters above need. */
const MAX_MEMORY = 128 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await derive(password, salt, COST, KEY_LENGTH);

    return [
        "scrypt",
        COST.N,
        COST.r,
        COST.p,
        salt.toString("base64"),
        key.toString("base64")
    ].join("$");
}

/**
 * Whether `password` produced `stored`.
 *
 * Returns false rather than throwing on a malformed or unknown hash: a row
 * we cannot interpret must not let anyone in, and it is not the caller's
 * problem to handle.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split("$");

    if (parts.length !== 6 || parts[0] !== "scrypt") {
        return false;
    }

    const [, n, r, p, salt, expected] = parts;
    const cost = { N: Number(n), r: Number(r), p: Number(p) };

    if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) {
        return false;
    }

    const expectedKey = Buffer.from(expected, "base64");

    try {
        const actualKey = await derive(password, Buffer.from(salt, "base64"), cost, expectedKey.length);

        // Byte-by-byte comparison leaks, through how long it takes, how much
        // of a guess was right; this one takes the same time either way.
        return actualKey.length === expectedKey.length && timingSafeEqual(actualKey, expectedKey);
    } catch {
        return false;
    }
}

/**
 * Spends the same work as a real verification and always fails.
 *
 * Called when no account matches the email, so that answering "no such
 * user" takes as long as answering "wrong password" — otherwise the
 * response time alone tells an attacker which addresses are registered.
 */
export async function wastePasswordTime(): Promise<false> {
    await derive("timing", Buffer.alloc(SALT_LENGTH), COST, KEY_LENGTH);
    return false;
}

/**
 * Wrapped by hand rather than with promisify: promisify picks scrypt's
 * three-argument overload, which leaves nowhere to pass the cost
 * parameters.
 *
 * Unicode is normalised so that a password typed with a composed accent
 * and the same password typed with a combining one still match.
 */
function derive(
    password: string,
    salt: Buffer,
    cost: { N: number; r: number; p: number },
    length: number
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(
            password.normalize("NFKC"),
            salt,
            length,
            { ...cost, maxmem: MAX_MEMORY },
            (error, key) => (error ? reject(error) : resolve(key))
        );
    });
}
