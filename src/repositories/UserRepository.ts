// src/repositories/UserRepository.ts

import { pool } from "../config/database.js";
import { User } from "../models/User.js";

export class UserRepository {

    async create(email: string, fullName: string): Promise<User> {
        const query = `
            INSERT INTO users (email, full_name)
            VALUES ($1, $2)
            RETURNING id, email, full_name, created_at, updated_at;
        `;

        const result = await pool.query(query, [email, fullName]);
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