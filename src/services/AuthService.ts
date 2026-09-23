// src/services/AuthService.ts

import { AppError } from "../errors/AppError.js";
import { ValidationError } from "../errors/ValidationError.js";
import { UserRepository } from "../repositories/UserRepository.js";
import { User } from "../models/User.js";
import {
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    hashPassword,
    verifyPassword,
    wastePasswordTime
} from "../utils/password.js";

/**
 * Registering and signing in.
 *
 * This service owns the users table, so it is where a password is checked;
 * main-backend turns a successful check into a session token and never sees
 * a hash.
 *
 * Two rules shape most of what follows:
 *
 *   • A failed sign-in says the same thing whatever went wrong. "No such
 *     account" and "wrong password" together let anyone test which of a
 *     company's email addresses are registered here, so both answer
 *     "Email or password is incorrect."
 *
 *   • Registering an email an admin already added is how an invited member
 *     sets their password. Those rows exist with no password
 *     (OrganizationService.addMember), and their organization memberships
 *     are already granted — creating a second account would strand them.
 */
export class AuthService {

    private readonly users: UserRepository;

    constructor(users?: UserRepository) {
        this.users = users ?? new UserRepository();
    }

    /**
     * Creates an account, or sets the password of one that was created for
     * this person by an admin.
     */
    async register(email: string, fullName: string, password: string): Promise<User> {
        const cleanEmail = this.cleanEmail(email);
        const cleanName = (fullName ?? "").trim();

        if (cleanName.length < 2 || cleanName.length > 120) {
            throw new ValidationError("Please give a name between 2 and 120 characters.");
        }
        this.assertPassword(password);

        const existing = await this.users.findCredentialsByEmail(cleanEmail);

        if (existing === null) {
            return this.users.create(cleanEmail, cleanName, await hashPassword(password));
        }

        if (existing.passwordHash !== null) {
            throw new AppError("An account with this email already exists. Sign in instead.", 409);
        }

        const claimed = await this.users.setPasswordIfUnset(
            existing.user.id,
            await hashPassword(password),
            cleanName
        );

        // Lost the race with another registration of the same address; the
        // account now has a password, so this is the same case as above.
        if (!claimed) {
            throw new AppError("An account with this email already exists. Sign in instead.", 409);
        }

        return { ...existing.user, fullName: cleanName };
    }

    /** The user behind these credentials, or 401. */
    async authenticate(email: string, password: string): Promise<User> {
        const cleanEmail = this.cleanEmail(email);

        if (!password) {
            throw this.rejected();
        }

        const found = await this.users.findCredentialsByEmail(cleanEmail);

        // No account, or one an admin created that nobody has claimed yet.
        // Both do the work of a real check first, so a caller can't tell
        // this case from a wrong password by how long the answer took.
        if (found === null || found.passwordHash === null) {
            await wastePasswordTime();
            throw this.rejected();
        }

        if (!await verifyPassword(password, found.passwordHash)) {
            throw this.rejected();
        }

        return found.user;
    }

    private rejected(): AppError {
        return new AppError("Email or password is incorrect.", 401);
    }

    private cleanEmail(email: string): string {
        const clean = (email ?? "").trim().toLowerCase();

        if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 255) {
            throw new ValidationError("A valid email address is required.");
        }
        return clean;
    }

    private assertPassword(password: string): void {
        if (typeof password !== "string"
            || password.length < MIN_PASSWORD_LENGTH
            || password.length > MAX_PASSWORD_LENGTH) {
            throw new ValidationError(
                `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`
            );
        }
    }
}
