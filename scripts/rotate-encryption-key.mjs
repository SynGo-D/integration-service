/**
 * Re-encrypts stored provider tokens under a new ENCRYPTION_KEY.
 *
 * The key protects every OAuth access and refresh token in the database.
 * Changing it without this step does not just lose the old tokens quietly:
 * decryptToken throws on the authentication tag, so every connected
 * repository breaks at the moment someone pushes to it.
 *
 * Run it while the old key is still known:
 *
 *   OLD_ENCRYPTION_KEY=<old> NEW_ENCRYPTION_KEY=<new> \
 *     node scripts/rotate-encryption-key.mjs [--commit]
 *
 * Without --commit it only reports what it would do. With it, each row is
 * updated in one transaction, so a failure part-way leaves the table as it
 * was rather than half under each key.
 *
 * The scheme is the one in src/utils/crypto.ts: AES-256-GCM, key derived
 * as sha256(ENCRYPTION_KEY), blob packed as IV | authTag | ciphertext and
 * base64-encoded.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import pg from "pg";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const commit = process.argv.includes("--commit");

const oldKey = requireEnv("OLD_ENCRYPTION_KEY");
const newKey = requireEnv("NEW_ENCRYPTION_KEY");

if (oldKey === newKey) {
    exit("OLD_ENCRYPTION_KEY and NEW_ENCRYPTION_KEY are the same — nothing to rotate.");
}

const OLD = createHash("sha256").update(oldKey).digest();
const NEW = createHash("sha256").update(newKey).digest();

const pool = new pg.Pool({
    host:     process.env.DB_HOST ?? "localhost",
    port:     Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? "integration_service_db",
    user:     process.env.DB_USER ?? "postgres",
    password: process.env.DB_PASSWORD
});

const client = await pool.connect();

try {
    const { rows } = await client.query(`
        SELECT id, repository_owner, repository_name, access_token, refresh_token
        FROM integrations
        WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL
        ORDER BY created_at
    `);

    console.log(`${rows.length} integration(s) hold an encrypted token.\n`);

    const updates = [];

    for (const row of rows) {
        const repo = `${row.repository_owner}/${row.repository_name}`;
        try {
            updates.push({
                id: row.id,
                repo,
                access:  reencrypt(row.access_token),
                refresh: reencrypt(row.refresh_token)
            });
            console.log(`  ${repo}: decrypts under the old key, ready`);
        } catch {
            // Most likely already re-encrypted, or written under a third
            // key. Either way, overwriting it would destroy a token we
            // cannot read, so it is left alone and reported.
            console.log(`  ${repo}: does NOT decrypt under the old key — skipped`);
        }
    }

    if (!commit) {
        console.log(`\nDry run. Re-run with --commit to write ${updates.length} row(s).`);
        process.exit(0);
    }

    await client.query("BEGIN");
    for (const u of updates) {
        await client.query(
            "UPDATE integrations SET access_token = $2, refresh_token = $3, updated_at = NOW() WHERE id = $1",
            [u.id, u.access, u.refresh]
        );
    }
    await client.query("COMMIT");

    console.log(`\nRe-encrypted ${updates.length} integration(s) under the new key.`);

    // Proves the new key reads what was just written, rather than trusting
    // that the write worked.
    const check = await client.query(
        "SELECT repository_owner, repository_name, access_token FROM integrations WHERE access_token IS NOT NULL"
    );
    for (const row of check.rows) {
        decrypt(row.access_token, NEW);
        console.log(`  verified: ${row.repository_owner}/${row.repository_name} decrypts under the new key`);
    }
} catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    exit(error instanceof Error ? error.message : String(error));
} finally {
    client.release();
    await pool.end();
}

function reencrypt(blob) {
    if (blob === null || blob === undefined) return null;
    return encrypt(decrypt(blob, OLD), NEW);
}

function decrypt(cipherText, key) {
    const data = Buffer.from(cipherText, "base64");
    const decipher = createDecipheriv(ALGORITHM, key, data.subarray(0, IV_LENGTH));
    decipher.setAuthTag(data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
    return Buffer.concat([
        decipher.update(data.subarray(IV_LENGTH + TAG_LENGTH)),
        decipher.final()
    ]).toString("utf8");
}

function encrypt(plainText, key) {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function requireEnv(name) {
    const value = process.env[name];
    if (!value) exit(`${name} is required.`);
    return value;
}

function exit(message) {
    console.error(message);
    process.exit(1);
}
