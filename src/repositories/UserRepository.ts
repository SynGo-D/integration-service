// src/repositories/UserRepository.ts

import { pool } from "../config/database.js";
import { User } from "../models/User.js";

/**
 * The stored password hash alongside the user it belongs to.
 *
 * Deliberately not part of `User`: everything else passes users around and
 * some of it serialises them to HTTP responses. Keeping the hash in a
 * separate shape means it can only travel where someone asked for it.
 */
export interface UserCredentials {
    user: User;
    /** NULL for an account an admin created; nobody can sign in to it yet. */
    passwordHash: string | null;
}

export class UserRepository {

    async create(email: string, fullName: string, passwordHash: string | null = null): Promise<User> {
        const query = `
            INSERT INTO users (email, full_name, password_hash)
            VALUES ($1, $2, $3)
            RETURNING id, email, full_name, created_at, updated_at;
        `;

        const result = await pool.query(query, [email, fullName, passwordHash]);
        return this.mapRow(result.rows[0]);
    }

    async findByEmail(email: string): Promise<User | null> {
        const query = `
            SELECT id, email, full_name, created_at, updated_at
            FROM users
            WHERE email = $1;
        `;

        const result = await pool.query(query, [email]);
        if (result.rows.length === 0) return null;

        return this.mapRow(result.rows[0]);
    }

    /** For sign-in only — every other lookup should use findByEmail. */
    async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
        const query = `
            SELECT id, email, full_name, password_hash, created_at, updated_at
            FROM users
            WHERE email = $1;
        `;

        const result = await pool.query(query, [email]);
        if (result.rows.length === 0) return null;

        return {
            user: this.mapRow(result.rows[0]),
            passwordHash: result.rows[0].password_hash ?? null
        };
    }

    /**
     * Sets the password of an account that has none, and returns whether it
     * did. The WHERE clause is the guard: an account that already has a
     * password can only be changed by someone who proves they know it, and
     * that flow doesn't exist yet, so this must never overwrite one.
     */
    async setPasswordIfUnset(userId: string, passwordHash: string, fullName: string): Promise<boolean> {
        const query = `
            UPDATE users
            SET password_hash = $2,
                full_name     = COALESCE(NULLIF($3, ''), full_name),
                updated_at    = NOW()
            WHERE id = $1 AND password_hash IS NULL;
        `;

        const result = await pool.query(query, [userId, passwordHash, fullName]);
        return (result.rowCount ?? 0) > 0;
    }

    async findById(id: string): Promise<User | null> {
        const query = `
            SELECT id, email, full_name, created_at, updated_at
            FROM users
            WHERE id = $1;
        `;

        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) return null;

        return this.mapRow(result.rows[0]);
    }

    private mapRow(row: any): User {
        return {
            id:        row.id,
            email:     row.email,
            fullName:  row.full_name,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        };
    }
}
