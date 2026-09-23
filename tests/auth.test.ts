import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes, scryptSync } from "crypto";

import { AuthService } from "../src/services/AuthService.js";
import { hashPassword, verifyPassword } from "../src/utils/password.js";
import type { UserCredentials } from "../src/repositories/UserRepository.js";

const USER = {
    id: "44444444-4444-4444-4444-444444444444",
    email: "amara@acme.io",
    fullName: "Amara Perera",
    createdAt: new Date(),
    updatedAt: new Date()
};

/** A users table holding whatever the test puts in it. */
function harness(stored: UserCredentials | null) {
    const users = {
        findCredentialsByEmail: vi.fn(async () => stored),
        create: vi.fn(async (email: string, fullName: string, passwordHash: string | null) => ({
            ...USER, email, fullName, passwordHash
        })),
        setPasswordIfUnset: vi.fn(async () => true),
        findByEmail: vi.fn(async () => null),
        findById: vi.fn(async () => null)
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { users, service: new AuthService(users as any) };
}

async function withPassword(password: string): Promise<UserCredentials> {
    return { user: USER, passwordHash: await hashPassword(password) };
}

describe("password hashing", () => {
    it("never stores the password itself", async () => {
        const hash = await hashPassword("correct horse battery");

        expect(hash).not.toContain("correct horse battery");
        expect(hash.startsWith("scrypt$")).toBe(true);
    });

    it("accepts the right password and rejects a near miss", async () => {
        const hash = await hashPassword("correct horse battery");

        expect(await verifyPassword("correct horse battery", hash)).toBe(true);
        expect(await verifyPassword("correct horse batterz", hash)).toBe(false);
        expect(await verifyPassword("", hash)).toBe(false);
    });

    it("salts, so two people who choose the same password get different hashes", async () => {
        const [first, second] = await Promise.all([hashPassword("shared"), hashPassword("shared")]);

        expect(first).not.toEqual(second);
        expect(await verifyPassword("shared", second)).toBe(true);
    });

    it("verifies a hash written with different cost parameters", async () => {
        // Hashes carry the parameters they were made with, so raising the
        // cost later must not lock out everyone who registered before.
        const salt = randomBytes(16);
        const cheap = [
            "scrypt", 16_384, 8, 1,
            salt.toString("base64"),
            scryptSync("portable", salt, 64, { N: 16_384, r: 8, p: 1 }).toString("base64")
        ].join("$");

        expect(await verifyPassword("portable", cheap)).toBe(true);
        expect(await verifyPassword("something else", cheap)).toBe(false);
    });

    it("refuses a hash it cannot read rather than throwing", async () => {
        expect(await verifyPassword("anything", "")).toBe(false);
        expect(await verifyPassword("anything", "plaintext")).toBe(false);
        expect(await verifyPassword("anything", "bcrypt$12$whatever$x$y$z")).toBe(false);
    });
});

describe("signing in", () => {
    it("returns the user when the password matches", async () => {
        const { service } = harness(await withPassword("correct horse battery"));

        await expect(service.authenticate("amara@acme.io", "correct horse battery"))
            .resolves.toMatchObject({ id: USER.id });
    });

    it("rejects the wrong password", async () => {
        const { service } = harness(await withPassword("correct horse battery"));

        await expect(service.authenticate("amara@acme.io", "wrong")).rejects.toMatchObject({ statusCode: 401 });
    });

    it("says the same thing for an unknown email as for a wrong password", async () => {
        const known = harness(await withPassword("correct horse battery"));
        const unknown = harness(null);

        const wrongPassword = await known.service.authenticate("amara@acme.io", "wrong").catch((e) => e);
        const noSuchUser = await unknown.service.authenticate("nobody@acme.io", "whatever").catch((e) => e);

        // Two different answers here would let anyone map which of a
        // company's addresses have accounts.
        expect(noSuchUser.message).toBe(wrongPassword.message);
        expect(noSuchUser.statusCode).toBe(401);
    });

    it("refuses an account an admin created but nobody has claimed", async () => {
        const { service } = harness({ user: USER, passwordHash: null });

        await expect(service.authenticate("amara@acme.io", "")).rejects.toMatchObject({ statusCode: 401 });
        await expect(service.authenticate("amara@acme.io", "anything")).rejects.toMatchObject({ statusCode: 401 });
    });

    it("rejects a malformed address before touching the database", async () => {
        const { service, users } = harness(null);

        await expect(service.authenticate("not-an-email", "whatever")).rejects.toMatchObject({ statusCode: 422 });
        expect(users.findCredentialsByEmail).not.toHaveBeenCalled();
    });
});

describe("registering", () => {
    let created: { email: string; fullName: string; passwordHash: string | null };

    beforeEach(() => {
        created = { email: "", fullName: "", passwordHash: null };
    });

    it("stores a hash, never the password", async () => {
        const { service, users } = harness(null);

        await service.register("Amara@Acme.io", "Amara Perera", "correct horse battery");

        [created.email, created.fullName, created.passwordHash] = users.create.mock.calls[0] as [
            string, string, string
        ];
        expect(created.email).toBe("amara@acme.io"); // stored lower-case
        expect(created.passwordHash).not.toContain("correct horse battery");
        expect(await verifyPassword("correct horse battery", created.passwordHash!)).toBe(true);
    });

    it("lets someone an admin added set their password, keeping their account", async () => {
        const { service, users } = harness({ user: USER, passwordHash: null });

        const user = await service.register("amara@acme.io", "Amara Perera", "correct horse battery");

        expect(user.id).toBe(USER.id); // same row ⇒ same memberships
        expect(users.create).not.toHaveBeenCalled();
        expect(users.setPasswordIfUnset).toHaveBeenCalled();
    });

    it("won't overwrite the password of an existing account", async () => {
        const { service } = harness(await withPassword("the real one"));

        await expect(service.register("amara@acme.io", "Impostor", "mine now"))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it("treats losing the race to claim an account as an account that exists", async () => {
        const { service, users } = harness({ user: USER, passwordHash: null });
        users.setPasswordIfUnset.mockResolvedValue(false);

        await expect(service.register("amara@acme.io", "Amara", "correct horse battery"))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it("insists on a password worth having", async () => {
        const { service } = harness(null);

        await expect(service.register("amara@acme.io", "Amara Perera", "short"))
            .rejects.toMatchObject({ statusCode: 422 });
    });
});
